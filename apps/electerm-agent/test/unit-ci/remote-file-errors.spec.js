const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/sftp/remote-file-errors.js'
)).href

function throwingCoercion () {
  return Object.freeze({
    toString () { throw new Error('coercion denied') },
    valueOf () { throw new Error('coercion denied') },
    [Symbol.toPrimitive] () { throw new Error('coercion denied') }
  })
}

test('recovery classifier is total and fail-closed for adversarial graphs', async t => {
  const { classifyRemoteFileRecoveryError } = await import(moduleUrl)
  const hugeErrors = new Array(200000).fill(new Error('nested'))
  const throwingGetter = Object.assign(new Error('getter'), {
    code: 'ECONNRESET'
  })
  Object.defineProperty(throwingGetter, 'cause', {
    get () { throw new Error('cause denied') }
  })
  const throwingIterator = []
  Object.defineProperty(throwingIterator, Symbol.iterator, {
    get () { throw new Error('iterator denied') }
  })
  const iteratorFailure = Object.assign(new Error('iterator'), {
    code: 'ECONNRESET',
    errors: throwingIterator
  })
  const revoked = Proxy.revocable([], {})
  revoked.revoke()
  const revokedProxy = Object.assign(new Error('proxy'), {
    code: 'ECONNRESET',
    cleanupErrors: revoked.proxy
  })
  const cases = [
    ['200k structured array', Object.assign(new Error('huge'), {
      code: 'ECONNRESET',
      errors: hugeErrors
    })],
    ['throwing code coercion', Object.assign(new Error('coercion'), {
      code: throwingCoercion()
    })],
    ['throwing property getter', throwingGetter],
    ['throwing array iterator', iteratorFailure],
    ['revoked proxy collection', revokedProxy]
  ]

  for (const [name, failure] of cases) {
    await t.test(name, () => {
      let classification
      assert.doesNotThrow(() => {
        classification = classifyRemoteFileRecoveryError(failure)
      })
      assert.equal(classification.inspectionIncomplete, true)
      assert.equal(classification.failClosed, true)
    })
  }
})

test('recovery classifier bounds nullish collection iteration', async t => {
  const { classifyRemoteFileRecoveryError } = await import(moduleUrl)

  await t.test('infinite undefined iterator', () => {
    let nextCalls = 0
    const errors = []
    Object.defineProperty(errors, Symbol.iterator, {
      value: () => ({
        next: () => {
          nextCalls += 1
          if (nextCalls > 512) throw new Error('iteration was not bounded')
          return { done: false, value: undefined }
        }
      })
    })
    const failure = Object.assign(new Error('infinite nullish collection'), {
      code: 'ECONNRESET',
      errors
    })

    const classification = classifyRemoteFileRecoveryError(failure)

    assert.ok(nextCalls <= 128)
    assert.equal(classification.inspectionIncomplete, true)
    assert.equal(classification.failClosed, true)
  })

  await t.test('200k sparse array', () => {
    let nextCalls = 0
    const errors = new Array(200000)
    const baseIterator = Array.prototype[Symbol.iterator].call(errors)
    Object.defineProperty(errors, Symbol.iterator, {
      value: () => ({
        next: () => {
          nextCalls += 1
          return baseIterator.next()
        }
      })
    })
    const failure = Object.assign(new Error('sparse collection'), {
      code: 'ECONNRESET',
      errors
    })

    const classification = classifyRemoteFileRecoveryError(failure)

    assert.ok(nextCalls <= 128)
    assert.equal(classification.inspectionIncomplete, true)
    assert.equal(classification.failClosed, true)
  })
})
