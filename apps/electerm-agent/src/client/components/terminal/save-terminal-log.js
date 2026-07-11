export function normalizeTerminalLogContent (content) {
  if (!content) {
    return ''
  }
  return content.replace(/(?:\r\n|\r|\n)+$/, '') + '\n'
}

async function runTerminalLogAction ({
  action,
  failureMessage,
  onError,
  onSuccess
}) {
  try {
    const result = await action()
    if (result === false) {
      throw new Error(failureMessage)
    }
    onSuccess()
    return true
  } catch (error) {
    onError(error)
    return false
  }
}

export function startTerminalRecording ({
  pid,
  filePath,
  addTimeStampToTermLog,
  startTerminalLogFile,
  onError,
  onSuccess
}) {
  return runTerminalLogAction({
    action: () => startTerminalLogFile(
      pid,
      filePath,
      addTimeStampToTermLog
    ),
    failureMessage: '启动终端录制失败',
    onError,
    onSuccess
  })
}

export function stopTerminalRecording ({
  pid,
  toggleTerminalLog,
  onError,
  onSuccess
}) {
  return runTerminalLogAction({
    action: () => toggleTerminalLog(pid),
    failureMessage: '停止终端录制失败',
    onError,
    onSuccess
  })
}

export async function saveTerminalLog ({
  filePath,
  content,
  pid,
  addTimeStampToTermLog,
  writeFile,
  startTerminalLogFile,
  onError,
  onSuccess
}) {
  try {
    const writeResult = await writeFile(
      filePath,
      normalizeTerminalLogContent(content)
    )
    if (writeResult === false) {
      throw new Error('写入终端日志文件失败')
    }
    const startResult = await startTerminalLogFile(
      pid,
      filePath,
      addTimeStampToTermLog
    )
    if (startResult === false) {
      throw new Error('启动终端日志文件失败')
    }
    onSuccess()
    return true
  } catch (error) {
    onError(error)
    return false
  }
}
