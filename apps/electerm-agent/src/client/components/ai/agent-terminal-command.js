export async function runAgentTerminalCommand ({ store, args = {} }) {
  const tabId = args.tabId || store?.activeTabId
  if (!tabId) {
    return {
      success: false,
      cancelled: true,
      message: '当前没有活动终端，命令尚未发送。'
    }
  }
  const safetyResult = await store.runSafetyCommand(args.command, {
    tabId,
    source: 'agent',
    title: 'Agent 终端命令'
  })
  if (safetyResult?.sent !== true) {
    return {
      success: false,
      cancelled: safetyResult?.cancelled === true,
      operationId: safetyResult?.operationId,
      message: safetyResult?.cancelled
        ? '用户取消了安全确认，命令尚未发送。'
        : '命令未发送。'
    }
  }
  return store.mcpWaitForTerminalIdle({
    tabId,
    timeout: 30000,
    lines: 100
  })
}
