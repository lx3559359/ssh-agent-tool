const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const observationUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-observation.js'
)).href

test('bounds a 100 MB async source without consuming or retaining it all', async () => {
  const {
    MAX_AGENT_MODEL_OBSERVATION_BYTES,
    MAX_AGENT_RENDERER_OBSERVATION_BYTES,
    consumeBoundedAgentOutput
  } = await import(observationUrl)
  let generatedChunks = 0
  async function * source () {
    const chunk = Buffer.alloc(1024 * 1024, 0x61)
    for (let index = 0; index < 100; index += 1) {
      generatedChunks += 1
      yield chunk
    }
  }

  const result = await consumeBoundedAgentOutput(source(), {
    cursor: '0'
  })

  assert.ok(Buffer.byteLength(result.rendererData) <= MAX_AGENT_RENDERER_OBSERVATION_BYTES)
  assert.ok(Buffer.byteLength(result.modelData) <= MAX_AGENT_MODEL_OBSERVATION_BYTES)
  assert.equal(result.truncated, true)
  assert.ok(Number(result.nextCursor) > 0)
  assert.ok(generatedChunks < 100)
})

test('bounded output consumption responds to cancellation', async () => {
  const { consumeBoundedAgentOutput } = await import(observationUrl)
  const controller = new AbortController()
  let generatedChunks = 0
  async function * source () {
    while (true) {
      generatedChunks += 1
      if (generatedChunks === 2) controller.abort()
      yield Buffer.alloc(1024, 0x61)
    }
  }

  await assert.rejects(
    consumeBoundedAgentOutput(source(), {
      signal: controller.signal,
      maxRendererBytes: 64 * 1024
    }),
    error => error.name === 'AbortError'
  )
  assert.equal(generatedChunks, 2)
})
