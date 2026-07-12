const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../../')

function readSource (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('server status AI context is bounded and identifies the exact endpoint', async () => {
  const moduleUrl = pathToFileURL(path.join(
    root,
    'src/client/components/server-status/server-status-ai-context.js'
  )).href
  const { buildServerStatusAiPrompt } = await import(moduleUrl)
  const prompt = buildServerStatusAiPrompt({
    endpoint: { host: '10.0.0.8', port: 2222, username: 'root' },
    services: Array.from({ length: 300 }, (_, index) => ({
      name: `service-${index}.service`,
      activeState: index ? 'active' : 'failed'
    })),
    probes: [{ id: 'services', rawOutput: 'x'.repeat(100000) }]
  })

  assert.match(prompt, /root@10\.0\.0\.8:2222/)
  assert.match(prompt, /只读服务器状态快照/)
  assert.ok(prompt.length < 30000)
  assert.doesNotMatch(prompt, /service-299/)
})

test('server status modal wires clipboard export and explicit AI handoff', () => {
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')

  assert.match(modal, /buildServerStatusMarkdown/)
  assert.match(modal, /buildServerStatusJson/)
  assert.match(modal, /copy\(/)
  assert.match(modal, /download\(/)
  assert.match(modal, /refsStatic\.get\('AIChat'\)/)
  assert.match(modal, /handleOpenAIPanel/)
})
