export function createTransferOperationQueue ({ execute, onError } = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Transfer queue executor must be a function')
  }
  const pending = []
  let processing = false
  let disposedError = null

  const processNext = async () => {
    if (processing || pending.length === 0 || disposedError) return
    processing = true
    const item = pending.shift()
    try {
      item.resolve(await execute(...item.args))
    } catch (error) {
      onError?.(error)
      item.reject(error)
    } finally {
      processing = false
      processNext()
    }
  }

  return {
    add: (...args) => {
      if (disposedError) return Promise.reject(disposedError)
      const completion = new Promise((resolve, reject) => {
        pending.push({ args, resolve, reject })
      })
      processNext()
      return completion
    },
    dispose: (error = new Error('Transfer queue was disposed')) => {
      disposedError = error
      while (pending.length) pending.shift().reject(error)
    }
  }
}
