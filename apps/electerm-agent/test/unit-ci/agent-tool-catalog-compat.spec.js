import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

const expectedFacadeExports = [
  'agentTools',
  'executeToolCall',
  'failAgentRiskBatch',
  'getAgentToolDescriptor',
  'prepareAgentRiskArgs',
  'prepareAgentRiskBatch',
  'runReadonlyTool'
]

const expectedCatalogDigest = '320d0121d2810149847e7bf0e7e86b65de404f5c99e000051d8b2fc30af6228c'

let server

function normalizeDescriptors (tools) {
  return tools.map(tool => ({
    type: tool.type,
    function: tool.function,
    name: tool.name,
    scope: tool.scope,
    execution: tool.execution,
    outputLimit: tool.outputLimit,
    cancellable: tool.cancellable
  }))
}

function digestDescriptors (tools) {
  return createHash('sha256')
    .update(JSON.stringify(normalizeDescriptors(tools)))
    .digest('hex')
}

before(async () => {
  globalThis.window = {
    translate: value => value,
    store: {}
  }
  server = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true }
  })
})

after(async () => {
  await server?.close()
  delete globalThis.window
})

test('agent tools facade keeps its public exports and descriptor contract', async () => {
  const facade = await server.ssrLoadModule('/src/client/components/ai/agent-tools.js')

  assert.deepEqual(Object.keys(facade).sort(), expectedFacadeExports)
  assert.equal(facade.agentTools.length, 40)
  assert.equal(digestDescriptors(facade.agentTools), expectedCatalogDigest)
})

test('extracted catalog is descriptor-compatible with the facade', async () => {
  const facade = await server.ssrLoadModule('/src/client/components/ai/agent-tools.js')
  const catalog = await server.ssrLoadModule('/src/client/components/ai/agent-tool-catalog.js')

  assert.equal(catalog.agentTools.length, 40)
  assert.deepEqual(
    normalizeDescriptors(catalog.agentTools),
    normalizeDescriptors(facade.agentTools)
  )
  assert.equal(catalog.getAgentToolDescriptor('sftp_list')?.function?.name, 'sftp_list')
  assert.throws(
    () => catalog.getAgentToolDescriptor('missing_tool'),
    error => error?.code === 'UNKNOWN_AGENT_TOOL'
  )
  assert.deepEqual(catalog.getAgentToolDescriptor('list_tabs').scheduling, {
    readonly: true,
    stateful: false,
    parallelSafe: true,
    coalesce: true
  })
  assert.equal(catalog.getAgentToolDescriptor('sftp_list').scheduling, undefined)
})

test('direct module parity keeps focused exports identical to the facade', async () => {
  const facade = await server.ssrLoadModule('/src/client/components/ai/agent-tools.js')
  const risk = await server.ssrLoadModule('/src/client/components/ai/agent-tool-risk-lifecycle.js')
  const execution = await server.ssrLoadModule('/src/client/components/ai/agent-tool-execution.js')

  assert.equal(risk.prepareAgentRiskArgs, facade.prepareAgentRiskArgs)
  assert.equal(risk.prepareAgentRiskBatch, facade.prepareAgentRiskBatch)
  assert.equal(risk.failAgentRiskBatch, facade.failAgentRiskBatch)
  assert.equal(execution.runReadonlyTool, facade.runReadonlyTool)
  assert.equal(execution.executeToolCall, facade.executeToolCall)
})
