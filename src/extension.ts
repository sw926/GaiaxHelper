import * as vscode from 'vscode';
import * as path from 'path';

// 导入工具函数
import { readFileContent, fileExists, parseJsonFile, findIdInJson, findKeyValuePositionInContent, findKeyPositionInContent, getFileInSameDirectory, isInJsonIdField, JsonObject, JsonValue, DataBindingData } from './utils/helpers';

// 导入 Provider
import {
    CssIdCompletionProvider,
    DataBindingKeyCompletionProvider
} from './providers/completion-providers';

import { GaiaxDiagnosticProvider } from './providers/diagnostic-providers';

// 诊断提供器实例
let diagnosticProvider: GaiaxDiagnosticProvider;

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    console.log('GaiaX Helper extension is now active!');

    // 初始化诊断提供器
    diagnosticProvider = new GaiaxDiagnosticProvider();

    // ==================== 代码提示 ====================

    // 1. CSS 中输入 # 显示 index.json 中定义的 id 作为候选
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'css' },
            new CssIdCompletionProvider(),
            '#'
        )
    );

    // 2. databinding 的 data/event/track 第一层级输入 key 时显示 index.json 中定义的 id 作为候选
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'json', pattern: '**/index.databinding' },
            new DataBindingKeyCompletionProvider(),
            '"'
        )
    );

    // ==================== 跳转 ====================

    const definitionProviders: Array<{ provider: vscode.DefinitionProvider; languages: string[] }> = [
        { provider: new JsonToCssDefinitionProvider(), languages: ['json'] },
        { provider: new CssToJsonDefinitionProvider(), languages: ['css'] },
        { provider: new JsonToDataBindingDefinitionProvider(), languages: ['json'] },
        { provider: new DataBindingToJsonDefinitionProvider(), languages: ['json'] },
    ];

    definitionProviders.forEach(({ provider, languages }) => {
        languages.forEach(language => {
            context.subscriptions.push(
                vscode.languages.registerDefinitionProvider({ language }, provider)
            );
        });
    });

    // ==================== 诊断 ====================

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            await diagnosticProvider.updateDiagnostics(document);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            await diagnosticProvider.updateDiagnostics(document);
        })
    );

    // 编辑中实时刷新诊断（带防抖）
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                void diagnosticProvider.updateDiagnostics(event.document);
            }, 500);
        })
    );

    // 文件关闭时清理诊断
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            diagnosticProvider.clearDiagnostics(document);
        })
    );

    // 初始诊断
    const openDocuments = vscode.workspace.textDocuments;
    for (const document of openDocuments) {
        await diagnosticProvider.updateDiagnostics(document);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('Your extension "gaiax-helper" is now deactivated!');
}

// ==================== 跳转 ====================

class JsonToCssDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        // 检查文件名是否为 index.json
        if (path.basename(document.uri.fsPath) !== 'index.json') {
            return undefined;
        }

        // 获取光标位置的单词
        const wordRange = document.getWordRangeAtPosition(position, /[\-0-9a-zA-Z]+/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // 检查是否在 id 字段中
        if (!isInJsonIdField(document, position, word)) {
            return undefined;
        }

        // 获取 CSS 文件 URI
        const cssUri = getFileInSameDirectory(document.uri, 'index.css');

        // 检查并读取 CSS 文件
        if (!(await fileExists(cssUri))) {
            return undefined;
        }

        const cssContent = await readFileContent(cssUri);
        if (!cssContent) {
            return undefined;
        }

        // 查找对应 id 的 CSS 规则（容忍 #id{ 无空格写法）
        const cssRulePattern = new RegExp(`#${word}\\s*\\{[^}]*\\}`, 'g');
        const match = cssRulePattern.exec(cssContent);
        if (!match || match.index === undefined) {
            return undefined;
        }

        // 计算并返回选择器位置（match.index 即 #id 起点）
        const linesBeforeMatch = cssContent.substring(0, match.index).split('\n');
        const targetLine = linesBeforeMatch.length - 1;
        const targetCharacter = linesBeforeMatch[targetLine].length;
        return new vscode.Location(cssUri, new vscode.Position(targetLine, targetCharacter));
    }
}

class CssToJsonDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        // 光标须位于 #id 选择器文本上
        const lineText = document.lineAt(position.line).text;
        const selectorRegex = /#([A-Za-z0-9_-]+)/g;
        let m: RegExpExecArray | null;
        let word: string | undefined;
        while ((m = selectorRegex.exec(lineText)) !== null) {
            const start = m.index;
            const end = start + m[0].length;
            if (position.character >= start && position.character <= end) {
                word = m[1];
                break;
            }
        }
        if (!word) {
            return undefined;
        }

        // 获取 JSON 文件 URI
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');

        // 解析 JSON 文件
        const jsonData = await parseJsonFile(jsonUri);
        if (!jsonData) {
            return undefined;
        }

        // 查找 JSON 中是否存在该 id
        if (!findIdInJson(jsonData, word)) {
            return undefined;
        }

        // 读取 JSON 内容以查找位置
        const jsonContent = await readFileContent(jsonUri);
        if (!jsonContent) {
            return undefined;
        }

        // 返回 JSON 文件中的位置（容忍冒号两侧任意空白）
        const jsonRange = findKeyValuePositionInContent(jsonContent, 'id', word);
        return jsonRange ? new vscode.Location(jsonUri, jsonRange) : undefined;
    }
}


class JsonToDataBindingDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        // 检查文件名是否为 index.json
        if (path.basename(document.uri.fsPath) !== 'index.json') {
            return undefined;
        }

        // 获取光标位置的单词
        const wordRange = document.getWordRangeAtPosition(position, /[\-0-9a-zA-Z]+/);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // 检查是否在 id 字段中
        if (!isInJsonIdField(document, position, word)) {
            return undefined;
        }

        // 获取 DataBinding 文件 URI
        const dataBindingUri = getFileInSameDirectory(document.uri, 'index.databinding');

        // 解析 DataBinding 文件
        const dataBindingData = await parseJsonFile(dataBindingUri) as DataBindingData | undefined;
        if (!dataBindingData) {
            return undefined;
        }

        // 查找 data 对象下对应的属性
        if (!dataBindingData.data || !(word in dataBindingData.data)) {
            return undefined;
        }

        // 读取 DataBinding 内容以查找位置
        const dataBindingContent = await readFileContent(dataBindingUri);
        if (!dataBindingContent) {
            return undefined;
        }

        // 返回 DataBinding 文件中的位置（按"作为键出现"匹配，避免误中字符串值）
        const dataBindingRange = findKeyPositionInContent(dataBindingContent, word);
        return dataBindingRange ? new vscode.Location(dataBindingUri, dataBindingRange) : undefined;
    }
}

class DataBindingToJsonDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Location | undefined> {
        // 检查文件名是否为 index.databinding
        if (path.basename(document.uri.fsPath) !== 'index.databinding') {
            return undefined;
        }

        // 获取光标位置的单词
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // 获取 JSON 文件 URI
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');

        // 解析 JSON 文件
        const jsonData = await parseJsonFile(jsonUri);
        if (!jsonData) {
            return undefined;
        }

        // 查找 JSON 中是否存在该 id
        if (!findIdInJson(jsonData, word)) {
            return undefined;
        }

        // 读取 JSON 内容以查找位置
        const jsonContent = await readFileContent(jsonUri);
        if (!jsonContent) {
            return undefined;
        }

        // 返回 JSON 文件中的位置（容忍冒号两侧任意空白）
        const jsonRange = findKeyValuePositionInContent(jsonContent, 'id', word);
        return jsonRange ? new vscode.Location(jsonUri, jsonRange) : undefined;
    }
}
