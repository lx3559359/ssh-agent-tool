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

function shellQuote (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = `${quote}"${quote}"${quote}`
  return `${quote}${String(value).replaceAll(quote, escapedQuote)}${quote}`
}

function buildBackgroundExecution (command, operationId) {
  const taskId = safeTaskId(operationId)
  const logFile = `/tmp/shellpilot-${taskId}.log`
  const pidFile = `/tmp/shellpilot-${taskId}.pid`
  const exitFile = `/tmp/shellpilot-${taskId}.exit`
  const payload = encodeBase64Utf8(command)
  const workerScript = [
    `payload=$(printf %s ${payload} | base64 --decode)`,
    `bash -c "$payload" > ${logFile} 2>&1`,
    'code=$?',
    `printf '%s\\n' "$code" > ${exitFile}`
  ].join('; ')
  const launcherScript = `nohup bash -c ${shellQuote(workerScript)} ` +
    `>/dev/null 2>&1 & bg_pid=$!; printf '%s\\n' "$bg_pid" > ${pidFile}; ` +
    'disown "$bg_pid"'
  const submittedCommand = `bash -c ${shellQuote(launcherScript)}`
  return {
    mode: 'background',
    submittedCommand,
    metadata: {
      mode: 'background',
      submittedCommand,
      taskId,
      logFile,
      pidFile,
      exitFile,
      launcherScript
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
