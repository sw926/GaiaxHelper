import * as vscode from 'vscode';
import { parseJsonFile, extractIdsFromJson, getFileInSameDirectory, JsonObject } from '../utils/helpers';

/**
 * CSS 中输入 # 显示 index.json 中定义的 id 作为候选
 */
export class CssIdCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | undefined> {
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // 匹配 # 及其后已输入的部分（支持 #ti 中途过滤）
        const hashMatch = /#([A-Za-z0-9_-]*)$/.exec(textBeforeCursor);
        if (!hashMatch) {
            return undefined;
        }

        // 必须处于选择器位置：# 在行首（或 { , ; 之后），排除 color: #ff 这类十六进制颜色
        const hashIdx = position.character - hashMatch[0].length;
        const beforeHash = textBeforeCursor.substring(0, hashIdx).trimEnd();
        if (beforeHash !== '' && !/[{,;]$/.test(beforeHash)) {
            return undefined;
        }

        // 获取 JSON 文件 URI
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');

        // 解析 JSON 文件
        const jsonData = await parseJsonFile(jsonUri);
        if (!jsonData) {
            return undefined;
        }

        // 提取 JSON 中的 id 列表
        const ids = extractIdsFromJson(jsonData);
        if (ids.length === 0) {
            return undefined;
        }

        // 创建 CompletionItem 列表
        // 触发字符 # 不在 label 前缀内：VS Code 会用输入流 "#..." 过滤 label 导致候选全被滤掉。
        // 必须让替换范围覆盖 #、filterText 带 # 前缀
        const range = new vscode.Range(
            position.line, hashIdx,
            position.line, position.character
        );
        return ids.map(id => {
            const item = new vscode.CompletionItem(
                id,
                vscode.CompletionItemKind.Reference
            );
            item.detail = 'ID from index.json';
            item.documentation = new vscode.MarkdownString(`index.json 中定义的图层 id，插入 **#${id}** 选择器`);
            item.range = range;
            item.filterText = '#' + id;
            item.insertText = '#' + id;
            return item;
        });
    }
}

/**
 * databinding 的 data/event/track 第一层级输入 key 时
 * 显示 index.json 中定义的 id 作为候选
 */
export class DataBindingKeyCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | undefined> {
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // 匹配已输入的引号及键名前缀（支持 "ti 中途过滤）
        // 两种形态：'..."'（键名开头）或 '..."xxx'（输入中途）
        const quoteMatch = /"([A-Za-z0-9_-]*)$/.exec(textBeforeCursor);
        if (!quoteMatch) {
            return undefined;
        }
        // 光标处于值位置（前面已是完整键值对）时不触发
        if (/"\s*:\s*"[A-Za-z0-9_-]*$/.test(textBeforeCursor)) {
            return undefined;
        }

        // 判断当前是否处于 data/event/track 的第一层级
        const section = this.getCurrentSection(document, position);
        if (!section) {
            return undefined;
        }

        // 获取 JSON 文件 URI
        const jsonUri = getFileInSameDirectory(document.uri, 'index.json');

        // 解析 JSON 文件
        const jsonData = await parseJsonFile(jsonUri);
        if (!jsonData) {
            return undefined;
        }

        // 提取 JSON 中的 id 列表
        const ids = extractIdsFromJson(jsonData);
        if (ids.length === 0) {
            return undefined;
        }

        // 创建 CompletionItem 列表
        // 触发字符 " 不在 label 前缀内：需让替换范围覆盖已输入的 "prefix、
        // filterText 带 " 前缀。用 snippet 插入完整键并处理自动闭合的引号
        const quoteIdx = position.character - quoteMatch[0].length;
        // 检测闭引号是否已被自动补出（如 ""）
        const restOfLine = lineText.substring(position.character);
        const hasAutoClosedQuote = quoteMatch[1] === '' && restOfLine.startsWith('"');
        const range = new vscode.Range(
            position.line, quoteIdx,
            position.line, hasAutoClosedQuote ? position.character + 1 : position.character
        );

        return ids.map(id => {
            const item = new vscode.CompletionItem(
                id,
                vscode.CompletionItemKind.Property
            );
            item.detail = `ID from index.json（${section} 节第一层级）`;
            item.documentation = new vscode.MarkdownString(`绑定到 index.json 中定义的图层 **${id}**`);
            item.range = range;
            item.filterText = '"' + quoteMatch[1] + id;
            item.insertText = new vscode.SnippetString(`"${id}": {$0}`);
            return item;
        });
    }

    /**
     * 判断光标是否位于 data/event/track 对象的第一层级（键位置）
     * 返回所在节名（data/event/track），不在则返回 undefined
     */
    private getCurrentSection(document: vscode.TextDocument, position: vscode.Position): 'data' | 'event' | 'track' | undefined {
        const text = document.getText();
        const offset = document.offsetAt(position);

        // 从文档开头扫描到光标，维护一个「路径栈」
        // 栈结构：每层记录 键名 + 是否数组
        const stack: Array<{ key: string; isArray: boolean }> = [];
        let i = 0;
        let lastKey: string | undefined;

        const skipWhitespace = (idx: number): number => {
            while (idx < text.length && /\s/.test(text[idx])) {
                idx++;
            }
            return idx;
        };

        while (i < offset && i < text.length) {
            const char = text[i];

            if (char === '"') {
                // 读取字符串（处理转义）
                const start = i;
                i++;
                while (i < text.length && text[i] !== '"') {
                    i += text[i] === '\\' ? 2 : 1;
                }
                i++; // 收尾引号
                const str = text.substring(start + 1, i - 1);

                // 判断该字符串是否为键（后面跟冒号）
                const after = skipWhitespace(i);
                if (text[after] === ':' && i <= offset) {
                    lastKey = str;
                }
                continue;
            }

            if (char === '{' || char === '[') {
                stack.push({ key: lastKey || '', isArray: char === '[' });
                lastKey = undefined;
                i++;
                continue;
            }

            if (char === '}' || char === ']') {
                stack.pop();
                i++;
                continue;
            }

            i++;
        }

        // 此时光标前的结构：[..., { key: section }, ...]
        // 第一层级 = 栈深度 2（根对象 → section 对象）且 section key 匹配
        if (stack.length === 2) {
            const sectionKey = stack[1].key;
            if (sectionKey === 'data' || sectionKey === 'event' || sectionKey === 'track') {
                // 还需确认当前键是新键（栈深度2下 lastKey 属于 section 内）
                // lastKey 记录的是最近解析的键；光标正在输入新键时 lastKey 应属于上一层
                // 简化判断：栈深度 2 即 section 内的第一层级
                return sectionKey;
            }
        }

        return undefined;
    }
}
