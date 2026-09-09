# GaiaX Helper

一个面向 [GaiaX](https://github.com/alibaba/GaiaX) 跨端模板开发的 VS Code 扩展，围绕模板三件套（`index.json` / `index.css` / `index.databinding`）提供相互跳转、id 智能补全、GaiaX V2 表达式校验与内置 JSON Schema 校验。

> GaiaX 模板的联动关系：`index.json` 里的图层 `id` 是核心关联键 —— CSS 用 `#id` 选择器取样式，databinding 用 `id` 作 `data`/`event`/`track` 的第一层级键。本插件的所有功能都围绕这条 id 链路展开。

## ✨ 功能特性

### 🔍 定义跳转（Go to Definition）

在下列位置按 `F12`（或 `Ctrl/Cmd + 点击`）即可跳转，四个方向全部支持：

| 方向 | 光标位置 | 跳转目标 |
|------|----------|----------|
| JSON → CSS | `index.json` 的 `"id": "xxx"` 值 | `index.css` 中对应的 `#xxx` 规则 |
| CSS → JSON | `index.css` 的 `#xxx` 选择器 | `index.json` 中对应的 `id` 定义 |
| JSON → DataBinding | `index.json` 的 `"id": "xxx"` 值 | `index.databinding` 中 `data` 节的同名键 |
| DataBinding → JSON | `index.databinding` 的属性键 | `index.json` 中对应的 `id` 定义 |

匹配容忍冒号两侧任意空白（`"id":"x"` 与 `"id": "x"` 均可），CSS 侧也容忍 `#id{` 无空格写法。

### 💡 代码补全

1. **CSS id 补全**：在 `index.css` 中输入 `#`，自动列出 `index.json` 中定义的所有图层 id。
   - 只在选择器位置触发（行首或 `{`、`,`、`;` 之后），`color: #ff` 这类十六进制颜色不会误触发；
   - 支持中途过滤：输入 `#tit` 只剩 `#title` 这类候选。
2. **DataBinding 一级键补全**：在 `index.databinding` 的 `data`/`event`/`track` 第一层级输入 `"`，自动列出 `index.json` 中的图层 id，选中后以代码片段形式插入完整键值对（`"id": {…}`），并正确处理编辑器自动补出的闭引号。

### ⚠️ 错误检查（诊断）

打开或编辑文件时实时检查（500ms 防抖），结果出现在「问题」面板中：

**index.css**

- `#id` 选择器未在 `index.json` 中定义 → Error（改名/删图层后最容易漏改的地方）。

**index.databinding**

- JSON 语法错误 → Error，并定位到具体位置；
- **GaiaX V2 表达式校验** → 内置与 `GaiaXAnalyze/GXAnalyzeCore` C++ 文法同源的递归下降校验器，表达式语法错误会导致引擎求值为 `null`、渲染静默失效，插件能把这类"隐形"问题提前揪出来：

  | 问题 | 示例 | 级别 |
  |------|------|------|
  | 字符串用了双引号 | `"abc"` | Error |
  | 字符串未加单引号（裸内容） | `已关注`、`https://xxx` | Warning |
  | 嵌套三元未加括号 | `$a ? $b : $c ? $d : $e` | Error |
  | 一元运算符叠加 | `!!$a`、`- -1` | Error |
  | 逻辑运算写成单个 `&`/`\|` | `$a & $b` | Error |
  | 赋值/比较写错 | `$a = 1`（应为 `==`） | Error |
  | 函数实参不是字面量 | `size($a + 1)` | Error |
  | 表达式含换行/Tab | JSON 里写了 `\n` | Error |
  | 数字后紧跟字母 | `123abc`、`1.5x` | Error |
  | 空表达式 | `""` | Warning |
  | 旧版 V1 语法（`${var}`/`@{…}`） | `${title}` | Warning |
  | 数据键名含 `-`（被解析为减法） | `$data.sub-title` | Error（附带提示） |

  校验规则与 [gaiax skill](https://github.com/alibaba/GaiaX) 的 lint 用例同源，63 个用例持续回归（`npm run test:expression`）。
- `data`/`event`/`track` 第一层级键未在 `index.json` 中定义 → Warning。

### 📋 内置 JSON Schema 校验

插件内置两份手工整理的 JSON Schema，经由 VS Code 原生 JSON 校验提供字段级提示与校验：

- `index.json` → `gaiax-template.schema.json`：根节点必填 `id`/`type` 且 `type` 固定为 `gaia-template`；图层 `type` 枚举（`gaia-template`/`view`/`text`/`image`/`richtext`/`iconfont`/`progress`/`custom`）；scroll/grid/slider 容器专属字段（`column`、`item-spacing`、`slider-*`、`direction` 等）与 progress 专属字段，每个字段都带中文说明和平台差异提示；
- `index.databinding` → `gaiax-databinding.schema.json`：`data`/`event`/`track`/`config`/`animation` 五个节的完整结构，`value` 表达式、`extend` 样式覆写（60+ CSS 属性键）、`item-type` 多坑位映射、事件节点等。

编辑这两个文件时，输入字段名即可获得补全，悬停可查看字段说明。

### 📎 其他

- `.databinding` 文件自动按 JSON 语言处理（语法高亮、格式化、折叠均可用）。

## 🚀 快速开始

### 文件结构

GaiaX 模板三件套位于**同一目录**：

```
your-component/
├── index.json          # 模板结构（图层树，id 是关联键）
├── index.css           # 样式（#id 选择器）
└── index.databinding   # 数据/事件/埋点绑定
```

### 激活条件

工作区中存在**任意一个** `index.json` / `index.css` / `index.databinding` 文件时插件即激活。跨文件功能（跳转、补全、校验）会按需读取**同目录**下的关联文件；关联文件缺失时相关功能静默降级，不会报错打扰。

## 📖 使用示例

以一个简单模板为例：

**index.json**

```json
{
  "id": "demo",
  "type": "gaia-template",
  "layers": [
    { "id": "title", "type": "text" },
    { "id": "cover", "type": "image" }
  ]
}
```

**index.css**

```css
#title {
  font-size: 16px;
  color: '#333333';
}
```

**index.databinding**

```json
{
  "data": {
    "title": { "value": "$data.head ? $data.head : '默认标题'" },
    "cover": { "value": "$data.img ?: 'local:default'" }
  }
}
```

- 在 `index.json` 的 `"title"` 上按 `F12` → 跳到 `index.css` 的 `#title` 规则；
- 在 `index.css` 新起一行输入 `#` → 候选里有 `title`、`cover`；
- 在 `index.databinding` 的 `"data": {` 里输入 `"` → 候选插入 `"cover": {…}`；
- 若把表达式误写成 `"$data.head ? $data.head : "默认标题"`（双引号嵌套），保存后「问题」面板会直接指出语法错误位置。

## 📌 GaiaX 表达式书写注意

以下规则源自 GaiaX V2 表达式引擎，违反时引擎静默求值为 `null`，插件会给出对应诊断：

1. 字符串字面量必须用**单引号**：`"'静态文本'"`；
2. 颜色也是字符串：`"'#ffffff'"`；
3. 嵌套三元必须加括号：`a ? b : (c ? d : e)`；
4. 数据键名禁含 `-`：`$data.sub-title` 的 `-` 会被解析为减法；
5. 表达式写在同一行，勿含换行/Tab；
6. 旧版 V1 语法（`${var}` / `@{…}`）需要模板声明 `"exp-version": "V1"` 且宿主注册扩展，V2 模板请改写为 `$data.xxx` 形式。

## 📦 安装

### 从 VS Code 扩展市场安装（推荐）

在扩展面板搜索 **GaiaX Helper** 安装。

### 从 VSIX 安装

1. 在 [Releases](https://github.com/sw926/GaiaxHelper/releases) 下载 `.vsix` 文件；
2. 命令面板（`Ctrl/Cmd + Shift + P`）→ `Extensions: Install from VSIX...` → 选择文件。

### 从源码构建

```bash
git clone https://github.com/sw926/GaiaxHelper.git
cd GaiaxHelper
npm install
npm run compile
npx @vscode/vsce package   # 生成 .vsix
```

## ⚙️ 扩展设置

本插件目前没有自定义设置项，安装即用。

## 🧑‍💻 开发

```bash
npm install
npm run compile           # 编译
npm run watch             # 监听编译
npm run lint              # ESLint 检查
npm run test:expression   # 表达式校验器用例回归（45 合法 + 17 非法）
npm test                  # VS Code 集成测试（需下载测试用 Electron）
```

按 `F5` 可启动扩展开发宿主窗口，用一个包含模板三件套的目录实际体验各功能。

发布流程见 [PUBLISHING.md](PUBLISHING.md)。

## 📝 版本历史

见 [CHANGELOG.md](CHANGELOG.md)。

## ⚠️ 已知限制

- 图层 `id` 重复、CSS 属性值合法性等暂未校验（欢迎 PR）；
- `index.json` → `index.databinding` 的跳转目前只查 `data` 节，`event`/`track` 键暂不支持反向定位；
- 仅识别文件名为 `index.json` / `index.css` / `index.databinding` 的模板三件套。

## 📄 许可证

[MIT](LICENSE)

## 💬 反馈

问题或建议请提交到 [GitHub Issues](https://github.com/sw926/GaiaxHelper/issues)。
