export async function requestAgentConfirmation (message, options = {}) {
  const signal = options.signal
  if (signal?.aborted) return false
  const Modal = options.Modal || (await import('antd')).Modal
  if (signal?.aborted) return false

  return await new Promise(resolve => {
    let settled = false
    const settle = accepted => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      modal?.destroy?.()
      resolve(accepted)
    }
    const onAbort = () => settle(false)

    signal?.addEventListener('abort', onAbort, { once: true })
    const modal = Modal.confirm({
      title: options.title || 'Agent 操作确认',
      content: String(message || ''),
      okText: options.okText || '确认',
      cancelText: options.cancelText || '取消',
      maskClosable: false,
      keyboard: true,
      onOk: () => settle(true),
      onCancel: () => settle(false)
    })
  })
}
