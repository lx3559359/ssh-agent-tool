# ShellPilot 外部 MCP Client 设计

日期：2026-07-19
状态：已确认
范围：ShellPilot 作为 MCP Host/Client 连接外部 MCP Server

## 1. 背景

ShellPilot 当前允许用户登记外部 MCP Server，但实现只把服务器名称、传输方式和用途作为提示词上下文传给模型。它没有建立 MCP Client 会话，也没有执行初始化、工具发现或 `tools/call`。聊天区的“引用 MCP 配置”因此只能提供接入建议，不能获得外部系统的真实数据。

项目中另有一个方向相反的内置 MCP Server，用于把 ShellPilot 的 SSH、SFTP 和连接能力暴露给外部 AI 客户端。本设计不重写该服务，只统一产品命名和安全边界：

- **外部 MCP（客户端）**：ShellPilot 主动连接 Prometheus、CMDB、知识库等外部 MCP Server。
- **ShellPilot MCP 服务（对外）**：外部 MCP Client 主动连接 ShellPilot。

## 2. 目标

本设计实现以下结果：

1. ShellPilot 在 Electron 主进程中运行真正的 MCP Client。
2. 支持本地 `stdio` 和远程 `Streamable HTTP` 两种标准传输。
3. 在 Agent 模式中动态发现、选择、调用和取消外部 MCP 工具。
4. 提供“禁用、自动、手动”三种会话级使用模式，新对话默认手动。
5. 所有外部工具默认不可信，工具调用进入明确、可审计、不可复用的权限流程。
6. OAuth、Bearer Token 和 stdio 敏感环境变量不进入普通配置、聊天记录、同步文件或日志。
7. MCP 工具结果沿用现有 Agent 的脱敏、截断和不可信观察边界。
8. 保留未来把主进程 MCP Host 迁移到独立 Broker 进程的接口边界。

## 3. 非目标

首期不实现：

- 旧版 HTTP+SSE 传输兼容。
- MCP `resources`、`prompts`、`roots`、`sampling`、`elicitation`。
- 实验性 MCP Tasks。
- 普通“对话”模式中的隐式工具执行。
- 模型创建、修改或删除 MCP Server 配置。
- 工具写操作的永久免确认授权。
- MCP Server 凭据随配置同步或导出。
- 自动获取工具结果中的资源链接。

工具调用结果仍可能包含 MCP Content Block。首期对结果块的处理见第 13 节。

## 4. 已确认的产品决策

1. 本次只设计 ShellPilot 的外部 MCP Client；现有对外 MCP Server 保持兼容。
2. 新对话的 MCP 模式默认为“手动”，同时提供“自动”和“禁用”。
3. 首期支持 `stdio` 和 `Streamable HTTP`，不支持旧 HTTP+SSE。
4. 首期只实现 MCP `tools` 能力。
5. 所有新发现或定义变化的工具，在完成审阅并启用后默认“每次确认”。
6. 只有人工逐工具审阅后的可信只读工具可以免除每次确认。
7. 正式发布前必须实现 OAuth 2.1 自动发现、PKCE、刷新和增量 Scope。
8. 真实 MCP 工具调用只在 Agent 模式运行；普通对话会先提示切换到 Agent。
9. MCP Client 集中托管在 Electron 主进程，Renderer 不直接管理传输和凭据。

## 5. 产品信息架构

### 5.1 设置中心

设置中心增加“外部 MCP（客户端）”页面。现有对外服务在工具中心显示为“ShellPilot MCP 服务（对外）”。两者不得共用含糊的“MCP Server”标题。

外部 MCP 列表展示：

- 名称和用户填写的用途说明。
- 传输方式。
- 启用状态。
- 连接、认证和审阅状态。
- 已发现工具数、已启用工具数、可信只读工具数。
- 最近测试时间和服务器身份摘要。
- 测试、登录、审阅、编辑、禁用和删除操作。

状态统一为：

- 未连接
- 连接中
- 就绪
- 待登录
- 需审阅
- 不可用
- 已禁用

### 5.2 添加和编辑服务器

标准流程为：

1. 填写公开配置。
2. 测试连接。
3. 查看协商的协议版本和服务器身份。
4. 预览并审阅工具。
5. 选择启用的工具。
6. 保存配置。

连接测试未通过时可以保存为禁用草稿，但不能启用，也不能被会话选择。

stdio 表单包括：

- 名称、用途说明。
- 可执行命令。
- 参数数组。
- 可选工作目录。
- 普通环境变量。
- Secret 环境变量引用。
- 连接和调用超时。

参数必须以数组形式保存和展示。ShellPilot 不接受依赖管道、重定向、变量替换、命令拼接或其他 Shell 解释行为的整段命令。

Streamable HTTP 表单包括：

- 名称、用途说明。
- MCP Endpoint URL。
- 认证方式：无认证、Bearer、OAuth 2.1。
- 连接和调用超时。
- 是否允许自动匹配。

首期不提供任意自定义认证 Header 编辑器，也不提供“忽略 TLS 错误”。

### 5.3 Agent 输入区

Agent 输入区使用一个 MCP 状态按钮展示当前模式、已选服务器数和异常状态。点击后显示：

- **禁用**：不启动 stdio 进程，不建立 HTTP 连接，不把 MCP Server 或工具元数据发送给模型。
- **自动**：只允许从用户明确标记为“允许自动匹配”的服务器中选择候选项。
- **手动**：用户勾选当前对话可使用的服务器。

新对话初始化为 `mode=manual` 且 `selectedServerIds=[]`。当前对话的选择可以随聊天历史保存并在重启后恢复，但不会继承到新对话。

普通对话模式点击 MCP 时，界面明确提示“使用 MCP 需要切换到 Agent 模式”。用户确认后才切换；不在纯问答模式暗中运行工具。

### 5.4 工具审阅

工具审阅页展示：

- 原始工具名称。
- 来自服务器的描述，并标记为不可信元数据。
- Input Schema 可读视图。
- annotations，仅作提示。
- 工具定义指纹。
- 启用状态。
- 调用策略：阻止、每次确认、可信只读。

首次发现、新增或定义变化的工具进入 `pending-review`，不会暴露给模型。用户启用后，调用策略默认为“每次确认”。“可信只读”必须逐工具设置，不提供整个服务器一键信任。

### 5.5 调用确认和工具卡

确认框展示：

- MCP Server 名称和身份摘要。
- 工具原始名称。
- 当前用户任务。
- 冻结后的脱敏参数。
- 参数和结果将流向何处。
- 工具描述来自外部服务器、不能作为安全保证的警告。

确认框只提供“取消”和“仅允许本次”。修改参数必须取消当前调用，让 Agent 生成新的调用。

工具卡展示：

- MCP 标识、服务器和工具名。
- 运行、成功、失败、取消、取消未确认、结果未知状态。
- 参数摘要、耗时、结果规模、是否截断。
- 结果摘要。
- 参数、结果和技术详情入口。

原始 JSON-RPC 包不在主视图展示。

## 6. 总体架构

### 6.1 进程边界

Renderer 负责：

- 设置、会话选择和状态展示。
- Agent 动态工具适配。
- 用户确认界面。
- 工具卡和聊天历史展示。

Electron 主进程负责：

- MCP Profile 和 Secret 管理。
- stdio 子进程与 Streamable HTTP 传输。
- OAuth。
- MCP 初始化、能力协商和工具发现。
- 会话生命周期、重连和关闭。
- 工具 Schema 校验、调用和取消。
- 工具权限、一次性批准和调用审计。

Preload 只暴露细粒度、经过 Schema 校验的 IPC 方法和事件。不得暴露任意 JSON-RPC 透传、Token、敏感环境变量、OAuth 刷新令牌、子进程对象或底层 Transport。

### 6.2 主进程模块

MCP Client 代码集中在 `src/app/mcp/client/`，模块边界如下：

- `mcp-host`：唯一的外部入口，协调其他模块。
- `server-registry`：读取、校验和版本化公开 Profile。
- `secret-vault`：加密保存和按引用读取凭据。
- `session-manager`：管理对话级逻辑会话和状态机。
- `transport-factory`：创建 stdio 或 Streamable HTTP Transport。
- `oauth-manager`：发现、授权、刷新和增量 Scope。
- `tool-discovery`：处理 `tools/list`、分页和变更通知。
- `schema-adapter`：校验原始 Schema，并转换为模型供应商可接受的工具定义。
- `tool-gateway`：冻结、授权、执行、取消和结果规范化。
- `approval-ledger`：管理一次性批准记录。
- `mcp-diagnostics`：记录脱敏状态、耗时和错误分类。

Renderer 侧新增：

- MCP Profile 和会话状态 Store。
- Agent MCP Tool Adapter。
- MCP 设置、选择、审阅、确认和工具卡组件。

### 6.3 SDK 策略

使用官方稳定 v1.x TypeScript SDK，并在 lockfile 中固定精确版本。ShellPilot 在 SDK 外增加自己的 `McpClientAdapter`，业务代码只依赖适配接口，不直接散布 SDK 类型和方法。

不使用仍处于预发布阶段的 v2，不把项目现有的自制 MCP Server 实现扩展成客户端。未来升级 SDK 或迁移独立 Broker 时，只替换 Adapter 和主进程实现。

## 7. 持久化数据模型

### 7.1 MCP Profile

```text
McpServerProfile
  id: stable UUID
  name: string
  description: user-authored string
  enabled: boolean
  autoEligible: boolean
  transport: "stdio" | "streamable-http"
  stdio?:
    command: string
    args: string[]
    cwd?: string
    env: Record<string, string>
    secretEnvRefs: Record<string, credentialRef>
  http?:
    url: string
    authMode: "none" | "bearer" | "oauth"
    credentialRef?: string
  connectTimeoutMs: bounded integer
  callTimeoutMs: bounded integer
  configRevision: integer
  lastKnownIdentity?: ServerIdentity
  lastTestedAt?: timestamp
  createdAt: timestamp
  updatedAt: timestamp
```

Profile 不保存明文 Secret。

### 7.2 服务器和工具身份

服务器身份摘要由以下稳定信息构成：

- 传输类型和规范化目标。
- stdio 解析后的可执行路径和安全相关启动配置摘要，或 HTTP 规范化 Endpoint 和认证方式。
- 初始化返回的 server name、version 和协商协议版本。
- OAuth issuer（存在时）。

显示名称、用户填写的用途、超时和最近测试时间不属于服务器身份。普通 `configRevision` 用于撤销旧 Session 和 Approval，但只有传输目标、启动配置、认证边界或初始化身份变化时才撤销已有工具审阅策略。

工具指纹由以下内容规范化后计算摘要：

- 服务器身份摘要。
- 原始工具名称。
- 描述。
- Input Schema。
- annotations。

仅运行时状态不得进入指纹。

### 7.3 工具策略

```text
McpToolPolicy
  serverId
  originalToolName
  toolFingerprint
  exposure: "pending-review" | "enabled" | "disabled"
  executionPolicy: "blocked" | "confirm-every-call" | "trusted-readonly"
  reviewedAt?: timestamp
```

工具指纹变化时，旧策略不再匹配。新定义自动进入 `pending-review`。

### 7.4 对话选择

```text
ConversationMcpSelection
  mode: "disabled" | "auto" | "manual"
  selectedServerIds: string[]
  selectionRevision: integer
```

该数据属于对话，不属于全局模型 Profile。模型 Profile 可以保存 MCP Server 目录，但不能把会话授权隐式继承给新对话。

### 7.5 运行时数据

Session、pending call、approval、access token 明文和子进程句柄只存在于主进程内存。Approval 不持久化，应用重启后全部失效。

## 8. 会话生命周期

每个 `conversationId + serverId` 建立独立逻辑 MCP 会话。对话之间不共享服务端 Session 状态。

状态机：

```text
idle
  -> connecting
  -> authenticating
  -> initializing
  -> discovering
  -> ready
  -> degraded | review-required | backoff
  -> closing
  -> closed
```

规则：

1. 会话按需创建，不在应用启动时连接全部服务器。
2. 设置页测试使用独立的一次性会话。
3. stdio 默认每个活动对话和服务器使用独立子进程。
4. Streamable HTTP 默认每个活动对话和服务器使用独立 MCP Session ID。
5. 同一对话内的工具调用串行执行；不同对话可并发，但受全局资源预算限制。
6. 会话空闲超时后关闭；重新使用时重新初始化和发现工具。
7. 对话删除、Profile 禁用、配置修改或应用退出时关闭相关会话。
8. HTTP 关闭时尝试发送带 Session ID 的 DELETE；服务器不支持时接受 405。
9. stdio 关闭时先请求协议关闭，再限时终止进程树。

配置变化会增加 `configRevision`，所有引用旧 Revision 的 Session 和 Approval 立即失效。

## 9. 连接和工具发现

### 9.1 初始化

Client 使用稳定协议版本协商并记录：

- 协商协议版本。
- Server Info。
- Server Capabilities。
- 是否支持工具变更通知。

服务器不支持兼容版本时，Profile 标记为“不可用”，不降级到旧 HTTP+SSE。

### 9.2 工具发现

`tools/list` 必须处理分页。发现结果先经过：

1. MCP 协议结构校验。
2. 工具名称和描述长度限制、控制字符清理。
3. Input Schema 校验。
4. 模型供应商 Schema 兼容转换。
5. 工具指纹计算。
6. 与已保存策略对比。

Schema 无法安全转换时，该工具显示为“不兼容”，不允许通过删除约束或扩大参数范围的方式强行暴露给模型。

### 9.3 工具变化

收到工具列表变更通知后重新发现：

- 未变化工具继续可用。
- 新增和变化工具进入 `pending-review`，不暴露给模型。
- 删除工具立即从模型工具集移除。
- 等待确认但指纹已经变化的调用立即失效。

服务器身份变化时，该服务器全部工具进入 `pending-review`。

## 10. 动态工具选择与模型集成

### 10.1 工具命名

暴露给模型的工具名称使用确定性命名空间：

```text
mcp_<serverShortId>_<normalizedToolName>_<collisionSuffix>
```

名称满足模型供应商限制。Renderer 维护运行时映射，界面始终展示服务器原始名称和工具原始名称。

### 10.2 手动模式

在第一次模型请求前：

1. 为用户选中的服务器创建会话。
2. 完成认证、初始化和工具发现。
3. 收集已审阅、已启用且非阻止的工具。
4. 适配 Schema 并加入本轮模型工具列表。

认证或审阅未完成时暂停发送，先引导用户处理，不让模型误以为工具可用。

### 10.3 自动模式

自动模式最初只给模型提供：

- 用户填写的、已清理的 Server 名称和用途摘要。
- 内部安全工具 `mcp_activate_server`。

模型选择候选 Server 后，ShellPilot 才建立会话并在下一轮请求注入已审阅工具。Server 自己返回的工具描述不能作为最初的自动路由依据。

每个 Agent 任务默认最多自动激活 3 个 Server。默认最多同时向模型暴露 64 个外部工具。超过预算时不得静默截断，而是提供内部工具搜索和分批激活流程，让 Agent 缩小工具集合。

手动模式允许用户选择更多 Server，但同样受工具暴露预算约束。

### 10.4 Agent 循环

现有 Agent 的静态工具集合改为“每轮动态构建”：

```text
ShellPilot built-in tools
+ active MCP tools for this conversation
+ internal MCP routing tools when required
```

模型产生 MCP Tool Call 后，Adapter 解析命名空间，得到原始 Server 和 Tool 身份，再进入主进程 Tool Gateway。模型不能直接选择 Transport、URL、命令或 credentialRef。

## 11. 权限与批准模型

### 11.1 工具策略

权限只有三种：

- `blocked`：永不调用。
- `confirm-every-call`：默认策略，每次调用都确认。
- `trusted-readonly`：精确指纹不变时允许自动调用。

annotations、名称和描述不能自动授予可信只读权限。可信只读是用户对某个精确工具定义的显式判断，不表示信任整个 Server，也不能扩展到写操作。

首期不提供写操作的永久免确认策略。

### 11.2 冻结调用

Tool Gateway 在执行前创建 Frozen Call：

- conversationId
- serverId
- server identity digest
- original tool name
- tool fingerprint
- configRevision
- selectionRevision
- 规范化参数
- 参数摘要
- 当前用户任务摘要
- 创建时间和过期时间

主进程使用原始工具 Schema 再次校验参数。Renderer 只展示 Frozen Call，不重新构造执行参数。

### 11.3 一次性批准

需要确认时，用户接受后主进程创建不可复用的 `approvalId`。Approval 精确绑定 Frozen Call，并在以下任一情况立即失效：

- 已执行一次。
- 超过短时有效期。
- 参数、工具指纹或服务器身份变化。
- Profile、会话选择或对话状态变化。
- 会话关闭、应用重启或用户取消。

### 11.4 双重校验

Renderer 的现有 Agent 风险网关负责用户交互和任务级编排；主进程 Tool Gateway 再检查会话选择、工具暴露状态、策略、指纹和 Approval。只通过 Renderer 校验不能执行 MCP Tool Call。

## 12. 传输与认证安全

### 12.1 stdio

1. 使用 `spawn(command, args, { shell: false, windowsHide: true })`。
2. 首次测试和每次命令目标变化时，展示解析后的可执行文件绝对路径。
3. 不通过 `cmd.exe`、PowerShell 或 Shell 字符串解释参数。
4. 子进程只继承最小系统环境；业务凭据必须使用 Secret 引用。
5. stdout 仅允许 MCP JSON-RPC；其他内容按协议错误处理。
6. stderr 只保留脱敏、限量的诊断尾部，不因存在 stderr 自动判定调用失败。
7. 设置连接、初始化、调用、关闭和输出上限。
8. 应用退出、会话关闭或进程失控时终止完整进程树。
9. MCP Server 可执行路径或关键启动配置变化时，服务器身份变化并撤销旧工具策略。

### 12.2 Streamable HTTP

1. 默认要求 HTTPS；只有 `localhost`、`127.0.0.1` 和 `::1` 可以使用 HTTP。
2. 禁止 URL 内嵌用户名、密码或 Token。
3. MCP 请求不跟随跨 Origin 重定向。
4. Authorization Header 不转发到重定向目标。
5. 不提供跳过 TLS 校验的用户设置。
6. 允许用户主动配置内网 MCP Endpoint，但模型不能创建或修改 URL。
7. Session ID 和协商协议版本只在主进程保存并附加到后续请求。
8. HTTP 404 Session 失效只允许在下一次调用前重建 Session，不重放已经发送的 Tool Call。

### 12.3 OAuth 2.1

正式发布必须支持：

- Protected Resource Metadata 发现。
- OAuth Authorization Server Metadata 和 OIDC Discovery。
- Authorization Code + PKCE S256。
- `state` 校验。
- loopback 随机端口回调。
- Resource Indicator。
- Access Token 刷新和 Refresh Token 轮换。
- `WWW-Authenticate` Scope Challenge。
- 增量 Scope 和有限次数重试授权流程。

授权使用系统浏览器。Token 不放入 URL，不转发给非目标 MCP Server，也不写入聊天、日志或同步数据。

### 12.4 Secret 存储

使用 Electron `safeStorage` 在 Windows 上调用系统加密能力。普通配置只保存不可反推 Secret 的 `credentialRef`。Secret 仅在主进程需要发送请求或创建进程环境时短暂解密。

配置导出只包含 Secret 槽位名称和缺失提示，不包含密文或明文。导入后相关 Profile 保持“待登录”或“缺少凭据”。

## 13. 工具调用和结果处理

### 13.1 调用

一次调用流程：

1. 模型生成动态工具调用。
2. Adapter 解析为 Server 和原始 Tool。
3. 主进程验证当前对话选择和 Session。
4. 使用原始 Schema 校验参数。
5. 创建 Frozen Call。
6. 应用 Tool Policy；必要时请求用户确认。
7. 验证一次性 Approval。
8. 执行 `tools/call`。
9. 规范化结果并生成不可信 Observation。
10. 把受限结果加入 Agent 下一轮消息。

同一对话的 MCP Tool Call 串行执行。首期不对 `tools/call` 自动重试，即使 annotations 声明幂等也不例外。

### 13.2 取消和超时

- Agent 停止时向支持取消的 Server 发送 MCP 取消通知。
- 调用还必须受本地 AbortSignal 和超时控制。
- Server 确认取消时标记“已取消”。
- 无法确认远程是否停止时标记“取消未确认”。
- 传输断开且请求可能已经送达时标记“结果未知”。
- 取消未确认和结果未知均禁止自动重试。

### 13.3 Content Block

工具返回结果按类型处理：

- `text` 和 `structuredContent`：脱敏、规范化、截断后展示并发送给模型。
- `image`：验证 MIME 和大小，使用临时受控数据展示；只有当前模型支持相应输入时才允许进入后续模型上下文。
- `audio`：验证 MIME 和大小，提供受控播放或下载；首期不自动发送给模型。
- `resource_link`：展示链接和元数据，不自动读取。
- embedded resource：文本内容按普通文本边界处理；二进制内容不自动发送。

每个二进制项最大 5 MiB，单次调用二进制总量最大 10 MiB。超出时丢弃超限内容并在工具卡说明。临时二进制不进入普通聊天历史，关闭会话后清理。

### 13.4 Observation 边界

复用现有 Agent Observation 边界：

- Renderer 观察数据上限 64 KiB。
- 模型观察数据上限 32 KiB。
- 统一进行敏感信息脱敏。
- 统一标记 `untrusted-observation`。
- MCP 返回文本不能授予权限、创建 Approval、修改 Profile 或绕过确认。

工具卡持久化脱敏参数摘要、状态、耗时和受限文本结果。原始 JSON-RPC、完整 stderr、Token、OAuth Code 和 Refresh Token 不持久化。

## 14. IPC 契约

Preload 暴露以下语义接口，而不是任意 MCP 请求通道：

- Profile：列出、读取、保存、删除、启用、禁用、测试。
- Auth：登录、登出、读取脱敏状态。
- Review：读取工具快照、保存工具暴露和策略。
- Conversation：准备选择、释放会话、读取状态。
- Tool：准备调用、批准调用、执行调用、取消调用。
- Diagnostics：读取限量脱敏诊断。

主进程向 Renderer 发送：

- Server 状态变化。
- Authentication required。
- Tool list changed。
- Review required。
- Tool call progress 和终态。

所有 IPC 输入和输出都必须经过显式 Schema 校验。IPC 不接受 Renderer 传入任意命令、URL、Header 或 JSON-RPC method。

## 15. 错误和恢复

错误统一映射为：

- 配置无效
- 启动失败
- 连接超时
- 认证失败
- Scope 不足
- 协议不兼容
- 工具定义不兼容
- 工具定义变化
- 调用失败
- 调用超时
- 已取消
- 取消未确认
- 结果未知

恢复原则：

1. 配置、连接、初始化和工具发现可以有限重试并使用指数退避。
2. `tools/call` 不自动重试。
3. stdio 崩溃后关闭该 Session；下一次新调用前可以重建，但不重放旧调用。
4. HTTP Session 404 后关闭旧 Session；下一次新调用前重新初始化。
5. OAuth 401/403 按规范进入重新认证或增量 Scope，限制授权流程重试次数。初始化、发现和授权请求成功后可以继续；已经返回 401/403 的 `tools/call` 不原地重放，必须生成一笔新调用。
6. Profile 编辑后立即关闭受影响 Session，并撤销旧 Approval。
7. 应用重启不恢复进行中的 MCP Call；聊天中未完成的工具卡标记为中断且结果未知。

## 16. 隐私、审计和可观测性

调用前界面明确说明：

1. 工具参数将发送到哪个 MCP Server。
2. 工具结果将发送给当前模型供应商继续推理。

本地诊断可以记录：

- 匿名化 Server ID。
- Transport 类型。
- 状态迁移。
- 初始化和调用耗时。
- MCP、HTTP 和本地错误分类。
- 调用、确认、取消和失败计数。

默认不得记录：

- Secret。
- 完整参数或结果。
- OAuth Code、Token、Scope 返回正文。
- 内网 URL、SSH 地址、账号和业务数据。
- 完整 stderr 或 JSON-RPC 包。

技术详情最多展示脱敏后的错误码、服务器身份摘要、调用 ID、耗时、截断标记和有限 stderr 尾部。

## 17. 旧配置迁移

现有 `mcpServers` 数据迁移规则：

1. 为每条记录创建稳定 UUID 和新 Profile。
2. 默认 `enabled=false`、`autoEligible=false`、状态为“待验证”。
3. 不自动启动任何旧 stdio 命令。
4. 旧 `http` 映射到 `streamable-http`，但必须重新测试。
5. 旧字符串参数保留为迁移预览，用户确认转换为参数数组后才能启用。
6. 不生成或继承工具策略。
7. 不迁移任何潜在明文 Secret 到普通 Profile。
8. 移除 Agent System Prompt 中的 MCP 配置引用内容。
9. 移除聊天区“引用 MCP 配置”入口，以真实 MCP 选择器替代。

迁移失败不能影响其他 AI、SSH 或 SFTP 配置。无法安全转换的记录保留为禁用草稿并给出具体字段提示。

## 18. 测试设计

### 18.1 单元测试

- Profile 校验和旧配置迁移。
- Secret 引用与脱敏。
- Server Identity 和 Tool Fingerprint。
- Tool 名称规范化、冲突和模型限制。
- JSON Schema 校验和兼容转换。
- Tool Policy 和定义变化撤销。
- Frozen Call 和一次性 Approval 绑定。
- 状态机、超时、取消和关闭。
- Content Block 和输出边界。
- IPC Schema 和拒绝任意透传。

### 18.2 集成测试

提供可控的 Mock stdio 和 Streamable HTTP Server，覆盖：

- 初始化和版本协商。
- `tools/list` 分页。
- 工具变化通知。
- 正常、错误、超时和畸形结果。
- stdio 非协议 stdout、stderr 和进程崩溃。
- HTTP Session ID、404 重建和 DELETE。
- 401、403、OAuth、Refresh 和 Scope Challenge。
- 取消确认、取消未确认和结果未知。
- 超大文本、结构化数据和二进制结果。
- 恶意工具名称、描述、Schema 和结果提示注入。

### 18.3 E2E

- 添加、测试、审阅、启用、禁用和删除 Profile。
- 禁用、自动、手动三种模式。
- 普通对话切换 Agent。
- 调用确认和工具卡各状态。
- 定义变化后的策略撤销。
- 应用重启后的选择恢复和进行中调用中断。
- 配置导出不包含 Secret。

### 18.4 安全回归

- stdio 参数不能触发 Shell 注入。
- 可执行路径变化撤销旧身份。
- Token 不进入 URL、日志、聊天或重定向请求。
- 非 loopback HTTP 被拒绝。
- TLS 错误不能被绕过。
- 过期、复用和参数不匹配的 Approval 被拒绝。
- 未审阅工具不进入模型工具列表。
- Disabled 模式不创建任何外部连接或子进程。
- MCP 返回内容不能修改权限和配置。

### 18.5 Windows 发布验证

在安装包和便携包中验证：

- stdio 子进程启动和完整进程树清理。
- Windows 隐藏窗口行为。
- `safeStorage` 持久化。
- 系统浏览器 OAuth 和 loopback 回调。
- 应用升级后 Profile、Tool Policy 和 Secret 引用兼容。

## 19. 实施阶段

### M1：基础框架

- 主进程 MCP Host 和 Adapter。
- Profile、Secret Vault、IPC 和状态模型。
- Mock Server 和迁移测试。

### M2：stdio 与手动模式

- stdio Transport。
- 测试连接、工具发现和审阅。
- 手动选择、动态工具注入。
- 确认、调用、取消和工具卡。

### M3：Streamable HTTP

- HTTP Session、Bearer 和关闭。
- Session 恢复、定义变化和错误映射。
- 网络安全限制。

### M4：完整安全与自动模式

- OAuth 2.1 + PKCE。
- 增量 Scope。
- 自动 Server 路由和工具预算。
- 可信只读策略。

### M5：发布硬化

- 旧配置迁移 UI。
- 全量单元、集成、E2E 和安全回归。
- Windows 安装包与便携包验证。
- 用户文档和故障排查说明。

## 20. 验收标准

1. stdio 和 Streamable HTTP Profile 均可完成测试、初始化、工具发现和调用。
2. 禁用模式不启动进程、不连接网络、不向模型发送 MCP 元数据。
3. 新对话默认为手动，且不会继承其他对话选择。
4. 自动模式只能选择用户允许自动匹配的 Server。
5. 未审阅工具不会暴露给模型；启用后的默认策略为每次确认。
6. 可信只读权限只匹配精确工具指纹；定义变化立即撤销。
7. 需要确认的调用没有有效一次性 Approval 时，主进程拒绝执行。
8. 写操作没有永久免确认路径。
9. Secret 不出现在普通配置、同步、导出、聊天和日志中。
10. 工具结果在发送模型前完成脱敏、截断和不可信标记。
11. `tools/call` 失败、断线或取消未确认时不会自动重试。
12. 应用关闭后不残留 stdio 子进程。
13. OAuth 完成发现、PKCE、Token 刷新和 Scope Challenge 流程。
14. 工具变化、Profile 编辑和服务器身份变化会撤销相关 Session 与 Approval。
15. 单元、集成、E2E、安全和 Windows 打包验证全部通过后才能发布。

## 21. 参考

- MCP 稳定规范：<https://modelcontextprotocol.io/specification/2025-11-25>
- MCP 传输规范：<https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP 授权规范：<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>
- 官方 TypeScript SDK：<https://github.com/modelcontextprotocol/typescript-sdk>
