const {
  buildManagedInputCapabilities,
  buildManagedInputStatus
} = require('./terminal-control-message')

function createManagedTerminalChannel ({ writer, send } = {}) {
  if (!writer || typeof writer.submit !== 'function' ||
    typeof writer.interrupt !== 'function' ||
    typeof writer.dispose !== 'function') {
    throw new TypeError('Managed terminal channel requires a writer')
  }
  if (typeof send !== 'function') {
    throw new TypeError('Managed terminal channel requires a sender')
  }
  const sendStatus = (requestId, status) => {
    send(buildManagedInputStatus(requestId, status))
  }
  return Object.freeze({
    handle (control) {
      if (!control || typeof control !== 'object') return false
      if (control.action === 'invalid-control') return true
      if (control.action === 'managed-input-capabilities-request') {
        send(buildManagedInputCapabilities())
        return true
      }
      if (control.action === 'managed-input') {
        const submission = writer.submit(control)
        if (!submission) {
          sendStatus(control.requestId, 'rejected')
          return true
        }
        sendStatus(submission.requestId, 'accepted')
        submission.completion.then(result => {
          sendStatus(result.requestId, result.status)
        }).catch(() => {
          sendStatus(submission.requestId, 'interrupted')
        })
        return true
      }
      if (control.action === 'managed-input-interrupt') {
        writer.interrupt()
        return true
      }
      return false
    },
    dispose: () => writer.dispose()
  })
}

exports.createManagedTerminalChannel = createManagedTerminalChannel
