# ShellPilot v0.4.27 第 1 轮自检：代码、组件与边界

日期：2026-08-02  
对照版本：v0.4.26（`af86bb9`）  
检查分支：`codex/ui-accessibility-0.4.27`

## 结论

第 1 轮通过。完整单元测试、Standard 静态检查、生产构建、空白检查和 v0.4.27 范围守卫均通过。检查发现并修复 1 个真实缺陷：英文“毫秒”单位文案带前导空格，违反了所有本地化目录值必须去除首尾空白的既有契约。

产品改动只涉及客户端表现与可访问性交互层；`src/client/store`、`src/app/server`、`src/app/common` 没有差异，也没有新增 API、IPC、持久化键、命令模板、扫描命令、安全分类或事务路径。

## 缺陷、根因、修复与重放

### R1-01：英文毫秒单位违反文案目录契约

- 首次完整测试：3130 项，3123 通过、1 失败、6 跳过，退出码 1。
- 失败用例：`shellpilot-i18n-overrides.spec.js` 中“catalog values are non-empty strings without obvious encoding corruption”。
- 失败证据：`en_us.shellpilotMillisecondsUnit` 的值为带前导空格的 ` (ms)`，其 `trim()` 结果与原值不同。
- 根因：数字设置控件此前依赖单位文案自身携带空格来拼接显示文本，把布局分隔符误存进了可复用的本地化目录。
- 修复：目录值改为独立、无首尾空白的“毫秒”/“milliseconds”；数字设置控件使用统一的 ` · ` 分隔符组合标题和单位，并同步本地化覆盖测试。
- 聚焦重放：18 项通过、0 失败；Standard 和 `git diff --check` 通过。
- 完整重放：3130 项，3124 通过、0 失败、6 跳过，退出码 0，用时 291423.1083 ms。

测试输出中出现的“administratively prohibited”“authentication methods failed”“Timed out while waiting for handshake”“Connection refused”和“SOCKS5 listener error”均是故障路径用例主动产生的预期日志；对应 TAP 结果没有失败。

## 门禁结果

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm run test-unit-ci` | 通过 | 3130 项；3124 通过、6 跳过、0 失败 |
| `npm run lint` | 通过 | Standard 退出码 0 |
| `npm run b` | 通过 | Vite 生产编译、文件准备和 Runtime package verification 均完成；依赖安装审计为 0 漏洞 |
| `git diff --check v0.4.26...HEAD` | 通过 | 退出码 0，无空白错误 |
| v0.4.27 范围守卫 | 通过 | 16 项通过、0 失败 |
| 后端保护目录差异 | 通过 | 三个受保护目录的 diff 为空 |

构建继续报告既有的大体积 chunk 警告；它不影响构建退出码，也不是本轮引入的新功能边界变化。

## 变更范围审计

相对 v0.4.26 共 73 个文件发生变化，3803 行新增、336 行删除，按生产目录归类如下：

- `src/client/common`：对话框背景隔离、状态展示、SFTP 可访问性、本地化与语义主题令牌。
- `src/client/components`：顶栏、通用弹窗/抽屉、连接向导、Terminal/SFTP、AI、服务器状态、安全中心、运维、帮助、更新和设置的表现与键盘/读屏语义。
- `src/client/css`：共享焦点、减少动态效果和次级界面样式。
- `test/unit-ci`：范围守卫、样式契约、可访问性和现有功能回归。
- `docs/superpowers`：已批准的设计与实施计划。

以下受保护目录差异为空：

- `src/client/store`
- `src/app/server`
- `src/app/common`

关键词扫描命中的 `autoCollapsed` 和 `saveAsBookmark: false` 均为 v0.4.26 已有代码；相对基线未修改。范围守卫进一步确认：AI 面板不会被新增自动收起逻辑；连接向导仍为三步、默认保存行为和连接按钮回调不变；Operations 既有页签及 SFTP 点击、双击、拖放、右键和传输处理器不变。

## 第 2 轮入口条件

代码和组件门禁已满足。第 2 轮继续验证 14 个用户界面状态、亮/暗主题、视口/缩放矩阵、键盘路径、对话框背景隔离、焦点恢复、截图差异和 Windows 读屏体验。
