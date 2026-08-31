const defaultChunkBytes = 512
const defaultPacingMs = 2
const maxManagedCommandBytes = 4 * 1024 * 1024
const managedRequestIdPattern = /^[a-f0-9]{32}$/

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function splitUtf8Chunks (value, maximumBytes) {
  const chunks = []
  let chunk = ''
  let chunkBytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (chunk && chunkBytes + characterBytes > maximumBytes) {
      chunks.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += character
    chunkBytes += characterBytes
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

function createCancellationSignal () {
  let cancel
  const promise = new Promise(resolve => {
    cancel = resolve
  })
  return { promise, cancel }
}

function createManagedTerminalInputWriter (term, options = {}) {
  if (!term || typeof term.write !== 'function') {
    throw new TypeError('Managed terminal input requires a writable terminal')
  }
  const chunkBytes = Math.max(1, Math.floor(
    Number(options.chunkBytes) || defaultChunkBytes
  ))
  const pacingMs = Math.max(0, Math.floor(
    Number(options.pacingMs) || defaultPacingMs
  ))
  const pause = typeof options.pause === 'function'
    ? options.pause
    : () => delay(pacingMs)
  let active = null
  let disposed = false

  async function waitUnlessCancelled (promise, operation) {
    await Promise.race([Promise.resolve(promise), operation.cancellation.promise])
  }

  function submit ({ requestId, command } = {}) {
    if (disposed || active || !managedRequestIdPattern.test(requestId) ||
      typeof command !== 'string' || !command.length ||
      Buffer.byteLength(command) > maxManagedCommandBytes) {
      return null
    }
    const operation = {
      requestId,
      cancelled: false,
      cancellation: createCancellationSignal()
    }
    active = operation
    const completion = (async () => {
      try {
        const chunks = splitUtf8Chunks(command, chunkBytes)
        for (const chunk of chunks) {
          if (operation.cancelled || disposed) break
          const accepted = term.write(chunk)
          if (accepted === false &&
            typeof term.waitForWriteDrain === 'function') {
            await waitUnlessCancelled(term.waitForWriteDrain(), operation)
          }
          if (!operation.cancelled && !disposed) {
            await waitUnlessCancelled(pause(pacingMs), operation)
          }
        }
        if (!operation.cancelled && !disposed) {
          term.write('\r')
          return { requestId, status: 'written' }
        }
        return { requestId, status: 'interrupted' }
      } finally {
        if (active === operation) active = null
      }
    })()
    return Object.freeze({ requestId, completion })
  }

  function interrupt () {
    if (disposed) return false
    if (active && !active.cancelled) {
      active.cancelled = true
      active.cancellation.cancel()
    }
    term.write('\x03')
    return true
  }

  function dispose () {
    disposed = true
    if (active && !active.cancelled) {
      active.cancelled = true
      active.cancellation.cancel()
    }
  }

  return Object.freeze({ submit, interrupt, dispose })
}

exports.createManagedTerminalInputWriter = createManagedTerminalInputWriter
exports.managedRequestIdPattern = managedRequestIdPattern
exports.maxManagedCommandBytes = maxManagedCommandBytes
