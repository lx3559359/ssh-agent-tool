const COMMAND_TOOL_NAMES = new Set([
  'send_terminal_command',
  'run_background_command'
])

export function isAgentCommandTool (toolName) {
  return COMMAND_TOOL_NAMES.has(toolName)
}

export async function confirmAgentToolExecution ({
  toolName,
  args = {},
  confirm
} = {}) {
  if (!isAgentCommandTool(toolName)) {
    return {
      accepted: true,
      cancelled: false
    }
  }

  const command = String(args.command || '').trim()
  if (!command) {
    return {
      accepted: false,
      cancelled: true,
      message: 'Agent 命令为空，已取消执行。'
    }
  }

  const ask = typeof confirm === 'function'
    ? confirm
    : message => window.confirm(message)
  const accepted = await ask(`Agent 请求执行以下命令，请确认：\n\n${command}`)
  return {
    accepted,
    cancelled: !accepted,
    message: accepted ? '' : '用户已取消 Agent 命令执行。'
  }
}
