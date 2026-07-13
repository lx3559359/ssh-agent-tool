const COMMAND_TOOL_NAMES = new Set([
  'send_terminal_command',
  'run_background_command',
  'run_local_cli'
])

const DANGEROUS_PATTERNS = [
  /\brm\s+.*(-r|-f|--recursive|--force)/i,
  /\bsystemctl\s+(restart|stop|reload|disable|mask|kill)\b/i,
  /\bservice\s+\S+\s+(restart|stop|reload)\b/i,
  /\bkubectl\s+(delete|apply|replace|patch|scale|rollout|cordon|drain)\b/i,
  /\bdocker\s+(rm|rmi|stop|restart|kill|prune)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-|push\s+--force)\b/i,
  /\b(chmod|chown)\s+/i,
  /\b(mkfs|fdisk|parted|reboot|shutdown|poweroff)\b/i,
  />\s*\/|>>\s*\/|\bsed\s+-i\b|\btruncate\s+/i
]

const READONLY_PATTERNS = [
  /^(uptime|whoami|id|hostname|pwd|date)\b/i,
  /^(df|du|free|top|htop|ps|ss|netstat|lsof|ip|ifconfig|route)\b/i,
  /^(cat|tail|head|grep|egrep|fgrep|awk|sed|find|ls|stat)\b/i,
  /^systemctl\s+(status|is-active|is-enabled|list-units|--failed)\b/i,
  /^journalctl\b/i,
  /^docker\s+(ps|logs|inspect|stats|images|volume\s+ls|network\s+ls)\b/i,
  /^kubectl\s+(get|describe|logs|top|version|config\s+view)\b/i,
  /^git\s+(status|log|show|diff|branch|remote)\b/i,
  /^(ping|traceroute|tracert|ssh-keygen\s+-l|ssh-keygen\s+-y)\b/i
]

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
  if (DANGEROUS_PATTERNS.some(pattern => pattern.test(text))) {
    return {
      risk: 'dangerous',
      needsSecondConfirmation: true,
      reason: '命令可能修改系统、删除数据、重启服务或影响业务'
    }
  }
  if (READONLY_PATTERNS.some(pattern => pattern.test(text))) {
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
  return lines.join('\n')
}

export async function confirmAgentPlan ({
  args = {},
  confirm
} = {}) {
  const ask = typeof confirm === 'function'
    ? confirm
    : message => window.confirm(message)
  const accepted = await ask(buildAgentPlanConfirmationMessage(args))
  return {
    accepted,
    cancelled: !accepted,
    planConfirmed: accepted,
    message: accepted ? '用户已确认 Agent 分析计划。' : '用户已取消 Agent 分析计划。'
  }
}

export function markAgentPlanConfirmed (runtime, confirmation) {
  if (runtime && confirmation?.accepted) {
    runtime.planConfirmed = true
  }
}

export function ensureAgentPlanConfirmed ({
  toolName,
  runtime
} = {}) {
  if (!isAgentCommandTool(toolName)) {
    return null
  }
  if (runtime?.planConfirmed) {
    return null
  }
  return {
    accepted: false,
    cancelled: true,
    requiresPlan: true,
    message: 'Agent 必须先提交分析计划，并由用户确认后才能执行命令。'
  }
}
