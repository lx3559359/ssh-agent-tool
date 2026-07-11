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
    failureMessage: 'Failed to start terminal recording',
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
    failureMessage: 'Failed to stop terminal recording',
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
      throw new Error('Failed to write terminal log file')
    }
    const startResult = await startTerminalLogFile(
      pid,
      filePath,
      addTimeStampToTermLog
    )
    if (startResult === false) {
      throw new Error('Failed to start terminal log file')
    }
    onSuccess()
    return true
  } catch (error) {
    onError(error)
    return false
  }
}
