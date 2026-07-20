const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const discoveryUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/quick-command-service-discovery.js'
)).href

test('quick commands reuse service inventory and expose readable systemd choices', async () => {
  const { discoverQuickCommandTargets } = await import(discoveryUrl)
  const client = {
    inventory: async () => ({
      status: 'completed',
      items: [
        {
          id: 'systemd:nginx.service',
          name: 'nginx.service',
          type: 'service',
          source: 'systemd',
          state: 'running',
          autostart: 'enabled',
          description: 'A high performance web server'
        },
        {
          id: 'docker:web-api',
          name: 'web-api',
          type: 'container',
          source: 'docker',
          state: 'stopped',
          autostart: 'unknown',
          description: 'web api container'
        }
      ]
    })
  }

  const result = await discoverQuickCommandTargets({ host: 'server.example' }, {
    client,
    type: 'service',
    sources: ['systemd']
  })

  assert.equal(result.status, 'ready')
  assert.equal(result.options.length, 1)
  assert.deepEqual(result.options[0], {
    value: 'nginx.service',
    label: 'nginx.service · 运行中 · systemd',
    state: 'running',
    source: 'systemd',
    description: 'A high performance web server'
  })
})

test('quick command target discovery reports partial results without hiding choices', async () => {
  const { discoverQuickCommandTargets } = await import(discoveryUrl)
  const client = {
    inventory: async () => ({
      status: 'error',
      truncated: true,
      items: [{
        id: 'docker:worker',
        name: 'worker',
        type: 'container',
        source: 'docker',
        state: 'restarting',
        autostart: 'unknown',
        description: ''
      }],
      errors: [{ code: 'OUTPUT_TRUNCATED', category: 'partial' }]
    })
  }

  const result = await discoverQuickCommandTargets({}, {
    client,
    type: 'container',
    sources: ['docker', 'compose']
  })

  assert.equal(result.status, 'partial')
  assert.equal(result.truncated, true)
  assert.equal(result.options[0].value, 'worker')
  assert.match(result.message, /部分|截断/)
})
