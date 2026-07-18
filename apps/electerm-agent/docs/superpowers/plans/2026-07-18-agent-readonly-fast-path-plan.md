# ShellPilot Agent Readonly Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ShellPilot v0.4.6 实现每会话 AI 接管下的只读 SSH 快路径、人工终端完全直通、风险事务单次详细确认、可靠运行图标和可审计工具卡，并完成真实 VPS 只读验收与发布。

**Architecture:** 新增专用 `run_readonly_command` 工具和渲染进程只读执行器，复用当前 SSH 会话 PID 的后端 `run-cmd`/SSH exec 通道；策略网关与 dispatch 前各分类一次，并在执行前后核对完整 SSH 端点。人工键盘 Enter 不再经过 ShellPilot 安全协调器；风险调用不再要求通用计划授权，而是使用现有冻结风险事务或精确委托到底层安全事务，确保每个具体风险事务只出现一个详细确认弹窗。

**Tech Stack:** Electron、React、MobX、Node.js、`@electerm/ssh2`、Ant Design、Playwright Electron、`node:test`、现有安全事务/Agent 网关/SSH session API、GitHub Release、ModelScope。

---

## 文件结构

### 新增文件

- `src/client/components/ai/agent-readonly-exec.js`：只读命令二次分类、端点绑定、SSH exec、取消、超时和有界结果规范化。
- `src/client/components/ai/agent-tool-presentation.js`：从工具调用与原始结果生成脱敏后的命令、目标、耗时、退出码和输出展示模型，并判断“填入终端”可用性。
- `test/unit-ci/agent-readonly-exec.spec.js`：只读执行、双重分类、端点变化、超时、取消、输出边界测试。
- `test/unit-ci/agent-tool-presentation.spec.js`：工具卡展示模型、复制与填入终端边界测试。
- `test/e2e/031.agent-readonly-real-server.spec.js`：环境变量驱动的真实 Electron＋Agent 只读执行与性能验收，不接受任意命令参数。
- `docs/releases/v0.4.6.md`：0.4.6 中文发布说明。

### 修改文件

- `src/app/server/session-common.js`：让有界 `run-cmd` 结果显式返回 `truncated`，保留现有 stdout/stderr/code/signal。
- `src/client/common/safety-transactions/command-classifier.js`：将 `ip a` 识别为 `ip address` 的只读别名。
- `src/client/components/ai/agent-tool-scopes.js`：注册 `run_readonly_command` 的 `session-read` 作用域，移除 `confirm_agent_plan`。
- `src/client/components/ai/agent-tool-policy.js`：注册只读 raw-shell 工具，并继续拒绝未知、动态、管道、后台及资源敏感命令。
- `src/client/components/ai/agent-runtime-context.js`：将只读工具绑定到发起任务的 SSH 标签页。
- `src/client/components/ai/agent-task-mode.js`：移除通用计划确认协议，更新 Agent 提示词和命令工具集合。
- `src/client/components/ai/agent-tools.js`：暴露只读工具，移除计划工具与 plan guard，接入只读执行器和风险上下文。
- `src/client/components/ai/agent-risk-delegation.js`：所有已分类为风险的终端/后台命令精确委托到底层冻结安全事务，避免第二个确认弹窗。
- `src/client/components/ai/agent-structured-tools.js`：结构化命令读取改走只读 exec；文件范围读取仍走 SFTP。
- `src/client/components/ai/agent.js`：保存任务目标和工具展示元数据，保持模型观察值有界且不可信。
- `src/client/components/ai/ai-chat.jsx`：Agent 运行时用旋转图标替代发送图标。
- `src/client/components/ai/agent-tool-call-card.jsx`：主要展示命令、目标、耗时、退出码、输出、复制和填入终端操作。
- `src/client/components/ai/ai.styl`：补充只读工具卡、状态行和操作按钮样式。
- `src/client/components/terminal/terminal.jsx`：移除人工 Enter 安全协调器，保留程序代执行安全入口和事务弹窗。
- `src/client/components/setting-panel/setting-terminal.jsx`：移除“SSH 终端安全保护”开关。
- `src/client/common/default-setting.js`：不再声明人工终端安全保护默认值。
- `src/client/common/shellpilot-i18n-overrides.js`：移除已下线开关的中英文文案。
- `test/e2e/common/local-ssh-server.js`：为只读 exec fixture 提供确定性命令输出。
- `test/e2e/026.ai-takeover.spec.js`：覆盖无计划弹窗只读执行、单风险弹窗、人工直通、运行图标和工具卡。
- `test/unit-ci/real-server-e2e-hygiene.spec.js`：验证真实服务器 Agent 测试只含固定读取命令且不会泄露凭据。
- `test/unit-ci/agent-tool-policy.spec.js`、`agent-task-mode.spec.js`、`agent-structured-tools.spec.js`、`agent-risk-delegation.spec.js`、`ai-agent-tools.spec.js`：更新 Agent 策略和执行契约。
- `test/unit-ci/terminal-input-stability.spec.js`、`ai-chat-layout.spec.js`：更新人工输入与 UI 状态契约。
- `test/unit-ci/session-run-cmd-safety.spec.js`：覆盖显式截断元数据。
- `package.json`、`package-lock.json`：版本升级为 0.4.6，并增加 `smoke:agent-readonly`。

---

### Task 1: 固化只读工具与命令分类契约

**Files:**
- Modify: `src/client/common/safety-transactions/command-classifier.js`
- Modify: `src/client/components/ai/agent-tool-scopes.js`
- Modify: `src/client/components/ai/agent-tool-policy.js`
- Test: `test/unit-ci/agent-tool-policy.spec.js`
- Test: `test/unit-ci/command-safety-orchestration.spec.js`

- [ ] **Step 1: 编写 `ip a` 与只读工具失败测试**

在策略测试中增加准确断言：

```js
assert.equal(classifyCommand('ip a').risk, 'readonly')
assert.equal(classifyCommand('ip a show dev eth0').risk, 'readonly')

const descriptor = getAgentToolDescriptor('run_readonly_command')
assert.equal(descriptor.scope, 'session-read')
assert.equal(classifyAgentCall({
  descriptor,
  args: { command: 'ip addr' }
}).outcome, 'allowlisted-readonly')
for (const command of [
  'ip addr add 10.0.0.2/24 dev eth0',
  'cat /etc/os-release | sh',
  'echo $(id)',
  'journalctl -f',
  'unknown-static-command'
]) {
  assert.notEqual(classifyAgentCall({ descriptor, args: { command } }).outcome, 'allowlisted-readonly')
}
```

- [ ] **Step 2: 运行测试并确认新契约失败**

Run: `node --test test/unit-ci/agent-tool-policy.spec.js test/unit-ci/command-safety-orchestration.spec.js`
Expected: FAIL，至少包含 `ip a` 仍为 unknown 或 `run_readonly_command` policy missing。

- [ ] **Step 3: 实现 `ip a` 只读别名**

在 `isReadonly()` 的 `ip` 分支只规范化 section，不改写原命令：

```js
if (executable === 'ip') {
  const rawSection = words[1]?.toLowerCase()
  const section = rawSection === 'a' ? 'addr' : rawSection
  const action = words[2]?.toLowerCase()
  const readonlyActions = section === 'route'
    ? ['show', 'list', 'get']
    : ['show', 'list']
  return ['addr', 'address', 'route', 'link'].includes(section) &&
    (!action || readonlyActions.includes(action))
}
```

- [ ] **Step 4: 注册只读工具策略**

在 `AGENT_TOOL_SCOPES` 加入：

```js
run_readonly_command: 'session-read'
```

将 `run_readonly_command` 加入 raw shell 分类集合；它只能在 `classifyShellText()` 返回 `allowlisted-readonly` 时执行，其他结果仍由网关拒绝或转入风险工具，不能自动回退 PTY。

- [ ] **Step 5: 运行策略测试并确认通过**

Run: `node --test test/unit-ci/agent-tool-policy.spec.js test/unit-ci/command-safety-orchestration.spec.js`
Expected: PASS，`ip a`/`ip addr` 为只读，五类绕过样例均不是 allowlisted-readonly。

- [ ] **Step 6: 提交分类与策略契约**

```bash
git add src/client/common/safety-transactions/command-classifier.js src/client/components/ai/agent-tool-scopes.js src/client/components/ai/agent-tool-policy.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/command-safety-orchestration.spec.js
git commit -m "feat: define Agent readonly command policy"
```

---

### Task 2: 实现有界、可取消的 SSH 只读 exec

**Files:**
- Create: `src/client/components/ai/agent-readonly-exec.js`
- Modify: `src/app/server/session-common.js`
- Test: `test/unit-ci/agent-readonly-exec.spec.js`
- Test: `test/unit-ci/session-run-cmd-safety.spec.js`

- [ ] **Step 1: 编写后端截断元数据失败测试**

将 `session-run-cmd-safety.spec.js` 的有界结果断言补充为：

```js
assert.equal(result.truncated, true)
assert.equal(result.code, 0)
assert.ok(Buffer.byteLength(result.stdout, 'utf8') +
  Buffer.byteLength(result.stderr, 'utf8') <= maxOutputBytes)
```

同时为小输出断言 `truncated === false`。

- [ ] **Step 2: 运行后端测试并确认缺少元数据**

Run: `node --test test/unit-ci/session-run-cmd-safety.spec.js`
Expected: FAIL，`result.truncated` 为 `undefined`。

- [ ] **Step 3: 在有界收集器返回准确截断状态**

为收集器增加只读属性并在 `boundedResult` 合并：

```js
get truncated () {
  return totalBytes > limit
}

const boundedResult = (code = null, signal = null) => ({
  stdout: stdoutCollector?.toString() || '',
  stderr: stderrCollector?.toString() || '',
  code: typeof code === 'number' && Number.isFinite(code) ? code : null,
  signal: signal == null ? null : String(signal),
  truncated: stdoutCollector?.truncated === true ||
    stderrCollector?.truncated === true
})
```

- [ ] **Step 4: 编写只读执行器失败测试**

测试用依赖注入的 `run`/`cancel`/`resolveEndpoint`，覆盖：

```js
const result = await executeAgentReadonlyCommand({
  command: 'ip addr',
  endpoint,
  resolveEndpoint: () => endpoint,
  run: async (pid, command, options) => ({
    stdout: '1: lo\n2: eth0\n', stderr: '', code: 0,
    signal: null, truncated: false
  }),
  cancel: async () => true,
  now: (() => { const values = [1000, 1125]; return () => values.shift() })(),
  createExecutionId: () => 'agent-readonly-test'
})
assert.equal(result.exitCode, 0)
assert.equal(result.durationMs, 125)
assert.equal(result.output, '1: lo\n2: eth0\n')
assert.equal(result.executionId, 'agent-readonly-test')
```

另行断言修改命令、动态 shell、执行中端点变化、预先取消、执行中取消和超过 32 KiB 输出的行为。

- [ ] **Step 5: 运行执行器测试并确认模块不存在**

Run: `node --test test/unit-ci/agent-readonly-exec.spec.js`
Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 6: 实现只读执行器**

稳定接口为：

```js
export async function executeAgentReadonlyCommand ({
  command,
  endpoint,
  resolveEndpoint,
  runtime,
  timeoutMs = 15000,
  maxOutputBytes = 32 * 1024,
  run = runCmd,
  cancel = cancelRunCmd,
  now = Date.now,
  createExecutionId = createAgentReadonlyExecutionId
} = {})
```

执行顺序固定为：调用 `classifyAgentCall()` 复核 `run_readonly_command`；`assertAgentRuntimeActive()`；`assertSameSessionEndpoint(endpoint, resolveEndpoint())`；使用 `endpoint.pid` 调用 `run()`；通过 `registerAgentCancellation()` 注册 `cancel(endpoint.pid, executionId)`；完成后再次核对端点；返回冻结结果：

```js
{
  kind: 'readonly-exec-result',
  command,
  executionId,
  endpoint,
  capturedAt,
  durationMs,
  exitCode: raw.code,
  signal: raw.signal,
  truncated: raw.truncated === true,
  output: [raw.stdout, raw.stderr].filter(Boolean).join('\n')
}
```

策略拒绝使用 `AGENT_READONLY_COMMAND_REJECTED`，端点变化沿用 `SESSION_ENDPOINT_CHANGED`，取消沿用 `AbortError`/`RunCmdCancelledError`，不得自动重试到交互终端。

- [ ] **Step 7: 运行执行器与后端测试并确认通过**

Run: `node --test test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/session-run-cmd-safety.spec.js`
Expected: PASS，执行器始终传递 `timeoutMs: 15000`、`maxOutputBytes: 32768` 和唯一 execution ID。

- [ ] **Step 8: 提交只读 exec**

```bash
git add src/app/server/session-common.js src/client/components/ai/agent-readonly-exec.js test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/session-run-cmd-safety.spec.js
git commit -m "feat: execute readonly Agent commands over SSH exec"
```

---

### Task 3: 重接 Agent 工具循环并移除通用计划门禁

**Files:**
- Modify: `src/client/components/ai/agent-tools.js`
- Modify: `src/client/components/ai/agent-task-mode.js`
- Modify: `src/client/components/ai/agent-runtime-context.js`
- Modify: `src/client/components/ai/agent-structured-tools.js`
- Modify: `src/client/components/ai/agent-risk-delegation.js`
- Modify: `src/client/components/ai/agent.js`
- Test: `test/unit-ci/agent-task-mode.spec.js`
- Test: `test/unit-ci/agent-structured-tools.spec.js`
- Test: `test/unit-ci/agent-risk-delegation.spec.js`
- Test: `test/unit-ci/ai-agent-tools.spec.js`
- Test: `test/unit-ci/agent-risk-execution.spec.js`

- [ ] **Step 1: 编写无计划门禁与单风险事务失败测试**

测试必须断言工具列表不含 `confirm_agent_plan`，包含 `run_readonly_command`；纯只读调用没有 `runtime.planGrant` 仍可执行；风险命令精确委托到底层冻结事务：

```js
assert.equal(agentTools.some(tool =>
  tool.function.name === 'confirm_agent_plan'), false)
assert.equal(agentTools.some(tool =>
  tool.function.name === 'run_readonly_command'), true)
assert.equal(shouldDelegateAgentSafetyConfirmation(
  'send_terminal_command',
  { command: 'systemctl restart nginx' },
  { endpoint: sshEndpoint }
), true)
```

并用 source contract 断言 `ensureAgentPlanAvailable`、`ensureAgentPlanConfirmed`、`commitAgentPlanCall` 不再出现在 `agent-tools.js`。

- [ ] **Step 2: 运行 Agent 契约测试并确认旧计划协议失败**

Run: `node --test test/unit-ci/agent-task-mode.spec.js test/unit-ci/agent-risk-delegation.spec.js test/unit-ci/ai-agent-tools.spec.js`
Expected: FAIL，旧工具列表仍含 `confirm_agent_plan`，风险 restart 尚未委托。

- [ ] **Step 3: 更新工具描述与 Agent 提示词**

新增工具描述：

```js
{
  type: 'function',
  function: {
    name: 'run_readonly_command',
    description: '在当前 SSH 会话的独立 exec 通道运行一条静态、已允许的只读命令；无需用户确认，不写入交互终端。未知、动态、管道、后台或修改命令会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '单条静态只读命令' },
        tabId: { type: 'string', description: '由系统绑定当前接管会话' }
      },
      required: ['command'],
      additionalProperties: false
    }
  }
}
```

`buildAgentTaskModePrompt()` 改为：先简短分析；结构化读取优先；普通静态读取使用 `run_readonly_command`；不得调用计划确认；风险工具调用必须附带目的、影响和结构化验证；读取成功后不得无理由轮询 `get_terminal_status`。

- [ ] **Step 4: 删除通用计划执行许可**

从工具列表、scope 和执行 switch 删除 `confirm_agent_plan`；从只读和风险准备路径删除 `ensureAgentPlanAvailable()`/`ensureAgentPlanConfirmed()`/`commitAgentPlanCall()`。保留 `agent-plan-grant.js`，因为冻结风险事务仍用它签名并验证精确调用，不删除风险 grant。

在 `agentRuntime` 保存任务目的而不是执行许可：

```js
const agentRuntime = {
  goal: String(chatEntry.prompt || 'Agent SSH task'),
  selectedSkillBindings: [],
  selectedSkillArtifactDigests: [],
  // existing endpoint, resolver, takeover registry and cancellation fields
}
```

- [ ] **Step 5: 为风险调用绑定自身上下文**

在风险工具 schema 复用以下字段，冻结到具体调用参数：

```js
riskContext: {
  type: 'object',
  properties: {
    purpose: { type: 'string' },
    impactTargets: { type: 'array', items: { type: 'string' } },
    verification: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: ['read_service_status', 'read_recent_logs',
              'verify_listening_port', 'read_file_range']
          },
          args: { type: 'object' },
          expected: { type: 'object' }
        },
        required: ['name', 'args']
      }
    }
  },
  required: ['purpose', 'verification']
}
```

`buildResolvedRiskTransaction()` 从 `args.riskContext` 和 `runtime.goal` 构造目的、影响对象和验证步骤；冻结后参数或端点变化仍由 `validateConfirmedRiskTransaction()` 拒绝。

- [ ] **Step 6: 让只读工具与结构化读取走 exec**

在执行 switch 中：

```js
case 'run_readonly_command':
  return JSON.stringify(await runReadonlyTool(args, endpoint, runtime))
case 'read_service_status':
case 'read_recent_logs':
case 'verify_listening_port':
case 'read_file_range':
  return JSON.stringify(await executeStructuredAgentTool({
    toolName,
    args,
    endpoint,
    executeCommand: command => runReadonlyTool(
      { command, tabId: args.tabId }, endpoint, runtime
    ),
    readFile: fileArgs => window.store.mcpSftpReadFile(fileArgs)
  }))
```

为了兼容旧模型，`send_terminal_command` 如果二次分类仍为 `allowlisted-readonly`，也路由到相同 exec；风险结果才进入原有终端安全事务。风险后的结构化验证因此自动使用 exec，不依赖 Shell Integration。

- [ ] **Step 7: 把终端风险确认收敛成一个弹窗**

`shouldDelegateAgentSafetyConfirmation()` 对已通过网关、分类为 risky 的 `send_terminal_command` 和 `run_background_command` 返回 true，不再只限 `reversible === true`。委托 preparation 必须冻结完整 args、端点和 `args.riskContext?.verification || []`；执行时由现有 `runSafetyCommand()` 创建并显示唯一的底层安全事务确认，Agent 网关不再先弹另一份风险确认。SFTP 删除沿用现有委托；本机 CLI 等没有底层事务弹窗的工具仍使用 Agent 风险确认。

- [ ] **Step 8: 运行 Agent 核心测试并确认通过**

Run: `node --test test/unit-ci/agent-task-mode.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-risk-delegation.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-risk-verification-gate.spec.js`
Expected: PASS；只读零确认，风险每次一个冻结事务确认，风险验证仍强制执行。

- [ ] **Step 9: 提交 Agent 执行链**

```bash
git add src/client/components/ai/agent-tools.js src/client/components/ai/agent-task-mode.js src/client/components/ai/agent-runtime-context.js src/client/components/ai/agent-structured-tools.js src/client/components/ai/agent-risk-delegation.js src/client/components/ai/agent.js test/unit-ci/agent-task-mode.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-risk-delegation.spec.js test/unit-ci/ai-agent-tools.spec.js test/unit-ci/agent-risk-execution.spec.js
git commit -m "feat: route Agent reads through readonly SSH exec"
```

---

### Task 4: 让人工终端输入完全直通

**Files:**
- Modify: `src/client/components/terminal/terminal.jsx`
- Modify: `src/client/components/setting-panel/setting-terminal.jsx`
- Modify: `src/client/common/default-setting.js`
- Modify: `src/client/common/shellpilot-i18n-overrides.js`
- Test: `test/unit-ci/terminal-input-stability.spec.js`
- Test: `test/unit-ci/terminal-safety-coordinator.spec.js`

- [ ] **Step 1: 编写人工 Enter 直通失败测试**

更新 source contract：

```js
assert.doesNotMatch(terminalSource, /beforeTerminalEnter\s*=/)
assert.doesNotMatch(terminalSource, /createTerminalSafetyCoordinator/)
assert.doesNotMatch(settingSource, /renderTerminalSafetyToggle/)
assert.doesNotMatch(settingSource, /terminalSafetyProtection/)
assert.doesNotMatch(defaultsSource, /terminalSafetyProtection/)
assert.doesNotMatch(localeSource, /terminalSafetyProtectionHelp/)
assert.match(terminalSource, /runSafetyCommand\s*=/)
assert.match(terminalSource, /commandSafetyEntrypoint/)
```

保留 coordinator 自身单元测试，因为安全事务模块可能仍被其他入口复用；测试只要求 `Terminal` 不再把人工 Enter 连接到它。

- [ ] **Step 2: 运行人工输入测试并确认旧拦截仍存在**

Run: `node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/terminal-safety-coordinator.spec.js`
Expected: FAIL，`terminal.jsx` 仍定义 `beforeTerminalEnter` 且设置页仍展示开关。

- [ ] **Step 3: 从 Terminal 实例移除人工安全协调器**

删除 `createTerminalSafetyCoordinator` import、构造、begin/invalidate 和以下人工专用方法：`beforeTerminalEnter`、`consumeTerminalSafetyRelease`。将共享事件缩减为程序代执行入口：

```js
onTerminalSafetyInputChanged = () => {
  this.commandSafetyEntrypoint.inputChanged().catch(window.store.onError)
}

handleTerminalSafetyExecute = () => {
  this.commandSafetyEntrypoint.confirmPending()
}

handleTerminalSafetyCancel = () => {
  if (this.state.terminalSafetyBusy) return
  this.commandSafetyEntrypoint.cancelPending().catch(window.store.onError)
}

handleTerminalCommandFinished = event => (
  this.commandSafetyEntrypoint.handleCommandFinished(event)
)
```

`attach-addon-custom.js` 已经在父级不存在 `beforeTerminalEnter` 时直接调用 `_sendToServerDirect(data)`，因此不需要添加人工命令白名单或特殊分支。

- [ ] **Step 4: 移除无效设置项**

删除设置页 `renderTerminalSafetyToggle()` 及其 render 调用，删除默认值与中英文 label/help。用户旧配置中残留的键不会被读取，也不会影响人工 Enter；不编写破坏性配置迁移。

- [ ] **Step 5: 运行终端与程序入口回归测试**

Run: `node --test test/unit-ci/terminal-input-stability.spec.js test/unit-ci/terminal-safety-coordinator.spec.js test/unit-ci/safety-entrypoint-integration.spec.js test/unit-ci/command-entrypoint-callers.spec.js`
Expected: PASS；人工路径无确认，`runSafetyCommand()`、快捷命令、批量命令和 Agent 风险命令仍使用安全事务。

- [ ] **Step 6: 提交人工终端直通**

```bash
git add src/client/components/terminal/terminal.jsx src/client/components/setting-panel/setting-terminal.jsx src/client/common/default-setting.js src/client/common/shellpilot-i18n-overrides.js test/unit-ci/terminal-input-stability.spec.js
git commit -m "fix: keep manually entered terminal commands direct"
```

---

### Task 5: 增加运行图标与可操作工具卡

**Files:**
- Create: `src/client/components/ai/agent-tool-presentation.js`
- Modify: `src/client/components/ai/ai-chat.jsx`
- Modify: `src/client/components/ai/agent.js`
- Modify: `src/client/components/ai/agent-tool-call-card.jsx`
- Modify: `src/client/components/ai/ai.styl`
- Test: `test/unit-ci/agent-tool-presentation.spec.js`
- Test: `test/unit-ci/ai-chat-layout.spec.js`

- [ ] **Step 1: 编写进行中图标失败测试**

在布局测试断言：

```js
assert.match(aiChatSource,
  /if \(submitDisabled\)[\s\S]*LoadingOutlined[\s\S]*agent-send-running/)
assert.doesNotMatch(aiChatSource,
  /if \(submitDisabled\)[\s\S]{0,180}<SendOutlined/)
```

- [ ] **Step 2: 编写展示模型失败测试**

`agent-tool-presentation.spec.js` 覆盖：

```js
const view = buildAgentToolPresentation('run_readonly_command',
  { command: 'ip addr' }, JSON.stringify({
    endpoint: { tabId: 'tab-a', host: 'srv.test', port: 22, username: 'root' },
    capturedAt: 1000,
    durationMs: 125,
    exitCode: 0,
    truncated: false,
    output: '1: lo'
  }))
assert.deepEqual(view, {
  kind: 'readonly-exec', command: 'ip addr', tabId: 'tab-a',
  target: 'root@srv.test:22', capturedAt: 1000, durationMs: 125,
  exitCode: 0, truncated: false, output: '1: lo'
})
```

稳定接口为 `getAgentCommandFillState({ presentation, activeTabId, terminal })`，返回 `{ allowed, reason }`。仅在活动 tab 相同、SSH 已连接、普通 buffer、当前输入为空时 `allowed === true`；密码提示、TUI、错会话、非空输入均为 false。

- [ ] **Step 3: 运行 UI 单元测试并确认失败**

Run: `node --test test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/ai-chat-layout.spec.js`
Expected: FAIL，展示模块不存在且 disabled 分支仍渲染 SendOutlined。

- [ ] **Step 4: 实现稳定运行图标**

导入 `LoadingOutlined` 并替换 disabled 分支：

```jsx
if (submitDisabled) {
  return (
    <LoadingOutlined
      spin
      className='mg1l send-to-ai-icon agent-send-running'
      title={aiAgentCopy.runningTitle}
    />
  )
}
```

状态继续来自 `agentTaskRegistry`，任务完成、失败、取消或注册失败都由 unregister 恢复 Send 图标；一键停止按钮保持独立。

- [ ] **Step 5: 在观察值转换前保存展示元数据**

创建 `toolEntry` 时先用调用参数与运行时端点生成 running presentation；`executeToolCall()` 返回后、`createAgentToolObservation()` 前再用原始结果补全：

```js
toolEntry.presentation = buildAgentToolPresentation(
  toolCall.function.name,
  args,
  toolResult,
  { endpoint: agentRuntime.endpoint }
)
```

catch 分支也调用同一函数并传入 `{ error: sanitizeAIStoredText(err.message) }`，因此 exec 不可用、超时、策略拒绝和端点变化时仍展示准确命令、目标、错误以及“复制/填入终端”入口。展示模型只允许命令、投影端点、时间、耗时、退出码、截断、错误和已脱敏输出；不得保存 password、token、私钥、完整书签或任意对象键。

- [ ] **Step 6: 重做只读工具卡主视图**

只读卡标题显示“只读执行”和命令；状态行显示 target、duration、exit code、truncated；输出默认折叠。操作按钮：

```jsx
<button type='button' onClick={() => copy(presentation.command)}>
  复制命令
</button>
<button
  type='button'
  disabled={!fillState.allowed}
  title={fillState.reason}
  onClick={handleFillTerminal}
>
  填入终端
</button>
```

`handleFillTerminal` 调用：

```js
window.store.mcpSendTerminalCommand({
  command: presentation.command,
  tabId: presentation.tabId,
  inputOnly: true,
  title: 'Agent 命令预览'
})
```

调用前同步重算 fill state；只填入、不附加 `\r`、不自动 Enter。原始技术 JSON放在次级折叠区域。

- [ ] **Step 7: 运行 UI 测试并确认通过**

Run: `node --test test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/ai-chat-layout.spec.js test/unit-ci/ai-chat-stability-matrix.spec.js`
Expected: PASS；运行状态为 Loading，终态 Send，工具卡动作边界全部成立。

- [ ] **Step 8: 提交 UI 与可见性**

```bash
git add src/client/components/ai/agent-tool-presentation.js src/client/components/ai/ai-chat.jsx src/client/components/ai/agent.js src/client/components/ai/agent-tool-call-card.jsx src/client/components/ai/ai.styl test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/ai-chat-layout.spec.js
git commit -m "feat: show Agent readonly execution progress and evidence"
```

---

### Task 6: 完成本地 SSH E2E 与真实 VPS 只读验收

**Files:**
- Modify: `test/e2e/common/local-ssh-server.js`
- Modify: `test/e2e/026.ai-takeover.spec.js`
- Modify: `package.json`
- Create: `test/e2e/031.agent-readonly-real-server.spec.js`
- Test: `test/unit-ci/real-server-e2e-hygiene.spec.js`

- [ ] **Step 1: 扩展本地 SSH exec fixture**

exec handler 仅实现测试所需固定命令：

```js
const execResults = {
  pwd: ['/home/shellpilot\n', 0],
  'ip addr': ['1: lo: <LOOPBACK,UP>\n2: eth0: <BROADCAST,UP>\n', 0],
  'ip route show': ['default via 192.0.2.1 dev eth0\n', 0],
  'uname -s': ['Linux\n', 0],
  'cat /proc/loadavg': ['0.00 0.01 0.05 1/100 1234\n', 0],
  'systemctl show --no-pager --property=LoadState,ActiveState,SubState,UnitFileState nginx': [
    'LoadState=loaded\nActiveState=active\nSubState=running\n', 0
  ]
}
```

未列出的 exec 返回 127；所有调用进入 `state.execCommands`，交互终端输入仍进入 `state.commands`，以便断言 Agent 没有自动敲终端。

- [ ] **Step 2: 改写 Agent API fixture 为无计划协议**

首轮对 `readonly-e2e` 直接返回 `run_readonly_command('ip addr')`；风险场景直接返回 `send_terminal_command('systemctl restart nginx', riskContext)`；收到一条工具结果后返回最终结论，不再产生 `confirm_agent_plan`。

- [ ] **Step 3: 编写完整 E2E 断言**

`026.ai-takeover.spec.js` 逐项验证：

1. 开启当前会话接管仍需一次授权，其他标签页保持关闭。
2. 提交只读问题后发送位置立即出现 `.agent-send-running`，期间不存在 plan/risk modal。
3. 完成后恢复发送图标；工具卡含 `ip addr`、目标、耗时、退出码和输出。
4. `state.execCommands` 含 `ip addr`，`state.commands` 不含该命令。
5. “填入终端”后命令出现在当前输入但未进入 `state.commands`；非空输入或错标签页时按钮禁用。
6. 人工输入 `ip a` 与 `systemctl restart nginx` 均不出现 ShellPilot modal，并进入 `state.commands`。
7. Agent 风险命令只出现一个详细安全事务弹窗；取消零执行，确认恰好执行一次。
8. Agent 停止会取消活动 exec；标签关闭、重连和应用重启撤销接管。

- [ ] **Step 4: 运行本地 AI 接管 E2E**

Run: `npx playwright test test/e2e/026.ai-takeover.spec.js --workers=1`
Expected: PASS；正常只读工具 dispatch 到结果小于 3 秒，不出现 Shell Integration 等待文本。

- [ ] **Step 5: 编写真实 VPS Electron＋Agent E2E 与卫生测试**

测试只从 `SHELLPILOT_E2E_HOST`、`SHELLPILOT_E2E_PORT`、`SHELLPILOT_E2E_USERNAME`、`SHELLPILOT_E2E_PASSWORD` 读取连接信息，不接受命令行命令。它启动隔离 Electron 应用和本地假 AI API，经客户端正常连接、主机密钥确认、会话接管、Agent 工具调用和工具卡渲染完成验收。固定命令数组：

```js
const readonlyCommands = Object.freeze([
  'ip -brief address',
  'ip addr',
  'ip route show',
  'uname -s',
  'cat /proc/loadavg'
])
```

假 AI API 首轮只返回上述 `run_readonly_command` 调用，收到全部工具观察值后返回最终回答。同一已建立会话预热一次后每条执行 5 次，从工具 presentation 读取 exit code、输出字节数和 duration；测试日志不打印输出或连接凭据，普通读取 p95 超过 3000 ms 时失败。`real-server-e2e-hygiene.spec.js` 断言 031 源码不存在写入、重启、安装、网络修改、清理命令和任意 argv 命令执行。

在 `package.json` 增加固定测试入口：

```json
"test-agent-readonly-real-server": "playwright test test/e2e/031.agent-readonly-real-server.spec.js --workers=1"
```

- [ ] **Step 6: 运行真实服务器 E2E 卫生测试**

Run: `node --test test/unit-ci/real-server-e2e-hygiene.spec.js`
Expected: PASS，031 的固定命令全部只读且凭据、终端正文不进入测试输出。

- [ ] **Step 7: 使用用户提供的 VPS 信息进行真实只读验收**

从 `F:\SSH工具开发\VPS服务器信息.txt` 仅在当前 PowerShell 进程内解析 host/user/password 并映射到 031 使用的环境变量；客户端通过真实连接流程确认并绑定主机指纹。不得显示变量值、不得写入 `.env`、报告或仓库。然后运行：

Run: `npm run test-agent-readonly-real-server`
Expected: 五条命令全部经 `run_readonly_command` 完成，exit code 0、输出非空、无截断、工具卡信息完整、交互终端没有自动命令输入、连续执行稳定，普通读取 p95 ≤ 3000 ms；服务器上不产生文件、服务、软件包或网络配置变化。

- [ ] **Step 8: 提交 E2E 与真实只读验收脚本**

```bash
git add test/e2e/common/local-ssh-server.js test/e2e/026.ai-takeover.spec.js test/e2e/031.agent-readonly-real-server.spec.js package.json test/unit-ci/real-server-e2e-hygiene.spec.js
git commit -m "test: verify Agent readonly SSH fast path"
```

---

### Task 7: 全量自检、版本升级与发布 v0.4.6

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `docs/releases/v0.4.6.md`
- Test: `test/unit-ci/release-notes.spec.js`

- [ ] **Step 1: 运行针对性单元测试**

Run:

```bash
node --test test/unit-ci/agent-readonly-exec.spec.js test/unit-ci/agent-tool-policy.spec.js test/unit-ci/agent-task-mode.spec.js test/unit-ci/agent-structured-tools.spec.js test/unit-ci/agent-risk-delegation.spec.js test/unit-ci/agent-risk-execution.spec.js test/unit-ci/agent-tool-presentation.spec.js test/unit-ci/terminal-input-stability.spec.js test/unit-ci/session-run-cmd-safety.spec.js
```

Expected: PASS，0 failed。

- [ ] **Step 2: 运行全量单元测试与 lint**

Run: `npm run test-unit-ci`
Expected: PASS，0 failed。

Run: `npm run lint`
Expected: exit 0，无 StandardJS 错误。

- [ ] **Step 3: 运行 AI、视觉和质量回归**

Run:

```bash
npx playwright test test/e2e/026.ai-takeover.spec.js test/e2e/026.agent-skill-manager.spec.js test/e2e/026.primary-workspace-regression.spec.js test/e2e/022.secondary-ui-visual-matrix.spec.js --workers=1
npm run test-quality-e2e
npm run test-performance-e2e
```

Expected: PASS；既有截图无非预期差异，Skill、SFTP、接管隔离和性能基线不回归。

- [ ] **Step 4: 升级版本并撰写发布说明**

用精确补丁把 `package.json`、`package-lock.json` 根版本从 `0.4.5` 改为 `0.4.6`。`docs/releases/v0.4.6.md` 必须包含 `[新增]`、`[修复]`、`[改动]` 三节，明确列出：只读 exec 快路径、人工命令直通、风险单弹窗、运行图标、工具卡、真实 VPS 只读验证。

- [ ] **Step 5: 验证发布元数据**

Run: `node --test test/unit-ci/release-notes.spec.js test/unit-ci/update-version.spec.js test/unit-ci/update-sources.spec.js`
Expected: PASS，当前 release notes 与 package version 都是 0.4.6。

- [ ] **Step 6: 构建与打包 Windows x64**

Run:

```bash
npm run b
npm run pb
npx electron-builder --win --x64 --publish never
npm run release:approval
npm run release:prepare-assets
npm run release:local:verify
npm run test-package-smoke
npm run verify-win-portable
```

Expected: `dist` 中安装包、portable zip、latest.yml、checksums、release index 和两个兼容 manifest 全部为 0.4.6，安装包启动冒烟与 portable 校验通过。

- [ ] **Step 7: 最终差异与秘密卫生检查**

Run:

```bash
git diff --check
git status --short
git diff --name-only origin/master...HEAD
git grep -n -I -E "SHELLPILOT_SSH_PASSWORD=|23\.94\.104\.203|VPS服务器信息" -- . ":(exclude)docs/superpowers/specs/2026-07-18-agent-readonly-fast-path-design.md" ":(exclude)docs/superpowers/plans/2026-07-18-agent-readonly-fast-path-plan.md"
```

Expected: 无空白错误；差异只包含本方案文件结构列出的实现、测试、文档和版本文件；grep 无凭据、真实主机或私有文件内容。

- [ ] **Step 8: 提交版本与发布说明**

```bash
git add package.json package-lock.json docs/releases/v0.4.6.md
git commit -m "chore: prepare ShellPilot v0.4.6"
```

- [ ] **Step 9: 合并并推送发布提交**

先确认工作树干净且全部验证记录成功，然后将 `codex/ai-readonly-fast-path-0.4.6` 合并到最新 `master`；如远端 master 有新提交，先非破坏性 rebase/merge 并重新运行针对性测试。推送 `master` 后创建并推送 `v0.4.6` 标签。

- [ ] **Step 10: 发布并验证双更新源**

Run:

```bash
npm run release:github:dry
npm run release:github
npm run release:github:verify
npm run release:modelscope
npm run release:modelscope:hub
npm run release:update-sources:verify
```

Expected: GitHub Release `v0.4.6` 与 ModelScope 均包含同一组校验通过的 Windows 产物；在线更新源验证返回 0.4.6，下载 URL、SHA256 和大小一致。

- [ ] **Step 11: 发布后客户端检查**

在干净用户数据目录安装 0.4.6，验证“检查更新”显示最新；连接本地 SSH fixture 后确认每会话接管默认关闭、只读零确认、人工零确认、风险单确认、任务运行图标和终态恢复均符合设计。记录发布 URL、安装包 SHA256、真实 VPS p95 和全部测试命令结果，不记录 VPS 地址或凭据。
