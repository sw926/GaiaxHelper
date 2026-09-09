import * as vscode from 'vscode';
import * as path from 'path';
import { parseJsonFile, extractIdsFromJson, getFileInSameDirectory, isGaiaxDataBindingDocument, JsonObject } from '../utils/helpers';
import { checkExpression, collectStringValues } from '../validators/expression-validator';

export class GaiaxDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('gaiax');
    }

    /**
     * 更新诊断信息
     */
    async updateDiagnostics(document: vscode.TextDocument): Promise<void> {
        const fileName = path.basename(document.uri.fsPath);

        const isCss = document.languageId === 'css' && fileName === 'index.css';
        const isDataBinding = isGaiaxDataBindingDocument(document) && fileName === 'index.databinding';
        if (!isCss && !isDataBinding) {
            return;
        }

        let diagnostics: vscode.Diagnostic[] = [];

        if (isCss) {
            diagnostics = await this.validateCssFile(document);
        } else {
            diagnostics = await this.validateDataBindingFile(document);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * 验证 CSS 文件：#id 选择器必须已在 index.json 中定义
     */
    private async validateCssFile(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];

        // 获取 index.json 中定义的 id 集合
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');
        const jsonData = await parseJsonFile(jsonUri);
        if (!jsonData) {
            // index.json 缺失或解析失败时静默（可能是编辑中间态）
            return diagnostics;
        }
        const definedIds = new Set(extractIdsFromJson(jsonData));

        const content = document.getText();
        const lines = content.split('\n');
        // 匹配 #id 选择器（排除颜色值 #fff：仅当 # 后直接跟 { 或行内选择器位置才算）
        const selectorRegex = /#([A-Za-z0-9_-]+)/g;

        lines.forEach((line, lineIndex) => {
            // 跳过规则体内部：仅识别选择器行（行首空白后紧跟 #id，后面是 { 或 , 或行尾）
            const trimmed = line.trim();
            if (!trimmed.startsWith('#')) {
                return;
            }

            let m: RegExpExecArray | null;
            selectorRegex.lastIndex = 0;
            while ((m = selectorRegex.exec(trimmed)) !== null) {
                const id = m[1];
                if (definedIds.has(id)) {
                    continue;
                }

                const startChar = line.indexOf(m[0]);
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(lineIndex, startChar, lineIndex, startChar + m[0].length),
                    `"${id}" 未在 index.json 中定义`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        });

        return diagnostics;
    }

    /**
     * 验证 DataBinding 文件：
     * data/event/track 第一层级 key 必须已在 index.json 中定义
     */
    private async validateDataBindingFile(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        const diagnostics: vscode.Diagnostic[] = [];

        let data: JsonObject;
        try {
            data = JSON.parse(document.getText()) as JsonObject;
        } catch (error) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                `JSON 解析错误: ${(error as Error).message}`,
                vscode.DiagnosticSeverity.Error
            ));
            return diagnostics;
        }

        if (typeof data !== 'object' || data === null) {
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(0, 0, 0, 0),
                'DataBinding 文件必须是 JSON 对象',
                vscode.DiagnosticSeverity.Error
            ));
            return diagnostics;
        }

        // 获取 index.json 中定义的 id 集合
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');
        const jsonData = await parseJsonFile(jsonUri);
        const definedIds = jsonData ? new Set(extractIdsFromJson(jsonData)) : null;

        const content = document.getText();

        // 1. 表达式语法检查（全部值字符串；语法错误 → 引擎求值 null → 渲染静默失效）
        const offsetToPosition = (offset: number): vscode.Position =>
            document.positionAt(Math.min(offset, content.length));

        for (const str of collectStringValues(content)) {
            const issues = checkExpression(str.value);
            for (const issue of issues) {
                // 定位：问题偏移相对表达式内容，换算回文档坐标
                const start = offsetToPosition(str.contentStart + issue.offset);
                const end = offsetToPosition(str.contentStart + issue.offset + issue.length);
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(start, end),
                    issue.hint ? `${issue.message}。${issue.hint}` : issue.message,
                    issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
                );
                diagnostic.source = 'gaiax-expression';
                diagnostics.push(diagnostic);
            }
        }

        // 2. data/event/track 三个节的第一层级 key 校验（需要 index.json）
        if (!definedIds) {
            return diagnostics;
        }
        const sections = ['data', 'event', 'track'] as const;

        for (const section of sections) {
            const sectionObj = data[section];
            if (!sectionObj || typeof sectionObj !== 'object' || Array.isArray(sectionObj)) {
                continue;
            }

            for (const key of Object.keys(sectionObj)) {
                if (definedIds.has(key)) {
                    continue;
                }

                // 定位到该 key 在文件中的位置
                const range = this.findSectionKeyRange(content, section, key);
                diagnostics.push(new vscode.Diagnostic(
                    range,
                    `"${key}" 未在 index.json 中定义（${section} 节第一层级 key 应为 index.json 中的图层 id）`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        return diagnostics;
    }

    /**
     * 定位 section 内第一层级 key 在文本中的位置
     */
    private findSectionKeyRange(content: string, section: string, key: string): vscode.Range {
        // 逐行扫描："data": { 之后同一嵌套层级内的 "key":
        const lines = content.split('\n');
        let depth = 0;
        let inSection = false;
        const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 记录 section 进入（"data": {）
            if (!inSection && new RegExp(`"${escape(section)}"\\s*:\\s*\\{`).test(line)) {
                inSection = true;
                depth = this.countBraces(line, `"${escape(section)}"`.length);
                // key 可能在同一行
                const keyIdx = line.indexOf(`"${key}"`);
                if (keyIdx !== -1 && new RegExp(`"${escape(key)}"\\s*:`).test(line)) {
                    return new vscode.Range(i, keyIdx, i, keyIdx + key.length + 2);
                }
                continue;
            }

            if (inSection) {
                // 检查本行是否有该 key（第一层级深度内）
                const keyRegex = new RegExp(`"${escape(key)}"\\s*:`);
                if (depth === 0 && keyRegex.test(line)) {
                    const keyIdx = line.indexOf(`"${key}"`);
                    return new vscode.Range(i, keyIdx, i, keyIdx + key.length + 2);
                }
                depth += this.countBraces(line, 0);

                if (depth < 0) {
                    // section 结束
                    inSection = false;
                    depth = 0;
                }
            }
        }

        return new vscode.Range(0, 0, 0, 1);
    }

    /**
     * 统计行内 {} 的增减量（忽略字符串内的括号）
     */
    private countBraces(line: string, from: number): number {
        let count = 0;
        let inString = false;
        for (let i = from; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inString = !inString;
            } else if (!inString) {
                if (ch === '{') {
                    count++;
                } else if (ch === '}') {
                    count--;
                }
            }
        }
        return count;
    }

    /**
     * 清除诊断信息
     */
    clearDiagnostics(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri);
    }

    /**
     * 清除所有诊断信息
     */
    clearAllDiagnostics(): void {
        this.diagnosticCollection.clear();
    }
}
