function commandFailure (result, fallback) {
  if (result?.error) return result.error
  if (result?.cancelled) return '用户取消了安全确认，命令尚未发送。'
  if (result?.retryable) return '安全命令提交失败，可在终端中取消或重试。'
  return fallback
}

export async function waitForSafetyCompletion (
  result,
  { timeoutMs = 30000 } = {}
) {
  if (result?.inputOnly === true) {
    return { inputOnly: true, exitCode: null }
  }
  if (result?.sent !== true) {
    throw new Error(commandFailure(result, '安全命令尚未发送。'))
  }
  if (typeof result.waitForCompletion !== 'function') {
    throw new Error('终端未提供可靠的命令完成追踪，已停止后续命令。')
  }
  return result.waitForCompletion({ timeoutMs })
}

export async function runSafetyCommandSequence (steps, options = {}) {
  if (!Array.isArray(steps)) throw new Error('命令步骤必须是数组。')
  if (typeof options.runStep !== 'function') {
    throw new Error('多步骤命令缺少安全执行入口。')
  }
  const results = []
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const submission = await options.runStep(step, index)
    const completion = await waitForSafetyCompletion(submission, {
      timeoutMs: options.timeoutMs
    })
    const result = { step, submission, completion }
    results.push(result)
    await options.onStepComplete?.(result, index)
  }
  return results
}

export async function runSafetyCommandBatch (command, tabIds, options = {}) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    throw new Error('批量命令没有选中的终端。')
  }
  if (typeof options.getTerminal !== 'function') {
    throw new Error('批量命令缺少终端解析器。')
  }
  const ids = [...new Set(tabIds.map(String))]
  const settled = await Promise.allSettled(ids.map(async tabId => {
    const terminal = options.getTerminal(tabId)
    if (typeof terminal?.runSafetyCommand !== 'function') {
      throw new Error(`终端 ${tabId} 没有可用的安全命令入口。`)
    }
    const submission = await terminal.runSafetyCommand(command, {
      source: options.source || 'quick-command',
      title: options.title || '批量终端命令',
      metadata: {
        ...(options.metadata || {}),
        batchCommand: true
      }
    })
    const completion = await waitForSafetyCompletion(submission, {
      timeoutMs: options.timeoutMs
    })
    return { tabId, submission, completion }
  }))
  const failures = settled.flatMap((result, index) => (
    result.status === 'rejected'
      ? [{ tabId: ids[index], error: result.reason?.message || '未知错误' }]
      : []
  ))
  if (failures.length) {
    const error = new Error(`批量命令失败：${failures
      .map(failure => `${failure.tabId}：${failure.error}`)
      .join('；')}`)
    error.failures = failures
    throw error
  }
  return settled.map(result => result.value)
}
