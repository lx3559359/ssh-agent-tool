const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const expected = [
  'service.inventory-health',
  'service.failed-related-logs',
  'logs.system-anomaly-summary',
  'web.nginx-apache-diagnostic',
  'web.http-tls-check',
  'container.runtime-health',
  'container.storage-resources',
  'service.scheduled-tasks'
]

test('service and platform catalog has eight readonly tools', async () => {
  const { servicesPlatformTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/services-platform.js'
  )
  assert.deepEqual(servicesPlatformTools.map(tool => tool.id), expected)
  assert.equal(servicesPlatformTools.every(tool => tool.risk === 'read-only'), true)
})

test('service selection comes from discovery and supports multiple values', async () => {
  const { normalizeServiceSelection } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/services-platform.js'
  )
  const capabilities = {
    services: [
      { name: 'nginx.service' },
      { name: 'docker.service' }
    ]
  }
  assert.deepEqual(
    normalizeServiceSelection(['nginx.service', 'docker.service'], capabilities),
    ['nginx.service', 'docker.service']
  )
  assert.throws(
    () => normalizeServiceSelection(['unknown.service'], capabilities),
    /已发现/
  )
})
