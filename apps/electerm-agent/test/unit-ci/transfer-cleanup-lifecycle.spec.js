const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const cleanupUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-cleanup.js'
)).href
const cancellationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/file-transfer/transfer-cancellation-lifecycle.js'
)).href

test('subtransport cleanup starts every destroy and throws first rejection with acyclic cleanup errors', async () => {
  const { destroyTransferHandles } = await import(cleanupUrl)
  const calls = []
  const first = new Error('first subtransport cleanup failed')
  const second = new Error('second subtransport cleanup failed')
  const transports = [
    {
      destroy () {
        calls.push('first')
        throw first
      }
    },
    {
      async destroy () {
        calls.push('second')
        throw second
      }
    },
    {
      async destroy () {
        calls.push('third')
        return true
      }
    }
  ]

  await assert.rejects(destroyTransferHandles(transports), error => {
    assert.equal(error, first)
    assert.deepEqual(error.cleanupErrors, [second])
    assert.equal(second.cleanupErrors?.includes(first) === true, false)
    return true
  })
  assert.deepEqual(calls, ['first', 'second', 'third'])
})

test('stale subtransport cleanup preserves stale cause and observes destroy rejection', async () => {
  const { settleStaleTransferHandle } = await import(cleanupUrl)
  const stale = new Error('stale transfer attempt')
  stale.code = 'STALE_TRANSFER_ATTEMPT'
  const cleanup = new Error('stale transport destroy failed')

  assert.equal(await settleStaleTransferHandle({
    async destroy () { throw cleanup }
  }, stale), stale)
  assert.deepEqual(stale.cleanupErrors, [cleanup])
})

test('cleanup accumulation preserves the first error without cyclic aliases', async () => {
  const { preserveTransferCleanupError } = await import(cleanupUrl)
  const first = new Error('primary cancellation failed')
  const cleanup = new Error('release cleanup failed')

  assert.equal(preserveTransferCleanupError(undefined, first), first)
  assert.equal(preserveTransferCleanupError(first, cleanup), first)
  assert.deepEqual(first.cleanupErrors, [cleanup])
  assert.equal(cleanup.cleanupErrors?.includes(first) === true, false)
})

test('failed cancellation never records cancelled or removes the queue', async () => {
  const { settleTransferCancellation } = await import(cancellationUrl)
  const first = new Error('native cancel failed')
  const releaseFailure = new Error('release cleanup failed')
  const calls = []

  await assert.rejects(settleTransferCancellation({
    stopTransport: async () => {
      calls.push('stop')
      throw first
    },
    cancelSafety: async () => { calls.push('safety') },
    finishTransfer: async () => { calls.push('finish') },
    markCancelled: async () => { calls.push('cancelled') },
    markFailed: async error => {
      calls.push(`failed:${error.message}`)
    },
    release: async () => {
      calls.push('release')
      throw releaseFailure
    }
  }), error => {
    assert.equal(error, first)
    assert.deepEqual(error.cleanupErrors, [releaseFailure])
    return true
  })
  assert.deepEqual(calls, [
    'stop',
    'safety',
    'failed:native cancel failed',
    'release'
  ])
})

test('successful cancellation removes queue before publishing cancelled', async () => {
  const { settleTransferCancellation } = await import(cancellationUrl)
  const calls = []

  assert.equal(await settleTransferCancellation({
    stopTransport: async () => { calls.push('stop') },
    cancelSafety: async () => { calls.push('safety') },
    finishTransfer: async () => { calls.push('finish') },
    markCancelled: async () => { calls.push('cancelled') },
    markFailed: async () => { calls.push('failed') },
    release: async () => { calls.push('release') }
  }), true)
  assert.deepEqual(calls, [
    'stop', 'safety', 'finish', 'cancelled', 'release'
  ])
})

test('Transfer awaits stale handle destruction and checks allSettled rejections', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const destroy = source.slice(
    source.indexOf('destroySubTransports ='),
    source.indexOf('removeTransferFromQueue =')
  )
  const subtransfer = source.slice(
    source.indexOf('transferFileAsSubTransfer ='),
    source.indexOf('getDefaultTransfer =')
  )
  const primaryTransfer = source.slice(
    source.indexOf('transferFile = async'),
    source.indexOf('isTransferAction =')
  )

  assert.match(destroy, /await destroyTransferHandles\(transports\)/)
  assert.match(subtransfer, /await settleStaleTransferHandle/)
  assert.match(primaryTransfer, /await settleStaleTransferHandle/)
  assert.doesNotMatch(subtransfer, /transportInstance\?\.destroy\(\)/)
  assert.doesNotMatch(subtransfer, /transport\?\.destroy\(\)/)
  assert.doesNotMatch(primaryTransfer, /transport\?\.destroy\(\)/)
})

test('Transfer settles subtransport cleanup before recording successful terminal state', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/file-transfer/transfer.jsx'
  ), 'utf8')
  const onEnd = source.slice(
    source.indexOf('onEnd = async'),
    source.indexOf('onData =')
  )
  const cleanup = onEnd.indexOf("await this.stopTransport('completed')")
  const safetyComplete = onEnd.indexOf('await this.transferSafety.complete')
  const history = onEnd.indexOf('window.store.addTransferHistory')

  assert.ok(cleanup >= 0)
  assert.ok(cleanup < safetyComplete)
  assert.ok(cleanup < history)
  assert.match(onEnd, /status:\s*'exception'[\s\S]*error:\s*error\.message/)
})
