const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('Agent exposes conversation-scoped artifact tools', () => {
  const tools = read('src/client/components/ai/artifact-agent-tools.js')
  const scopes = read('src/client/components/ai/agent-tool-scopes.js')
  const registry = read('src/client/components/ai/agent-tools.js')

  for (const name of [
    'create_artifact',
    'update_artifact',
    'regenerate_artifact',
    'export_artifact'
  ]) {
    assert.match(tools, new RegExp(`name:\\s*'${name}'`))
    assert.match(scopes, new RegExp(`${name}:\\s*'conversation'`))
  }
  assert.match(registry, /artifactAgentTools/)
  assert.match(registry, /executeArtifactAgentTool/)
})

test('created artifact ids are persisted on the completed chat entry', () => {
  const agent = read('src/client/components/ai/agent.js')

  assert.match(agent, /createdArtifactIds:\s*new Set\(\)/)
  assert.match(agent, /artifactIds:\s*\[\.\.\.agentRuntime\.createdArtifactIds\]/)
})

test('artifact execution observes Agent cancellation', () => {
  const tools = read('src/client/components/ai/artifact-agent-tools.js')

  assert.match(tools, /runtime\.signal/)
  assert.match(tools, /AbortError/)
  assert.match(tools, /createdArtifactIds\.add/)
})
