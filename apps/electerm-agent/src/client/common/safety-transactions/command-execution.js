function encodeBase64Utf8 (value) {
  const bytes = new TextEncoder().encode(String(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function safeTaskId (operationId) {
  const safeId = String(operationId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) throw new Error('后台命令任务标识无效。')
  return `bg-${safeId.slice(-96)}`
}

function buildBackgroundExecution (command, operationId) {
  const taskId = safeTaskId(operationId)
  const logFile = `/tmp/shellpilot-${taskId}.log`
  const pidFile = `/tmp/shellpilot-${taskId}.pid`
  const exitFile = `/tmp/shellpilot-${taskId}.exit`
  const payload = encodeBase64Utf8(command)
  const inner = [
    `payload=$(printf %s ${payload} | base64 --decode)`,
    `bash -c "$payload" > ${logFile} 2>&1`,
    'code=$?',
    `printf %s "$code" > ${exitFile}`,
    `rm -f ${pidFile}`
  ].join('; ')
  const submittedCommand = [
    `nohup bash -c '${inner}' >/dev/null 2>&1 &`,
    `echo $! > ${pidFile}`,
    'disown'
  ].join(' ')
  return {
    mode: 'background',
    submittedCommand,
    metadata: {
      mode: 'background',
      submittedCommand,
      taskId,
      logFile,
      pidFile,
      exitFile
    }
  }
}

export function buildCommandExecution ({ command, operationId, mode = 'foreground' }) {
  if (mode === 'foreground') {
    return {
      mode,
      submittedCommand: command,
      metadata: {
        mode,
        submittedCommand: command
      }
    }
  }
  if (mode === 'background') {
    return buildBackgroundExecution(command, operationId)
  }
  throw new Error('命令执行模式不受支持。')
}
