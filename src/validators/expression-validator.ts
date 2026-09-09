/**
 * GaiaX V2 表达式语法校验器
 *
 * 文法 1:1 还原自 GaiaXAnalyze/GXAnalyzeCore 的 C++ LR(1) 文法（递归下降实现），
 * 与 gaiax skill 的 gaiax_lint.py 同源。语法错误 → 引擎求值返回 null → 渲染静默失效。
 *
 * EBNF（优先级从低到高，二元运算全部左结合）：
 *   elvis        := elvis "?:" cond | cond
 *   cond         := logicOr "?" logicOr ":" logicOr    （真/假部不能再是裸三元）
 *   logicOr      := logicOr "||" logicAnd | logicAnd
 *   logicAnd     := logicAnd "&&" equality | equality
 *   equality     := equality ("=="|"!=") relational | relational
 *   relational   := relational (">"|">="|"<"|"<=") additive | additive
 *   additive     := additive ("+"|"-") multiplicative | multiplicative
 *   multiplicative := multiplicative ("*"|"/"|"%") unary | unary
 *   unary        := ("+"|"-"|"!") primary | primary    （不可叠加）
 *   primary      := "(" elvis ")" | funcCall | literal
 *   funcCall     := IDENT "(" [literal ("," literal)*] ")"   （实参仅字面量）
 *   literal      := "true" | "false" | "null" | path | "$$" | FLOAT | LONG | STRING
 *   path         := "$" {字母|数字|_|.|[|]}                  （下标仅数字）
 *   STRING       := '...'（仅单引号，无转义）
 */

/** 单个表达式问题 */
export interface ExpressionIssue {
    /** 错误或警告 */
    severity: 'error' | 'warning';
    /** 一句话描述 */
    message: string;
    /** 修复建议 */
    hint: string;
    /** 问题在表达式字符串中的偏移（用于定位） */
    offset: number;
    /** 问题覆盖长度 */
    length: number;
}

interface Token {
    kind: 'path' | '$$' | 'num' | 'string' | 'ident' | 'func' | 'op' | 'lparen' | 'rparen' | 'comma' | 'unterminated';
    value: string;
    offset: number;
}

class ExprError extends Error {
    hint: string;
    offset: number;
    length: number;

    constructor(message: string, hint: string, offset = 0, length = 1) {
        super(message);
        this.hint = hint;
        this.offset = offset;
        this.length = length;
    }
}

const TOKEN_PATH = /^\$[0-9A-Za-z_.[\]]+/;
const TOKEN_NUM = /^\d+(?:\.\d+)?/;
const TOKEN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * 把表达式切成 token 列表；词法错误抛 ExprError
 */
function tokenizeExpression(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = expr.length;

    while (i < n) {
        const ch = expr[i];

        if (ch === ' ') {
            i++;
            continue;
        }
        if (ch === '\n' || ch === '\r' || ch === '\t') {
            throw new ExprError(
                '表达式中含换行/Tab 等空白字符',
                'GaiaX 表达式引擎只接受半角空格，JSON 中请把表达式写在同一行（勿用 \\n）',
                i, 1
            );
        }
        if (ch === '#' || ch === '~') {
            throw new ExprError(
                `表达式含保留字符 '${ch}'`,
                `'#' 与 '~' 是表达式引擎内部保留符，不可出现在表达式中`,
                i, 1
            );
        }
        if (ch === '$') {
            if (i + 1 < n && expr[i + 1] === '$') {
                tokens.push({ kind: '$$', value: '$$', offset: i });
                i += 2;
                continue;
            }
            const m = TOKEN_PATH.exec(expr.substring(i));
            if (!m) {
                throw new ExprError(
                    "'$' 后缺少合法路径字符",
                    '$ 路径仅允许 字母/数字/_/./[]，如 $data.items[0].title',
                    i, 1
                );
            }
            const full = m[0];
            const path = full.substring(1);
            if (path.endsWith('.')) {
                throw new ExprError(
                    `'${full}' 路径以 '.' 结尾`,
                    '请检查取值路径拼写',
                    i, full.length
                );
            }
            if ((/\[\s*\]|\[\.|\.\.|\.\[|\[\]/).test(path)) {
                throw new ExprError(
                    `'${full}' 路径中存在空下标或连续分隔符`,
                    '',
                    i, full.length
                );
            }
            if (/\[\d+[^\]\d]\d*\]|\[[^\]\d]/.test(path)) {
                throw new ExprError(
                    `'${full}' 路径下标仅支持数字`,
                    '数组下标仅支持数字字面量，如 $data.items[0]',
                    i, full.length
                );
            }
            tokens.push({ kind: 'path', value: full, offset: i });
            i += full.length;
            continue;
        }
        if (ch === "'") {
            const j = expr.indexOf("'", i + 1);
            if (j === -1) {
                tokens.push({ kind: 'string', value: expr.substring(i), offset: i });
                tokens.push({ kind: 'unterminated', value: "'", offset: i });
                break;
            }
            tokens.push({ kind: 'string', value: expr.substring(i, j + 1), offset: i });
            i = j + 1;
            continue;
        }
        if (ch === '"') {
            throw new ExprError(
                '表达式含双引号字符串',
                "GaiaX 字符串字面量必须用单引号：'xxx'，双引号非法",
                i, 1
            );
        }
        if (ch >= '0' && ch <= '9') {
            const rest = expr.substring(i);
            const m = TOKEN_NUM.exec(rest)!;
            const text = m[0];
            const nextIdx = i + text.length;
            // 数字后接字母 → 非法（GXWordAnalyze.cpp:126-168）
            if (nextIdx < n && (/[A-Za-z_]/.test(expr[nextIdx]))) {
                throw new ExprError(
                    `数字 ${text} 后紧跟字母`,
                    '数字与标识符之间需要运算符；若想写字符串请加单引号',
                    i, nextIdx - i + 1
                );
            }
            if (text.endsWith('.')) {
                throw new ExprError(
                    `小数点后缺少数字（${text}）`,
                    '',
                    i, text.length
                );
            }
            tokens.push({ kind: 'num', value: text, offset: i });
            i = nextIdx;
            continue;
        }
        if (ch === '.') {
            throw new ExprError(
                '表达式含孤立的小数点',
                '成员访问只存在于 $ 取值路径内，如 $data.title',
                i, 1
            );
        }
        if (/[A-Za-z_]/.test(ch)) {
            const m = TOKEN_IDENT.exec(expr.substring(i));
            if (!m) {
                throw new ExprError(
                    `非法字符 '${ch}'：标识符仅允许 ASCII 字母/数字/下划线`,
                    `裸字符串（含中文）在 GaiaX 表达式中必须用单引号包裹：'${ch}…'`,
                    i, 1
                );
            }
            const word = m[0];
            const j = i + word.length;
            // 后紧跟 ( 才是函数 token（GXWordAnalyze.cpp:106-114）
            if (j < n && expr[j] === '(') {
                tokens.push({ kind: 'func', value: word, offset: i });
            } else {
                tokens.push({ kind: 'ident', value: word, offset: i });
            }
            i = j;
            continue;
        }
        if (ch === '(') {
            tokens.push({ kind: 'lparen', value: ch, offset: i });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ kind: 'rparen', value: ch, offset: i });
            i++;
            continue;
        }
        if (ch === ',') {
            tokens.push({ kind: 'comma', value: ch, offset: i });
            i++;
            continue;
        }
        if (ch === '?' || ch === ':') {
            if (ch === '?' && i + 1 < n && expr[i + 1] === ':') {
                tokens.push({ kind: 'op', value: '?:', offset: i });
                i += 2;
                continue;
            }
            tokens.push({ kind: 'op', value: ch, offset: i });
            i++;
            continue;
        }
        if ('&|=<>+-*/%!'.includes(ch)) {
            const two = expr.substring(i, i + 2);
            if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
                tokens.push({ kind: 'op', value: two, offset: i });
                i += 2;
                continue;
            }
            if (ch === '&' || ch === '|') {
                throw new ExprError(
                    `表达式含单个 '${ch}'`,
                    '逻辑运算必须写成 && 或 ||',
                    i, 1
                );
            }
            if (ch === '=') {
                throw new ExprError(
                    "表达式含单个 '='",
                    '相等比较必须写 ==；赋值在表达式中不存在',
                    i, 1
                );
            }
            tokens.push({ kind: 'op', value: ch, offset: i });
            i++;
            continue;
        }
        throw new ExprError(
            `表达式含非法字符 '${ch}'`,
            "仅支持：'字符串' 数字 $路径 $$ true false null ( ) , 运算符",
            i, 1
        );
    }

    return tokens;
}

/**
 * 递归下降解析器
 */
class ExpressionParser {
    private toks: Token[];
    private pos = 0;

    constructor(toks: Token[]) {
        this.toks = toks;
    }

    private peek(): Token {
        return this.pos < this.toks.length ? this.toks[this.pos] : { kind: 'ident', value: '', offset: 0 };
    }

    private next(): Token {
        const tok = this.peek();
        this.pos++;
        return tok;
    }

    private expectOp(text: string): void {
        const tok = this.peek();
        if (tok.kind === 'op' && tok.value === text) {
            this.next();
            return;
        }
        throw new ExprError(
            `缺少 '${text}'`,
            '',
            tok.offset, 1
        );
    }

    parse(): void {
        if (this.toks.length === 0) {
            throw new ExprError('表达式为空', '', 0, 1);
        }
        this.elvis();
        if (this.pos < this.toks.length) {
            const tok = this.peek();
            if (tok.kind === 'unterminated') {
                throw new ExprError(
                    `字符串未闭合（位置 ${tok.offset}）`,
                    '检查单引号是否成对',
                    tok.offset, tok.value.length
                );
            }
            throw new ExprError(
                `存在无法解析的多余内容 '${tok.value}'（位置 ${tok.offset}）`,
                '常见原因：三元嵌套未加括号、字符串缺单引号、运算符两侧类型不匹配',
                tok.offset, tok.value.length
            );
        }
    }

    // elvis := elvis "?: " cond | cond（左结合）
    private elvis(): void {
        this.cond();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && tok.value === '?:') {
                this.next();
                this.cond();
            } else {
                return;
            }
        }
    }

    // cond := logicOr "?" logicOr ":" logicOr
    //（C++ 文法 L → N ? N ; T → L : N，真/假部不能再是裸三元或 elvis）
    private cond(): void {
        this.logicOr();
        const tok = this.peek();
        if (tok.kind === 'op' && tok.value === '?') {
            this.next();
            this.logicOr();
            this.expectOp(':');
            this.logicOr();
        }
    }

    private logicOr(): void {
        this.logicAnd();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && tok.value === '||') {
                this.next();
                this.logicAnd();
            } else {
                return;
            }
        }
    }

    private logicAnd(): void {
        this.equality();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && tok.value === '&&') {
                this.next();
                this.equality();
            } else {
                return;
            }
        }
    }

    private equality(): void {
        this.relational();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && (tok.value === '==' || tok.value === '!=')) {
                this.next();
                this.relational();
            } else {
                return;
            }
        }
    }

    private relational(): void {
        this.additive();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && (tok.value === '>' || tok.value === '>=' || tok.value === '<' || tok.value === '<=')) {
                this.next();
                this.additive();
            } else {
                return;
            }
        }
    }

    private additive(): void {
        this.multiplicative();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && (tok.value === '+' || tok.value === '-')) {
                this.next();
                this.multiplicative();
            } else {
                return;
            }
        }
    }

    private multiplicative(): void {
        this.unary();
        for (;;) {
            const tok = this.peek();
            if (tok.kind === 'op' && (tok.value === '*' || tok.value === '/' || tok.value === '%')) {
                this.next();
                this.unary();
            } else {
                return;
            }
        }
    }

    // unary := ("+"|"-"|"!") primary | primary（单目运算不可叠加）
    private unary(): void {
        const tok = this.peek();
        if (tok.kind === 'op' && (tok.value === '+' || tok.value === '-' || tok.value === '!')) {
            this.next();
            // 叠加检查：!!a、- -a、- !a 等均非法（C++ 文法 U → +Y|-Y|!Y，Y 不含 U）
            const tok2 = this.peek();
            if (tok2.kind === 'op' && (tok2.value === '+' || tok2.value === '-' || tok2.value === '!')) {
                throw new ExprError(
                    `一元运算符不可叠加（${tok.value}${tok2.value}）`,
                    '文法不允许 !!a / --a 连写，请加括号分层',
                    tok.offset, tok2.offset - tok.offset + tok2.value.length
                );
            }
            this.primary();
            return;
        }
        this.primary();
    }

    private primary(): void {
        const tok = this.next();
        if (tok.kind === 'ident' && tok.value === '') {
            throw new ExprError(
                '表达式意外结束',
                '检查是否缺少操作数或右括号',
                tok.offset, 1
            );
        }
        if (tok.kind === 'lparen') {
            this.elvis();
            const tok2 = this.next();
            if (tok2.kind !== 'rparen') {
                throw new ExprError(
                    `缺少右括号（位置 ${tok2.offset}）`,
                    '',
                    tok2.offset, 1
                );
            }
            return;
        }
        if (tok.kind === 'path' || tok.kind === '$$' || tok.kind === 'num' || tok.kind === 'string') {
            return;
        }
        if (tok.kind === 'ident' && (tok.value === 'true' || tok.value === 'false' || tok.value === 'null')) {
            return;
        }
        if (tok.kind === 'func') {
            // funcCall := IDENT "(" [literal ("," literal)*] ")" 实参仅字面量
            const tok2 = this.next();
            if (tok2.kind !== 'lparen') {
                throw new ExprError(
                    `函数 ${tok.value} 后缺少 '('（位置 ${tok2.offset}）`,
                    '',
                    tok2.offset, 1
                );
            }
            const tok3 = this.peek();
            if (tok3.kind === 'rparen') {
                this.next();
                return;
            }
            for (;;) {
                this.literalArg();
                const tok4 = this.next();
                if (tok4.kind === 'comma') {
                    continue;
                }
                if (tok4.kind === 'rparen') {
                    return;
                }
                throw new ExprError(
                    `函数 ${tok.value} 的参数列表格式错误（位置 ${tok4.offset}）`,
                    '函数实参仅支持字面量（\'str\' / 数字 / true / false / null / $路径 / $$），不支持 size(1+2) 这类表达式实参',
                    tok4.offset, 1
                );
            }
        }
        throw new ExprError(
            `意外的内容 '${tok.value}'（位置 ${tok.offset}）`,
            this.commonCause(tok),
            tok.offset, tok.value.length || 1
        );
    }

    private literalArg(): void {
        const tok = this.next();
        if (tok.kind === 'path' || tok.kind === '$$' || tok.kind === 'num' || tok.kind === 'string') {
            return;
        }
        if (tok.kind === 'ident' && (tok.value === 'true' || tok.value === 'false' || tok.value === 'null')) {
            return;
        }
        throw new ExprError(
            `函数实参必须是字面量，得到 '${tok.value}'（位置 ${tok.offset}）`,
            "函数实参仅支持：'字符串' / 数字 / true / false / null / $取值路径 / $$",
            tok.offset, tok.value.length || 1
        );
    }

    private commonCause(tok: Token): string {
        if (tok.kind === 'ident') {
            return `裸标识符 '${tok.value}' 不是合法字面量（引擎解析失败时会静默返回 null）：字符串请加单引号，取值请用 $ 路径`;
        }
        if (tok.kind === 'op') {
            return `运算符 '${tok.value}' 缺少操作数`;
        }
        return '';
    }
}

/** 空表达式 / 纯裸内容的正则 */
const BARE_CONTENT_RE = /^[^$'0-9][^']*|-\d+.*/;
const PURE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * 检查单个表达式字符串，返回问题列表（0 个 = 合法）。
 * 诊断偏移相对 trim 后的表达式计算；返回前换算回原文偏移，
 * 保证带首部空白的表达式（如 " $a ? 'x' : 'y' "）定位不漂移。
 */
export function checkExpression(expr: string): ExpressionIssue[] {
    const issues = checkExpressionTrimmed(expr);
    const leading = expr.length - expr.trimStart().length;
    return issues.map(issue => ({ ...issue, offset: issue.offset + leading }));
}

function checkExpressionTrimmed(expr: string): ExpressionIssue[] {
    const issues: ExpressionIssue[] = [];
    if (typeof expr !== 'string') {
        return issues;
    }

    const stripped = expr.trim();
    if (!stripped) {
        issues.push({
            severity: 'warning',
            message: '表达式为空字符串',
            hint: "空表达式求值为 null；若想表达空字符串请写 ''（一对单引号）",
            offset: 0,
            length: expr.length || 1
        });
        return issues;
    }

    // 旧版 V1 表达式语法特征：${var} / @{...}
    if (stripped.includes('${') || stripped.includes('@{')) {
        issues.push({
            severity: 'warning',
            message: `疑似旧版 V1 表达式语法：'${expr.substring(0, 40)}'`,
            hint: 'V1 语法（${var}/@{...}）要求模板声明 "exp-version":"V1" 且宿主注册扩展；否则 V2 引擎求值失败返回 null。V2 应改写为 $data.xxx 形式',
            offset: 0,
            length: expr.length
        });
        return issues;
    }

    // 纯裸内容：字符串未加单引号（如 已关注 / https://... / lottie）
    if (!stripped.includes("'") && !stripped.includes('$') &&
        !['true', 'false', 'null'].includes(stripped) &&
        !PURE_NUMBER_RE.test(stripped)) {
        if (BARE_CONTENT_RE.test(stripped) && !stripped.startsWith('$')) {
            issues.push({
                severity: 'warning',
                message: `疑似字符串缺少单引号：'${stripped.substring(0, 20)}'`,
                hint: "GaiaX V2 表达式中字符串字面量必须用单引号包裹；裸字符串求值失败返回 null",
                offset: 0,
                length: expr.length
            });
        }
    }

    try {
        const tokens = tokenizeExpression(stripped);
        new ExpressionParser(tokens).parse();
    } catch (err) {
        if (err instanceof ExprError) {
            let hint = err.hint;
            // 针对性增强：数据键含 '-' 会被切成减法
            if (stripped.includes('-') && stripped.includes('$') &&
                (err.message.includes('缺少') || err.message.includes('意外的内容'))) {
                hint = (hint ? hint + '；' : '') +
                    "若数据 JSON 的键名本身含 '-'（如 sub-title），无法用 $ 路径取值（'-' 会被解析为减法），请改用不含 '-' 的键名";
            }
            issues.push({
                severity: 'error',
                message: `表达式语法错误：${err.message}`,
                hint,
                offset: err.offset,
                length: err.length
            });
        } else {
            throw err;
        }
    }

    return issues;
}

/** 带位置的字符串值（JSON 文档中的 value 字符串，非 key） */
export interface LocatedString {
    value: string;
    /** 引号内内容起始偏移（文档全文） */
    contentStart: number;
    /** 字符串 token 起始偏移（含开引号） */
    tokenStart: number;
    /** 字符串 token 结束偏移（含闭引号后一位） */
    tokenEnd: number;
}

/**
 * 扫描 JSON 文本，收集所有「值位置」的字符串（跳过 key）。
 * 假定文本是合法 JSON（调用前先 JSON.parse 验证）。
 */
export function collectStringValues(content: string): LocatedString[] {
    const results: LocatedString[] = [];
    let i = 0;
    const n = content.length;

    const readString = (start: number): { raw: string; end: number } => {
        // start 指向开引号
        let j = start + 1;
        while (j < n) {
            if (content[j] === '\\') {
                j += 2;
                continue;
            }
            if (content[j] === '"') {
                break;
            }
            j++;
        }
        return { raw: content.substring(start + 1, j), end: j + 1 };
    };

    const skipWs = (idx: number): number => {
        while (idx < n && /\s/.test(content[idx])) {
            idx++;
        }
        return idx;
    };

    while (i < n) {
        const ch = content[i];
        if (ch === '"') {
            const { raw, end } = readString(i);
            // 后面（跳过空白）是 ':' → 是 key，跳过；否则是值
            const after = skipWs(end);
            if (content[after] !== ':') {
                results.push({
                    value: raw,
                    contentStart: i + 1,
                    tokenStart: i,
                    tokenEnd: end
                });
            }
            i = end;
            continue;
        }
        i++;
    }

    return results;
}
