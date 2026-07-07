function stringifyError (error) {
  if (!error) {
    return ''
  }
  if (error instanceof Error) {
    return error.stack || error.message
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function isGpuRelatedError (error) {
  const text = stringifyError(error)
  return /gpu|graphics|vulkan|dxgi/i.test(text)
}

function maybePrintGpuSuggestion (error, consoleRef, gpuSuggestion) {
  if (gpuSuggestion && isGpuRelatedError(error)) {
    consoleRef.error(gpuSuggestion)
  }
}

function installProcessErrorLogging ({
  app,
  processRef = process,
  log,
  consoleRef = console,
  gpuSuggestion = ''
}) {
  processRef.on('uncaughtException', (error) => {
    log.error('main-process uncaughtException', stringifyError(error))
    maybePrintGpuSuggestion(error, consoleRef, gpuSuggestion)
  })

  processRef.on('unhandledRejection', (reason) => {
    log.error('main-process unhandledRejection', stringifyError(reason))
    maybePrintGpuSuggestion(reason, consoleRef, gpuSuggestion)
  })

  app.on('gpu-process-crashed', (event, killed) => {
    log.error('electron gpu-process-crashed', { killed })
    if (gpuSuggestion) {
      consoleRef.error(gpuSuggestion)
    }
  })

  app.on('render-process-gone', (event, webContents, details) => {
    log.error('electron render-process-gone', details)
    if (['crashed', 'abnormal-exit', 'killed', 'oom'].includes(details?.reason) && gpuSuggestion) {
      consoleRef.error(gpuSuggestion)
    }
  })

  app.on('child-process-gone', (event, details) => {
    log.error('electron child-process-gone', details)
  })
}

module.exports = {
  installProcessErrorLogging,
  isGpuRelatedError,
  stringifyError
}
