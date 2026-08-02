# ShellPilot v0.4.27 最终自检、发布与复验报告

日期：2026-08-02
目标版本：`v0.4.27`
发布合并提交：`908e3344a0fb18cc1be8b282762d7c3b7931a9f5`

## 最终结论

本轮基于 ShellPilot 最新源码完成三轮使用者视角自检、问题修复、166 项历史要求复核、真实 VPS 外部验收、Windows 构建、双源发布及旧客户端升级发现复验。GitHub `v0.4.27` 已发布为稳定版本，ModelScope 自动更新源已同步；两端自动更新资产均通过严格字节校验。

166 项要求的最终状态为：163 项已满足、2 项部分满足、1 项已替代、0 项未满足、0 项未验证、0 项无法验证。部分满足项仍为 `TUN-06` 与 `REL-13`，原因分别是缺少专用“禁止 SSH 转发”端点、缺少可独立验收的正式官网；为遵守授权边界，本轮没有通过修改共享 VPS 的 sshd 或既有 Web 服务来制造验收条件。

## 三轮自检结果

### 第一轮：源码、组件与基本交互

- 对连接、终端、SFTP、AI、运维、安全、帮助、设置和更新等界面逐项检查并修复可访问名称、禁用态、危险操作、焦点、文案、布局与窄窗口问题。
- 当轮完整单元测试：3124 项，3118 项通过，0 项失败，6 项按环境跳过。
- 证据：`round-1-code-components.md`。

### 第二轮：集成交互、视觉与 Windows 实机

- 集成桌面矩阵：20/20 通过，用时约 19.9 分钟。
- 覆盖 408 个主题、尺寸、缩放和界面状态；408 次焦点检查、278 次禁用态对比度检查、68 次危险操作检查；视觉失败 0。
- Windows 实机发现并修复 Vite 开发态 CommonJS 默认导入不兼容导致的白屏，修复后实机主界面与生产构建均通过。
- 证据截图：
  - `evidence/round-2-01-disconnected-home.png`
  - `evidence/round-2-02-connection-test-feedback.png`
  - `evidence/round-2-03-connected-sftp-keyboard.png`
  - `evidence/round-2-04-settings-dialog.png`
- 详细记录：`round-2-interaction-visual-a11y.md`。

### 第三轮：真实 VPS、回归、安全与性能

- 真实外部桌面验收 5/5 通过，用时约 9.2 分钟：完整 SFTP 旅程、编辑/权限/删除、拖拽上传、远程转发/SOCKS5/目标拒绝、沙箱零残留。
- 真实服务器基础回归 1/1、Agent 只读链路 1/1、隧道单元契约 51/51 加桌面 E2E 1/1、质量/恢复 2/2、性能 1/1 均通过。
- 发现并修复慢速远端刷新可能吞掉 SFTP“新建文件/文件夹”未提交输入行的问题；仅保留无远端 ID 的编辑草稿，提交或取消后的条目不会残留。
- 完整与生产依赖审计均为 0 漏洞。
- 发布元数据加入后最终单元测试：3140 项，3134 项通过，0 项失败，6 项按环境跳过。
- 详细记录：`round-3-external-regression.md`；逐项要求：`requirements-matrix.md`。

## VPS 安全边界与六项外部验收

服务器凭据只在测试子进程中读取，未写入源码、测试产物、报告、截图或命令输出。所有远端写操作仅发生在随机 `/tmp/.shellpilot-e2e-*` 沙箱；隧道只使用回环地址和动态临时端口。

外部套件在执行前后分别读取 x-ui 状态与关键文件摘要、运行服务集合、监听端口、容器状态和受保护文件摘要，前后指纹完全一致。没有修改、重启或重载 x-ui、sshd、防火墙、容器、数据库、业务目录或其他已安装服务。

| 项目 | 最终状态 | 验收方式 |
| --- | --- | --- |
| `SFTP-01` | 已满足 | 真实认证后检查双栏、地址跳转、进入/返回、刷新、选择、排序和筛选 |
| `SFTP-02` | 已满足 | 随机 `/tmp` 沙箱中执行上传、下载、复制、移动、改名、新建、权限、删除和文本编辑并回读 |
| `SFTP-13` | 已满足 | 验证 Ctrl 多选、多文件拖移、跨栏拖拽上传、右键目标保持及键盘操作 |
| `TUN-01` | 已满足 | 桌面管理器实际启动本地转发、远程转发和 SOCKS5，并收发临时标记或 SSH banner |
| `TUN-06` | 部分满足 | 端口占用和目标拒绝已实机验证；策略禁止仍需专用禁转发 SSH 端点，不能修改共享 VPS 的 sshd |
| `REL-13` | 部分满足 | 仓库、发布页和应用内品牌已核对；正式官网尚未独立部署，不能改动 VPS 现有 Web 服务代替验收 |

## 发布内容与资产

实现提交：

- `a7b8c8f` — 全局 UI 与可访问性外壳
- `9aae9d3` — 连接、终端、SFTP 与 AI 体验
- `7b9b51e` — 状态、安全与运维工作区
- `9e343a1` — 帮助、更新、设置与文案

验收与发布提交：`71ffcee`、`73126c6`、`4ec9661`；PR #9 合并提交与 `v0.4.27` 标签均为 `908e334`。本报告属于标签后的发布复验记录，发布标签未移动。

GitHub 稳定版发布时间：2026-08-02 23:38:47（北京时间）。

- GitHub：https://github.com/lx3559359/ssh-agent-tool/releases/tag/v0.4.27
- ModelScope：https://www.modelscope.cn/models/lx3559359/ShellPilot-Updates

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `ShellPilot-0.4.27-win-x64-installer.exe` | 102262664 | `1020555172ee7b6f57336d511ae915ff42986678e1593313d848c350c97cf2bb` |
| `ShellPilot-0.4.27-win-x64-installer.exe.blockmap` | 108762 | `3f1d77be3811aa7a79205fba3fe22891c934b4aac965278ac6a85f429046824c` |
| `ShellPilot-0.4.27-win-x64-portable.zip` | 145228593 | `8589b128bdf9ec116fa787c33880ccd0bcb792e83d7031c51ecfc932ffacabb8` |
| `latest.yml` | 376 | `cb489ba872080ab9b7a119979df39ef04eeb6052f04b52ad0ca487b6ea106f40` |
| `shellpilot-local.yml` | 376 | `cb489ba872080ab9b7a119979df39ef04eeb6052f04b52ad0ca487b6ea106f40` |
| `aigshell-update.json` | 212 | `a852d90a8eda1fa100fd9444c6c9faed8799c5451feb4056fd710bb34c1870da` |
| `shellpilot-update.json` | 212 | `a852d90a8eda1fa100fd9444c6c9faed8799c5451feb4056fd710bb34c1870da` |
| `checksums.json` | 1084 | `a3f4317a4c11235c0533202c51f4ab5ae2589b4e5915c9dbb82e32a05302b146` |
| `shellpilot-release.json` | 4407 | `d5c3e02e239b3044c4c4be013b6a649ca1d04fa5b3d92b8151c2a1c7584ea5af` |

GitHub 含上述九项资产；ModelScope 按既有自动更新契约同步除 portable ZIP 外的八项自动更新资产。Windows 安装程序的 Authenticode 状态为 `NotSigned`，因此系统可能显示“未知发布者”；本报告不把它描述为已签名安装包。

## 发布后复验

- GitHub Release 为公开、稳定、非草稿、非预发布状态，包含且仅包含九项获批资产。
- ModelScope 提交为 `8d283ee70d0f88b3d5bff17504a50d26f0b0e5c0`；远端 `master` 与该提交一致，发布克隆无未提交更改。
- 严格双源验证按元数据逐字节下载并核对：ModelScope 8/8、GitHub 自动更新资产 8/8，全数匹配。
- 从公开历史地址重新下载未经修改的 v0.4.26 portable ZIP（145289007 字节，SHA-256 `e604b87b8ea23b149dc0c6c3e4b21ca5625dba345fbcb6d9342f2ffa0355123e`），在全新隔离配置目录启动其 `ShellPilot.exe`。ModelScope 与 GitHub 两种显式来源均识别当前版本 0.4.26、远端版本 v0.4.27、状态为可更新、允许自动升级，且三类发布说明均存在。
- 旧客户端复验未点击下载或安装，没有覆盖现有用户配置或已安装程序。

## 保留边界

- `TUN-06` 的“服务器策略禁止转发”仍需单独授权、专用于测试且 `AllowTcpForwarding no` 的 SSH 端点。
- `REL-13` 仍需独立正式官网部署后，对品牌、下载链接、帮助内容和当前获批资产进行逐项核对。
- 安装包尚无 Authenticode 签名；若需要消除 Windows“未知发布者”提示，后续必须引入可信代码签名证书和受控签名流水线。
