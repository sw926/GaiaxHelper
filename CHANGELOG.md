# Change Log

All notable changes to the "gaiax-helper" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.6.0] - 2026-09-16

### Added

- **GaiaX V2 表达式校验**：内置与 `GaiaXAnalyze/GXAnalyzeCore` C++ LR(1) 文法同源的递归下降校验器，对 databinding 全部值字符串做语法检查（双引号字符串、裸字符串、嵌套三元未加括号、一元运算符叠加、单个 `&`/`|`、函数实参非字面量、换行/Tab、数字后接字母、空表达式、V1 旧语法等），错误定位到表达式内具体偏移
- 表达式校验器用例回归脚本：`npm run test:expression`（45 合法 + 17 非法，取自 gaiax skill test_lint.py）
- 应用商店图标、LICENSE（MIT）、publisher/repository/homepage/bugs 等发布元数据

### Changed

- `jsonValidation` 的 `fileMatch` 改为 `**/index.json`、`**/index.databinding`，确保嵌套目录中的模板文件也能命中 Schema 校验
- databinding 表达式诊断不再依赖 index.json 存在（表达式语法检查独立于 id 校验执行）
- `categories` 从 `Other` 调整为 `Programming Languages` + `Linters`；描述文案与实际功能对齐

### Fixed

- 表达式诊断偏移量：带首部空白的表达式（`" $a ? 'x' : 'y' "`）诊断定位漂移
- 清理 `out/` 中无源码的陈旧编译产物（`jump-to-definition.js`），打包不再混入死代码；`out/test` 不再进入 VSIX
- 移除 helpers 中 9 个旧版本遗留的死代码函数（约 200 行）

### Breaking

- `fileMatch` 升级为 `**/` 前缀需要 VS Code ≥ 1.98（与 engines 声明一致）

## [0.5.1] - 2026-09-09

- 以「CSS/databinding id 补全与校验 + 内置 JSON Schema」为核心的重构版本
- 内置 `gaiax-template.schema.json` / `gaiax-databinding.schema.json` 两份手工整理的 Schema，经 `jsonValidation` 提供字段补全、悬停说明与校验
- CSS id 补全：仅选择器位置触发（不误触十六进制颜色）、支持中途过滤
- databinding 一级键补全：以 snippet 形式插入 `"id": {…}`，处理自动闭合引号
- CSS 校验改为「`#id` 选择器必须在 index.json 中定义」；databinding 校验新增 data/event/track 一级键校验

> 注：0.3.0 – 0.5.0 期间未留变更记录。0.2.0 引入的部分功能（Hover 提示、Snippets 片段库、`.databinding` 独立语法高亮、type/sub-type/CSS 属性值补全等）在 0.3+ 重构中被移除，能力收敛到 id 链路（跳转/补全/校验）+ Schema。

## [0.2.0] - 2026-09-09

### Fixed

- **index.databinding 全部智能功能失效**：`.databinding` 注册为自定义语言 `gaiax-databinding`，但补全/悬停/跳转/诊断 provider 全部挂在 `json` 语言上，导致 databinding 文件内功能不生效。现改为挂载到 `gaiax-databinding` 语言
- **激活条件过苛**：要求 index.json/index.css/index.databinding 三件套同目录齐全才激活（databinding 可为空文件、新建模板三缺一是常态）。移除激活门槛
- **表达式 `-` 检查死代码**：databinding 诊断的正则字符类不含 `-`，`includes('-')` 永远 false。修复正则使 `$data.sub-title` 类键名告警真正生效（`-` 被表达式引擎解析为减法）
- **跳转定位脆弱**：`"id": "x"` 精确串匹配在无空格 JSON（`"id":"x"`）下失效，改为容忍任意空白的正则匹配，并返回完整 range
- **悬停崩溃**：id 悬停中 `JSON.parse` 无 try/catch，编辑中间态（JSON 不完整）抛异常
- **CSS 属性补全文档覆盖**：`documentation` 先设可选值再被默认值覆盖，两者现在合并显示
- **package.json 尾逗号** 导致 JSON 解析失败（讽刺地正是 GaiaX iOS 解析器的雷）
- **isInsideJsonString 转义引号误判**：`\"` 会被当作字符串边界翻转状态

### Changed

- 片段统一走 `contributes.snippets` 声明式注册，删除代码内 `GAIAX_SNIPPETS` 双重注册（其中含尾逗号的错误模板）
- 新增 `.databinding` TextMate 语法高亮（JSON 结构 + `$data`/函数/单引号字符串/运算符着色）
- 诊断支持编辑中实时刷新（500ms 防抖），文件关闭时清理诊断
- 诊断定位从根节点 (0,0) 改为钉到实际字段位置
- databinding 事件 snippet 的 `type` 值改为单引号表达式（`'tap'`）——裸字符串在 iOS 会静默回退为 tap
- CSS snippet 修复：`padding: 2px 8px` 多值简写（Android 整模板渲染失败）改为分边写法；`env(safe-area-inset-*)`（GaiaX CSS 不支持）改为注释说明；grid 容器 `height: auto`（塌陷为 0）改为显式高度
- CSS 属性表补充 `left/right/top/bottom`、`direction`、`background-size`/`background-url`（iOS）、`text-align: justify`（iOS）、image mode 完整取值
- 语言配置：移除 JSON 不支持的 `//` 行注释，补单引号自动闭合

### Removed

- 删除未使用的 `GAIAX_SNIPPETS` 数据及其它 schema 死数据

## [0.1.0]

- 控件类型 (type) / 子类型 (sub-type) / CSS 属性与值 / DataBinding 表达式 / 事件类型 / 内置函数自动补全
- Hover 信息提示、语法检查与错误提示、代码片段 (Snippets)

## [0.0.1]

- 初始版本：基本定义跳转与代码补全
