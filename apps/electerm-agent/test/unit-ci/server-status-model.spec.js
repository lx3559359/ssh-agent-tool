const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modelUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/server-status/server-status-model.js')
).href
const reportUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/server-status/server-status-report.js')
).href

test('creates a stable normalized snapshot without mutating collected data', async () => {
  const { createServerStatusSnapshot } = await import(modelUrl)
  const collected = {
    endpoint: {
      tabId: 'tab-1',
      host: '10.0.0.8',
      port: 22,
      username: 'root',
      title: '生产服务器'
    },
    system: { hostname: 'prod-01', cpuCores: 4 },
    resources: { memory: { totalBytes: 1000, availableBytes: 600 } },
    services: [{ name: 'sshd.service', state: 'running' }]
  }

  const snapshot = createServerStatusSnapshot(collected, {
    now: new Date('2026-07-12T10:00:00.000Z')
  })

  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.collectedAt, '2026-07-12T10:00:00.000Z')
  assert.deepEqual(snapshot.endpoint, collected.endpoint)
  assert.deepEqual(snapshot.system, collected.system)
  assert.deepEqual(snapshot.resources, collected.resources)
  assert.deepEqual(snapshot.services, collected.services)
  assert.deepEqual(snapshot.networks, [])
  assert.deepEqual(snapshot.containers, [])
  assert.deepEqual(snapshot.platforms, [])
  assert.deepEqual(snapshot.probes, [])
  assert.equal(snapshot.overallStatus, 'healthy')

  snapshot.services[0].state = 'failed'
  assert.equal(collected.services[0].state, 'running')
})

test('disk and inode thresholds produce deterministic warning and critical alerts', async () => {
  const { deriveServerStatusHealth } = await import(modelUrl)
  const health = deriveServerStatusHealth({
    resources: {
      filesystems: [
        { mount: '/', usedPercent: 80, inodeUsedPercent: 79 },
        { mount: '/data', usedPercent: 90, inodeUsedPercent: 91 }
      ]
    }
  })

  assert.equal(health.overallStatus, 'critical')
  assert.deepEqual(
    health.alerts.map(item => [item.code, item.status, item.target]),
    [
      ['disk-usage', 'warning', '/'],
      ['disk-usage', 'critical', '/data'],
      ['inode-usage', 'critical', '/data']
    ]
  )
})

test('memory health uses available memory and load is normalized by CPU cores', async () => {
  const { deriveServerStatusHealth } = await import(modelUrl)
  const health = deriveServerStatusHealth({
    system: { cpuCores: 4 },
    resources: {
      memory: {
        totalBytes: 16 * 1024,
        usedBytes: 8 * 1024,
        availableBytes: 1024
      },
      load: { one: 6 }
    }
  })

  assert.equal(health.overallStatus, 'critical')
  assert.equal(health.summary.memoryAvailablePercent, 6.25)
  assert.equal(health.summary.normalizedLoad, 1.5)
  assert.equal(health.alerts.find(item => item.code === 'memory-available').status, 'critical')
  assert.equal(health.alerts.find(item => item.code === 'load-average').status, 'warning')
})

test('the most severe status wins and failed services are critical', async () => {
  const { deriveServerStatusHealth, worstServerStatus } = await import(modelUrl)
  assert.equal(worstServerStatus(['unknown', 'healthy', 'warning']), 'warning')
  assert.equal(worstServerStatus(['warning', 'critical', 'healthy']), 'critical')

  const health = deriveServerStatusHealth({
    services: [
      { name: 'nginx.service', state: 'running' },
      { name: 'mysql.service', activeState: 'failed' }
    ],
    probes: [{ id: 'security', status: 'restricted', message: '权限不足' }]
  })

  assert.equal(health.overallStatus, 'critical')
  assert.equal(health.summary.failedServices, 1)
  assert.equal(health.summary.restrictedProbes, 1)
  assert.equal(health.alerts.find(item => item.code === 'service-failed').target, 'mysql.service')
})

test('a snapshot with only unavailable probes remains unknown', async () => {
  const { createServerStatusSnapshot } = await import(modelUrl)
  const snapshot = createServerStatusSnapshot({
    probes: [
      { id: 'services', status: 'unsupported', message: '不支持' },
      { id: 'security', status: 'restricted', message: '权限不足' }
    ]
  })

  assert.equal(snapshot.overallStatus, 'unknown')
  assert.equal(snapshot.summary.restrictedProbes, 1)
  assert.equal(snapshot.summary.unsupportedProbes, 1)
})

test('runner permission and error statuses are counted without being reported as success', async () => {
  const { createServerStatusSnapshot } = await import(modelUrl)
  const snapshot = createServerStatusSnapshot({
    probes: [
      { id: 'system', status: 'success' },
      { id: 'firewall', status: 'permission' },
      { id: 'containers', status: 'error' },
      { id: 'security', status: 'timeout' }
    ]
  })

  assert.equal(snapshot.summary.successfulProbes, 1)
  assert.equal(snapshot.summary.restrictedProbes, 1)
  assert.equal(snapshot.summary.failedProbes, 2)
  assert.equal(snapshot.overallStatus, 'critical')
  assert.ok(snapshot.alerts.some(item => item.code === 'probe-failed'))
})

test('Markdown and JSON reports cap large collections and raw output', async () => {
  const { createServerStatusSnapshot } = await import(modelUrl)
  const { buildServerStatusMarkdown, buildServerStatusJson } = await import(reportUrl)
  const snapshot = createServerStatusSnapshot({
    endpoint: {
      host: '10.0.0.8',
      port: 22,
      username: 'root',
      password: 'server-secret'
    },
    system: { hostname: 'prod-01', osName: 'Rocky Linux 9' },
    services: Array.from({ length: 80 }, (_, index) => ({
      name: `service-${index}.service`,
      state: index === 0 ? 'failed' : 'running'
    })),
    resources: {
      processes: Array.from({ length: 40 }, (_, index) => ({ pid: index + 1, command: `process-${index}` }))
    },
    networks: [{
      name: 'eth0',
      addresses: ['10.0.0.8/24'],
      listeningPorts: Array.from({ length: 60 }, (_, index) => ({ port: 1000 + index, process: `svc-${index}` }))
    }],
    probes: [{ id: 'services', status: 'success', rawOutput: 'x'.repeat(12000) }]
  })

  const json = JSON.parse(buildServerStatusJson(snapshot))
  const markdown = buildServerStatusMarkdown(snapshot)

  assert.equal(json.services.length, 50)
  assert.equal(json.resources.processes.length, 20)
  assert.equal(json.networks[0].listeningPorts.length, 30)
  assert.equal(json.probes[0].rawOutput.length, 2000)
  assert.equal(Object.hasOwn(json.endpoint, 'password'), false)
  assert.equal(markdown.includes('server-secret'), false)
  assert.match(markdown, /ShellPilot 服务器状态报告/)
  assert.match(markdown, /service-0\.service/)
  assert.equal(markdown.includes('service-79.service'), false)
  assert.ok(markdown.length < 30000)
})

test('reports redact credentials embedded in command-line strings and raw probe output', async () => {
  const { buildServerStatusMarkdown, buildServerStatusJson } = await import(reportUrl)
  const snapshot = {
    endpoint: { host: '10.0.0.8', username: 'root' },
    services: [{
      name: 'agent.service',
      activeState: 'active',
      execStart: '/opt/agent --token top-secret --password=hunter2 --api-key sk-live-secret'
    }],
    probes: [{
      id: 'services',
      status: 'success',
      rawOutput: 'ExecStart=/opt/agent --token top-secret --password=hunter2 Authorization: Bearer abcdef'
    }]
  }

  const jsonText = buildServerStatusJson(snapshot)
  const markdown = buildServerStatusMarkdown(snapshot)
  for (const secret of ['top-secret', 'hunter2', 'sk-live-secret', 'abcdef']) {
    assert.equal(jsonText.includes(secret), false, secret)
    assert.equal(markdown.includes(secret), false, secret)
  }
  assert.match(jsonText, /\[已脱敏\]/)
})
