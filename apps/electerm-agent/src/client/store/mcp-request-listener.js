export function installMcpRequestListener ({
  ipcOnEvent,
  ipcOffEvent,
  previousListener,
  handleToolCall
}) {
  if (previousListener && typeof ipcOffEvent === 'function') {
    ipcOffEvent('mcp-request', previousListener)
  }

  const listener = (_event, request) => {
    const data = request?.data
    if (
      request?.action !== 'tool-call' ||
      typeof data?.toolName !== 'string' ||
      !data.toolName
    ) {
      return false
    }
    handleToolCall(request.requestId, data.toolName, data.args)
    return true
  }

  ipcOnEvent('mcp-request', listener)
  return listener
}
