# 发布指南（PUBLISHING）

发布到 VS Code 扩展市场（Visual Studio Code Marketplace）的完整流程与检查清单。

## 一、首次发布前的一次性准备

### 1. 确认 Publisher ID

`package.json` 中的 `"publisher": "sw926"` 是依据 GitHub 仓库推断的，**必须与你在 Marketplace 创建的发布者 ID 完全一致**，否则 `vsce publish` 会失败。

- 创建/查看发布者：<https://marketplace.visualstudio.com/manage>
- Create publisher → 记下 ID（大小写敏感）；如与 `sw926` 不符，改 `package.json` 的 `publisher` 字段。

### 2. 生成 Personal Access Token (PAT)

1. 登录 <https://dev.azure.com/>（用发布者所属的 Microsoft 账号）；
2. User Settings → Personal Access Tokens → New Token；
3. Organization 选 **All accessible organizations**，Scopes 选 **Marketplace → Manage**；
4. 生成并保存 token，然后登录：

```bash
npx @vscode/vsce login sw926   # 粘贴 PAT，之后凭据存于本机
```

## 二、每次发布检查清单

- [ ] 更新 `package.json` 的 `version`（0.x 阶段建议每次功能变化都 +0.1）
- [ ] 在 `CHANGELOG.md` 顶部补齐本版本变更
- [ ] `npm run lint` 通过
- [ ] `npm run compile` 通过
- [ ] `npm run test:expression` 通过（45 valid + 17 invalid）
- [ ] 在真实模板目录中手动过一遍：跳转 × 4、CSS `#` 补全、databinding `"` 补全、CSS/databinding 诊断
- [ ] `npx @vscode/vsce package` 无 WARNING（LICENSE、icon、repository 等已配齐，理论上应干净）
- [ ] 检查 `.vsix` 内容：`npx @vscode/vsce show-properties` 或解压查看，确认不含 `src/`、`out/test/`、`scripts/` 等无关文件

## 三、发布

```bash
# 打包（生成 gaiax-helper-x.y.z.vsix，可先本地安装验证）
npx @vscode/vsce package

# 本地验证：安装到当前 VS Code
code --install-extension gaiax-helper-x.y.z.vsix

# 发布到 Marketplace
npx @vscode/vsce publish

# 或一步到位（自动 patch +1）
npx @vscode/vsce publish patch   # minor / major 同理
```

发布后几分钟内即可在 marketplace 和 VS Code 扩展面板搜索到（搜索索引可能延迟）。

### 可选：同步发布到 Open VSX（VSCodium 等用户）

```bash
npx ovsx publish -p <OPEN_VSX_PAT>   # 在 https://open-vsx.org 注册获取
```

## 四、市场页面优化（可选）

- **截图**：README 中放一张「问题面板报表达式错误」和一张「databinding 键补全」的实际截图（`⌘+Shift+4` 截图后放 `images/`，并在 README 引用），转化率会明显更好；
- **图标**：当前为 `images/icon.png`（128×128，程序生成的 GX 渐变标识），如需更换直接覆盖该文件；
- **后台设置**：Marketplace 后台可调整分类标签、Q&A 开关（默认开启）与不实举报入口。

## 五、常见问题

| 问题 | 处理 |
|------|------|
| `vsce publish` 提示 publisher 不存在 | PAT 的账号未创建 publisher，或 `package.json` 的 publisher 与其不一致 |
| 提示 README 是占位模板 | 确认 README 已是正式内容（本项目已完成） |
| 提示找不到 LICENSE | 已内置 `LICENSE`（MIT）；若换协议需同步改 `package.json` 的 `license` 字段 |
| `engines.vscode` 不兼容报错 | `@types/vscode` 与 `engines.vscode` 大版本需一致（当前均为 ^1.98.0） |
