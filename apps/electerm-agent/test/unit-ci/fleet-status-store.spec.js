const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const storeUrl = pathToFileURL(path.join(
  root,
  'src/client/components/fleet-status/fleet-status-store.js'
)).href

function bookmark (id, overrides = {}) {
  return {
    id,
    title: `Server ${id}`,
    host: `10.0.0.${id}`,
    port: 22,
    tags: [],
    ...overrides
  }
}

function deferred () {
  let resolvePending
  let rejectPending
  const promise = new Promise((resolve, reject) => {
    resolvePending = resolve
    rejectPending = reject
  })
  return { promise, resolve: resolvePending, reject: rejectPending }
}

function successfulResult (id, overrides = {}) {
  return {
    target: { id },
    status: 'success',
    durationMs: 25,
    probes: [{
      id: 'system',
      status: 'success',
      data: { uptimeSeconds: 3600 }
    }],
    ...overrides
  }
}

function collection (...results) {
  return {
    status: 'completed',
    results
  }
}

async function loadStore () {
  return import(`${storeUrl}?test=${Date.now()}-${Math.random()}`)
}

test('uses concurrency five and a sixty second cache by default', async () => {
  const { createFleetStatusStore } = await loadStore()
  let now = 1000
  const calls = []
  const client = {
    collect: async options => {
      calls.push(options)
      return collection(...options.bookmarks.map(item => successfulResult(item.id)))
    },
    cancel: async () => ({ cancelled: true })
  }
  const store = createFleetStatusStore({
    client,
    bookmarks: [bookmark('1'), bookmark('2')],
    now: () => now,
    createTaskId: () => `task-${calls.length + 1}`
  })

  await store.refreshAll()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].concurrency, 5)
  assert.equal(store.getState().cacheTtlMs, 60_000)

  now += 59_999
  await store.refreshAll()
  assert.equal(calls.length, 1)

  now += 2
  await store.refreshAll()
  assert.equal(calls.length, 2)
})

test('shares in-flight work and lets refreshOne force a cached target', async () => {
  const { createFleetStatusStore } = await loadStore()
  const requests = []
  const client = {
    collect: options => {
      const pending = deferred()
      requests.push({ options, pending })
      return pending.promise
    },
    cancel: async () => ({ cancelled: true })
  }
  const store = createFleetStatusStore({
    client,
    bookmarks: [bookmark('1')],
    createTaskId: () => `task-${requests.length + 1}`
  })

  const first = store.refreshAll()
  const shared = store.refreshOne('1', { force: false })
  assert.equal(requests.length, 1)
  requests[0].pending.resolve(collection(successfulResult('1')))
  await Promise.all([first, shared])

  await store.refreshOne('1', { force: false })
  assert.equal(requests.length, 1)

  const forced = store.refreshOne('1', { force: true })
  assert.equal(requests.length, 2)
  requests[1].pending.resolve(collection(successfulResult('1')))
  await forced
})

test('keeps successful targets when one fails and retries only that target', async () => {
  const { createFleetStatusStore } = await loadStore()
  const calls = []
  const client = {
    collect: async options => {
      calls.push(options)
      if (calls.length === 1) {
        return collection(
          successfulResult('1'),
          {
            target: { id: '2' },
            status: 'timeout',
            error: {
              code: 'TARGET_TIMEOUT',
              message: 'password=must-not-render'
            }
          }
        )
      }
      return collection(successfulResult('2'))
    },
    cancel: async () => ({ cancelled: true })
  }
  const store = createFleetStatusStore({
    client,
    bookmarks: [bookmark('1'), bookmark('2')]
  })

  await store.refreshAll()
  let rows = store.getVisibleRows()
  assert.equal(rows.find(row => row.id === '1').snapshot.connection.status, 'connected')
  assert.equal(rows.find(row => row.id === '2').snapshot.connection.status, 'timeout')
  assert.equal(rows.find(row => row.id === '2').errorMessage, '采集超时')
  assert.doesNotMatch(JSON.stringify(rows), /must-not-render/)

  await store.refreshAll()
  assert.equal(calls.length, 1)

  await store.refreshOne('2', { force: true })
  rows = store.getVisibleRows()
  assert.deepEqual(calls[1].bookmarks.map(item => item.id), ['2'])
  assert.equal(rows.find(row => row.id === '2').snapshot.connection.status, 'connected')
})

test('failed probes affect health without exposing backend messages', async () => {
  const { createFleetStatusStore } = await loadStore()
  const store = createFleetStatusStore({
    bookmarks: [bookmark('partial-probe')],
    client: {
      collect: async () => collection(successfulResult('partial-probe', {
        probes: [
          {
            id: 'system',
            status: 'success',
            data: { uptimeSeconds: 3600 }
          },
          {
            id: 'resources',
            status: 'permission',
            data: null,
            message: 'backend-message password=probe-secret'
          }
        ]
      })),
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  const snapshot = store.getVisibleRows()[0].snapshot
  assert.equal(snapshot.connection.status, 'connected')
  assert.equal(snapshot.overallStatus, 'warning')
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'collectedAt',
    'connection',
    'firewall',
    'network',
    'overallStatus',
    'resources',
    'services'
  ].sort())
  assert.doesNotMatch(JSON.stringify(snapshot), /backend-message|probe-secret/)
})

test('preserves stable target error categories in connection health and filters', async () => {
  const { createFleetStatusStore } = await loadStore()
  const failures = [
    {
      id: 'auth-code',
      error: { code: 'AUTH_FAILED', category: 'unknown' },
      connectionStatus: 'auth',
      overallStatus: 'offline'
    },
    {
      id: 'host-key-code',
      error: { code: 'HOST_KEY_MISMATCH', category: 'unknown' },
      connectionStatus: 'host-key',
      overallStatus: 'offline'
    },
    {
      id: 'permission-code',
      error: { code: 'PERMISSION_DENIED', category: 'unknown' },
      connectionStatus: 'permission',
      overallStatus: 'permission'
    },
    {
      id: 'unsupported-category',
      error: { code: 'PROBE_FAILED', category: 'unsupported' },
      connectionStatus: 'unsupported',
      overallStatus: 'unsupported'
    }
  ]
  const store = createFleetStatusStore({
    bookmarks: failures.map(item => bookmark(item.id)),
    client: {
      collect: async () => collection(...failures.map(item => ({
        target: { id: item.id },
        status: 'error',
        error: {
          ...item.error,
          message: 'backend-message password=target-secret'
        }
      }))),
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  const rows = store.getVisibleRows()
  for (const expected of failures) {
    const row = rows.find(item => item.id === expected.id)
    assert.equal(row.snapshot.connection.status, expected.connectionStatus)
    assert.equal(row.snapshot.connection.error, expected.connectionStatus)
    assert.equal(row.overallStatus, expected.overallStatus)
  }
  assert.doesNotMatch(JSON.stringify(rows), /backend-message|target-secret/)

  store.setFilters({ status: 'offline' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), [
    'auth-code',
    'host-key-code'
  ])
  store.setFilters({ status: 'permission' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), [
    'permission-code'
  ])
  store.setFilters({ status: 'unsupported' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), [
    'unsupported-category'
  ])
})

test('cancel invalidates late results and forwards every active task id', async () => {
  const { createFleetStatusStore } = await loadStore()
  const pending = deferred()
  const cancelled = []
  const client = {
    collect: () => pending.promise,
    cancel: async taskId => {
      cancelled.push(taskId)
      return { taskId, cancelled: true }
    }
  }
  const store = createFleetStatusStore({
    client,
    bookmarks: [bookmark('1')],
    createTaskId: () => 'cancel-me'
  })

  const refresh = store.refreshAll()
  assert.equal(store.getState().running, true)
  await store.cancel()
  assert.deepEqual(cancelled, ['cancel-me'])
  assert.equal(store.getState().running, false)

  pending.resolve(collection(successfulResult('1')))
  await refresh
  const row = store.getVisibleRows()[0]
  assert.equal(row.snapshot, null)
  assert.equal(row.errorMessage, '')
})

test('a newer forced generation cannot be overwritten by an older response', async () => {
  const { createFleetStatusStore } = await loadStore()
  const requests = []
  const client = {
    collect: options => {
      const pending = deferred()
      requests.push({ options, pending })
      return pending.promise
    },
    cancel: async () => ({ cancelled: true })
  }
  const store = createFleetStatusStore({
    client,
    bookmarks: [bookmark('1')]
  })

  const older = store.refreshOne('1', { force: true })
  const newer = store.refreshOne('1', { force: true })
  assert.equal(requests.length, 2)

  requests[1].pending.resolve(collection(successfulResult('1', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'nftables', enabled: true }
    }]
  })))
  await newer

  requests[0].pending.resolve(collection(successfulResult('1', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'ufw', enabled: true }
    }]
  })))
  await older

  assert.equal(
    store.getVisibleRows()[0].snapshot.firewall.provider,
    'nftables'
  )
})

test('filters by name ip tag group and status', async () => {
  const { createFleetStatusStore } = await loadStore()
  const bookmarks = [
    bookmark('1', { title: 'Gateway', tags: ['edge'] }),
    bookmark('2', { title: 'Database', host: '172.16.0.9', labels: ['mysql'] })
  ]
  const store = createFleetStatusStore({
    bookmarks,
    bookmarkGroups: [
      { id: 'group-edge', title: '边缘节点', bookmarkIds: ['1'] },
      { id: 'group-data', title: '数据节点', bookmarkIds: ['2'] }
    ],
    client: {
      collect: async () => collection(
        successfulResult('1'),
        {
          target: { id: '2' },
          status: 'error',
          error: { code: 'CONNECTION_FAILED' }
        }
      ),
      cancel: async () => ({ cancelled: true })
    }
  })
  await store.refreshAll()

  store.setFilters({ search: 'edge' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), ['1'])
  store.setFilters({ search: '172.16' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), ['2'])
  store.setFilters({ search: 'gateway', group: 'group-data' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), [])
  store.setFilters({ search: '', group: 'group-data', status: 'offline' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), ['2'])
  store.setFilters({ group: 'all', status: 'all' })
  assert.deepEqual(store.getVisibleRows().map(row => row.id), ['1', '2'])
})

test('tracks selected rows and exposes only safe bookmark fields', async () => {
  const { createFleetStatusStore } = await loadStore()
  const store = createFleetStatusStore({
    bookmarks: [bookmark('1', {
      username: 'root-user',
      password: 'password-value',
      privateKey: 'private-key-value',
      apiKey: 'api-key-value'
    })],
    client: {
      collect: async () => collection(successfulResult('1')),
      cancel: async () => ({ cancelled: true })
    }
  })

  assert.equal(store.toggleSelected('1'), true)
  assert.deepEqual(store.getState().selectedIds, ['1'])
  assert.deepEqual(store.getSelectedRows().map(row => row.id), ['1'])
  assert.equal(store.toggleSelected('1'), false)
  store.toggleSelected('1')
  store.clearSelected()
  assert.deepEqual(store.getState().selectedIds, [])

  const serialized = JSON.stringify(store.getVisibleRows())
  assert.doesNotMatch(serialized, /root-user|password-value|private-key-value|api-key-value/)
  assert.doesNotMatch(serialized, /username|password|privateKey|apiKey/)
})

test('notifies subscribers and stops after unsubscribe', async () => {
  const { createFleetStatusStore } = await loadStore()
  const store = createFleetStatusStore({ bookmarks: [bookmark('1')] })
  let calls = 0
  const unsubscribe = store.subscribe(() => {
    calls += 1
  })

  store.setFilters({ search: 'gateway' })
  assert.equal(calls, 1)
  unsubscribe()
  store.clearSelected()
  assert.equal(calls, 1)
})

test('name-only source changes notify and keep state rows aligned', async () => {
  const { createFleetStatusStore } = await loadStore()
  const initial = bookmark('name-only', {
    title: '',
    name: 'Before name'
  })
  const store = createFleetStatusStore({ bookmarks: [initial] })
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  const changed = store.setBookmarks([{
    ...initial,
    name: 'After name'
  }])

  assert.equal(changed, true)
  assert.equal(notifications, 1)
  assert.equal(store.getState().rows[0].name, 'After name')
  assert.equal(store.getVisibleRows()[0].name, 'After name')
  assert.deepEqual(store.getState().rows, store.getState().visibleRows)
})

test('invalidates cached and in-flight work when SSH connection identity changes', async () => {
  const { createFleetStatusStore } = await loadStore()
  const identityCases = [
    ['host', { host: '10.10.10.2' }],
    ['port', { port: 2222 }],
    ['username', { username: 'deploy' }],
    ['profile', { profile: 'profile-b' }],
    ['proxy', { proxy: 'socks5://proxy-b.internal:1080' }],
    ['hopping host', {
      connectionHoppings: [{
        host: 'jump-b.internal',
        port: 22,
        username: 'jump'
      }]
    }]
  ]

  for (const [label, update] of identityCases) {
    const calls = []
    const initial = bookmark('identity', {
      username: 'root',
      profile: 'profile-a',
      proxy: 'socks5://proxy-a.internal:1080',
      connectionHoppings: [{
        host: 'jump-a.internal',
        port: 22,
        username: 'jump'
      }]
    })
    const store = createFleetStatusStore({
      bookmarks: [initial],
      client: {
        collect: async options => {
          calls.push(options)
          return collection(successfulResult('identity'))
        },
        cancel: async () => ({ cancelled: true })
      }
    })

    await store.refreshAll()
    assert.equal(calls.length, 1, `${label}: initial collection`)
    store.setBookmarks([{ ...initial, ...update }])
    assert.equal(store.getVisibleRows()[0].snapshot, null, `${label}: cache cleared`)
    await store.refreshAll()
    assert.equal(calls.length, 2, `${label}: target recollected`)
  }

  const requests = []
  const initial = bookmark('stale-identity', { username: 'root' })
  const store = createFleetStatusStore({
    bookmarks: [initial],
    client: {
      collect: options => {
        const pending = deferred()
        requests.push({ options, pending })
        return pending.promise
      },
      cancel: async () => ({ cancelled: true })
    }
  })
  const stale = store.refreshAll()
  store.setBookmarks([{ ...initial, username: 'deploy' }])
  const current = store.refreshAll()
  assert.equal(requests.length, 2)

  requests[0].pending.resolve(collection(successfulResult('stale-identity', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'stale-provider', enabled: true }
    }]
  })))
  await stale
  assert.equal(store.getVisibleRows()[0].snapshot, null)

  requests[1].pending.resolve(collection(successfulResult('stale-identity', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'current-provider', enabled: true }
    }]
  })))
  await current
  assert.equal(
    store.getVisibleRows()[0].snapshot.firewall.provider,
    'current-provider'
  )
})

test('uses resolved client identities for profile and global SSH changes', async () => {
  const { createFleetStatusStore } = await loadStore()
  const identityCases = [
    ['profile host', identity => { identity.host = 'profile-b.internal' }],
    ['profile port', identity => { identity.port = 2222 }],
    ['global proxy', identity => { identity.proxy = 'socks5://proxy-b.internal:1080' }],
    ['profile jump', identity => { identity.connectionHoppings[0].host = 'jump-b.internal' }]
  ]

  for (const [label, updateIdentity] of identityCases) {
    const calls = []
    const identityCalls = []
    const initial = bookmark('resolved-identity', { profile: 'profile-a' })
    const resolvedIdentity = {
      host: 'profile-a.internal',
      port: 22,
      proxy: 'socks5://proxy-a.internal:1080',
      connectionHoppings: [{ host: 'jump-a.internal', port: 22 }]
    }
    const store = createFleetStatusStore({
      bookmarks: [initial],
      client: {
        connectionIdentity: target => {
          identityCalls.push(target)
          return JSON.stringify(resolvedIdentity)
        },
        collect: async options => {
          calls.push(options)
          return collection(successfulResult('resolved-identity'))
        },
        cancel: async () => ({ cancelled: true })
      }
    })

    assert.equal(identityCalls.length, 1, `${label}: initial identity mapped`)
    await store.refreshAll()
    assert.equal(calls.length, 1, `${label}: initial collection`)

    updateIdentity(resolvedIdentity)
    store.setBookmarks([initial])
    assert.equal(
      store.getVisibleRows()[0].snapshot,
      null,
      `${label}: cache cleared`
    )
    await store.refreshAll()
    assert.equal(calls.length, 2, `${label}: target recollected`)
  }
})

test('resolved identity changes invalidate stale asynchronous results', async () => {
  const { createFleetStatusStore } = await loadStore()
  const requests = []
  const initial = bookmark('resolved-stale', { profile: 'profile-a' })
  let resolvedHost = 'profile-a.internal'
  const store = createFleetStatusStore({
    bookmarks: [initial],
    client: {
      connectionIdentity: () => JSON.stringify({ host: resolvedHost, port: 22 }),
      collect: options => {
        const pending = deferred()
        requests.push({ options, pending })
        return pending.promise
      },
      cancel: async () => ({ cancelled: true })
    }
  })

  const stale = store.refreshAll()
  resolvedHost = 'profile-b.internal'
  store.setBookmarks([initial])
  const current = store.refreshAll()
  assert.equal(requests.length, 2)

  requests[0].pending.resolve(collection(successfulResult('resolved-stale', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'stale-provider', enabled: true }
    }]
  })))
  await stale
  assert.equal(store.getVisibleRows()[0].snapshot, null)

  requests[1].pending.resolve(collection(successfulResult('resolved-stale', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'current-provider', enabled: true }
    }]
  })))
  await current
  assert.equal(
    store.getVisibleRows()[0].snapshot.firewall.provider,
    'current-provider'
  )
})

test('schemeless proxy fallback strips credentials and invalidates changed endpoints', async () => {
  const { createFleetStatusStore } = await loadStore()
  const requests = []
  const initial = bookmark('schemeless-proxy', {
    proxy: 'proxy-user:first-secret@proxy-a.internal:1080'
  })
  const store = createFleetStatusStore({
    bookmarks: [initial],
    client: {
      collect: options => {
        const pending = deferred()
        requests.push({ options, pending })
        return pending.promise
      },
      cancel: async () => ({ cancelled: true })
    }
  })

  const stale = store.refreshAll()
  const credentialsOnly = {
    ...initial,
    proxy: 'other-user:second-secret@proxy-a.internal:1080'
  }
  assert.equal(store.setBookmarks([credentialsOnly]), false)
  const shared = store.refreshAll()
  assert.equal(requests.length, 1)

  const endpointChanged = {
    ...credentialsOnly,
    proxy: 'other-user:second-secret@proxy-b.internal:1080'
  }
  assert.equal(store.setBookmarks([endpointChanged]), true)
  const current = store.refreshAll()
  assert.equal(requests.length, 2)

  requests[0].pending.resolve(collection(successfulResult('schemeless-proxy', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'stale-provider', enabled: true }
    }]
  })))
  await Promise.all([stale, shared])
  assert.equal(store.getVisibleRows()[0].snapshot, null)

  requests[1].pending.resolve(collection(successfulResult('schemeless-proxy', {
    probes: [{
      id: 'firewall',
      status: 'success',
      data: { provider: 'current-provider', enabled: true }
    }]
  })))
  await current
  assert.equal(
    store.getVisibleRows()[0].snapshot.firewall.provider,
    'current-provider'
  )
  assert.doesNotMatch(
    JSON.stringify(store.getState()),
    /proxy-user|other-user|first-secret|second-secret/
  )
})

test('falls back to local safe identity when the client resolver throws', async () => {
  const { createFleetStatusStore } = await loadStore()
  const calls = []
  const initial = bookmark('identity-fallback', {
    password: 'first-password',
    privateKey: 'first-private-key'
  })
  const store = createFleetStatusStore({
    bookmarks: [initial],
    client: {
      connectionIdentity: () => {
        throw new Error('resolver unavailable: password=must-not-render')
      },
      collect: async options => {
        calls.push(options)
        return collection(successfulResult('identity-fallback'))
      },
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  store.setBookmarks([{
    ...initial,
    password: 'second-password',
    privateKey: 'second-private-key'
  }])
  await store.refreshAll()
  assert.equal(calls.length, 1)

  store.setBookmarks([{ ...initial, host: '10.10.10.10' }])
  assert.equal(store.getVisibleRows()[0].snapshot, null)
  await store.refreshAll()
  assert.equal(calls.length, 2)
  assert.doesNotMatch(JSON.stringify(store.getState()), /must-not-render|password|private-key/)
})

test('keeps credentials out of connection identity fingerprints and public state', async () => {
  const { createFleetStatusStore } = await loadStore()
  const calls = []
  const initial = bookmark('credential-safe', {
    username: 'root',
    profile: 'profile-a',
    proxy: 'socks5://proxy-user:proxy-secret@proxy.internal:1080',
    password: 'first-password',
    privateKey: 'first-private-key',
    passphrase: 'first-passphrase',
    certificate: 'first-certificate',
    apiKey: 'first-api-key',
    connectionHoppings: [{
      host: 'jump.internal',
      port: 22,
      username: 'jump',
      password: 'first-jump-password',
      privateKey: 'first-jump-private-key'
    }]
  })
  const store = createFleetStatusStore({
    bookmarks: [initial],
    client: {
      collect: async options => {
        calls.push(options)
        return collection(successfulResult('credential-safe'))
      },
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  store.setBookmarks([{
    ...initial,
    proxy: 'socks5://other-user:other-secret@proxy.internal:1080',
    password: 'second-password',
    privateKey: 'second-private-key',
    passphrase: 'second-passphrase',
    certificate: 'second-certificate',
    apiKey: 'second-api-key',
    connectionHoppings: [{
      ...initial.connectionHoppings[0],
      password: 'second-jump-password',
      privateKey: 'second-jump-private-key'
    }]
  }])
  await store.refreshAll()

  assert.equal(calls.length, 1)
  const serialized = JSON.stringify(store.getState())
  for (const secret of [
    'proxy-secret',
    'other-secret',
    'first-password',
    'second-password',
    'first-private-key',
    'second-private-key',
    'first-api-key',
    'second-api-key',
    'first-jump-password',
    'second-jump-password'
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret))
  }
})

test('assigns results only by target id and marks missing targets as failed', async () => {
  const { createFleetStatusStore } = await loadStore()
  const store = createFleetStatusStore({
    bookmarks: [bookmark('1'), bookmark('2')],
    client: {
      collect: async () => collection(successfulResult('2', {
        probes: [{
          id: 'firewall',
          status: 'success',
          data: { provider: 'server-two', enabled: true }
        }]
      })),
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  const rows = store.getVisibleRows()
  const first = rows.find(row => row.id === '1')
  const second = rows.find(row => row.id === '2')
  assert.equal(first.snapshot.connection.status, 'failed')
  assert.equal(first.errorMessage, '未收到该服务器的采集结果')
  assert.equal(first.snapshot.firewall.provider, '')
  assert.equal(second.snapshot.connection.status, 'connected')
  assert.equal(second.snapshot.firewall.provider, 'server-two')
})

test('accepts target and bookmark id aliases without positional fallback', async () => {
  const { createFleetStatusStore } = await loadStore()
  const store = createFleetStatusStore({
    bookmarks: [bookmark('1'), bookmark('2')],
    client: {
      collect: async () => collection(
        successfulResult('ignored', {
          target: { bookmarkId: '2' },
          probes: [{
            id: 'firewall',
            status: 'success',
            data: { provider: 'bookmark-id', enabled: true }
          }]
        }),
        successfulResult('ignored', {
          target: undefined,
          targetId: '1',
          probes: [{
            id: 'firewall',
            status: 'success',
            data: { provider: 'target-id', enabled: true }
          }]
        })
      ),
      cancel: async () => ({ cancelled: true })
    }
  })

  await store.refreshAll()
  const rows = store.getVisibleRows()
  assert.equal(rows.find(row => row.id === '1').snapshot.firewall.provider, 'target-id')
  assert.equal(rows.find(row => row.id === '2').snapshot.firewall.provider, 'bookmark-id')
})

test('accepts only SSH bookmarks while preserving legacy bookmarks without type', async () => {
  const { createFleetStatusStore } = await loadStore()
  const collected = []
  const sshBookmarks = [
    bookmark('legacy'),
    bookmark('typed', { type: 'ssh' }),
    bookmark('term-typed', { termType: 'ssh' })
  ]
  const excluded = [
    'telnet',
    'serial',
    'rdp',
    'vnc',
    'local',
    'terminal',
    'web',
    'ftp',
    'spice'
  ].flatMap((type, index) => [
    bookmark(`type-${index}`, { type }),
    bookmark(`term-type-${index}`, { type: undefined, termType: type })
  ])
  const store = createFleetStatusStore({
    bookmarks: [...sshBookmarks, ...excluded],
    client: {
      collect: async options => {
        collected.push(...options.bookmarks.map(item => item.id))
        return collection(...options.bookmarks.map(item => successfulResult(item.id)))
      },
      cancel: async () => ({ cancelled: true })
    }
  })

  assert.deepEqual(store.getVisibleRows().map(row => row.id), [
    'legacy',
    'typed',
    'term-typed'
  ])
  assert.equal(store.getState().bookmarkCount, 3)
  await store.refreshAll()
  assert.deepEqual(collected, ['legacy', 'typed', 'term-typed'])
})
