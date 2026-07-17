function assertActive (signal) {
  if (!signal?.aborted) return
  const error = new Error('Agent request cancelled')
  error.name = 'AbortError'
  throw error
}

export async function runAgentTerminalCommand ({
  store,
  args = {},
  signal,
  onDispatched
}) {
  assertActive(signal)
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
    ...(signal ? { signal } : {}),
    source: 'agent',
    title: 'Agent 终端命令'
  })
  if (safetyResult?.sent !== true) {
    assertActive(signal)
    return {
      success: false,
      cancelled: safetyResult?.cancelled === true,
      operationId: safetyResult?.operationId,
      message: safetyResult?.cancelled
        ? '用户取消了安全确认，命令尚未发送。'
        : '命令未发送。'
    }
  }
  if (typeof onDispatched === 'function') {
    await onDispatched(safetyResult)
  }
  assertActive(signal)
  return store.mcpWaitForTerminalIdle({
    tabId,
    timeout: 30000,
    lines: 100,
    ...(signal ? { signal } : {})
  })
}
