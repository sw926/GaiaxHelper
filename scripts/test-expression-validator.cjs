/**
 * expression-validator 移植正确性验证（用例取自 gaiax skill test_lint.py，
 * 45 合法 + 17 非法用例全部移植）
 * 运行：npm run test:expression
 */
const { checkExpression } = require('../out/validators/expression-validator');

// ---- 合法表达式（不得报 error）----
const VALID = [
    '$$',
    '$data.title',
    '$data.items[0].title',
    '$data.true',
    "'hello world'",
    "''",
    '1', '1.0', '0.001', '9223372036854775807',
    'true', 'false', 'null',
    "$data.title ? 'flex' : 'none'",
    "$data.backgroundColor ?: 'green'",
    '$data.title ? $data.a : $data.b',
    "($data.a ? 'x' : 'y') ?: 'z'",
    "$data.show == '1' && $data.open != null ? 'a' : 'b'",
    '$data.title == 0',
    "$data.title == 'string'",
    '$data.title != $data.subtitle',
    '$data.num > 1', '$data.num >= 1.5', '$data.num < 10', '$data.num <= 10',
    '$data.a && $data.b',
    '$data.a || $data.b',
    '$data.a && $data.b || $data.c',
    "'字符串' + $data.title",
    '100 + $data.num - 5',
    '2.25 * 2',
    '100 / $data.num',
    '10 % 3',
    "$data.price * $data.count + '元'",
    '-$data.num',
    '+1',
    '-1.5 + $data.x',
    'size($data.nodes)',
    'size($$)',
    "env('isAndroid')",
    "env('isiOS') ? 'ios' : 'android'",
    "int($data.title) > 3 ? 'flex' : 'none'",
    " ( $data.a == 'x' ) ? 'on' : 'off' ",
    "env( 'isAndroid' )",
    'true ? $$ : 1',
];

// ---- 非法表达式（必须报 error；第二项为提示应含的关键字，null = 不检查关键字）----
const INVALID = [
    ['$a ? $b : $c ? $d : $e', null],
    ['"abc"', '双引号'],
    ['abc + 1', null],
    ['已关注', null],
    ['$a & $b', '&&'],
    ['$a | $b', '||'],
    ['$a = 1', '=='],
    ['!!$a', '一元运算符不可叠加'],
    ['- -1', '一元运算符不可叠加'],
    ['size($a + 1)', '字面量'],
    ['$a # b', '保留字符'],
    ['$a ~ b', '保留字符'],
    ['123abc', null],
    ['1.5x', null],
    ['$a &&\n$b', '换行'],
    ['$a\t&& $b', 'Tab'],
    ["($a ? 'x' : 'y'", '右括号'],
];

let failures = 0;

for (const expr of VALID) {
    const errors = checkExpression(expr).filter(i => i.severity === 'error');
    if (errors.length > 0) {
        failures++;
        console.error(`VALID 用例误报 error: ${JSON.stringify(expr)}`);
        errors.forEach(e => console.error(`   → ${e.message}`));
    }
}

for (const [expr, hintKw] of INVALID) {
    const issues = checkExpression(expr);
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length === 0) {
        failures++;
        console.error(`INVALID 用例未报 error: ${JSON.stringify(expr)}`);
        continue;
    }
    if (hintKw && !errors.some(e => e.message.includes(hintKw) || e.hint.includes(hintKw))) {
        failures++;
        console.error(`INVALID 用例 ${JSON.stringify(expr)} 的提示中缺少关键字 '${hintKw}'`);
        errors.forEach(e => console.error(`   → ${e.message} / hint: ${e.hint}`));
    }
}

if (failures === 0) {
    console.log(`ALL TESTS PASSED（${VALID.length} valid + ${INVALID.length} invalid）`);
    process.exit(0);
} else {
    console.error(`${failures} failures`);
    process.exit(1);
}
