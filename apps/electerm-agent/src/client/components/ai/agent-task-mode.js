import { requestAgentConfirmation } from './agent-confirmation.js'
import { classifyCommand } from '../../common/safety-transactions/command-classifier.js'
import {
  createPlanGrant,
  verifyPlanGrant
} from './agent-plan-grant.js'

const COMMAND_TOOL_NAMES = new Set([
  'send_terminal_command',
  'run_background_command',
  'run_local_cli'
])

export function isAgentCommandTool (toolName) {
  return COMMAND_TOOL_NAMES.has(toolName)
}

export function getAgentToolCommandText (toolName, args = {}) {
  if (toolName === 'run_local_cli') {
    return [
      String(args.tool || '').trim(),
      ...(Array.isArray(args.args) ? args.args.map(arg => String(arg)) : [])
    ].filter(Boolean).join(' ')
  }
  return String(args.command || '').trim()
}

export function classifyAgentCommand (command) {
  const text = String(command || '').trim()
  if (!text) {
    return {
      risk: 'empty',
      needsSecondConfirmation: false,
      reason: '命令为空'
    }
  }
  const classified = classifyCommand(text)
  if (classified.risk === 'change' || classified.risk === 'blocked') {
    return {
      risk: 'dangerous',
      needsSecondConfirmation: true,
      reason: '命令可能修改系统、删除数据、重启服务或影响业务'
    }
  }
  if (classified.risk === 'readonly') {
    return {
      risk: 'readonly',
      needsSecondConfirmation: false,
      reason: '命令看起来是只读诊断操作'
    }
  }
  return {
    risk: 'unknown',
    needsSecondConfirmation: false,
    reason: '命令风险无法自动判断，仍需要用户确认'
  }
}

export function buildAgentTaskModePrompt () {
  return `Agent 任务模式：
1. 先分析上下文，输出简短的分析计划。
2. 调用 confirm_agent_plan，请用户确认计划和即将执行的只读命令。
3. 计划确认前，不允许执行 send_terminal_command、run_background_command 或 run_local_cli。
4. 计划确认后，优先执行只读命令收集证据，例如状态、日志、端口、磁盘、内存、进程和配置读取。
5. 危险命令必须解释影响，并在普通确认后再进行二次确认。
6. 每轮任务结束时给出总结报告：结论、证据、风险、建议下一步。
7. 服务器异常只读诊断计划使用严格 JSON：summary、steps、expectedSignals、stopConditions。
8. 诊断命令必须通过共享命令分类 classifyCommand，只有 readonly 可执行；不得执行任何修改、未知或禁止命令。
9. 如果用户只想聊天，不要强行进入任务模式。`
}

export function buildAgentPlanConfirmationMessage (args = {}) {
  const goal = String(args.goal || args.summary || 'Agent 运维排查任务').trim()
  const steps = Array.isArray(args.steps) ? args.steps : []
  const commands = Array.isArray(args.readonlyCommands) ? args.readonlyCommands : []
  const verification = Array.isArray(args.verification) ? args.verification : []
  const lines = [
    `Agent 请求确认分析计划：${goal}`,
    '',
    '计划步骤：',
    ...(steps.length ? steps.map((step, index) => `${index + 1}. ${step}`) : ['1. 分析当前上下文并收集只读证据']),
    '',
    '计划执行的只读命令：',
    ...(commands.length ? commands.map(command => `- ${command}`) : ['- 暂无，执行前会再次请求确认']),
    '',
    '确认后 Agent 才能继续执行命令。'
  ]
  lines.splice(lines.length - 1, 0,
    'Risk target verification:',
    ...(verification.length
      ? verification.map(step => `- ${JSON.stringify(step)}`)
      : ['- none; risky work cannot be marked verified']),
    ''
  )
  return lines.join('\n')
}

export async function confirmAgentPlan ({
  args = {},
  confirm,
  signal,
  endpoint = {},
  trustedSkillBindings = [],
  trustedArtifactDigests = []
} = {}) {
  const ask = typeof confirm === 'function'
    ? confirm
    : message => requestAgentConfirmation(message, { signal })
  const accepted = await ask(buildAgentPlanConfirmationMessage(args))
  const planGrant = accepted
    ? await createPlanGrant(buildConversationPlanGrantPayload(args, endpoint, {
      skillBindings: trustedSkillBindings,
      artifactDigests: trustedArtifactDigests
    }), {
      confirmedBy: 'user'
    })
    : null
  return {
    accepted,
    cancelled: !accepted,
    planGrant,
    message: accepted ? '用户已确认 Agent 分析计划。' : '用户已取消 Agent 分析计划。'
  }
}

export function buildConversationPlanGrantPayload (
  args = {},
  endpoint = {},
  trustedBindings = {}
) {
  const commands = Array.isArray(args.readonlyCommands) ? args.readonlyCommands : []
  return {
    schemaVersion: 1,
    endpoint,
    goal: String(args.goal || args.summary || 'Agent 运维任务').trim(),
    // Only commands rendered in the confirmation dialog may be granted. Never
    // accept a hidden orderedCalls field supplied by the model.
    orderedCalls: commands.map(command => ({
      name: 'send_terminal_command',
      args: { command: String(command) }
    })),
    skillBindings: Array.isArray(trustedBindings.skillBindings)
      ? trustedBindings.skillBindings
      : [],
    artifactDigests: Array.isArray(trustedBindings.artifactDigests)
      ? trustedBindings.artifactDigests
      : [],
    impactTargets: [],
    resourceImpact: {
      cpu: 'unknown',
      memory: 'unknown',
      disk: 'unknown',
      network: 'unknown',
      duration: 'unknown'
    },
    recovery: null,
    verification: Array.isArray(args.verification) ? args.verification : []
  }
}

export function markAgentPlanConfirmed (runtime, confirmation) {
  if (runtime && confirmation?.accepted && confirmation.planGrant) {
    runtime.planGrant = confirmation.planGrant
    runtime.planGrantCursor = 0
    runtime.planGrantReservation = null
  }
}

function stableSerialize (value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function executableCall (toolName, args = {}) {
  const { tabId, ...boundArgs } = args || {}
  return { name: toolName, args: boundArgs }
}

export async function ensureAgentPlanAvailable (runtime) {
  const grant = runtime?.planGrant
  if (grant && await verifyPlanGrant(grant.payload, grant)) return null
  return {
    accepted: false,
    cancelled: true,
    requiresPlan: true,
    reasonCode: grant ? 'PLAN_BINDING_CHANGED' : 'PLAN_CONFIRMATION_REQUIRED',
    message: grant
      ? 'The confirmed Agent plan binding changed and must be confirmed again.'
      : 'The Agent plan must be confirmed before risky work can be prepared.'
  }
}

export async function ensureAgentPlanConfirmed ({
  toolName,
  args,
  runtime
} = {}) {
  if (!isAgentCommandTool(toolName)) {
    return null
  }
  const availability = await ensureAgentPlanAvailable(runtime)
  const grant = runtime?.planGrant
  if (!availability) {
    const expected = stableSerialize(executableCall(toolName, args))
    const index = Number.isSafeInteger(runtime.planGrantCursor)
      ? runtime.planGrantCursor
      : 0
    const planned = grant.payload.orderedCalls[index]
    if (planned && stableSerialize(planned) === expected) {
      runtime.planGrantReservation = Object.freeze({ index, expected })
      return null
    }
  }
  return {
    accepted: false,
    cancelled: true,
    requiresPlan: true,
    reasonCode: grant ? 'PLAN_BINDING_CHANGED' : 'PLAN_CONFIRMATION_REQUIRED',
    message: grant
      ? 'Agent 计划绑定已变更，必须重新确认后才能执行命令。'
      : 'Agent 必须先提交分析计划，并由用户确认后才能执行命令。'
  }
}

export function commitAgentPlanCall ({ toolName, args, runtime } = {}) {
  if (!isAgentCommandTool(toolName)) return false
  const reservation = runtime?.planGrantReservation
  const index = Number.isSafeInteger(runtime?.planGrantCursor)
    ? runtime.planGrantCursor
    : 0
  const expected = stableSerialize(executableCall(toolName, args))
  if (!reservation || reservation.index !== index ||
    reservation.expected !== expected) {
    const error = new Error('Agent plan call was not reserved for this dispatch')
    error.code = 'PLAN_BINDING_CHANGED'
    throw error
  }
  runtime.planGrantCursor = index + 1
  runtime.planGrantReservation = null
  return true
}
