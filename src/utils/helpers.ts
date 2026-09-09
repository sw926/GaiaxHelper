import * as vscode from 'vscode';
import * as path from 'path';

// 类型定义
export interface JsonObject {
    [key: string]: JsonValue;
}

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface DataBindingData {
    data?: JsonObject;
    event?: JsonObject;
    track?: JsonObject;
    config?: JsonObject;
    animation?: JsonObject;
    [key: string]: JsonObject | undefined;
}

/**
 * 异步读取文件内容
 */
export async function readFileContent(uri: vscode.Uri): Promise<string | undefined> {
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(data).toString('utf-8');
    } catch (error) {
        console.error(`Failed to read file: ${uri.fsPath}`, error);
        return undefined;
    }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * 解析 JSON 文件内容
 */
export async function parseJsonFile(uri: vscode.Uri): Promise<JsonObject | undefined> {
    const content = await readFileContent(uri);
    if (!content) {
        return undefined;
    }

    try {
        return JSON.parse(content) as JsonObject;
    } catch (error) {
        console.error(`Failed to parse JSON file: ${uri.fsPath}`, error);
        return undefined;
    }
}

/**
 * 在 JSON 对象中查找指定 id
 */
export function findIdInJson(jsonData: JsonValue, id: string): boolean {
    if (typeof jsonData !== 'object' || jsonData === null) {
        return false;
    }

    if (Array.isArray(jsonData)) {
        return jsonData.some(item => findIdInJson(item, id));
    }

    const obj = jsonData as JsonObject;
    for (const key in obj) {
        if (key === 'id' && obj[key] === id) {
            return true;
        }
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            if (findIdInJson(obj[key], id)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * 从 JSON 对象中提取所有 id 值
 */
export function extractIdsFromJson(data: JsonValue): string[] {
    const ids: string[] = [];

    if (typeof data !== 'object' || data === null) {
        return ids;
    }

    if (Array.isArray(data)) {
        data.forEach(item => {
            ids.push(...extractIdsFromJson(item));
        });
        return ids;
    }

    const obj = data as JsonObject;
    for (const key in obj) {
        if (key === 'id' && typeof obj[key] === 'string') {
            ids.push(obj[key] as string);
        }
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            ids.push(...extractIdsFromJson(obj[key]));
        }
    }

    return ids;
}

/**
 * 在内容中查找 JSON 键值对（如 "id": "xxx"）的位置，容忍冒号两侧任意空白
 * 匹配的 range 覆盖整个键值对文本
 */
export function findKeyValuePositionInContent(content: string, key: string, value: string): vscode.Range | undefined {
    const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"${escapeRegExp(value)}"`);
    const match = pattern.exec(content);
    if (!match || match.index === undefined) {
        return undefined;
    }

    const linesBeforeMatch = content.substring(0, match.index).split('\n');
    const startLine = linesBeforeMatch.length - 1;
    const startCharacter = linesBeforeMatch[linesBeforeMatch.length - 1].length;
    const totalLines = content.substring(0, match.index + match[0].length).split('\n');
    const endLine = totalLines.length - 1;
    const endCharacter = endLine === startLine
        ? startCharacter + match[0].length
        : totalLines[totalLines.length - 1].length;

    return new vscode.Range(startLine, startCharacter, endLine, endCharacter);
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在内容中查找作为键出现的字符串（`"key":`）的位置，range 覆盖 `"key"`
 */
export function findKeyPositionInContent(content: string, key: string): vscode.Range | undefined {
    const pattern = new RegExp(`"${escapeRegExp(key)}"(?=\\s*:)`);
    const match = pattern.exec(content);
    if (!match || match.index === undefined) {
        return undefined;
    }

    const linesBeforeMatch = content.substring(0, match.index).split('\n');
    const startLine = linesBeforeMatch.length - 1;
    const startCharacter = linesBeforeMatch[linesBeforeMatch.length - 1].length;

    return new vscode.Range(startLine, startCharacter, startLine, startCharacter + match[0].length);
}

/**
 * 获取同目录下的文件 URI
 */
export function getFileInSameDirectory(documentUri: vscode.Uri, fileName: string): vscode.Uri {
    const currentFileDir = path.dirname(documentUri.fsPath);
    const filePath = path.join(currentFileDir, fileName);
    return vscode.Uri.file(filePath);
}

/**
 * 检查是否在 JSON 的 id 字段中
 */
export function isInJsonIdField(document: vscode.TextDocument, position: vscode.Position, word: string): boolean {
    const lineText = document.lineAt(position.line).text;
    const matchKeyId = lineText.match(/"id"\s*:\s*"([^"]+)"/);
    return matchKeyId !== null && matchKeyId[1] === word;
}

/**
 * 检查文档是否为 GaiaX DataBinding 文件
 * （.databinding 通过 extensions 关联到内置 json 语言，语言 id 即 json）
 */
export function isGaiaxDataBindingDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'json' && path.basename(document.uri.fsPath) === 'index.databinding';
}
