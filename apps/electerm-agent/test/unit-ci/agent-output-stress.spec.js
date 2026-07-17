const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const observationUrl = pathToFileURL(path.join(aiRoot, 'agent-observation.js')).href
const runtimeUrl = pathToFileURL(path.join(aiRoot, 'agent-runtime-context.js')).href

function largeRuntimeMessages (count, bytes) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'tool',
    tool_call_id: `call-${index}`,
    content: String(index).padStart(4, '0') + 'x'.repeat(bytes)
  }))
}

test('100 MB logs engage backpressure before retaining the whole source', async t => {
  const {
    MAX_AGENT_MODEL_OBSERVATION_BYTES,
    MAX_AGENT_RENDERER_OBSERVATION_BYTES,
    consumeBoundedAgentOutput
  } = await import(observationUrl)
  let chunksProduced = 0
  async function * logs () {
    for (let index = 0; index < 100; index += 1) {
      chunksProduced += 1
      yield Buffer.alloc(1024 * 1024, 0x61)
    }
  }

  const result = await consumeBoundedAgentOutput(logs())
  t.diagnostic(`output-stress ${JSON.stringify({
    sourceBytes: 100 * 1024 * 1024,
    chunksProduced,
    rendererBytes: Buffer.byteLength(result.rendererData),
    modelBytes: Buffer.byteLength(result.modelData)
  })}`)

  assert.equal(result.truncated, true)
  assert.ok(chunksProduced < 100)
  assert.ok(Buffer.byteLength(result.rendererData) <= MAX_AGENT_RENDERER_OBSERVATION_BYTES)
  assert.ok(Buffer.byteLength(result.modelData) <= MAX_AGENT_MODEL_OBSERVATION_BYTES)
  assert.ok(result.nextCursor)
})

test('continuous output cancellation yields promptly and retains no unbounded chunks', async () => {
  const { consumeBoundedAgentOutput } = await import(observationUrl)
  const controller = new AbortController()
  let chunksProduced = 0
  async function * continuous () {
    while (true) {
      chunksProduced += 1
      yield Buffer.alloc(8 * 1024, 0x62)
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  setImmediate(() => controller.abort())

  const startedAt = performance.now()
  await assert.rejects(
    consumeBoundedAgentOutput(continuous(), {
      signal: controller.signal,
      maxRendererBytes: 8 * 1024 * 1024
    }),
    error => error.name === 'AbortError'
  )
  const elapsedMs = performance.now() - startedAt

  assert.ok(chunksProduced < 32, `produced ${chunksProduced} chunks before stop`)
  assert.ok(elapsedMs < 250, `output stop took ${elapsedMs.toFixed(1)} ms`)
})

test('large history sends only capped recent observations to the model', async () => {
  const { buildBoundedAgentMessages } = await import(runtimeUrl)
  const messages = buildBoundedAgentMessages(
    [{ role: 'system', content: 'system' }],
    largeRuntimeMessages(200, 64 * 1024)
  )
  const serialized = JSON.stringify(messages)

  assert.ok(messages.length <= 33)
  assert.ok(serialized.length <= 96 * 1024)
  assert.equal(messages[0].role, 'system')
  assert.ok(messages.at(-1).content.length <= 16 * 1024)
})
