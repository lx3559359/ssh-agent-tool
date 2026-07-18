import {
  classifyAgentCommand,
  getAgentToolCommandText,
  isAgentCommandTool
} from './agent-task-mode.js'
import { requestAgentConfirmation } from './agent-confirmation.js'

export { isAgentCommandTool }

export async function confirmAgentToolExecution ({
  toolName,
  args = {},
  confirm,
  signal
} = {}) {
  if (!isAgentCommandTool(toolName)) {
    return {
      accepted: true,
      cancelled: false
    }
  }

  const command = getAgentToolCommandText(toolName, args)
  if (!command) {
    return {
      accepted: false,
      cancelled: true,
      risk: 'empty',
      message: 'Agent 命令为空，已取消执行。'
    }
  }

  const risk = classifyAgentCommand(command)
  const ask = typeof confirm === 'function'
    ? confirm
    : message => requestAgentConfirmation(message, { signal })
  const accepted = await ask(`Agent 请求执行以下命令，请确认：\n\n${command}\n\n风险判断：${risk.reason}`)

  if (accepted && risk.needsSecondConfirmation) {
    const secondAccepted = await ask(`危险命令二次确认：\n\n${command}\n\n${risk.reason}\n\n确认继续执行吗？`)
    return {
      accepted: secondAccepted,
      cancelled: !secondAccepted,
      risk: risk.risk,
      message: secondAccepted ? '' : '用户已取消危险 Agent 命令执行。'
    }
  }

  return {
    accepted,
    cancelled: !accepted,
    risk: risk.risk,
    message: accepted ? '' : '用户已取消 Agent 命令执行。'
  }
}
