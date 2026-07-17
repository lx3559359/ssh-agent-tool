const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const storeUrl = pathToFileURL(path.join(
  root,
  'src/client/components/fleet-status/fleet-service-selector-store.js'
)).href

function bookmark (id, overrides = {}) {
  return {
    id,
    title: `Server ${id}`,
    host: `10.0.0.${id}`,
    port: 22,
    username: 'ops',
    ...overrides
  }
}

function item (name, overrides = {}) {
  return {
    id: `systemd:${name}`,
    name,
    type: 'service',
    group: 'system',
    state: 'running',
    autostart: 'enabled',
    description: '',
    source: 'systemd',
    ...overrides
  }
}

function completed (items = [], errors = []) {
  return { status: 'completed', items, errors }
}

function deferred () {
  let resolvePending
  const promise = new Promise(resolve => { resolvePending = resolve })
  return { promise, resolve: resolvePending }
}

async function waitFor (predicate, message = 'condition') {
  const timeoutAt = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() > timeoutAt) throw new Error(`Timed out waiting for ${message}`)
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

async function loadStore () {
  return import(`${storeUrl}?test=${Date.now()}-${Math.random()}`)
}

test('uses a sixty second cache without credential identity or public-state leakage', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  let now = 1000
  const calls = []
  const client = {
    inventory: async ({ bookmark: target }) => {
      calls.push(target)
      return completed([item(`service-${target.id}`)])
    },
    connectionIdentity: target => JSON.stringify({
      host: target.host,
      port: target.port,
      username: target.username
    })
  }
  const store = createFleetServiceSelectorStore({ client, now: () => now })
  const first = bookmark('1', {
    password: 'first-secret',
    privateKey: 'first-private-key'
  })

  await store.open([first])
  assert.equal(calls.length, 1)
  assert.equal(store.getState().cacheTtlMs, 60_000)

  now += 59_999
  await store.open([{
    ...first,
    password: 'changed-secret',
    privateKey: 'changed-private-key'
  }])
  assert.equal(calls.length, 1)

  now += 2
  await store.open([first])
  assert.equal(calls.length, 2)

  await store.open([{ ...first, host: '10.0.9.1' }])
  assert.equal(calls.length, 3)
  const publicState = JSON.stringify(store.getState())
  assert.doesNotMatch(publicState, /secret|private-key|connectionIdentity/i)
})

test('deduplicates repeated opens while one target inventory is in flight', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const pending = deferred()
  let calls = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: () => {
      calls += 1
      return pending.promise
    },
    connectionIdentity: target => `${target.host}:${target.port}`
  })

  const firstOpen = store.open([bookmark('1')])
  const secondOpen = store.open([bookmark('1')])
  await waitFor(() => calls === 1, 'deduplicated inventory call')
  pending.resolve(completed([item('nginx')]))
  await Promise.all([firstOpen, secondOpen])

  assert.equal(calls, 1)
  assert.equal(store.getState().rows.length, 1)
})

test('limits per-server inventory collection to five concurrent requests', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const releases = []
  let active = 0
  let maximum = 0
  let calls = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async ({ bookmark: target }) => {
      calls += 1
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise(resolve => releases.push(resolve))
      active -= 1
      return completed([item(`service-${target.id}`)])
    },
    connectionIdentity: target => target.host
  })
  const opening = store.open(Array.from({ length: 12 }, (_, index) => (
    bookmark(String(index + 1))
  )))

  await waitFor(() => calls === 5, 'first concurrency batch')
  assert.equal(maximum, 5)
  releases.splice(0, 5).forEach(resolve => resolve())
  await waitFor(() => calls === 10, 'second concurrency batch')
  releases.splice(0, 5).forEach(resolve => resolve())
  await waitFor(() => calls === 12, 'final concurrency batch')
  releases.splice(0).forEach(resolve => resolve())
  await opening

  assert.equal(maximum, 5)
  assert.equal(store.getState().rows.length, 12)
})

test('never allows configured inventory concurrency above five', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const store = createFleetServiceSelectorStore({
    concurrency: 20,
    collectServiceInventory: async () => completed(),
    connectionIdentity: target => target.host
  })

  await store.open([bookmark('1')])
  assert.equal(store.getState().concurrency, 5)
})

test('cancel aborts every active request and ignores late results', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const first = deferred()
  const signals = []
  let calls = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: ({ signal }) => {
      calls += 1
      signals.push(signal)
      if (calls === 1) return first.promise
      return Promise.resolve(completed([item('reopened-service')]))
    },
    connectionIdentity: target => target.host
  })

  const opening = store.open([bookmark('1')])
  await waitFor(() => signals.length === 1, 'inventory signal')
  store.cancel()
  assert.equal(signals[0].aborted, true)
  assert.equal(store.getState().running, false)
  assert.equal(store.getState().servers[0].status, 'cancelled')

  first.resolve(completed([item('late-service')]))
  await opening
  assert.equal(store.getState().rows.length, 0)
  assert.equal(store.getState().servers[0].status, 'cancelled')

  store.close()
  await store.open([bookmark('1')])
  assert.equal(calls, 2)
  assert.deepEqual(store.getState().rows.map(row => row.name), ['reopened-service'])
})

test('keeps successful services visible beside partial and failed servers', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async ({ bookmark: target }) => {
      if (target.id === '1') {
        return completed([item('nginx')], [{
          code: 'OUTPUT_TRUNCATED',
          category: 'partial',
          message: 'unsafe backend truncation details'
        }])
      }
      return {
        status: 'error',
        error: {
          code: 'CONNECTION_FAILED',
          message: 'connect ECONNREFUSED with raw endpoint'
        }
      }
    },
    connectionIdentity: target => target.host
  })

  await store.open([bookmark('1'), bookmark('2')])
  const state = store.getState()
  assert.deepEqual(state.rows.map(row => row.name), ['nginx'])
  assert.deepEqual(state.servers.map(server => server.status), [
    'partial',
    'disconnected'
  ])
  assert.equal(state.servers[0].truncated, true)
  assert.equal(state.truncated, true)
  assert.match(state.servers[0].message, /部分检测项失败/)
  assert.equal(state.servers[1].message, '未连接或连接已断开')
  assert.doesNotMatch(JSON.stringify(state), /unsafe backend|ECONNREFUSED|raw endpoint/i)
})

test('presents empty permission unsupported and generic errors independently', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const responses = {
    1: completed(),
    2: completed([], [{ category: 'permission', message: 'sudo denied raw' }]),
    3: completed([], [{ category: 'unsupported', message: 'missing raw command' }]),
    4: { status: 'error', error: { code: 'PROBE_FAILED', message: 'raw probe' } }
  }
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async ({ bookmark: target }) => responses[target.id],
    connectionIdentity: target => target.host
  })

  await store.open(['1', '2', '3', '4'].map(bookmark))
  assert.deepEqual(store.getState().servers.map(server => server.status), [
    'empty',
    'permission',
    'unsupported',
    'error'
  ])
  assert.deepEqual(store.getState().servers.map(server => server.message), [
    '未发现服务',
    '权限不足',
    '当前服务器不支持服务检测',
    '检测失败'
  ])
  assert.doesNotMatch(JSON.stringify(store.getState()), /sudo denied|missing raw|raw probe/i)
})

test('filters and selects current results, all abnormal services, and clears selection', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const services = [
    item('nginx'),
    item('database', {
      id: 'docker:database',
      type: 'container',
      group: 'container',
      state: 'stopped',
      source: 'docker',
      description: 'PostgreSQL'
    }),
    item('worker', {
      id: 'pm2:worker',
      type: 'process',
      group: 'process-manager',
      state: 'failed',
      source: 'pm2'
    })
  ]
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async () => completed(services),
    connectionIdentity: target => target.host
  })
  await store.open([bookmark('1')])

  store.setFilters({ search: 'postgres', group: 'container', status: 'stopped' })
  assert.deepEqual(store.getState().visibleRows.map(row => row.name), ['database'])
  store.selectVisible()
  assert.equal(store.getState().selectedCount, 1)

  store.selectAbnormal()
  assert.deepEqual(
    store.getState().selectedRows.map(row => row.name).sort(),
    ['database', 'worker']
  )
  store.clearSelected()
  assert.equal(store.getState().selectedCount, 0)
})

test('close aborts work, stops notifications from late results, and preserves completed cache', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const pending = deferred()
  let calls = 0
  let notifications = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: ({ bookmark: target }) => {
      calls += 1
      if (target.id === '1') return Promise.resolve(completed([item('cached')]))
      return pending.promise
    },
    connectionIdentity: target => target.host
  })
  const unsubscribe = store.subscribe(() => { notifications += 1 })
  await store.open([bookmark('1')])
  const opening = store.open([bookmark('2')])
  await waitFor(() => calls === 2, 'second target request')
  store.close()
  const afterClose = notifications

  pending.resolve(completed([item('late-after-close')]))
  await opening
  assert.equal(notifications, afterClose)
  assert.equal(store.getState().open, false)

  await store.open([bookmark('1')])
  assert.equal(calls, 2)
  assert.deepEqual(store.getState().rows.map(row => row.name), ['cached'])
  unsubscribe()
})

test('namespaces rows selections and React server keys by credential-free identity', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  let calls = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async () => {
      calls += 1
      return completed([item('shared-service')])
    }
  })
  const first = bookmark('shared', {
    title: 'Shared target',
    host: 'host-a.example',
    port: 22,
    proxy: 'socks5://proxy-user:proxy-pass@proxy-a.example:1080',
    password: 'credential-one',
    privateKey: 'private-key-one'
  })
  const second = bookmark('shared', {
    title: 'Shared target',
    host: 'host-b.example',
    port: 2202,
    proxy: 'socks5://other-user:other-pass@proxy-b.example:2080',
    password: 'credential-two',
    privateKey: 'private-key-two'
  })

  await store.open([first, second])
  let state = store.getState()
  assert.equal(state.rows.length, 2)
  assert.equal(new Set(state.rows.map(row => row.id)).size, 2)
  assert.equal(new Set(state.servers.map(server => server.key)).size, 2)
  assert.ok(state.rows.some(row => row.id.includes('host-a.example')))
  assert.ok(state.rows.some(row => row.id.includes('proxy-a.example:1080')))
  assert.ok(state.rows.some(row => row.id.includes('host-b.example')))
  assert.ok(state.rows.some(row => row.id.includes('proxy-b.example:2080')))

  const selectedRow = state.rows.find(row => row.id.includes('host-a.example'))
  store.toggleSelected(selectedRow.id)
  assert.equal(store.getState().selectedRows.length, 1)

  await store.open([{
    ...first,
    password: 'credential-changed',
    privateKey: 'private-key-changed'
  }, second])
  state = store.getState()
  assert.equal(calls, 2)
  assert.deepEqual(state.selectedIds, [selectedRow.id])
  assert.doesNotMatch(
    JSON.stringify(state),
    /proxy-user|proxy-pass|other-user|other-pass|credential-|private-key/i
  )

  await store.open([{ ...first, host: 'host-c.example' }])
  assert.equal(calls, 3)
  assert.equal(store.getState().selectedCount, 0)
})

test('force refresh preserves same-identity selection until final rows prune it', async () => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const pending = deferred()
  let calls = 0
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: () => {
      calls += 1
      if (calls === 1) return completed([item('alpha'), item('removed')])
      return pending.promise
    },
    connectionIdentity: target => `${target.host}:${target.port}`
  })

  await store.open([bookmark('1')])
  store.selectVisible()
  const selectedBefore = [...store.getState().selectedIds]
  const refreshing = store.refresh()
  await waitFor(() => calls === 2, 'forced refresh')

  let state = store.getState()
  assert.equal(state.running, true)
  assert.deepEqual(state.rows.map(row => row.name), ['alpha', 'removed'])
  assert.deepEqual(state.selectedIds, selectedBefore)

  pending.resolve(completed([item('alpha')]))
  await refreshing
  state = store.getState()
  assert.deepEqual(state.rows.map(row => row.name), ['alpha'])
  assert.deepEqual(state.selectedRows.map(row => row.name), ['alpha'])
  assert.equal(state.selectedCount, 1)
})

test('batch-selects 1024 visible rows under 100ms with one notification', async t => {
  const { createFleetServiceSelectorStore } = await loadStore()
  const services = Array.from({ length: 1024 }, (_, index) => (
    item(`service-${index}`)
  ))
  const store = createFleetServiceSelectorStore({
    collectServiceInventory: async () => completed(services),
    connectionIdentity: target => target.host
  })
  await store.open([bookmark('1')])

  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications += 1 })
  const selectStarted = performance.now()
  const selected = store.setVisibleSelected(true)
  const selectDuration = performance.now() - selectStarted

  assert.equal(selected, 1024)
  assert.equal(notifications, 1)
  assert.equal(store.getState().selectedCount, 1024)
  assert.ok(selectDuration < 100, `select took ${selectDuration.toFixed(2)}ms`)

  notifications = 0
  const clearStarted = performance.now()
  const cleared = store.setVisibleSelected(false)
  const clearDuration = performance.now() - clearStarted

  assert.equal(cleared, 1024)
  assert.equal(notifications, 1)
  assert.equal(store.getState().selectedCount, 0)
  assert.ok(clearDuration < 100, `clear took ${clearDuration.toFixed(2)}ms`)
  t.diagnostic(
    `1024 rows: select ${selectDuration.toFixed(2)}ms, clear ${clearDuration.toFixed(2)}ms`
  )
  unsubscribe()
})
