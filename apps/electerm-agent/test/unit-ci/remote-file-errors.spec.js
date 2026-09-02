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

test('cleanup attachment removes primary cycles and deduplicates bounded errors', async () => {
  const {
    appendRemoteFileCleanupErrors,
    remoteFileCleanupErrorsTruncatedCode
  } = await import(moduleUrl)
  const primary = new Error('primary operation failed')
  const indirectSelfReference = Object.assign(
    new Error('wrapper around primary'),
    { cause: primary }
  )
  const primaryCauseSelfReference = Object.assign(
    new Error('primary recovery wrapper'),
    { primaryCause: primary }
  )
  const rollbackCauseSelfReference = Object.assign(
    new Error('rollback recovery wrapper'),
    { rollbackCause: primary }
  )
  const cyclicRecoveryWrapper = new Error('cyclic recovery wrapper')
  const cyclicRecoveryNested = new Error('cyclic recovery nested')
  cyclicRecoveryWrapper.primaryCause = cyclicRecoveryNested
  cyclicRecoveryNested.rollbackCause = cyclicRecoveryWrapper
  cyclicRecoveryNested.primaryCause = primary
  const secondary = new Error('secondary cleanup failed')
  primary.cleanupErrors = [
    primary,
    indirectSelfReference,
    primaryCauseSelfReference,
    rollbackCauseSelfReference,
    cyclicRecoveryWrapper,
    secondary,
    secondary
  ]

  const result = appendRemoteFileCleanupErrors(primary, [
    primary,
    indirectSelfReference,
    primaryCauseSelfReference,
    rollbackCauseSelfReference,
    cyclicRecoveryWrapper,
    secondary,
    secondary
  ])

  assert.equal(result.attached, true)
  assert.equal(primary.cleanupErrors.includes(primary), false)
  assert.equal(primary.cleanupErrors.includes(indirectSelfReference), false)
  assert.equal(primary.cleanupErrors.includes(primaryCauseSelfReference), false)
  assert.equal(primary.cleanupErrors.includes(rollbackCauseSelfReference), false)
  assert.equal(primary.cleanupErrors.includes(cyclicRecoveryWrapper), false)
  assert.equal(
    primary.cleanupErrors.filter(error => error === secondary).length,
    1
  )
  assert.equal(
    primary.cleanupErrors.some(error => (
      error?.code === remoteFileCleanupErrorsTruncatedCode
    )),
    false
  )
})

test('recovery classifier follows formal primary and rollback causes', async t => {
  const { classifyRemoteFileRecoveryError } = await import(moduleUrl)
  const cases = [
    ['primary identity cause', Object.assign(new Error('recovery failed'), {
      code: 'ECONNRESET',
      primaryCause: Object.assign(new Error('identity changed'), {
        code: 'REMOTE_FILE_IDENTITY_CHANGED'
      })
    }), classification => {
      assert.equal(classification.identityFailure, true)
      assert.equal(classification.failClosed, true)
    }],
    ['rollback uncertainty', Object.assign(new Error('rollback failed'), {
      code: 'ECONNRESET',
      rollbackCause: Object.assign(new Error('rollback state unknown'), {
        uncertain: true
      })
    }), classification => {
      assert.equal(classification.settlementUncertain, true)
      assert.equal(classification.failClosed, true)
    }],
    ['native recovery uncertainty code', Object.assign(
      new Error('recovery state requires manual inspection'),
      { code: 'REMOTE_FILE_RECOVERY_UNCERTAIN' }
    ), classification => {
      assert.equal(classification.settlementUncertain, true)
      assert.equal(classification.failClosed, true)
    }]
  ]

  for (const [name, failure, assertClassification] of cases) {
    await t.test(name, () => {
      assertClassification(classifyRemoteFileRecoveryError(failure))
    })
  }
})

test('formal cause overflow skips the wrapper and marks cleanup truncation', async t => {
  const {
    appendRemoteFileCleanupErrors,
    remoteFileCleanupErrorsTruncatedCode
  } = await import(moduleUrl)

  for (const formalKey of ['primaryCause', 'rollbackCause']) {
    await t.test(formalKey, () => {
      const primary = new Error('primary operation failed')
      let wrapper = primary
      for (let index = 0; index < 96; index += 1) {
        wrapper = Object.assign(new Error(`formal wrapper ${index}`), {
          [formalKey]: wrapper
        })
      }
      const outerWrapper = wrapper

      const result = appendRemoteFileCleanupErrors(primary, [outerWrapper])

      assert.equal(result.attached, true)
      assert.equal(result.inspectionIncomplete, true)
      assert.equal(primary.cleanupErrors.includes(outerWrapper), false)
      assert.equal(primary.cleanupErrors.includes(primary), false)
      assert.equal(primary.cleanupErrors.length, 1)
      assert.equal(
        primary.cleanupErrors[0]?.code,
        remoteFileCleanupErrorsTruncatedCode
      )
    })
  }
})
