const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const profilesUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/ai-profiles.js')
).href

test('AI health fingerprint never contains or derives from API credentials', async () => {
  const {
    getAIStatusFingerprint
  } = await import(profilesUrl)

  const base = {
    id: 'relay',
    baseURLAI: 'https://relay.example.com/v1',
    apiPathAI: '/chat/completions',
    modelAI: 'model-a',
    authHeaderNameAI: 'Authorization: Bearer',
    proxyAI: 'http://127.0.0.1:8080',
    credentialRevisionAI: 'revision-safe'
  }
  const first = getAIStatusFingerprint({ ...base, apiKeyAI: 'sk-short-secret' })
  const second = getAIStatusFingerprint({ ...base, apiKeyAI: 'sk-a-much-longer-secret-value' })

  assert.equal(first, second)
  assert.doesNotMatch(first, /secret|sk-/i)
  assert.match(first, /revision-safe/)
})

test('credential revision changes when request credentials change', async () => {
  const {
    withAICredentialRevision
  } = await import(profilesUrl)
  let created = 0
  const createRevision = () => `revision-${++created}`
  const previous = {
    id: 'relay',
    apiKeyAI: 'sk-old',
    credentialRevisionAI: 'revision-existing'
  }

  assert.equal(withAICredentialRevision({
    ...previous,
    modelAI: 'model-b'
  }, previous, createRevision).credentialRevisionAI, 'revision-existing')
  assert.equal(withAICredentialRevision({
    ...previous,
    apiKeyAI: 'sk-new'
  }, previous, createRevision).credentialRevisionAI, 'revision-1')
  assert.equal(withAICredentialRevision({
    id: 'new',
    apiKeyAI: 'sk-first'
  }, null, createRevision).credentialRevisionAI, 'revision-2')
})

test('AI model status exposes every real health state with stable classes', async () => {
  const {
    getAIModelStatus,
    getAIStatusFingerprint
  } = await import(profilesUrl)
  const translate = key => ({
    shellpilotAiUnconfigured: '未配置',
    shellpilotAiChecking: '检测中',
    shellpilotAiReachable: '接口可达',
    shellpilotAiAvailable: '模型可用',
    shellpilotAiAuthError: '认证失败',
    shellpilotAiModelError: '模型不可用',
    shellpilotAiQuotaError: '额度异常',
    shellpilotAiNetworkError: '网络异常',
    shellpilotAiStale: '待重新检测'
  })[key] || key
  const configured = {
    baseURLAI: 'https://relay.example.com/v1',
    apiKeyAI: 'sk-private',
    modelAI: 'model-a',
    credentialRevisionAI: 'revision-safe'
  }
  const fingerprint = getAIStatusFingerprint(configured)
  const expected = [
    ['checking', '检测中'],
    ['reachable', '接口可达'],
    ['available', '模型可用'],
    ['auth-error', '认证失败'],
    ['model-error', '模型不可用'],
    ['quota-error', '额度异常'],
    ['network-error', '网络异常'],
    ['stale', '待重新检测']
  ]

  assert.equal(getAIModelStatus({}, translate).status, 'unconfigured')
  assert.equal(getAIModelStatus(configured, translate).status, 'stale')
  for (const [status, label] of expected) {
    const result = getAIModelStatus({
      ...configured,
      aiStatus: status,
      aiStatusFingerprint: fingerprint
    }, translate)
    assert.equal(result.status, status)
    assert.equal(result.label, label)
    assert.equal(result.className, status)
  }
})

const coordinatorUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/ai-health-coordinator.js')
).href

function createDeferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function createManualClock (startAt = 1000) {
  let time = startAt
  let nextId = 0
  const timers = new Map()
  return {
    now: () => time,
    setTimeout: (callback, delay) => {
      const id = ++nextId
      timers.set(id, { callback, at: time + delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
    advance: async (amount) => {
      time += amount
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort((left, right) => left[1].at - right[1].at)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.callback()
      }
      await Promise.resolve()
      await Promise.resolve()
    }
  }
}

function createProfile (overrides = {}) {
  return {
    id: 'relay',
    baseURLAI: 'https://relay.example.com/v1',
    apiPathAI: '/chat/completions',
    apiKeyAI: 'sk-private-value',
    modelAI: 'model-a',
    authHeaderNameAI: 'Authorization: Bearer',
    proxyAI: '',
    credentialRevisionAI: 'revision-1',
    ...overrides
  }
}

test('AI health coordinator debounces automatic checks for 450ms', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const deferred = createDeferred()
  const calls = []
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: (...args) => {
      calls.push(args)
      return deferred.promise
    }
  })
  const profile = createProfile()

  coordinator.schedule(profile)
  assert.equal(coordinator.getSnapshot(profile).status, 'stale')
  await clock.advance(449)
  assert.equal(calls.length, 0)
  await clock.advance(1)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].slice(0, 7), [
    'AIHealthCheck',
    'model-a',
    'https://relay.example.com/v1',
    '/chat/completions',
    'sk-private-value',
    '',
    'Authorization: Bearer'
  ])
  assert.match(calls[0][7], /^ai-health-/)
  assert.equal(coordinator.getSnapshot(profile).status, 'checking')

  deferred.resolve({
    status: 'available',
    apiStatus: 'reachable',
    modelStatus: 'available',
    models: ['model-a'],
    message: 'ok',
    checkedAt: clock.now(),
    latencyMs: null
  })
  await clock.advance(0)
  assert.equal(coordinator.getSnapshot(profile).status, 'available')
  assert.equal(coordinator.getSnapshot(profile).latencyMs, null)
})

test('AI health coordinator caches for five minutes and deduplicates inflight checks', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const requests = []
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: () => {
      const deferred = createDeferred()
      requests.push(deferred)
      return deferred.promise
    }
  })
  const profile = createProfile()

  const first = coordinator.checkNow(profile, { force: true })
  const duplicate = coordinator.checkNow(profile, { force: true })
  assert.equal(first, duplicate)
  assert.equal(requests.length, 1)
  requests[0].resolve({ status: 'available', checkedAt: clock.now() })
  await first

  await coordinator.checkNow(profile)
  assert.equal(requests.length, 1)
  await clock.advance(300001)
  assert.equal(coordinator.getSnapshot(profile).status, 'stale')
  const refreshed = coordinator.checkNow(profile)
  assert.equal(requests.length, 2)
  requests[1].resolve({ status: 'reachable', checkedAt: clock.now() })
  await refreshed
  assert.equal(coordinator.getSnapshot(profile).status, 'reachable')
})

test('AI health coordinator ignores cancelled and obsolete responses', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const requests = []
  const cancellations = []
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: (...args) => {
      if (args[0] === 'AIHealthCheckCancel') {
        cancellations.push(args[1])
        return Promise.resolve(true)
      }
      const deferred = createDeferred()
      requests.push(deferred)
      return deferred.promise
    }
  })
  const oldProfile = createProfile()
  const newProfile = createProfile({
    modelAI: 'model-b',
    credentialRevisionAI: 'revision-2'
  })

  const cancelOld = coordinator.schedule(oldProfile)
  await clock.advance(450)
  cancelOld()
  coordinator.schedule(newProfile)
  await clock.advance(450)
  requests[1].resolve({ status: 'available', checkedAt: clock.now() })
  await clock.advance(0)
  requests[0].resolve({ status: 'auth-error', message: 'old', checkedAt: clock.now() })
  await clock.advance(0)

  assert.equal(coordinator.getSnapshot(newProfile).status, 'available')
  assert.equal(coordinator.getSnapshot(oldProfile).status, 'stale')
  assert.equal(cancellations.length, 1)
})

test('AI health coordinator redacts secrets and authentication data from public state', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const profile = createProfile()
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    runGlobalAsync: async () => ({
      status: 'auth-error',
      apiStatus: 'auth-error',
      modelStatus: 'unknown',
      message: 'Authorization: Bearer sk-private-value was rejected',
      checkedAt: clock.now()
    })
  })

  await coordinator.checkNow(profile, { force: true })
  const serialized = JSON.stringify(coordinator.getSnapshot(profile))
  assert.doesNotMatch(serialized, /sk-private|Authorization|Bearer/i)
  assert.equal(coordinator.getSnapshot(profile).status, 'auth-error')
})

test('real chat outcomes update the same model health entry without secrets', async () => {
  const {
    createAIHealthCoordinator,
    getAIHealthRequestKey
  } = await import(coordinatorUrl)
  const coordinator = createAIHealthCoordinator()
  const profile = createProfile()
  const key = getAIHealthRequestKey(profile)

  coordinator.recordChatStarted(key)
  assert.equal(coordinator.getSnapshot(profile).status, 'checking')
  coordinator.recordChatResult(key, { ok: true, message: '对话成功' })
  assert.equal(coordinator.getSnapshot(profile).status, 'available')
  coordinator.recordChatResult(key, {
    ok: false,
    status: 'quota-error',
    message: 'Authorization sk-private-value quota exhausted'
  })
  const snapshot = coordinator.getSnapshot(profile)
  assert.equal(snapshot.status, 'quota-error')
  assert.doesNotMatch(JSON.stringify(snapshot), /sk-private|Authorization/i)
})

test('chat health transitions wait for completed output and report failed requests', async () => {
  const { resolveAIChatHealthTransitions } = await import(coordinatorUrl)
  const tracked = new Map([
    ['running', { key: 'relay::model-a', seen: false }],
    ['failed', { key: 'relay::model-a', seen: false }],
    ['completed', { key: 'relay::model-a', seen: false }]
  ])
  const history = [
    {
      id: 'running',
      response: 'partial stream output',
      completionStatus: 'running'
    },
    {
      id: 'failed',
      response: 'insufficient balance: quota exhausted',
      completionStatus: 'failed'
    },
    {
      id: 'completed',
      response: 'complete answer',
      completionStatus: 'completed'
    }
  ]

  const result = resolveAIChatHealthTransitions(history, tracked)

  assert.deepEqual(result.updates, [
    {
      id: 'failed',
      key: 'relay::model-a',
      ok: false,
      status: 'quota-error'
    },
    {
      id: 'completed',
      key: 'relay::model-a',
      ok: true
    }
  ])
  assert.deepEqual([...result.tracked.keys()], ['running'])
  assert.equal(result.tracked.get('running').seen, true)
})

test('AI health coordinator expires ISO checkedAt after five minutes', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const startedAt = Date.parse('2026-07-16T00:00:00.000Z')
  const clock = createManualClock(startedAt)
  let requestCount = 0
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: async () => {
      requestCount += 1
      return {
        status: 'available',
        checkedAt: new Date(clock.now()).toISOString()
      }
    }
  })
  const profile = createProfile()

  await coordinator.checkNow(profile, { force: true })
  await coordinator.checkNow(profile)
  assert.equal(requestCount, 1)

  await clock.advance(300001)
  await coordinator.checkNow(profile)
  assert.equal(requestCount, 2)
})

test('AI health coordinator keeps cached results when a scheduled check is disposed', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const calls = []
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: async (...args) => {
      calls.push(args)
      return { status: 'available', checkedAt: clock.now() }
    }
  })
  const profile = createProfile()

  await coordinator.checkNow(profile, { force: true })
  const cancelScheduled = coordinator.schedule(profile)
  cancelScheduled()

  assert.equal(coordinator.getSnapshot(profile).status, 'available')
  assert.equal(calls.filter(call => call[0] === 'AIHealthCheckCancel').length, 0)
})

test('AI health coordinator cancels a started scheduled backend request', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const clock = createManualClock()
  const request = createDeferred()
  const calls = []
  const coordinator = createAIHealthCoordinator({
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    runGlobalAsync: (...args) => {
      calls.push(args)
      return args[0] === 'AIHealthCheckCancel'
        ? Promise.resolve(true)
        : request.promise
    }
  })
  const profile = createProfile()

  const cancel = coordinator.schedule(profile)
  await clock.advance(450)
  const healthCall = calls.find(call => call[0] === 'AIHealthCheck')
  assert.ok(healthCall)
  assert.match(healthCall[7], /^ai-health-/)
  cancel()
  const cancelCall = calls.find(call => call[0] === 'AIHealthCheckCancel')
  assert.deepEqual(cancelCall, ['AIHealthCheckCancel', healthCall[7]])

  request.resolve({ status: 'available', checkedAt: clock.now() })
  await clock.advance(0)
  assert.equal(coordinator.getSnapshot(profile).status, 'stale')
})
test('AI health coordinator cancels an inflight request when invalidated', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const request = createDeferred()
  const calls = []
  const coordinator = createAIHealthCoordinator({
    runGlobalAsync: (...args) => {
      calls.push(args)
      return args[0] === 'AIHealthCheckCancel'
        ? Promise.resolve(true)
        : request.promise
    }
  })
  const profile = createProfile()

  coordinator.checkNow(profile, { force: true })
  const healthCall = calls.find(call => call[0] === 'AIHealthCheck')
  coordinator.invalidate(profile)

  assert.deepEqual(
    calls.find(call => call[0] === 'AIHealthCheckCancel'),
    ['AIHealthCheckCancel', healthCall[7]]
  )
  assert.equal(coordinator.getSnapshot(profile).status, 'stale')
})

test('AI health coordinator cancels every inflight request on dispose', async () => {
  const { createAIHealthCoordinator } = await import(coordinatorUrl)
  const calls = []
  const coordinator = createAIHealthCoordinator({
    runGlobalAsync: (...args) => {
      calls.push(args)
      if (args[0] === 'AIHealthCheckCancel') return Promise.resolve(true)
      return createDeferred().promise
    }
  })

  coordinator.checkNow(createProfile(), { force: true })
  coordinator.checkNow(createProfile({ modelAI: 'model-b' }), { force: true })
  const requestIds = calls
    .filter(call => call[0] === 'AIHealthCheck')
    .map(call => call[7])

  coordinator.dispose()

  assert.deepEqual(
    calls
      .filter(call => call[0] === 'AIHealthCheckCancel')
      .map(call => call[1])
      .sort(),
    requestIds.sort()
  )
})
