const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const gateUrl = pathToFileURL(path.join(aiRoot, 'agent-takeover-gate.js')).href
const scopesUrl = pathToFileURL(path.join(aiRoot, 'agent-tool-scopes.js')).href
const runtimeUrl = pathToFileURL(path.join(aiRoot, 'agent-runtime-context.js')).href
const agentToolsPath = path.join(aiRoot, 'agent-tools.js')

function endpoint (overrides = {}) {
  return {
    host: 'srv.test',
    port: 22,
    username: 'ops',
    tabId: 'tab-a',
    pid: 'pid-a',
    terminalPid: 'terminal-a',
    sessionType: 'ssh',
    hostKeyFingerprint: 'SHA256:abc',
    ...overrides
  }
}

test('assigns one valid scope to every exported Agent tool descriptor', async () => {
  const {
    AGENT_TOOL_SCOPES,
    VALID_AGENT_TOOL_SCOPES,
    withAgentToolScopes
  } = await import(scopesUrl)
  const source = fs.readFileSync(agentToolsPath, 'utf8')
  const names = [...source.matchAll(/name:\s*'([^']+)'/g)].map(match => match[1])

  assert.deepEqual(Object.keys(AGENT_TOOL_SCOPES).sort(), [...names].sort())
  const descriptors = withAgentToolScopes(names.map(name => ({
    type: 'function',
    function: { name }
  })))
  for (const descriptor of descriptors) {
    assert.equal(
      VALID_AGENT_TOOL_SCOPES.includes(descriptor.scope),
      true,
      `${descriptor.function.name} has a valid scope`
    )
  }
})

test('conversation tools execute while takeover is off', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)
  let calls = 0
  const result = await executeAgentToolWithGate({
    descriptor: { scope: 'conversation' },
    execute: () => {
      calls += 1
      return 'conversation-result'
    }
  })

  assert.equal(result, 'conversation-result')
  assert.equal(calls, 1)
})

test('all session scopes fail before their executor runs when takeover is off', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)

  for (const scope of ['session-read', 'session-write', 'session-control']) {
    let calls = 0
    const registry = {
      assertActive: () => {
        const error = new Error('inactive')
        error.code = 'AI_TAKEOVER_REQUIRED'
        throw error
      }
    }
    await assert.rejects(
      executeAgentToolWithGate({
        descriptor: { scope },
        endpoint: endpoint(),
        registry,
        execute: () => {
          calls += 1
        }
      }),
      error => error.code === 'AI_TAKEOVER_REQUIRED',
      scope
    )
    assert.equal(calls, 0, `${scope} executor must not run`)
  }
})

test('active exact-session grant invokes one executor once', async () => {
  const { executeAgentToolWithGate } = await import(gateUrl)
  const expected = endpoint()
  let assertedEndpoint
  let calls = 0
  const result = await executeAgentToolWithGate({
    descriptor: { scope: 'session-read' },
    endpoint: expected,
    registry: {
      assertActive: value => {
        assertedEndpoint = value
        return { state: 'active-idle' }
      }
    },
    execute: async () => {
      calls += 1
      return 'remote-result'
    }
  })

  assert.equal(result, 'remote-result')
  assert.equal(calls, 1)
  assert.equal(assertedEndpoint, expected)
})

test('runtime endpoint resolver revalidates complete current SSH identity', async () => {
  const {
    resolveAgentExecutionEndpoint,
    resolveAgentRuntimeEndpoint
  } = await import(runtimeUrl)
  const expected = endpoint()
  const refs = new Map([[
    'term-tab-a',
    {
      isSsh: () => true,
      getTerminalSafetyEndpoint: () => ({ ...expected })
    }
  ]])

  assert.deepEqual(resolveAgentRuntimeEndpoint('tab-a', { refs }), expected)
  assert.deepEqual(resolveAgentExecutionEndpoint({
    descriptor: { scope: 'session-read' },
    runtime: {
      endpoint: expected,
      resolveEndpoint: () => ({ ...expected })
    }
  }), expected)
  assert.equal(resolveAgentRuntimeEndpoint('global', { refs }), null)
  assert.equal(resolveAgentRuntimeEndpoint('missing', { refs }), null)
  assert.equal(resolveAgentExecutionEndpoint({
    descriptor: { scope: 'conversation' },
    runtime: {}
  }), null)
  assert.throws(
    () => resolveAgentExecutionEndpoint({
      descriptor: { scope: 'session-read' },
      runtime: {
        endpoint: expected,
        resolveEndpoint: () => endpoint({ hostKeyFingerprint: 'SHA256:replacement' })
      }
    }),
    error => error.code === 'AI_TAKEOVER_REQUIRED'
  )
})

test('the single tool entrypoint resolves a descriptor before the guarded switch', () => {
  const source = fs.readFileSync(agentToolsPath, 'utf8')
  const entrypoint = source.slice(source.indexOf('export async function executeToolCall'))

  assert.match(source, /withAgentToolScopes\(\[/)
  assert.match(source, /function executeResolvedAgentTool/)
  assert.match(entrypoint, /getAgentToolDescriptor\(toolName\)/)
  assert.match(entrypoint, /resolveAgentExecutionEndpoint/)
  assert.match(entrypoint, /executeAgentToolWithGate/)
  assert.doesNotMatch(entrypoint, /switch\s*\(toolName\)/)
})
