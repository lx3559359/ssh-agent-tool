const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

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

test('artifact IPC converts observable tool arguments into cloneable JSON values', async t => {
  const calls = []
  global.window = {
    pre: {
      runGlobalAsync: async (method, ...args) => {
        calls.push({
          method,
          args: structuredClone(args)
        })
        return {
          ok: true,
          value: { id: 'artifact-proxy-safe' }
        }
      }
    }
  }
  t.after(() => {
    delete global.window
  })

  const moduleUrl = pathToFileURL(path.join(
    root,
    'src/client/components/artifacts/artifact-client.js'
  ))
  moduleUrl.searchParams.set('test', String(Date.now()))
  const { createArtifact } = await import(moduleUrl.href)
  const draft = new Proxy({
    schemaVersion: 1,
    type: 'incident-review',
    title: '故障复盘报告',
    server: 'prod-01',
    summary: '只读排查结论',
    sections: [],
    tables: [],
    risks: [],
    recommendations: []
  }, {})
  const provenance = new Proxy({
    source: 'ai-agent',
    traceId: 'trace-proxy'
  }, {})

  const result = await createArtifact(draft, provenance)

  assert.equal(result.id, 'artifact-proxy-safe')
  assert.deepEqual(calls, [{
    method: 'createAIArtifact',
    args: [
      {
        schemaVersion: 1,
        type: 'incident-review',
        title: '故障复盘报告',
        server: 'prod-01',
        summary: '只读排查结论',
        sections: [],
        tables: [],
        risks: [],
        recommendations: []
      },
      {
        source: 'ai-agent',
        traceId: 'trace-proxy'
      }
    ]
  }])
})
