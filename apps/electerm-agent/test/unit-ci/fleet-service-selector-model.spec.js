const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const modelUrl = pathToFileURL(path.join(
  root,
  'src/client/components/fleet-status/fleet-service-selector-model.js'
)).href

async function loadModel () {
  return import(`${modelUrl}?test=${Date.now()}-${Math.random()}`)
}

test('normalizes completed partial empty and safe failure presentations', async () => {
  const { normalizeFleetServiceInventoryResult } = await loadModel()
  const partial = normalizeFleetServiceInventoryResult({
    status: 'completed',
    items: [{
      id: 'systemd:sshd.service',
      name: 'sshd.service',
      type: 'service',
      group: 'system',
      state: 'running',
      autostart: 'enabled',
      description: 'OpenSSH daemon',
      source: 'systemd'
    }],
    errors: [{
      code: 'OUTPUT_TRUNCATED',
      category: 'partial',
      message: 'backend raw error must not be shown'
    }]
  })

  assert.equal(partial.status, 'partial')
  assert.equal(partial.message, '已发现 1 项，部分检测项失败')
  assert.equal(partial.truncated, true)
  assert.equal(partial.items.length, 1)
  assert.doesNotMatch(JSON.stringify(partial), /backend raw error/i)

  const empty = normalizeFleetServiceInventoryResult({
    status: 'completed',
    items: [],
    errors: []
  })
  assert.deepEqual(
    { status: empty.status, message: empty.message },
    { status: 'empty', message: '未发现服务' }
  )

  const disconnected = normalizeFleetServiceInventoryResult({
    status: 'error',
    error: {
      code: 'CONNECTION_FAILED',
      message: 'dial tcp 10.0.0.1:22 secret details'
    }
  })
  assert.deepEqual(
    { status: disconnected.status, message: disconnected.message },
    { status: 'disconnected', message: '未连接或连接已断开' }
  )
  assert.doesNotMatch(JSON.stringify(disconnected), /dial tcp|secret details/i)
})

test('treats an empty truncated result as partial without claiming no services', async () => {
  const { normalizeFleetServiceInventoryResult } = await loadModel()
  const result = normalizeFleetServiceInventoryResult({
    status: 'completed',
    items: [],
    errors: [],
    truncated: true
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.message, '\u7ed3\u679c\u53ef\u80fd\u5df2\u622a\u65ad')
  assert.equal(result.truncated, true)
  assert.doesNotMatch(result.message, /\u672a\u53d1\u73b0\u670d\u52a1/)
})

test('classifies permission unsupported cancellation and unknown failures honestly', async () => {
  const { normalizeFleetServiceInventoryResult } = await loadModel()
  const cases = [
    [{ status: 'completed', errors: [{ category: 'permission' }] }, 'permission', '权限不足'],
    [{ status: 'completed', errors: [{ category: 'unsupported' }] }, 'unsupported', '当前服务器不支持服务检测'],
    [{ status: 'cancelled' }, 'cancelled', '已取消'],
    [{ status: 'error', error: { code: 'PROBE_FAILED' } }, 'error', '检测失败']
  ]
  for (const [input, status, message] of cases) {
    const result = normalizeFleetServiceInventoryResult(input)
    assert.equal(result.status, status)
    assert.equal(result.message, message)
  }
})

test('filters services by keyword group and four user-facing status buckets', async () => {
  const {
    filterFleetServiceRows,
    isAbnormalFleetService
  } = await loadModel()
  const rows = [
    {
      id: 'one:systemd:nginx',
      serverName: 'Web One',
      name: 'nginx',
      description: 'Public edge',
      source: 'systemd',
      group: 'system',
      state: 'running'
    },
    {
      id: 'one:docker:db',
      serverName: 'Web One',
      name: 'database',
      description: 'PostgreSQL',
      source: 'docker',
      group: 'container',
      state: 'stopped'
    },
    {
      id: 'two:pm2:worker',
      serverName: 'Worker Two',
      name: 'queue-worker',
      description: '',
      source: 'pm2',
      group: 'process-manager',
      state: 'failed'
    }
  ]

  assert.deepEqual(
    filterFleetServiceRows(rows, {
      search: 'postgres',
      group: 'all',
      status: 'all'
    }).map(row => row.name),
    ['database']
  )
  assert.deepEqual(
    filterFleetServiceRows(rows, {
      search: '',
      group: 'container',
      status: 'stopped'
    }).map(row => row.name),
    ['database']
  )
  assert.deepEqual(
    filterFleetServiceRows(rows, {
      search: '',
      group: 'all',
      status: 'abnormal'
    }).map(row => row.name),
    ['queue-worker']
  )
  assert.equal(isAbnormalFleetService(rows[1]), false)
  assert.equal(isAbnormalFleetService(rows[2]), true)
})
