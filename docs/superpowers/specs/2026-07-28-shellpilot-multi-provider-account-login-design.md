# ShellPilot 多 Provider 账号登录与统一 AI 接入设计

**日期：** 2026-07-28
**状态：** 用户已确认设计，等待书面规格复核
**范围：** 产品与技术设计；实现、打包和发布另行规划

## 1. 背景

ShellPilot 当前通过 OpenAI 兼容接口调用模型，用户需要填写 API 地址、API Key、模型和认证 Header。项目已经具备 AI 配置档案、流式对话、Agent 工具调用、请求取消、凭据加密和本地 CLI 受控调用等基础能力，也已经能够检测系统 Codex CLI 或 Codex Desktop 自带的 `codex.exe`。

用户希望：

1. 直接登录 ChatGPT/Codex 账号，让右侧 AI 对话和 Agent 使用 Codex。
2. 增加 Grok 和 Gemini。
3. 保留现有 API Key、中转站和本地模型能力。
4. 功能上线时同步提供中文使用说明和故障排查，避免功能存在但用户不知道如何配置。

三个新增 Provider 的官方接入方式不同：

- Codex 提供 `codex app-server`，支持账号状态、浏览器登录、模型列表、线程和流式事件。
- Grok Build 提供官方账号登录和 ACP stdio 接口。
- Gemini 支持 Gemini API Key 和应用自有的 Google Cloud OAuth。ShellPilot 不复用或提取 Gemini CLI 的个人 OAuth 凭据。

因此采用统一 Provider 适配层，而不是在现有 `ai.js` 中继续堆叠条件分支。

## 2. 目标

### 2.1 产品目标

- 在“模型 API”中提供 Codex、Grok、Gemini 和现有 OpenAI 兼容服务的统一入口。
- Codex 和 Grok 支持官方账号登录、状态查看、模型选择、退出登录和重新连接。
- Gemini 首期支持 API Key，后续增强为应用自有的 Google Cloud OAuth。
- 右侧 AI 对话、命令建议和 Agent 接管共用当前主 Provider。
- 登录成功不自动切换主 Provider，避免意外消耗套餐或 API 额度。
- 每个 Provider 在应用内提供中文安装、登录、配置、退出和排障说明。

### 2.2 技术目标

- 用统一接口隔离 JSON-RPC、ACP、HTTP 和 OpenAI 兼容协议差异。
- 凭据只由官方客户端或 Electron 安全存储持有，渲染进程不接触 Token、Cookie 或账号密码。
- Codex 和 Grok 的原生本地工具不能绕过 ShellPilot 的 SSH 端点绑定、风险分类、二次确认、验证和回滚。
- 保持旧配置兼容，升级后现有 API 配置档案继续可用。
- 所有 Provider 支持统一流式事件、取消、错误分类和资源清理。

## 3. 非目标

- 不读取、复制、导入或导出 `~/.codex/auth.json`、Grok 登录缓存或 Gemini CLI OAuth 缓存。
- 不在 ShellPilot 内嵌第三方账号密码表单；登录使用官方浏览器页面或设备码流程。
- 不把失败任务自动转发给另一 Provider。
- 不使用 OpenRouter、LiteLLM 等中转服务替代官方账号登录。
- 不在首期实现自动按价格、速度或额度选择 Provider。
- 不在 CI 中保存真实账号、刷新令牌或 API Key。
- 不把 Codex、Grok 或 Gemini 的原生高权限本地工具直接开放给 SSH Agent。
- 不在本设计中顺带重构与 Provider 接入无关的 UI、SSH 或文件管理模块。

## 4. 已选方案

采用“统一 Provider 适配层”：

```text
右侧 AI / Agent / 命令建议
              |
              v
      AIProviderManager
              |
   +----------+----------+----------+------------------+
   |                     |          |                  |
   v                     v          v                  v
CodexProvider       GrokProvider  GeminiProvider  OpenAICompatibleProvider
app-server JSON-RPC   ACP stdio    Gemini API        现有 HTTP 接口
```

没有选择的方案：

- 全部通过 CLI 文本输出：协议脆弱、版本差异大，且 Gemini CLI OAuth 不适合第三方复用。
- 全部通过模型中转站：不能使用 Codex/Grok 个人账号登录，并增加数据流转和外部依赖。

## 5. 核心组件

### 5.1 `AIProviderManager`

主进程中的唯一 Provider 调度入口，负责：

- 注册和发现适配器。
- 获取安装、认证和健康状态。
- 选择当前 Provider 和模型。
- 创建请求 ID 并管理并发、取消和清理。
- 将各协议事件归一化后通过受控 IPC 发给渲染进程。
- 在切换 Provider、退出登录和应用退出前协调活动任务。

建议接口：

```ts
interface AIProviderAdapter {
  id: string
  getCapabilities(): ProviderCapabilities
  getStatus(options?: StatusOptions): Promise<ProviderStatus>
  login(options?: LoginOptions): Promise<LoginStartResult>
  cancelLogin(loginId: string): Promise<void>
  logout(): Promise<void>
  listModels(): Promise<ProviderModel[]>
  chat(request: ProviderRequest, sink: ProviderEventSink): Promise<void>
  runAgent(request: ProviderRequest, sink: ProviderEventSink): Promise<void>
  cancel(requestId: string): Promise<CancelResult>
  dispose(): Promise<void>
}
```

不支持的能力必须通过 `ProviderCapabilities` 明确声明，不能用空实现伪装成功。

### 5.2 `OpenAICompatibleProvider`

承接现有 `src/app/lib/ai.js` 能力：

- OpenAI 官方 API。
- DeepSeek、OpenRouter、SiliconFlow、DashScope、智谱、Moonshot、火山方舟等兼容服务。
- Ollama 和其他本地 OpenAI 兼容端点。
- 现有自定义 Header、代理、模型拉取、健康检查和流式响应。

首步只做适配封装和行为保持，不改变现有网络请求语义。

### 5.3 `CodexProvider`

使用本机 Codex CLI，不复制官方凭据：

- 复用现有系统 CLI 与 Codex Desktop 内置 CLI 解析逻辑。
- 用 stdio 启动 `codex app-server`。
- 完成 `initialize` / `initialized` 握手和能力协商。
- 用 `account/read` 获取认证状态。
- 用 `account/login/start` 启动 ChatGPT 浏览器登录，并通过系统默认浏览器打开返回的官方 URL。
- 监听 `account/login/completed` 和 `account/updated`。
- 用 `model/list` 获取当前账号实际可用模型。
- 用 `thread/start`、`turn/start` 和流式通知驱动会话。
- 用 `turn/interrupt` 或等价协议取消任务。

实现不得固定依赖当前机器上的某个 alpha 版本。启动时必须进行版本和能力探测；协议缺失时显示“Codex 版本不兼容”和升级指引。

ShellPilot 中的“退出登录”会调用官方退出接口。由于官方客户端可能共享登录缓存，界面必须提示退出可能同时影响 Codex CLI、IDE 扩展或其他共用该登录态的官方客户端。

### 5.4 `GrokProvider`

使用 Grok Build 官方客户端：

- 检测 `grok` 是否安装和可执行。
- 未安装时显示官方安装说明，不静默下载或执行远程脚本。
- 登录通过 `grok login` 的官方浏览器流程；无浏览器场景可提供 `--device-auth` 指引。
- 推理通过 `grok agent stdio` 的 ACP JSON-RPC 接口。
- 将 ACP 会话更新、文本增量、工具请求、取消和完成事件映射为统一事件。
- 模型列表优先使用官方模型发现能力，不维护容易过期的硬编码完整清单。

退出登录前同样提示可能影响 Grok Build 官方客户端的共享会话。

### 5.5 `GeminiProvider`

首期使用 Gemini 官方 API：

- 默认支持 Gemini API Key。
- API Key 沿用 Electron `safeStorage` 加密，配置对象只保留密文。
- 支持官方模型列表、健康检查、流式对话、函数调用和取消。
- 不读取或复用 Gemini CLI 的个人 OAuth Token。

Google Cloud OAuth 是后续增强：

- 使用 ShellPilot 自己注册的桌面 OAuth 客户端或由组织提供的 OAuth 客户端。
- 使用官方授权码/PKCE 或 Google 推荐的桌面应用流程。
- Token 由主进程安全存储和刷新。
- Google Cloud 项目、API 启用、OAuth 同意屏幕和计费属于用户或组织配置。

Gemini API Key 是初始多 Provider 发布的必需交付；Google Cloud OAuth 不阻塞该初始发布。

### 5.6 `ProviderToolGateway`

统一承接 Provider 提出的工具调用，并复用现有 ShellPilot Agent 安全协调器。

职责：

- 把 Provider 工具名称和参数转换为 ShellPilot 内部工具请求。
- 校验当前 SSH 会话、主机、端口、用户名、会话进程和已验证主机指纹。
- 复用只读判断、风险事务、二次确认、验证和回滚。
- 为每个 Agent 请求签发短生命周期、单任务、单端点能力令牌。
- 任务取消、标签页关闭、SSH 断开、端点变化或 Provider 切换时立即撤销令牌。
- 只记录脱敏后的参数摘要和结果。

Codex 和 Grok 通过仅监听 `127.0.0.1` 的临时内部 MCP/工具桥接端点访问该网关：

- 使用随机端口和高熵临时 Bearer Token。
- 不监听局域网或公网地址。
- 不把 Token 写入普通配置、日志、历史或诊断包。
- 不信任仅由模型声称的“只读”属性，最终风险分类由 ShellPilot 决定。

普通对话不启动工具桥接器。只有用户对当前精确 SSH 端点显式开启 Agent 接管后，才创建临时桥接会话。

## 6. 统一请求与事件

### 6.1 请求结构

```ts
interface ProviderRequest {
  requestId: string
  conversationId: string
  mode: 'chat' | 'suggestion' | 'agent'
  providerId: string
  model: string
  messages: ProviderMessage[]
  systemPrompt?: string
  sshContext?: SanitizedSSHContext
  agentAuthorization?: AgentAuthorizationReference
  toolCatalog?: ProviderToolDefinition[]
  cwd?: string
  timeoutMs?: number
}
```

请求中不包含 SSH 密码、私钥正文、Provider Token、Cookie 或 API Key。需要认证的网络请求由主进程适配器使用其安全凭据完成。

### 6.2 事件结构

```ts
type ProviderEvent =
  | { type: 'started'; requestId: string }
  | { type: 'text-delta'; requestId: string; text: string }
  | { type: 'tool-requested'; requestId: string; toolCall: SafeToolCall }
  | { type: 'approval-required'; requestId: string; approval: SafeApproval }
  | { type: 'tool-completed'; requestId: string; result: SafeToolResult }
  | { type: 'completed'; requestId: string; usage?: SafeUsage }
  | { type: 'cancelled'; requestId: string }
  | { type: 'failed'; requestId: string; error: ProviderError }
```

右侧界面只消费统一事件，不解析 Codex JSON-RPC、ACP、Gemini SSE 或 OpenAI SSE。

## 7. 配置模型与迁移

AI 配置档案新增非敏感字段：

```ts
interface AIProfileProviderConfig {
  providerId: 'openai-compatible' | 'codex' | 'grok' | 'gemini'
  authMode: 'official-account' | 'api-key' | 'google-cloud-oauth' | 'none'
  model: string
  providerOptions?: Record<string, SafeConfigValue>
}
```

迁移规则：

1. 没有 `providerId` 的旧档案迁移为 `openai-compatible`。
2. 保留现有 `baseURLAI`、`apiPathAI`、`modelAI`、`authHeaderNameAI`、`proxyAI` 和加密后的 API Key。
3. 当前主档案和档案 ID 不变。
4. 导入和导出继续排除 API Key、Token、Cookie 和官方登录缓存。
5. 历史消息新增 Provider 与模型标记，但旧历史保持可读。
6. 迁移失败时保留旧配置并显示可行动错误，不覆盖原数据。

## 8. 用户界面

“模型 API”窗口改为 Provider 卡片入口，同时保留高级配置能力。

每张卡片显示：

- 名称、用途和认证方式。
- 未安装、未登录、登录中、已登录、连接异常或版本不兼容状态。
- 脱敏账号信息和套餐类型，仅在官方接口提供时显示。
- 当前模型和可选模型。
- “登录”“重新连接”“退出登录”“测试连接”“设为当前”和“使用说明”。

交互规则：

- 登录使用系统默认浏览器，不在 WebView 中收集密码。
- 登录成功后刷新账号状态和模型，不自动设为当前 Provider。
- 切换当前 Provider 时保存配置档案。
- 活动任务期间禁止直接切换；先提示用户停止任务。
- 退出登录前提示共享登录态影响。
- 拉取模型失败时保留上次已验证模型，并显示刷新入口和错误原因。
- 高级区域继续提供地址、路径、Header、代理和自定义模型等现有功能。

右侧 AI 历史项显示当次 Provider 和模型。Provider 不可用时，历史仍可查看，但继续对话前要求重新登录、修复配置或由用户主动选择其他 Provider。

## 9. 运行流程

### 9.1 登录

```text
用户点击登录
  -> 渲染进程调用受控 IPC
  -> AIProviderManager 选择适配器
  -> 适配器启动官方登录并返回 URL/设备码
  -> ShellPilot 打开系统浏览器或展示设备码
  -> 官方客户端处理回调并保存凭据
  -> 适配器收到完成事件
  -> 刷新状态和模型
  -> 用户手动设为当前 Provider
```

### 9.2 普通对话

```text
消息与脱敏上下文
  -> ProviderRequest(mode=chat)
  -> 适配器
  -> 统一流式事件
  -> 右侧 AI 渲染并保存脱敏历史
```

普通对话不暴露执行工具。

### 9.3 Agent

```text
用户对精确 SSH 端点开启接管
  -> 创建端点绑定授权和临时工具能力令牌
  -> ProviderRequest(mode=agent)
  -> Provider 提出工具请求
  -> ProviderToolGateway 重新校验端点与风险
  -> 只读操作按现有规则执行
  -> 风险操作进入 ShellPilot 二次确认
  -> 执行、验证、记录或回滚
  -> 结果作为不可信观察返回 Provider
```

Codex/Grok 原生本地 Shell 和文件写入能力在 ShellPilot Agent 会话中默认关闭或限制为只读。任何原生权限升级请求默认拒绝，不能替代 ShellPilot 的风险确认。

## 10. 错误、取消与恢复

统一错误类别：

- `provider-not-installed`
- `provider-unavailable`
- `auth-required`
- `auth-cancelled`
- `auth-expired`
- `permission-denied`
- `quota-exceeded`
- `rate-limited`
- `model-unavailable`
- `network-error`
- `protocol-incompatible`
- `request-timeout`
- `request-cancelled`
- `tool-failed`
- `provider-crashed`
- `unknown`

恢复规则：

- 纯对话在 Provider 进程崩溃后可以重启，但由用户手动重试消息。
- Agent 一旦执行过工具，不自动重放模型请求或工具调用；任务标记为“需验证”。
- Provider 失败不自动转发给其他 Provider。
- 用户停止任务时同时取消模型请求、流、待确认工具和本地子进程。
- SSH 断开、标签页关闭、端点身份变化或应用重启会撤销 Agent 授权。
- 无法确认远端副作用时，不显示“已完成”，而显示“状态不确定，请验证”。
- 退出登录或切换 Provider 前必须结束活动任务。

日志和用户错误信息不得包含：

- API Key、Access Token、Refresh Token、Cookie 或 Authorization Header 值。
- SSH 密码、私钥正文或密钥口令。
- 包含敏感查询参数的完整 URL。
- 官方登录缓存文件内容。

## 11. 中文使用说明

文档是每个阶段的完成条件，不是发布后的补充任务。

### 11.1 应用内说明

帮助中心新增“多模型与账号登录”：

- Provider 选择原则。
- Codex 安装检测、账号登录、模型选择、测试、退出和共享登录态提示。
- Grok Build 安装、登录、ACP 可用性、设备码、模型和退出。
- Gemini API Key 创建、填写、测试、模型选择和计费边界。
- Google Cloud OAuth 的项目、API、同意屏幕和账号要求。
- OpenAI 兼容服务和本地模型原有说明。
- 切换 Provider、停止任务和历史标记说明。
- 隐私、数据流向和套餐/API 计费区别。

每张 Provider 卡片的“使用说明”直接打开对应章节。

### 11.2 仓库文档

- 更新 `apps/electerm-agent/docs/USER_GUIDE_ZH.md`。
- README 增加多 Provider 功能与用户指南入口。
- 新增独立的多 Provider 配置与故障排查文档，便于发布包和在线文档复用。
- 每个版本发布说明列出已支持的认证方式、依赖版本、已知限制和升级注意事项。

### 11.3 故障排查必须覆盖

- 未检测到官方客户端。
- 系统 PATH 中的商店别名无权限，但桌面应用内置命令可用。
- 浏览器登录没有返回。
- 设备码不可用或被组织策略禁用。
- 登录过期或账号被退出。
- Provider 套餐额度不足、API 欠费或速率限制。
- 当前账号没有所选模型。
- 协议版本不兼容。
- 公司代理、自签 CA 或网络阻断。
- 活动任务阻止切换或退出。

## 12. 分阶段交付

### 阶段 1：统一框架与 Codex

- Provider 接口、Manager、事件协议和配置迁移。
- 封装现有 OpenAI 兼容 Provider。
- Codex CLI 解析、app-server 生命周期、账号登录、模型和对话。
- Codex Agent 接入受控工具桥接器。
- Codex 中文使用说明和测试。

### 阶段 2：Grok

- Grok Build 检测、登录状态和安装指引。
- ACP 会话、流式输出、取消和工具映射。
- Grok Agent 安全接入。
- Grok 中文使用说明和测试。

### 阶段 3：Gemini

- Gemini API Key、模型、流式对话、函数调用和取消。
- Gemini Agent 安全接入。
- Gemini 中文使用说明和测试。
- Google Cloud OAuth 作为后续增强，不阻塞初始多 Provider 发布。

### 阶段 4：统一体验与发布验证

- Provider 卡片、统一状态和历史标记。
- 切换、退出、错误处理和手动重试。
- 安全回归、真实账号 Smoke、Windows 打包和发布说明。

各阶段必须保持可测试、可回滚；不能在中间阶段破坏现有 API Key Provider。

## 13. 测试策略

### 13.1 单元测试

- Provider 契约和能力声明。
- 配置迁移、旧档案兼容和无密钥导出。
- Codex JSON-RPC 消息关联、通知、登录完成和版本拒绝。
- Grok ACP 消息关联、流式增量和取消。
- Gemini HTTP/SSE、模型列表、错误映射和 API Key 处理。
- 统一错误分类、请求状态机和资源清理。
- 能力令牌作用域、过期、撤销和端点绑定。
- 日志、历史和诊断信息脱敏。

### 13.2 集成测试

- 使用伪 Codex app-server、伪 Grok ACP 和伪 Gemini HTTP 服务。
- 登录成功、取消、超时、过期、退出和重新登录。
- 模型列表为空、模型消失和服务端协议异常。
- 流式中断、子进程崩溃、请求取消和背压。
- Provider 切换与活动任务互斥。
- Agent 工具请求、只读快速路径、风险确认、拒绝、执行、验证和回滚。
- SSH 断线、标签页切换和端点变化后的授权撤销。

### 13.3 UI/E2E

- Provider 卡片的所有状态和键盘可访问性。
- 浏览器登录启动、登录中、成功、失败和取消。
- 模型选择、设为当前、测试连接和使用说明深链。
- 活动任务期间的切换/退出阻止。
- 对话历史的 Provider/模型标记。
- 中英文界面、窄窗口、夜间主题和 Windows 缩放。

### 13.4 真实 Smoke

- 真实账号测试只在人工、隔离环境中运行。
- 不把账号、Token、Cookie 或 API Key 写入测试产物。
- Codex 验证系统 CLI 及 Codex Desktop 内置 CLI 两条解析路径。
- Grok 验证浏览器登录、设备码和 ACP。
- Gemini 验证 API Key；OAuth 增强实现后单独验证。
- Agent 写操作只针对专用测试服务器和允许目录，并验证回滚。

### 13.5 打包验证

- Windows 安装版和便携版均可发现官方客户端。
- 商店执行别名拒绝访问时能回退到可执行的内置候选。
- 缺少 Codex/Grok 时应用仍正常启动，现有 Provider 不受影响。
- 打包产物不包含开发者账号缓存或密钥。

## 14. 验收标准

1. 旧版 API 配置升级后继续工作，API Key 未泄露或丢失。
2. 用户能在“模型 API”中查看四类 Provider，并明确理解各自认证方式。
3. Codex 用户能通过官方浏览器登录、查看状态、选择模型并完成流式对话。
4. Grok 用户能通过官方登录和 ACP 完成流式对话。
5. Gemini 用户能使用加密保存的 API Key 完成模型拉取和流式对话。
6. 登录成功不会自动改变当前 Provider。
7. 当前 Provider 能同时服务普通对话、命令建议和受控 Agent。
8. Codex/Grok 原生工具不能绕过 ShellPilot SSH 风险确认。
9. 活动任务期间不能无提示切换 Provider 或退出登录。
10. Provider 崩溃、网络失败、额度不足和协议不兼容都有中文可行动提示。
11. 用户停止任务后，模型请求、流、工具调用和子进程均被取消或如实报告无法确认。
12. Agent 已产生副作用后不会自动重试或切换 Provider。
13. 日志、历史、配置导出、诊断包和测试产物不包含敏感凭据。
14. 每个 Provider 卡片都能打开对应中文使用说明。
15. 用户指南、README 和发布说明与实际支持能力一致。
16. 缺少任一新增 Provider 客户端时，其他 Provider 和 SSH 功能继续正常运行。

## 15. 官方资料

- Codex 手册与 app-server：<https://developers.openai.com/codex/codex-manual.md>
- Grok Build：<https://docs.x.ai/build/overview>
- Grok ACP 与 Headless：<https://docs.x.ai/build/cli/headless-scripting>
- Grok 企业认证：<https://docs.x.ai/build/enterprise>
- Gemini API Key：<https://ai.google.dev/gemini-api/docs/api-key>
- Gemini API OAuth：<https://ai.google.dev/gemini-api/docs/oauth>
- Gemini CLI 第三方 OAuth 边界：<https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md>

这些资料会随官方产品更新。实现必须做运行时能力探测并提供版本不兼容提示，不能仅依赖设计日期时的具体命令输出或模型清单。
