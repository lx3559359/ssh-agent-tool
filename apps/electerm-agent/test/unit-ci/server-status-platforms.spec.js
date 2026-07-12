const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const platformsUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/server-status/server-status-platforms.js')
).href

test('known platform rules group matching services with high confidence and evidence', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const platforms = identifyServerPlatforms({
    services: [
      {
        name: 'gitlab-runsvdir.service',
        state: 'running',
        description: 'GitLab Runit supervision process',
        fragmentPath: '/usr/lib/systemd/system/gitlab-runsvdir.service',
        execStart: '/opt/gitlab/embedded/bin/runsvdir-start'
      },
      { name: 'sshd.service', state: 'running', description: 'OpenSSH server daemon' }
    ]
  })

  const gitlab = platforms.find(platform => platform.id === 'known:gitlab')
  assert.ok(gitlab)
  assert.equal(gitlab.name, 'GitLab')
  assert.equal(gitlab.confidence, 'high')
  assert.equal(gitlab.status, 'healthy')
  assert.deepEqual(gitlab.services.map(service => service.name), ['gitlab-runsvdir.service'])
  assert.ok(gitlab.evidence.some(item => item.type === 'known-rule' && item.value === 'gitlab'))
  assert.ok(gitlab.evidence.some(item => item.type === 'install-path' && item.value === '/opt/gitlab'))
})

test('services with a shared specific prefix are grouped as a suspected platform', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const platforms = identifyServerPlatforms({
    services: [
      { name: 'acme-api.service', state: 'running' },
      { name: 'acme-worker.service', state: 'failed' },
      { name: 'chronyd.service', state: 'running' }
    ]
  })

  const acme = platforms.find(platform => platform.id === 'prefix:acme')
  assert.ok(acme)
  assert.equal(acme.name, 'acme \u670d\u52a1\u7ec4')
  assert.equal(acme.confidence, 'medium')
  assert.equal(acme.status, 'critical')
  assert.deepEqual(
    acme.services.map(service => service.name),
    ['acme-api.service', 'acme-worker.service']
  )
  assert.deepEqual(acme.evidence, [{ type: 'service-prefix', value: 'acme', count: 2 }])
})

test('services sharing a specific installation directory are grouped together', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const platforms = identifyServerPlatforms({
    services: [
      { name: 'collector.service', state: 'running', execStart: '/opt/observatory/bin/collector --serve' },
      { name: 'scheduler.service', state: 'running', workingDirectory: '/opt/observatory/jobs' }
    ]
  })

  const observatory = platforms.find(platform => platform.id === 'path:/opt/observatory')
  assert.ok(observatory)
  assert.equal(observatory.name, 'observatory \u5e73\u53f0')
  assert.equal(observatory.confidence, 'medium')
  assert.deepEqual(observatory.installPaths, ['/opt/observatory'])
  assert.deepEqual(observatory.evidence, [{
    type: 'shared-install-path',
    value: '/opt/observatory',
    count: 2
  }])
})

test('Docker Compose labels form a high-confidence platform group', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const platforms = identifyServerPlatforms({
    containers: [
      {
        id: 'web-1',
        name: 'billing-web-1',
        state: 'running',
        labels: {
          'com.docker.compose.project': 'billing',
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.working_dir': '/srv/billing'
        }
      },
      {
        id: 'db-1',
        name: 'billing-db-1',
        state: 'exited',
        labels: [
          'com.docker.compose.project=billing',
          'com.docker.compose.service=db'
        ]
      }
    ]
  })

  const billing = platforms.find(platform => platform.id === 'compose:billing')
  assert.ok(billing)
  assert.equal(billing.name, 'billing')
  assert.equal(billing.confidence, 'high')
  assert.equal(billing.status, 'critical')
  assert.equal(billing.containers.length, 2)
  assert.ok(billing.evidence.some(item => item.type === 'docker-compose-project' && item.value === 'billing'))
  assert.ok(billing.evidence.some(item => item.type === 'compose-working-directory' && item.value === '/srv/billing'))
})

test('parsed container composeProject fields form platform groups and match custom rules', async () => {
  const { identifyServerPlatforms, normalizePlatformRules } = await import(platformsUrl)
  const containers = [
    { name: 'billing-web-1', status: 'Up 2 hours', composeProject: 'billing' },
    { name: 'billing-db-1', status: 'Exited (1)', composeProject: 'billing' },
    { name: 'erp-api-1', status: 'Up 1 hour', composeProject: 'erp-prod' }
  ]
  const customRules = normalizePlatformRules([{
    id: 'erp',
    name: 'ERP 平台',
    composeProjects: ['erp-prod']
  }])
  const platforms = identifyServerPlatforms({ containers }, { customRules })

  assert.equal(platforms.find(item => item.id === 'compose:billing')?.containers.length, 2)
  assert.equal(platforms.find(item => item.id === 'custom:erp')?.containers.length, 1)
})

test('custom rules are normalized and take precedence over heuristic grouping', async () => {
  const { identifyServerPlatforms, normalizePlatformRules } = await import(platformsUrl)
  const rules = normalizePlatformRules([{
    id: 'internal-erp',
    name: 'ERP \u4e1a\u52a1\u5e73\u53f0',
    servicePrefixes: ['erp-'],
    serviceNames: ['erp-gateway.service'],
    pathPrefixes: ['/data/company/erp/'],
    composeProjects: ['erp-prod']
  }])

  assert.deepEqual(rules, [{
    id: 'internal-erp',
    name: 'ERP \u4e1a\u52a1\u5e73\u53f0',
    servicePrefixes: ['erp-'],
    serviceNames: ['erp-gateway.service'],
    pathPrefixes: ['/data/company/erp'],
    composeProjects: ['erp-prod']
  }])

  const platforms = identifyServerPlatforms({
    services: [
      { name: 'erp-api.service', state: 'running', execStart: '/data/company/erp/bin/api' },
      { name: 'erp-worker.service', state: 'running', execStart: '/data/company/erp/bin/worker' }
    ],
    containers: [{
      name: 'erp-prod-cache-1',
      state: 'running',
      labels: { 'com.docker.compose.project': 'erp-prod' }
    }]
  }, { customRules: rules })

  const erp = platforms.find(platform => platform.id === 'custom:internal-erp')
  assert.ok(erp)
  assert.equal(erp.name, 'ERP \u4e1a\u52a1\u5e73\u53f0')
  assert.equal(erp.confidence, 'high')
  assert.equal(erp.services.length, 2)
  assert.equal(erp.containers.length, 1)
  assert.ok(erp.evidence.some(item => item.type === 'custom-rule'))
  assert.equal(platforms.some(platform => platform.id === 'prefix:erp'), false)
  assert.equal(platforms.some(platform => platform.id === 'compose:erp-prod'), false)
})

test('custom rules reject invalid or dangerously broad matchers', async () => {
  const { normalizePlatformRules } = await import(platformsUrl)
  const invalidRules = [
    {},
    { id: 'missing-name', servicePrefixes: ['erp-'] },
    { id: 'wildcard', name: '\u8fc7\u5bbd', servicePrefixes: ['*'] },
    { id: 'single-char', name: '\u8fc7\u5bbd', servicePrefixes: ['a'] },
    { id: 'two-char', name: '\u8fc7\u5bbd', servicePrefixes: ['ss'] },
    { id: 'generic-service', name: '\u8fc7\u5bbd', servicePrefixes: ['service'] },
    { id: 'root-path', name: '\u8fc7\u5bbd', pathPrefixes: ['/'] },
    { id: 'top-level-opt', name: '\u8fc7\u5bbd', pathPrefixes: ['/opt'] },
    { id: 'shared-local-root', name: '\u8fc7\u5bbd', pathPrefixes: ['/usr/local'] },
    { id: 'regex-like', name: '\u4e0d\u5141\u8bb8\u6b63\u5219', serviceNames: ['/^erp/'] }
  ]

  for (const rule of invalidRules) {
    assert.throws(
      () => normalizePlatformRules([rule]),
      /invalid|broad|matcher/i,
      JSON.stringify(rule)
    )
  }
})

test('unmatched services are retained in an other system services fallback group', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const platforms = identifyServerPlatforms({
    services: [
      { name: 'sshd.service', state: 'running' },
      { name: 'chronyd.service', state: 'inactive' }
    ]
  })

  assert.deepEqual(platforms, [{
    id: 'system:other',
    name: '\u5176\u4ed6\u7cfb\u7edf\u670d\u52a1',
    confidence: 'low',
    status: 'warning',
    services: [
      { name: 'chronyd.service', state: 'inactive' },
      { name: 'sshd.service', state: 'running' }
    ],
    containers: [],
    installPaths: [],
    evidence: [{ type: 'fallback', value: 'unmatched-system-services', count: 2 }]
  }])
})

test('platform output is deterministic and does not mutate probe input', async () => {
  const { identifyServerPlatforms } = await import(platformsUrl)
  const input = {
    services: [
      { name: 'zeta-worker.service', state: 'running' },
      { name: 'zeta-api.service', state: 'running' }
    ],
    containers: []
  }
  const before = JSON.stringify(input)

  const first = identifyServerPlatforms(input)
  const second = identifyServerPlatforms(input)

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(first[0].services.map(service => service.name), [
    'zeta-api.service',
    'zeta-worker.service'
  ])
})
