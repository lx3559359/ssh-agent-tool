# ShellPilot External MCP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ShellPilot 现有的“引用 MCP 配置”升级为真正的外部 MCP Host/Client，让 Agent 能安全地发现、选择和调用 `stdio` 与 Streamable HTTP MCP 工具。

**Architecture:** Electron 主进程拥有 MCP SDK、传输、会话、凭据和调用网关；Renderer 只管理设置、会话选择、确认 UI 和 Agent 工具适配。公开配置与加密凭据分库存储，所有工具均以服务身份、工具定义指纹和一次性冻结调用为安全边界，结果复用现有 Agent 的脱敏、截断与不可信观察链路。

**Tech Stack:** Electron 41、Node.js >=18、React 17、Ant Design 4、`@modelcontextprotocol/sdk@1.29.0`、Zod、Node `node:test`、Playwright、现有 safeStorage/DPAPI 与 Agent runtime。

---

## 开始前约束

- 设计基线：`docs/superpowers/specs/2026-07-19-shellpilot-external-mcp-client-design.md`。
- 本计划只实现 MCP `tools`；不实现 resources、prompts、roots、sampling、elicitation、Tasks 和旧 HTTP+SSE。
- 真实工具调用只允许 Agent 模式；普通问答只提示切换模式。
- 新会话默认“手动”；另外提供“自动”和“禁用”。
- 所有新发现或定义变化的工具必须先审阅；启用后默认每次确认。只有精确指纹匹配的可信只读工具可人工免确认，写工具永不提供永久放行。
- 主进程不信任 Renderer 传来的命令、URL、工具定义、风险级别或凭据；Renderer 只能引用主进程已登记的 profile、tool revision、selection revision 和 frozen call ID。
- 不自动重试 `tools/call`，避免写操作重复执行。
- 不改写现有“ShellPilot MCP 服务（对外）”；外部 MCP 客户端使用独立命名和代码路径。
- 工作区可能存在用户未提交修改。每个任务只暂存本任务列出的文件，禁止 `git add .`。
- 所有 `npm`、`node --test` 和 `npx playwright` 命令从 `apps/electerm-agent` 目录运行；示例中的 `git add apps/electerm-agent/...` 从仓库根目录运行。

## 目标目录与职责

### 主进程新增

- `src/app/mcp/client/profile-model.js`：公开 profile 规范化和校验。
- `src/app/mcp/client/profile-registry.js`：公开 profile 原子持久化、迁移和导入导出。
- `src/app/mcp/client/credential-vault.js`：凭据引用与 safeStorage 密文库存储。
- `src/app/mcp/client/server-identity.js`：服务身份摘要与工具定义指纹。
- `src/app/mcp/client/tool-policy-store.js`：工具审阅、启用和只读信任策略。
- `src/app/mcp/client/sdk-client.js`：官方 SDK v1 的窄适配层。
- `src/app/mcp/client/session-manager.js`：按会话与服务管理逻辑会话、懒连接、空闲关闭与取消。
- `src/app/mcp/client/selection-registry.js`：主进程校验并冻结会话选择 revision。
- `src/app/mcp/client/http-transport.js`：Streamable HTTP、安全端点和 Bearer 认证。
- `src/app/mcp/client/oauth-provider.js`：OAuth 2.1 discovery、PKCE、refresh 和增量 scope。
- `src/app/mcp/client/tool-gateway.js`：发现快照、冻结调用、审批令牌和 `tools/call`。
- `src/app/mcp/client/result-normalizer.js`：MCP Content Block、脱敏和大小边界。
- `src/app/mcp/client/auto-router.js`：自动服务激活、工具搜索和上限控制。
- `src/app/mcp/client/diagnostics.js`：结构化诊断与安全日志。
- `src/app/mcp/client/mcp-host.js`：服务装配和生命周期入口。
- `src/app/mcp/client/ipc-service.js`：专用、细粒度、显式 allowlist IPC。

### Renderer 新增

- `src/client/components/mcp-client/mcp-client.js`：固定 MCP IPC 客户端接口。
- `src/client/components/mcp-client/mcp-settings.jsx`：外部 MCP 设置页。
- `src/client/components/mcp-client/mcp-profile-editor.jsx`：stdio/HTTP profile 编辑器。
- `src/client/components/mcp-client/mcp-tool-review.jsx`：工具审阅和信任管理。
- `src/client/components/mcp-client/mcp.styl`：页面样式。
- `src/client/components/ai/mcp-selection-store.js`：会话级模式和服务选择持久化。
- `src/client/components/ai/mcp-conversation-selector.jsx`：禁用/自动/手动 UI。
- `src/client/components/ai/mcp-tool-adapter.js`：动态 Agent tool schema 与执行适配。
- `src/client/components/ai/mcp-tool-confirmation-modal.jsx`：一次性调用确认 UI。

### 测试夹具新增

- `test/fixtures/mcp/stdio-server.js`：可控 stdio MCP 服务。
- `test/fixtures/mcp/http-server.js`：可控 Streamable HTTP MCP 服务。
- `test/fixtures/mcp/oauth-server.js`：OAuth discovery/token/resource fixture。
- `test/e2e/032.external-mcp-client.spec.js`：完整设置、选择、调用和恢复流程。

## Task 1: 固定 MCP SDK 和 Node 运行时契约

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/unit-ci/mcp-sdk-contract.spec.js`

- [ ] **Step 1: 写 SDK 导出和运行时契约的失败测试**

```js
// test/unit-ci/mcp-sdk-contract.spec.js
const test = require('node:test')
const assert = require('node:assert/strict')

test('official MCP SDK v1 exposes the required client transports', async () => {
  const client = await import('@modelcontextprotocol/sdk/client/index.js')
  const stdio = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const http = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  assert.equal(typeof client.Client, 'function')
  assert.equal(typeof stdio.StdioClientTransport, 'function')
  assert.equal(typeof http.StreamableHTTPClientTransport, 'function')
})

test('the application requires a Node runtime supported by MCP SDK v1', () => {
  const pkg = require('../../package.json')
  assert.equal(pkg.engines.node, '>=18')
})
```

- [ ] **Step 2: 运行测试并确认因依赖缺失或 engines 不匹配而失败**

Run: `node --test test/unit-ci/mcp-sdk-contract.spec.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 或 `'>=16' !== '>=18'`。

- [ ] **Step 3: 精确安装官方稳定版并更新 engines**

Run: `npm install --save-exact @modelcontextprotocol/sdk@1.29.0`

然后在 `package.json` 中把 `engines.node` 改为 `>=18`，保留 npm 生成的 lockfile 变更，不手工重排其他依赖。

- [ ] **Step 4: 运行契约测试和依赖审计**

Run: `node --test test/unit-ci/mcp-sdk-contract.spec.js`

Expected: PASS，2 tests passed。

Run: `npm ls @modelcontextprotocol/sdk`

Expected: 只解析到 `@modelcontextprotocol/sdk@1.29.0`，无 invalid/deduped conflict。

- [ ] **Step 5: 提交本任务**

```bash
git add apps/electerm-agent/package.json apps/electerm-agent/package-lock.json apps/electerm-agent/test/unit-ci/mcp-sdk-contract.spec.js
git commit -m "build: add MCP client SDK"
```

## Task 2: 建立公开 profile 注册表、旧配置迁移和独立凭据库

**Files:**
- Create: `src/app/mcp/client/profile-model.js`
- Create: `src/app/mcp/client/profile-registry.js`
- Create: `src/app/mcp/client/credential-vault.js`
- Modify: `src/app/lib/get-config.js`
- Modify: `src/app/lib/user-config-controller.js`
- Test: `test/unit-ci/mcp-profile-registry.spec.js`
- Test: `test/unit-ci/mcp-credential-vault.spec.js`

- [ ] **Step 1: 写 profile 规范化、原子保存和旧配置迁移的失败测试**

覆盖以下断言：

```js
const profile = normalizeMcpProfile({
  id: 'prom', name: 'Prometheus', transport: 'stdio',
  command: 'npx', args: ['-y', '@example/prom-mcp'],
  env: { TOKEN: { credentialRef: 'cred-prom-token' } }
})
assert.equal(profile.enabled, false)
assert.equal(profile.reviewState, 'unverified')
assert.equal(profile.env.TOKEN.credentialRef, 'cred-prom-token')
assert.equal('secret' in profile, false)
```

测试还必须验证：

- 写入使用同目录临时文件加 rename，失败时旧文件保持可读。
- `mcpServers` 旧记录只迁移一次，迁入后全部 `enabled: false`、`reviewState: 'unverified'`。
- 迁移标记写入成功后不因旧字段仍存在而重复导入。
- 公开 registry 序列化结果不含 bearer、client secret、refresh token 或环境变量明文。

- [ ] **Step 2: 运行 profile 测试并确认模块不存在**

Run: `node --test test/unit-ci/mcp-profile-registry.spec.js`

Expected: FAIL，错误包含 `Cannot find module .../profile-registry.js`。

- [ ] **Step 3: 实现最小 profile schema 和原子 registry**

公开 API 固定为：

```js
normalizeMcpProfile(input)
createProfileRegistry({ filePath, legacyProvider, onLegacyMigrated })
registry.initialize()
registry.list()
registry.get(profileId)
registry.upsert(profileDraft, { expectedRevision })
registry.remove(profileId, { expectedRevision })
registry.exportPublic()
registry.importPublic(payload)
```

profile revision 每次修改递增；所有写入先校验完整快照，再原子替换文件。`stdio.command`、`args`、`cwd` 只作为公开配置保存；敏感 env 只能保存 `{credentialRef}`。HTTP 只保存 URL、认证类型和 credential reference。

- [ ] **Step 4: 写凭据库存取、锁定和脱敏的失败测试**

覆盖：

- `put()` 返回不可猜测的 `credentialRef`，`listMetadata()` 不返回明文。
- 密文使用现有 `safe-storage.js`；safeStorage 不可用时沿用项目已有加密 fallback。
- `resolve(ref)` 只在主进程返回明文，未知/已删除 ref 返回结构化错误。
- 原子写失败不会损坏旧 vault。
- `JSON.stringify(registry)`、错误日志和导出数据均找不到测试 secret。

Run: `node --test test/unit-ci/mcp-credential-vault.spec.js`

Expected: FAIL，错误包含 `Cannot find module .../credential-vault.js`。

- [ ] **Step 5: 实现独立凭据库并接入旧配置迁移入口**

```js
createMcpCredentialVault({ filePath, safeStorageAdapter })
vault.put({ kind, label, secret })
vault.resolve(credentialRef)
vault.remove(credentialRef)
vault.listMetadata()
```

将 MCP 的公开 profile 与加密 vault 放在 `app.getPath('userData')/mcp-client/` 下的不同文件。`get-config.js` 只提供旧 `mcpServers` 给一次性迁移器；`user-config-controller.js` 不再保护或恢复新 MCP secret，也不得把新 vault 合并回常规用户配置。

- [ ] **Step 6: 运行两组测试**

Run: `node --test test/unit-ci/mcp-profile-registry.spec.js test/unit-ci/mcp-credential-vault.spec.js`

Expected: PASS，所有迁移、原子写和 secret hygiene 断言通过。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/profile-model.js apps/electerm-agent/src/app/mcp/client/profile-registry.js apps/electerm-agent/src/app/mcp/client/credential-vault.js apps/electerm-agent/src/app/lib/get-config.js apps/electerm-agent/src/app/lib/user-config-controller.js apps/electerm-agent/test/unit-ci/mcp-profile-registry.spec.js apps/electerm-agent/test/unit-ci/mcp-credential-vault.spec.js
git commit -m "feat: persist MCP profiles and credentials"
```

## Task 3: 定义服务身份、工具 schema、指纹和审阅策略

**Files:**
- Create: `src/app/mcp/client/server-identity.js`
- Create: `src/app/mcp/client/schema-adapter.js`
- Create: `src/app/mcp/client/tool-policy-store.js`
- Test: `test/unit-ci/mcp-identity-policy.spec.js`
- Test: `test/unit-ci/mcp-schema-adapter.spec.js`

- [ ] **Step 1: 写规范化指纹和策略失效的失败测试**

```js
const identityA = fingerprintServerIdentity({
  transport: 'http', endpoint: 'https://mcp.example.com/api',
  serverInfo: { name: 'metrics', version: '1.0.0' }
})
const identityB = fingerprintServerIdentity({
  serverInfo: { version: '1.0.0', name: 'metrics' },
  endpoint: 'https://mcp.example.com/api', transport: 'http'
})
assert.equal(identityA, identityB)

const toolRevision = fingerprintToolDefinition({
  name: 'query_range', description: 'Read metrics',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
})
```

覆盖：对象键顺序不影响摘要；数组顺序保持语义；endpoint/stdio 启动定义改变会改变服务身份；description 或 inputSchema 改变会产生新 tool revision；新 revision 自动回到 `needs-review`；旧的 trusted-readonly 授权不继承。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-identity-policy.spec.js`

Expected: FAIL，身份与策略模块尚不存在。

- [ ] **Step 3: 实现 canonical JSON 与 SHA-256 身份函数**

```js
canonicalizeForFingerprint(value)
fingerprintServerIdentity({ transport, endpoint, command, args, cwd, serverInfo })
fingerprintToolDefinition({ name, title, description, inputSchema, annotations })
namespaceToolName(profileId, toolName)
```

命名空间格式必须稳定、可逆到 profile ID 和原始 tool name，并对模型工具名字符集做安全编码；不要把 secret、token 或敏感 env 值放进摘要输入。

- [ ] **Step 4: 实现策略存储和状态机**

```js
policyStore.reconcileDiscovery({ profileId, serverIdentity, tools })
policyStore.reviewTool({ profileId, toolRevision, enabled, riskClass })
policyStore.setTrustedReadonly({ profileId, toolRevision, trusted })
policyStore.getExposure({ profileId, serverIdentity })
```

允许状态：`needs-review`、`disabled`、`confirm-every-call`、`trusted-readonly`。`trusted-readonly` 仅接受人工标记为只读且精确 tool revision 匹配的工具；所有其他工具保持每次确认。

- [ ] **Step 5: 写参数 schema 安全校验的失败测试**

覆盖：合法对象通过；缺少 required、错误类型、超深嵌套、超大参数、`__proto__`/`constructor` 污染键被拒绝；`oneOf`/`anyOf`/enum/array 按 MCP JSON Schema 验证；向模型暴露的兼容 schema 不含无法安全序列化的值，但主进程仍用完整 schema 校验实际参数。

Run: `node --test test/unit-ci/mcp-schema-adapter.spec.js`

Expected: FAIL，schema adapter 尚不存在。

- [ ] **Step 6: 实现主进程 schema 编译与模型安全投影**

```js
compileToolInputValidator(inputSchema, { maxBytes, maxDepth })
projectToolSchemaForModel(inputSchema)
normalizeToolArguments(value)
```

validator 在发现 revision 时编译并缓存，调用时以精确 tool revision 查找；编译失败的工具标记 `needs-review/invalid-schema`，不得暴露或调用。Renderer 收到的只是安全投影，不负责最终授权校验。

- [ ] **Step 7: 运行身份、schema 和策略测试**

Run: `node --test test/unit-ci/mcp-identity-policy.spec.js test/unit-ci/mcp-schema-adapter.spec.js`

Expected: PASS，包含 identity/tool definition 授权失效和恶意参数 schema 场景。

- [ ] **Step 8: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/server-identity.js apps/electerm-agent/src/app/mcp/client/schema-adapter.js apps/electerm-agent/src/app/mcp/client/tool-policy-store.js apps/electerm-agent/test/unit-ci/mcp-identity-policy.spec.js apps/electerm-agent/test/unit-ci/mcp-schema-adapter.spec.js
git commit -m "feat: add MCP identity and tool policy"
```

## Task 4: 建立主进程 MCP Host 生命周期和专用 IPC 边界

**Files:**
- Create: `src/app/mcp/client/mcp-host.js`
- Create: `src/app/mcp/client/ipc-service.js`
- Modify: `src/app/lib/create-window.js`
- Modify: `src/app/lib/create-app.js`
- Modify: `src/app/preload/preload.js`
- Modify: `src/client/common/pre.js`
- Create: `src/client/components/mcp-client/mcp-client.js`
- Test: `test/unit-ci/mcp-ipc.spec.js`

- [ ] **Step 1: 写专用 IPC allowlist 的失败测试**

测试采用假的 `ipcMain` 和假的 host，断言只注册一个专用通道 `mcp-client`，但 action 必须是固定 allowlist：

```js
const allowed = [
  'profiles:list', 'profiles:upsert', 'profiles:remove',
  'credentials:put', 'credentials:remove',
  'connections:test', 'tools:list', 'tools:review',
  'selection:prepare', 'tools:snapshot',
  'calls:prepare', 'calls:approve',
  'calls:cancel', 'diagnostics:get', 'oauth:begin'
]
```

覆盖：未知 action、额外字段、错误 revision、任意 method name 和 Renderer 直接提供 command/URL/credential 明文均在调用 host 前被拒绝。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-ipc.spec.js`

Expected: FAIL，`ipc-service.js` 不存在。

- [ ] **Step 3: 实现可依赖注入的 Host 装配和幂等关闭**

```js
createMcpHost({ dataRoot, safeStorageAdapter, clock, sdkFactory })
host.initialize()
host.close()
```

本任务先装配已经存在的 vault → registry/migration → policy store，并为后续 session manager、selection registry、gateway、OAuth 和 diagnostics 定义显式 factory 插槽；后续任务在创建对应服务时补齐默认装配。失败时按逆序关闭已创建资源。`close()` 必须幂等并取消所有已注册资源。

- [ ] **Step 4: 实现专用 IPC handler 和 preload 固定方法**

Renderer API 形状固定为：

```js
window.api.mcpClient.listProfiles()
window.api.mcpClient.upsertProfile(input)
window.api.mcpClient.testConnection(profileId)
window.api.mcpClient.listTools(profileId)
window.api.mcpClient.prepareSelection(input)
window.api.mcpClient.getToolSnapshot(input)
window.api.mcpClient.prepareCall(input)
window.api.mcpClient.approveCall(frozenCallId)
window.api.mcpClient.cancelCall(callId)
```

preload 中每个方法都调用同一专用通道和固定 action；不要把 MCP 方法加入现有 `runGlobalAsync(name, ...args)`，也不要暴露通用 `invokeMcp(action, payload)` 给 Renderer。

- [ ] **Step 5: 接入应用生命周期**

`create-window.js` 在窗口可用前初始化一次 host 和 MCP IPC；`create-app.js` 的 `before-quit` 路径等待 `host.close()` 的有界清理。开发热重载和重复创建窗口不得注册重复 handler。

- [ ] **Step 6: 运行 IPC 测试和现有 preload 契约测试**

Run: `node --test test/unit-ci/mcp-ipc.spec.js test/unit-ci/agent-skill-ipc.spec.js`

Expected: PASS；现有 Agent skill IPC 行为不变。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/app/mcp/client/ipc-service.js apps/electerm-agent/src/app/lib/create-window.js apps/electerm-agent/src/app/lib/create-app.js apps/electerm-agent/src/app/preload/preload.js apps/electerm-agent/src/client/common/pre.js apps/electerm-agent/src/client/components/mcp-client/mcp-client.js apps/electerm-agent/test/unit-ci/mcp-ipc.spec.js
git commit -m "feat: add MCP host IPC boundary"
```

## Task 5: 接入官方 SDK、stdio 传输和逻辑会话管理

**Files:**
- Create: `src/app/mcp/client/sdk-client.js`
- Create: `src/app/mcp/client/session-manager.js`
- Create: `src/app/mcp/client/tool-discovery.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Create: `test/fixtures/mcp/stdio-server.js`
- Test: `test/unit-ci/mcp-stdio-session.spec.js`

- [ ] **Step 1: 编写可脚本化的 stdio MCP fixture**

fixture 使用 SDK v1 server API，行为由非敏感环境变量控制：

```js
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')

// 至少提供 echo_read、mutate_counter、slow_read 三个工具。
// stderr 输出启动诊断；stdout 只允许 MCP 协议帧。
```

fixture 支持：延迟、工具列表变化、返回错误、记录调用次数和收到的参数。测试临时目录由测试创建，不能使用仓库根目录作为写入目标。

- [ ] **Step 2: 写连接、发现、复用、空闲关闭和取消的失败测试**

覆盖：

- SDK initialize 后读取 server info 和 capabilities。
- 同一 `{conversationScopeId, profileId, profileRevision}` 复用一个逻辑会话。
- 不同会话或 profile revision 不共享会话。
- 会话懒连接；没有选择或调用时不启动子进程。
- 到达可注入 clock 的 idle timeout 后关闭。
- 取消 `slow_read` 会终止请求；若 SDK/transport 无法安全单独取消，则关闭该逻辑会话并返回 `cancelled`，不自动重试。
- 服务器退出后状态为 `disconnected`，下一次用户触发可重新连接。

- [ ] **Step 3: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-stdio-session.spec.js`

Expected: FAIL，SDK 适配层和 session manager 尚不存在。

- [ ] **Step 4: 实现窄 SDK 适配层**

```js
createSdkClient({ clientInfo, capabilities: {} })
connectStdio({ command, args, cwd, env, stderr })
client.listTools()
client.callTool({ name, arguments }, { signal })
client.close()
```

SDK 类型和版本特有细节只能出现在 `sdk-client.js`；其他模块依赖上述项目内接口。stdio 环境由最小基础环境、profile 非敏感 env 和 vault 解析的敏感 env 合成，禁止把整个 `process.env` 无筛选转发给第三方进程。

- [ ] **Step 5: 实现 session manager 和发现快照**

```js
sessionManager.acquire({ conversationScopeId, profileId, profileRevision })
sessionManager.release(sessionKey)
sessionManager.closeConversation(conversationScopeId)
sessionManager.closeAll()

discoverTools(session)
// => { serverIdentity, listRevision, tools: [{ name, description, inputSchema, annotations, toolRevision }] }
```

发现结果先进入 Task 3 的 policy reconciliation，再返回可暴露列表。`tools/list_changed` 先记录事件并使快照 stale；完整重发现与 UI 状态在 Task 14 完成。

- [ ] **Step 6: 运行 stdio 测试并检查无孤儿进程**

Run: `node --test test/unit-ci/mcp-stdio-session.spec.js`

Expected: PASS；测试结束后 fixture 子进程全部退出，临时目录可删除。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/sdk-client.js apps/electerm-agent/src/app/mcp/client/session-manager.js apps/electerm-agent/src/app/mcp/client/tool-discovery.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/test/fixtures/mcp/stdio-server.js apps/electerm-agent/test/unit-ci/mcp-stdio-session.spec.js
git commit -m "feat: connect stdio MCP sessions"
```

## Task 6: 新增“外部 MCP（客户端）”设置页并移除提示词式配置

**Files:**
- Create: `src/client/components/mcp-client/mcp-settings.jsx`
- Create: `src/client/components/mcp-client/mcp-profile-editor.jsx`
- Create: `src/client/components/mcp-client/mcp-tool-review.jsx`
- Create: `src/client/components/mcp-client/mcp.styl`
- Modify: `src/client/common/constants.js`
- Modify: `src/client/common/setting-list.js`
- Modify: `src/client/common/init-setting-item.js`
- Modify: `src/client/components/setting-panel/tab-settings.jsx`
- Modify: `src/client/components/ai/ai-config.jsx`
- Modify: `src/client/components/ai/ai-config-props.js`
- Modify: `src/client/components/ai/ai-profiles.js`
- Modify: `src/client/components/ai/ai-request-credentials.js`
- Modify: `src/client/components/ai/ai-chat.jsx`
- Modify: `src/client/components/ai/agent-mcp-servers.js`
- Modify: `src/client/components/ai/ai-agent-copy.json`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/mcp-settings-ui.spec.js`
- Modify: `test/unit-ci/agent-mcp-servers.spec.js`

- [ ] **Step 1: 写设置入口和旧行为移除的失败契约测试**

测试源代码与导出契约，至少断言：

- `setting-list.js` 存在独立的 `settingMcpId`，中文显示“外部 MCP（客户端）”。
- `tab-settings.jsx` 能渲染 `McpSettings`。
- AI Provider 设置不再渲染 `Form.List name="mcpServers"`。
- `ai-chat.jsx` 不再包含 `handleQuoteMcpServers` 或“引用 MCP 配置”上下文动作。
- `agent-mcp-servers.js` 不再生成“当前没有真正 MCP 客户端”的系统提示；该文件要么删除，要么只保留明确的旧配置迁移纯函数。
- 普通 AI credential helper 不再把新 MCP credential 当作 Provider 配置复制、导出或恢复。

- [ ] **Step 2: 运行测试并确认旧 UI 导致失败**

Run: `node --test test/unit-ci/mcp-settings-ui.spec.js test/unit-ci/agent-mcp-servers.spec.js`

Expected: FAIL，仍检测到旧 `mcpServers` 表单和引用动作。

- [ ] **Step 3: 添加独立设置入口、文案和页面骨架**

列表行展示：名称、用途、传输方式、启用状态、连接/认证/审阅状态、工具计数、服务身份摘要、最近测试时间。操作包含测试、登录、审阅、编辑、启用/禁用和删除。

状态统一为：`disconnected`、`connecting`、`ready`、`auth-required`、`review-required`、`error`。页面所有数据通过 `mcp-client.js` 的固定 IPC 方法读取，不从 AI Provider config 推导。

- [ ] **Step 4: 实现 profile 编辑器并严格区分 stdio/HTTP**

stdio 字段：名称、用途、command、逐项 args、cwd、非敏感 env、敏感 env credentialRef。HTTP 字段：名称、用途、HTTPS endpoint、认证类型（无/Bearer/OAuth）、credential metadata。保存时先显示解析后的非敏感启动摘要；Renderer 不回读 secret。

删除 profile 时先显示受影响的会话选择和工具授权，并调用主进程删除公开 profile、策略和关联凭据。删除失败时保持 UI 原状态。

- [ ] **Step 5: 实现工具审阅面板**

逐工具展示服务器、原始名称、description、input schema 摘要、annotations、tool revision、变化原因。动作只允许：禁用、启用且每次确认、人工标记只读后可信。写工具和未知风险工具不显示“永久允许”。

- [ ] **Step 6: 移除提示词式 MCP 路径**

删除旧配置表单、复制/恢复路径、聊天“引用 MCP 配置”入口和系统提示注入。旧数据只由 Task 2 主进程迁移器读取，Renderer 不再把服务器元数据拼进用户消息或 system prompt。

- [ ] **Step 7: 运行设置测试和现有 AI 配置测试**

Run: `node --test test/unit-ci/mcp-settings-ui.spec.js test/unit-ci/agent-mcp-servers.spec.js test/unit-ci/ai-config-required.spec.js test/unit-ci/ai-config-presets.spec.js`

Expected: PASS；AI 配置必填校验和 preset 行为不回归。

- [ ] **Step 8: 提交本任务**

```bash
git add apps/electerm-agent/src/client/components/mcp-client apps/electerm-agent/src/client/common/constants.js apps/electerm-agent/src/client/common/setting-list.js apps/electerm-agent/src/client/common/init-setting-item.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/src/client/components/setting-panel/tab-settings.jsx apps/electerm-agent/src/client/components/ai/ai-config.jsx apps/electerm-agent/src/client/components/ai/ai-config-props.js apps/electerm-agent/src/client/components/ai/ai-profiles.js apps/electerm-agent/src/client/components/ai/ai-request-credentials.js apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/src/client/components/ai/agent-mcp-servers.js apps/electerm-agent/src/client/components/ai/ai-agent-copy.json apps/electerm-agent/test/unit-ci/mcp-settings-ui.spec.js apps/electerm-agent/test/unit-ci/agent-mcp-servers.spec.js
git commit -m "feat: add external MCP settings"
```

## Task 7: 增加会话级“禁用/自动/手动”选择

**Files:**
- Create: `src/app/mcp/client/selection-registry.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Modify: `src/app/mcp/client/ipc-service.js`
- Create: `src/client/components/ai/mcp-selection-store.js`
- Create: `src/client/components/ai/mcp-conversation-selector.jsx`
- Modify: `src/client/components/ai/ai-chat.jsx`
- Modify: `src/client/components/ai/ai-chat-actions.js`
- Modify: `src/client/components/ai/ai.styl`
- Modify: `src/client/components/ai/ai-agent-copy.json`
- Test: `test/unit-ci/mcp-conversation-selection.spec.js`

- [ ] **Step 1: 写选择模型、默认值和持久化的失败测试**

```js
assert.deepEqual(getDefaultMcpSelection(), {
  mode: 'manual', profileIds: [], revision: 1
})
```

覆盖：

- 新 conversation scope 默认 manual，不自动选择全部服务。
- disabled 清空活跃工具但保留用户上一次手动勾选，切回 manual 可恢复。
- manual 只接受当前存在且 enabled/reviewed 的 profile ID。
- auto 不把 Renderer 自报的 tool schema 写进选择。
- 每次发送消息，把不可变 `mcpSelection` 快照写入 chat entry。
- 历史恢复、重新生成和 Agent 接管保持原消息的 selection revision。
- 清空当前对话后回到 manual 默认值；其他 scope 不受影响。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-conversation-selection.spec.js`

Expected: FAIL，selection store 尚不存在。

- [ ] **Step 3: 实现会话选择 store**

```js
createMcpSelectionStore({ storage, profileProvider })
store.get(conversationScopeId)
store.setMode(conversationScopeId, mode)
store.setManualProfiles(conversationScopeId, profileIds)
store.snapshot(conversationScopeId)
store.clear(conversationScopeId)
```

只持久化模式和 profile IDs，不持久化工具定义、凭据或主进程 session ID。主进程 `selection:prepare` 再用 registry 和 policy 校验并返回 `selectionRevision`。

- [ ] **Step 4: 实现主进程 selection registry**

```js
selectionRegistry.prepare({ conversationScopeId, mode, profileIds })
selectionRegistry.resolve({ conversationScopeId, selectionRevision })
selectionRegistry.clearConversation(conversationScopeId)
selectionRegistry.invalidateProfile(profileId)
```

`prepare` 从主进程 profile registry 和 policy store 重新筛选 profile IDs，生成单调递增的 opaque revision，并把 profile revisions 一并冻结。`tools:snapshot`、`calls:prepare` 和 auto router 都只能引用这里存在的 revision；Renderer 自行构造或过期 revision 必须失败。

- [ ] **Step 5: 实现输入框附近的选择器**

选择器展示当前模式、已选服务数量和异常状态。manual 弹层按服务显示用途、连接状态和已启用工具数；auto 说明最多激活 3 个服务；disabled 明确不会连接 MCP。普通问答模式选择了服务时显示“切换到 Agent 才会调用”，不启动连接。

- [ ] **Step 6: 把选择快照接入发送、恢复和清理流程**

`handleSubmit` 在创建 `chatEntry` 前先调用 `selection:prepare`；主进程返回规范化 selection revision 后才发送给 Agent。若 profile 在此期间被禁用，提示用户刷新选择，不静默降级为全选。

- [ ] **Step 7: 运行选择测试和聊天恢复测试**

Run: `node --test test/unit-ci/mcp-conversation-selection.spec.js test/unit-ci/ai-chat-actions.spec.js`

Expected: PASS；现有 chat history 和 takeover 恢复行为不回归。

- [ ] **Step 8: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/selection-registry.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/app/mcp/client/ipc-service.js apps/electerm-agent/src/client/components/ai/mcp-selection-store.js apps/electerm-agent/src/client/components/ai/mcp-conversation-selector.jsx apps/electerm-agent/src/client/components/ai/ai-chat.jsx apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/src/client/components/ai/ai-agent-copy.json apps/electerm-agent/test/unit-ci/mcp-conversation-selection.spec.js
git commit -m "feat: add conversation MCP selection"
```

## Task 8: 动态注入 MCP 工具并接入 Agent 循环

**Files:**
- Create: `src/client/components/ai/mcp-tool-adapter.js`
- Modify: `src/client/components/ai/agent.js`
- Modify: `src/client/components/ai/agent-runtime-context.js`
- Modify: `src/client/components/ai/agent-observation.js`
- Test: `test/unit-ci/mcp-agent-adapter.spec.js`

- [ ] **Step 1: 写 schema 转换、命名空间和动态刷新失败测试**

覆盖：

- MCP JSON Schema 转换为现有模型 API 的 function tool 结构，保留 enum、required、items、oneOf/anyOf；无法表示的 keyword 保留在主进程校验，但向模型输出兼容子集和说明。
- 工具名使用 Task 3 的 namespaced name；模型参数永远不能覆盖 profile ID 或原始工具名。
- 同一 Agent 迭代只暴露该 selection revision 下已审阅、已启用的工具。
- 工具列表变化后下一轮模型调用使用新列表；旧 tool call 不映射到新 revision。
- disabled 或普通问答模式返回零个 MCP tools，且不触发 IPC 连接。

- [ ] **Step 2: 运行测试并确认当前静态 `agentApiTools` 导致失败**

Run: `node --test test/unit-ci/mcp-agent-adapter.spec.js`

Expected: FAIL，当前 Agent 在模块加载时固定生成工具列表。

- [ ] **Step 3: 实现 Renderer 适配器**

```js
createMcpToolAdapter({ mcpClient })
adapter.getTools({ conversationScopeId, selectionRevision })
adapter.prepareExecution({ namespacedName, args, conversationScopeId, selectionRevision })
adapter.executeApproved({ frozenCallId, signal })
```

`getTools()` 返回 `{apiTools, bindings, listRevision}`；bindings 仅含主进程签发的 opaque binding ID，不含 command、URL 或 credential。

- [ ] **Step 4: 将 Agent 工具列表改为逐轮动态构建**

把模块级 `agentApiTools` 改为：

```js
const builtInTools = buildAgentApiTools(agentTools)
const mcpSnapshot = await mcpToolAdapter.getTools(selectionContext)
const apiTools = [...builtInTools, ...mcpSnapshot.apiTools]
```

每轮模型请求前重新取得工具快照；当前轮解析和执行只使用该轮冻结的 bindings。内置 SSH 工具继续走现有 gateway，不改变名称或策略。

- [ ] **Step 5: 让 MCP 观察进入现有不可信结果边界**

`agentRuntime` 增加 `observationSource`/`toolBinding`，MCP 执行结果调用现有 `createAgentObservation` 和大小限制，source 标记为 `mcp:<profileId>`。禁止把 MCP result 直接拼接到 system message。

- [ ] **Step 6: 运行适配器与现有 Agent 测试**

Run: `node --test test/unit-ci/mcp-agent-adapter.spec.js test/unit-ci/ai-conversation-safety.spec.js test/unit-ci/agent-observation.spec.js`

Expected: PASS；现有内置工具列表与观察边界不变。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/client/components/ai/mcp-tool-adapter.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/agent-runtime-context.js apps/electerm-agent/src/client/components/ai/agent-observation.js apps/electerm-agent/test/unit-ci/mcp-agent-adapter.spec.js
git commit -m "feat: inject MCP tools into agent"
```

## Task 9: 实现主进程冻结调用、一次性审批和 Renderer 确认

**Files:**
- Create: `src/app/mcp/client/tool-gateway.js`
- Create: `src/app/mcp/client/approval-ledger.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Create: `src/client/components/ai/mcp-tool-confirmation-modal.jsx`
- Modify: `src/client/components/ai/mcp-tool-adapter.js`
- Modify: `src/client/components/ai/agent.js`
- Modify: `src/client/components/ai/ai.styl`
- Test: `test/unit-ci/mcp-tool-gateway.spec.js`

- [ ] **Step 1: 写冻结调用与一次性令牌的失败测试**

测试必须覆盖：

- `prepareCall` 从主进程 binding 解析 profile/tool/revision，并用工具 input schema 再校验参数。
- Renderer 传入不同 profile ID、tool name、risk class、URL 或 command 被忽略/拒绝。
- frozen call 包含参数规范化摘要、selection revision、server identity、tool revision 和过期时间。
- `approveCall` 只可消费一次；过期、取消、profile revision 变化、server identity 变化、tool revision 变化均失败。
- `trusted-readonly` 精确指纹可直接执行；confirm-every-call 返回 `confirmation-required`。
- 写/未知风险工具即使 Renderer 请求 trust 也必须确认。
- 调用超时或传输错误不自动重试。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-tool-gateway.spec.js`

Expected: FAIL，gateway/ledger 尚不存在。

- [ ] **Step 3: 实现短时冻结调用账本**

```js
ledger.issue({ binding, normalizedArgs, selectionRevision }, { ttlMs })
ledger.inspect(frozenCallId)
ledger.consume(frozenCallId)
ledger.cancel(frozenCallId)
ledger.invalidateByProfile(profileId)
```

账本只在内存中存在，ID 使用加密随机数；进程重启后全部失效。结构化日志只记录参数摘要大小和哈希，不记录完整敏感参数。

- [ ] **Step 4: 实现 gateway 两阶段调用**

```js
gateway.prepareCall({ conversationScopeId, selectionRevision, bindingId, args })
// => { status: 'ready'|'confirmation-required', frozenCallId, presentation }
gateway.approveAndCall({ frozenCallId }, { signal })
gateway.cancel({ callId })
```

`presentation` 来自主进程可信 metadata：服务名、工具名、用途、风险、参数脱敏摘要、目标 endpoint/command 摘要和“不会自动重试”说明。

- [ ] **Step 5: 实现确认弹窗并接入 Agent 暂停/恢复**

弹窗只提交 frozenCallId。用户选择“允许一次”后调用 `approveCall`；“拒绝”生成结构化 denied observation；关闭对话、点击停止或任务取消会调用 `calls:cancel`。只读可信工具不弹窗，但工具卡仍显示来源和信任状态。

- [ ] **Step 6: 运行 gateway 和 Agent 安全测试**

Run: `node --test test/unit-ci/mcp-tool-gateway.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-risk-transaction.spec.js`

Expected: PASS；MCP 新流程不削弱现有 SSH 风险事务。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/tool-gateway.js apps/electerm-agent/src/app/mcp/client/approval-ledger.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/client/components/ai/mcp-tool-confirmation-modal.jsx apps/electerm-agent/src/client/components/ai/mcp-tool-adapter.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/test/unit-ci/mcp-tool-gateway.spec.js
git commit -m "feat: gate MCP tool calls"
```

## Task 10: 规范化 MCP 结果、工具卡和取消状态

**Files:**
- Create: `src/app/mcp/client/result-normalizer.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Modify: `src/client/components/ai/agent-tool-presentation.js`
- Modify: `src/client/components/ai/agent-tool-call-card.jsx`
- Modify: `src/client/components/ai/agent-observation.js`
- Modify: `src/client/components/ai/ai.styl`
- Modify: `src/client/components/ai/ai-agent-copy.json`
- Test: `test/unit-ci/mcp-result-normalizer.spec.js`

- [ ] **Step 1: 写 Content Block、错误和大小边界的失败测试**

覆盖 MCP v1 工具结果中的：

- `text`：保留文本，经现有 secret redaction 和 untrusted observation 包装。
- `image`/`audio`：Renderer 只得到受控 metadata 与大小；首期不把任意 data URL 直接送进模型。
- `resource_link`：只显示 URI、name、mimeType 等 metadata，不自动获取。
- embedded `resource`：文本走边界；二进制只保留 metadata/摘要，不自动解码到模型上下文。
- 未知 block type：保留安全占位和类型名，不抛出未处理异常。
- `isError: true`：归类为远端工具错误，不伪装成 transport failure。
- renderer observation 上限 64 KiB、model observation 上限 32 KiB；截断标志、原始字节数和哈希可见。
- secret fixture 不出现在 normalized output、日志或错误 stack。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-result-normalizer.spec.js`

Expected: FAIL，result normalizer 尚不存在。

- [ ] **Step 3: 实现主进程结果规范化**

```js
normalizeMcpToolResult(result, {
  rendererLimitBytes: 64 * 1024,
  modelLimitBytes: 32 * 1024,
  redact
})
// => { status, rendererView, modelObservation, contentSummary, truncated, digest }
```

主进程先应用绝对接收上限，避免超大响应跨 IPC；Renderer 现有观察模块再执行相同或更严格的防御性边界。不要把完整原始 result 放进 chat history。

- [ ] **Step 4: 扩展工具卡展示 MCP 来源和状态**

工具卡显示：外部 MCP 徽标、服务器名、原始工具名、连接目标摘要、确认/可信状态、耗时、截断状态。状态覆盖 `waiting-confirmation`、`running`、`completed`、`remote-error`、`cancelled`、`connection-lost`。图片/音频/资源块只显示首期支持范围内的安全摘要。

- [ ] **Step 5: 接入停止按钮和取消 observation**

用户停止 Agent 时同时 abort 模型请求和 MCP call。取消结果必须明确告诉模型“用户/系统已取消，未知是否产生远端副作用”，不得把 cancelled 当空成功结果，也不得自动再调一次。

- [ ] **Step 6: 运行结果、工具卡和观察测试**

Run: `node --test test/unit-ci/mcp-result-normalizer.spec.js test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/agent-observation.spec.js`

Expected: PASS，包含超大文本、二进制块、未知块和 secret redaction。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/result-normalizer.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/client/components/ai/agent-tool-presentation.js apps/electerm-agent/src/client/components/ai/agent-tool-call-card.jsx apps/electerm-agent/src/client/components/ai/agent-observation.js apps/electerm-agent/src/client/components/ai/ai.styl apps/electerm-agent/src/client/components/ai/ai-agent-copy.json apps/electerm-agent/test/unit-ci/mcp-result-normalizer.spec.js
git commit -m "feat: normalize MCP tool results"
```

## Task 11: 实现 Streamable HTTP、端点安全和 Bearer 认证

**Files:**
- Create: `src/app/mcp/client/http-transport.js`
- Modify: `src/app/mcp/client/sdk-client.js`
- Modify: `src/app/mcp/client/session-manager.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Create: `test/fixtures/mcp/http-server.js`
- Test: `test/unit-ci/mcp-http-session.spec.js`

- [ ] **Step 1: 写 Streamable HTTP fixture 和失败测试**

fixture 支持 initialize、tools/list、tools/call、session ID、通知、延迟、401、429、500、连接中断和计数。测试覆盖：

- 只使用 SDK `StreamableHTTPClientTransport`，不回退旧 SSE transport。
- 默认只允许 HTTPS；`http://127.0.0.1`、`http://localhost` 和 `[::1]` 仅在明确的本地开发开关下允许。
- 禁止 URL 中的 username/password；重定向到不同 origin、降级 HTTP、file/data/javascript scheme 被拒绝。
- DNS/连接前后执行私网和 loopback 策略，避免公开 URL 重绑定到未授权内网；显式允许的内网目标要在 profile 中保存非敏感授权标志。
- Bearer token 从 vault 注入 Authorization header，错误/诊断/重定向不泄露 header。
- session ID 只在同一 logical session 内使用。
- 429/500/断线不自动重试 `tools/call`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-http-session.spec.js`

Expected: FAIL，HTTP transport 尚不存在。

- [ ] **Step 3: 实现端点校验和安全 fetch 适配器**

```js
validateMcpEndpoint(url, { allowLocalHttp, allowPrivateNetwork })
createSafeMcpFetch({ credentialVault, dnsLookup, maxRedirects })
createHttpTransport({ endpoint, authRef, sdkOptions })
```

每次重定向重新执行 scheme、origin、DNS/IP 和凭据转发检查。Authorization 只发送给精确授权 origin。响应体先经过绝对大小/时间限制，再交给 SDK。

- [ ] **Step 4: 接入 session manager 和状态模型**

HTTP 与 stdio 共享 acquire/release/idle/cancel API，但 transport health 和 session metadata 独立。401 映射 `auth-required`，协议错误映射 `error`，用户取消映射 `cancelled`。

- [ ] **Step 5: 运行 HTTP 与 stdio 回归测试**

Run: `node --test test/unit-ci/mcp-http-session.spec.js test/unit-ci/mcp-stdio-session.spec.js`

Expected: PASS；stdio 行为不受 HTTP 认证和 fetch 策略影响。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/http-transport.js apps/electerm-agent/src/app/mcp/client/sdk-client.js apps/electerm-agent/src/app/mcp/client/session-manager.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/test/fixtures/mcp/http-server.js apps/electerm-agent/test/unit-ci/mcp-http-session.spec.js
git commit -m "feat: connect streamable HTTP MCP sessions"
```

## Task 12: 完成 OAuth 2.1 discovery、PKCE、刷新和增量 scope

**Files:**
- Create: `src/app/mcp/client/oauth-provider.js`
- Modify: `src/app/mcp/client/http-transport.js`
- Modify: `src/app/mcp/client/credential-vault.js`
- Modify: `src/app/mcp/client/ipc-service.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Modify: `src/client/components/mcp-client/mcp-settings.jsx`
- Create: `test/fixtures/mcp/oauth-server.js`
- Test: `test/unit-ci/mcp-oauth.spec.js`

- [ ] **Step 1: 写 OAuth fixture 和安全流程失败测试**

覆盖：

- 从 protected resource metadata / authorization server metadata 自动发现端点。
- authorization code + PKCE S256；state 与 code_verifier 使用加密随机数且单次消费。
- 回调只接受预期 loopback redirect URI、state、issuer 和授权会话。
- token endpoint 认证与 dynamic client registration 按 discovery metadata 能力执行；不假定 client secret 一定存在。
- access/refresh token 和 client secret 只进入 vault；公开 profile 只保存 credentialRef 和非敏感 metadata。
- 过期 access token 单飞刷新；并发调用共享一次 refresh。
- `invalid_grant` 清除失效 token 并进入 `auth-required`，不循环刷新。
- 401/insufficient_scope 触发明确的增量授权提示，未经用户动作不自动扩大 scope。
- discovery、authorize 或 token endpoint 的非 HTTPS/跨 issuer/危险重定向被拒绝。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-oauth.spec.js`

Expected: FAIL，OAuth provider 尚不存在。

- [ ] **Step 3: 实现 OAuth provider 状态机**

```js
oauthProvider.begin({ profileId, requestedScopes })
// => { authorizationUrl, loginSessionId }
oauthProvider.complete({ loginSessionId, callbackUrl })
oauthProvider.getAccessToken({ profileId, requiredScopes })
oauthProvider.logout(profileId)
```

浏览器登录通过 Electron `shell.openExternal` 打开系统浏览器；主进程启动只绑定 loopback 的短时回调监听器。回调页面只显示成功/失败，不回显 code/token。关闭、超时或取消时释放端口和 PKCE 状态。

- [ ] **Step 4: 接入 HTTP transport 和设置页**

HTTP 请求前调用 `getAccessToken`；遇到明确 scope challenge 时把 `{requiredScopes, reason}` 返回设置页/确认 UI。用户点击“授权更多权限”后才调用 `begin`。登出删除 token，但保留公开 profile 与工具审阅记录；重新登录后若服务身份变化，Task 14 会要求复审。

- [ ] **Step 5: 运行 OAuth、HTTP 和 vault 测试**

Run: `node --test test/unit-ci/mcp-oauth.spec.js test/unit-ci/mcp-http-session.spec.js test/unit-ci/mcp-credential-vault.spec.js`

Expected: PASS，测试输出和临时文件均不包含 access/refresh token。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/oauth-provider.js apps/electerm-agent/src/app/mcp/client/http-transport.js apps/electerm-agent/src/app/mcp/client/credential-vault.js apps/electerm-agent/src/app/mcp/client/ipc-service.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/client/components/mcp-client/mcp-settings.jsx apps/electerm-agent/test/fixtures/mcp/oauth-server.js apps/electerm-agent/test/unit-ci/mcp-oauth.spec.js
git commit -m "feat: authenticate MCP with OAuth"
```

## Task 13: 实现自动服务路由、工具上限和按需搜索

**Files:**
- Create: `src/app/mcp/client/auto-router.js`
- Modify: `src/app/mcp/client/tool-discovery.js`
- Modify: `src/app/mcp/client/tool-gateway.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Modify: `src/client/components/ai/mcp-tool-adapter.js`
- Modify: `src/client/components/ai/agent.js`
- Test: `test/unit-ci/mcp-auto-routing.spec.js`

- [ ] **Step 1: 写确定性路由和上限的失败测试**

覆盖：

- auto 仅从 enabled、reviewed、健康的 profile 候选集中选择。
- 根据 profile 用途、工具标题/description 和当前用户请求做本地确定性评分；不把凭据、完整工具结果或聊天历史发送到新外部服务。
- 最多自动激活 3 个服务。
- 暴露给模型的 MCP 工具总数最多 64；超过时只暴露内部 `search_mcp_tools` 与 `activate_mcp_tools`，以及已钉住/当前相关工具。
- 工具搜索只返回 metadata；activate 仍须通过 policy 和 selection revision 校验。
- 相同输入和 registry snapshot 产生相同排序；平分时按稳定 profile/tool key 排序。
- manual 不走自动路由，disabled 返回空结果。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/unit-ci/mcp-auto-routing.spec.js`

Expected: FAIL，auto router 尚不存在。

- [ ] **Step 3: 实现本地候选索引与评分**

```js
router.selectProfiles({ requestText, profiles, maxProfiles: 3 })
router.selectTools({ requestText, tools, maxExposed: 64 })
router.searchTools({ query, selectionRevision, limit })
router.activateTools({ toolRevisionIds, selectionRevision })
```

第一版使用可解释的关键词/BM25 风格本地评分，不引入第二个模型请求。诊断可返回命中字段和分数，但不得记录完整用户消息；只记录截断摘要/哈希。

- [ ] **Step 4: 接入 Agent 每轮动态工具快照**

auto 在首轮根据用户请求选择服务，后续轮可根据最近一条模型请求更新工具集，但单个 Agent step 使用冻结 snapshot。`search_mcp_tools`/`activate_mcp_tools` 是 ShellPilot 内部控制工具，不转发给外部 MCP Server。

- [ ] **Step 5: 运行路由和动态 Agent 测试**

Run: `node --test test/unit-ci/mcp-auto-routing.spec.js test/unit-ci/mcp-agent-adapter.spec.js`

Expected: PASS，3/64 上限和 manual/disabled 隔离均通过。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/auto-router.js apps/electerm-agent/src/app/mcp/client/tool-discovery.js apps/electerm-agent/src/app/mcp/client/tool-gateway.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/client/components/ai/mcp-tool-adapter.js apps/electerm-agent/src/client/components/ai/agent.js apps/electerm-agent/test/unit-ci/mcp-auto-routing.spec.js
git commit -m "feat: route automatic MCP tools"
```

## Task 14: 处理工具变化、崩溃恢复、诊断和同步安全

**Files:**
- Create: `src/app/mcp/client/diagnostics.js`
- Modify: `src/app/mcp/client/tool-discovery.js`
- Modify: `src/app/mcp/client/session-manager.js`
- Modify: `src/app/mcp/client/tool-policy-store.js`
- Modify: `src/app/mcp/client/profile-registry.js`
- Modify: `src/app/mcp/client/mcp-host.js`
- Modify: `src/client/components/mcp-client/mcp-settings.jsx`
- Modify: `src/client/components/ai/ai-chat-actions.js`
- Modify: `src/client/store/sync.js`
- Test: `test/unit-ci/mcp-change-recovery.spec.js`
- Test: `test/unit-ci/mcp-security-hygiene.spec.js`

- [ ] **Step 1: 写 list_changed、身份变化和恢复失败测试**

覆盖：

- 收到 `notifications/tools/list_changed` 后对该 session 做去抖重发现。
- 新工具进入 `needs-review`，不会自动暴露。
- 删除的工具立即从下一轮 snapshot 移除，并使未执行 frozen calls 失效。
- definition fingerprint 变化使旧 enable/trust 失效。
- server identity 变化使该服务全部工具回到待审阅；UI 显示变化前后摘要。
- 子进程/HTTP session 崩溃不会自动重放正在执行的调用。
- 应用重启后 profile/policy 可恢复，但逻辑 session、approval ledger 和在途调用不恢复。
- chat recovery 把中断调用标记 `interrupted-unknown-outcome`，提醒用户核查远端状态。

- [ ] **Step 2: 运行变化恢复测试并确认失败**

Run: `node --test test/unit-ci/mcp-change-recovery.spec.js`

Expected: FAIL，当前只记录 stale 事件，尚未完成 reconciliation。

- [ ] **Step 3: 实现重发现与授权失效事务**

同一 profile 的变更流程必须按顺序提交：发现新列表 → 计算 identity/tool diff → 原子更新 policy snapshot → 失效旧 bindings/frozen calls → 发布 Renderer 状态。任何一步失败时保留上一份可解释快照并将服务标记 error，不暴露半更新工具集。

- [ ] **Step 4: 写诊断与同步/导出 secret hygiene 失败测试**

测试构造独特 secret，检查：

- diagnostics、profile export、同步 payload、chat history、tool card serialization、错误对象和普通日志均不含 secret。
- 公开 profile 可选择同步/导出，但 credentialRef 在跨设备导入后标记 `credential-required`，不能误指向另一台设备的 vault 条目。
- OAuth token、Bearer token、stdio 敏感 env、完整工具参数/结果永不进入同步。
- 诊断包只含版本、状态、时间、错误码、摘要、字节数和脱敏 endpoint。

Run: `node --test test/unit-ci/mcp-security-hygiene.spec.js`

Expected: FAIL，diagnostics 和 sync 过滤尚未实现。

- [ ] **Step 5: 实现结构化诊断和安全导入导出**

```js
diagnostics.record(eventCode, safeMetadata)
diagnostics.snapshot({ profileId, since })
registry.exportPublic({ includePolicies: true })
registry.importPublic(payload, { detachCredentialRefs: true })
```

在 sync 层增加显式 MCP public profile sanitizer，而不是依赖 secret 字段黑名单。跨设备导入生成新的本地 profile revision 并要求重新绑定凭据；trusted-readonly 授权默认不跨设备继承。

- [ ] **Step 6: 运行恢复、安全与同步测试**

Run: `node --test test/unit-ci/mcp-change-recovery.spec.js test/unit-ci/mcp-security-hygiene.spec.js`

Expected: PASS；同步 payload 的 MCP sanitizer 断言由 security-hygiene 测试覆盖。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/electerm-agent/src/app/mcp/client/diagnostics.js apps/electerm-agent/src/app/mcp/client/tool-discovery.js apps/electerm-agent/src/app/mcp/client/session-manager.js apps/electerm-agent/src/app/mcp/client/tool-policy-store.js apps/electerm-agent/src/app/mcp/client/profile-registry.js apps/electerm-agent/src/app/mcp/client/mcp-host.js apps/electerm-agent/src/client/components/mcp-client/mcp-settings.jsx apps/electerm-agent/src/client/components/ai/ai-chat-actions.js apps/electerm-agent/src/client/store/sync.js apps/electerm-agent/test/unit-ci/mcp-change-recovery.spec.js apps/electerm-agent/test/unit-ci/mcp-security-hygiene.spec.js
git commit -m "feat: recover and diagnose MCP sessions"
```

## Task 15: 完成端到端流程、文档、打包与发布验收

**Files:**
- Create: `test/e2e/032.external-mcp-client.spec.js`
- Modify: `docs/USER_GUIDE_ZH.md`
- Modify: `README.md`
- Modify: `src/app/widgets/widget-mcp-server.js`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Modify: `build/bin/package-smoke-utils.js`
- Modify: `test/unit-ci/package-smoke-utils.spec.js`

- [ ] **Step 1: 写完整 E2E 失败测试**

使用真实 Electron + 本地 fixture，至少覆盖：

1. 打开“外部 MCP（客户端）”，新增 stdio profile，测试连接。
2. 首次发现工具进入待审阅；启用只读工具，默认仍每次确认。
3. 新会话默认 manual；选择该服务并进入 Agent。
4. fake OpenAI 首轮返回 MCP tool call，ShellPilot 显示确认卡；允许一次后 fixture 收到一次调用。
5. 工具结果以不可信 observation 回到第二轮模型请求，UI 工具卡显示服务来源。
6. 拒绝调用、停止慢调用、工具定义变化和服务崩溃时显示正确状态，且不重试。
7. 标记精确只读工具为 trusted 后免弹窗；修改 schema 后重新要求审阅和确认。
8. disabled 模式不启动 fixture；普通问答不调用 MCP。
9. HTTP Bearer 流程不在 UI、trace 或日志出现 token。
10. 应用重启后 profile 与审阅状态恢复，在途审批不恢复。

- [ ] **Step 2: 运行 E2E 并确认在功能未完整接线时失败**

Run: `npx playwright test test/e2e/032.external-mcp-client.spec.js --workers=1`

Expected: FAIL，指出尚未接线或选择器/确认流程缺失的真实断点；不能用放宽断言隐藏失败。

- [ ] **Step 3: 完成最后的 UI 接线和可访问性修正**

为设置操作、会话选择、确认弹窗和工具卡增加稳定 `data-testid`、可见 label、键盘焦点、Escape/Enter 行为和 loading/error 状态。不要仅依赖颜色表达连接、审阅或风险状态。

- [ ] **Step 4: 更新用户文档和双向命名**

中文指南说明：

- “外部 MCP（客户端）”与“ShellPilot MCP 服务（对外）”的方向区别。
- stdio、HTTP、Bearer、OAuth 的配置和风险。
- manual/auto/disabled、3 个服务和 64 个工具上限。
- 工具审阅、每次确认、可信只读、definition change 失效。
- secret 不参与同步，跨设备需重新登录/绑定。
- 常见诊断状态、取消的未知副作用和无自动重试。

README 提供精简英文入口。`widget-mcp-server.js` 仅更新对外服务标题/帮助文案，不改变协议或现有能力。

- [ ] **Step 5: 运行目标 E2E**

Run: `npx playwright test test/e2e/032.external-mcp-client.spec.js --workers=1`

Expected: PASS，测试结束后无 fixture 进程、OAuth 回调监听器或临时凭据文件残留。

- [ ] **Step 6: 运行 MCP 单元测试集合**

Run:

```bash
node --test test/unit-ci/mcp-sdk-contract.spec.js test/unit-ci/mcp-profile-registry.spec.js test/unit-ci/mcp-credential-vault.spec.js test/unit-ci/mcp-identity-policy.spec.js test/unit-ci/mcp-schema-adapter.spec.js test/unit-ci/mcp-ipc.spec.js test/unit-ci/mcp-stdio-session.spec.js test/unit-ci/mcp-settings-ui.spec.js test/unit-ci/mcp-conversation-selection.spec.js test/unit-ci/mcp-agent-adapter.spec.js test/unit-ci/mcp-tool-gateway.spec.js test/unit-ci/mcp-result-normalizer.spec.js test/unit-ci/mcp-http-session.spec.js test/unit-ci/mcp-oauth.spec.js test/unit-ci/mcp-auto-routing.spec.js test/unit-ci/mcp-change-recovery.spec.js test/unit-ci/mcp-security-hygiene.spec.js
```

Expected: PASS，0 failed、0 cancelled。

- [ ] **Step 7: 运行全量静态与单元验证**

Run: `npm run lint`

Expected: PASS，无新增 ESLint 错误。

Run: `npm run test-unit-ci`

Expected: PASS；如有与本功能无关的既有失败，保存完整命令和错误证据，不在本任务顺手修改无关模块。

- [ ] **Step 8: 运行打包烟雾测试**

Run: `npm run test-package-smoke`

Expected: PASS，打包产物包含 MCP SDK 所需运行文件且 Electron 主进程可加载。

- [ ] **Step 9: 人工发布验收**

- Windows：验证 safeStorage/DPAPI、stdio 子进程退出、HTTP/OAuth 登录与取消。
- macOS/Linux（CI 或可用机器）：验证 SDK 打包、stdio command/args、keychain/libsecret fallback。
- 断网、代理、TLS 错误、401、429、500、超时、服务器退出、应用退出时均无自动重放。
- 检查 DevTools、应用日志、同步文件、导出文件和 crash diagnostics，不包含测试 secret。
- 检查旧版 `mcpServers` 首启迁移一次且全部禁用/待审阅，现有对外 MCP Server 仍可启动。

- [ ] **Step 10: 提交本任务**

```bash
git add apps/electerm-agent/test/e2e/032.external-mcp-client.spec.js apps/electerm-agent/docs/USER_GUIDE_ZH.md apps/electerm-agent/README.md apps/electerm-agent/src/app/widgets/widget-mcp-server.js apps/electerm-agent/src/client/common/shellpilot-i18n-overrides.js apps/electerm-agent/build/bin/package-smoke-utils.js apps/electerm-agent/test/unit-ci/package-smoke-utils.spec.js
git commit -m "test: verify external MCP client flow"
```

## 里程碑与停点

- **M1（Task 1–5）**：主进程可以安全保存配置并连接 stdio，尚不对用户开放真实调用。
- **M2（Task 6–9）**：设置、会话选择、动态工具和一次性审批形成最小可用竖切；建议做第一次内部演示和安全复核。
- **M3（Task 10–11）**：结果边界和 Streamable HTTP 完成，可进入扩大测试。
- **M4（Task 12–14）**：OAuth、自动路由、变更恢复和同步安全达到正式发布候选标准。
- **M5（Task 15）**：E2E、全量测试、打包和跨平台人工验收完成后才可宣称发布就绪。

每个里程碑结束时执行一次 `superpowers:requesting-code-review`。所有审查问题解决、测试通过且准备合并时，使用 `superpowers:finishing-a-development-branch`；在任何“完成/通过”声明前使用 `superpowers:verification-before-completion` 重新运行对应命令并引用新鲜输出。

## 设计覆盖自检

- [ ] 外部 MCP Client 与现有对外 MCP Server 命名和代码路径分离。
- [ ] 只实现 tools、stdio 与 Streamable HTTP；旧 SSE 和其他 MCP capability 明确排除。
- [ ] 新会话 manual 默认，disabled/auto 行为与 3/64 上限都有测试。
- [ ] 主进程拥有传输、凭据、会话与调用网关；Renderer 只有固定 IPC 方法。
- [ ] profile、secret、session、tool revision、selection revision、frozen call 的边界均有独立测试。
- [ ] 新/变化工具需要审阅；可信只读按精确指纹授权；写工具无永久放行。
- [ ] `tools/call` 无自动重试，取消和崩溃展示 unknown outcome。
- [ ] Content Block、64 KiB/32 KiB 边界、脱敏和不可信 observation 完整覆盖。
- [ ] OAuth discovery、PKCE、refresh、incremental scope 和跨 origin 凭据保护完整覆盖。
- [ ] `tools/list_changed`、服务身份变化、旧配置迁移、重启恢复和同步 secret hygiene 完整覆盖。
- [ ] 单元、E2E、lint、全量测试、打包烟雾和人工发布验收都有明确命令和通过标准。
