const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
const presentationUrl = pathToFileURL(path.join(
  aiRoot,
  'agent-tool-presentation.js'
)).href

function endpoint (overrides = {}) {
  return {
    tabId: 'tab-a',
    host: 'srv.test',
    port: 22,
    username: 'root',
    ...overrides
  }
}

function connectedTerminal (overrides = {}) {
  return {
    isSsh: () => true,
    props: { tab: { status: 'success' } },
    term: { buffer: { active: { type: 'normal' } } },
    attachAddon: { _passwordPromptDetected: false },
    getCurrentInput: () => '',
    ...overrides
  }
}

test('builds the exact readonly execution presentation from raw evidence', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)
  const view = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    JSON.stringify({
      endpoint: endpoint(),
      capturedAt: 1000,
      durationMs: 125,
      exitCode: 0,
      truncated: false,
      output: '1: lo'
    })
  )

  assert.deepEqual(view, {
    kind: 'readonly-exec',
    command: 'ip addr',
    tabId: 'tab-a',
    target: 'root@srv.test:22',
    capturedAt: 1000,
    durationMs: 125,
    exitCode: 0,
    truncated: false,
    output: '1: lo'
  })
  assert.equal(Object.isFrozen(view), true)
})

test('builds a bounded running presentation from args and the runtime endpoint', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)
  const view = buildAgentToolPresentation(
    'run_readonly_command',
    { command: ' uname -s ', password: 'must-not-survive' },
    null,
    { endpoint: endpoint() }
  )

  assert.equal(view.kind, 'readonly-exec')
  assert.equal(view.command, 'uname -s')
  assert.equal(view.tabId, 'tab-a')
  assert.equal(view.target, 'root@srv.test:22')
  assert.equal(view.capturedAt, undefined)
  assert.equal(view.error, undefined)
  assert.doesNotMatch(JSON.stringify(view), /password|must-not-survive/)
})

test('preserves sanitized failure evidence for timeout policy endpoint and exec errors', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)

  for (const error of [
    'readonly exec timeout',
    'policy rejected command',
    'session endpoint changed',
    'SSH exec unavailable'
  ]) {
    const view = buildAgentToolPresentation(
      'run_readonly_command',
      { command: 'ip addr' },
      { error },
      { endpoint: endpoint() }
    )
    assert.equal(view.kind, 'readonly-exec')
    assert.equal(view.command, 'ip addr')
    assert.equal(view.tabId, 'tab-a')
    assert.equal(view.target, 'root@srv.test:22')
    assert.equal(view.error, error)
  }
})

test('fails closed for malformed or invalid raw results without projecting arbitrary data', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)
  const malformed = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr', arbitrary: 'args-secret' },
    '{"password":"raw-result-secret"',
    { endpoint: endpoint() }
  )
  const invalid = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    { bookmark: { password: 'bookmark-secret' }, token: 'result-token' },
    { endpoint: endpoint() }
  )

  for (const view of [malformed, invalid]) {
    assert.equal(view.kind, 'readonly-exec')
    assert.equal(view.command, 'ip addr')
    assert.equal(view.tabId, 'tab-a')
    assert.ok(view.error)
    assert.deepEqual(
      Object.keys(view).sort(),
      ['command', 'error', 'kind', 'tabId', 'target']
    )
  }
  assert.doesNotMatch(
    JSON.stringify([malformed, invalid]),
    /raw-result-secret|args-secret|bookmark-secret|result-token|bookmark|password|token/
  )
})

test('keeps nonzero stderr and truncation metadata as readonly evidence', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)
  const view = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'systemctl status nginx' },
    {
      endpoint: endpoint(),
      capturedAt: 2000,
      durationMs: 80,
      exitCode: 7,
      truncated: true,
      stdout: 'partial output',
      stderr: 'permission denied'
    }
  )

  assert.equal(view.exitCode, 7)
  assert.equal(view.truncated, true)
  assert.equal(view.output, 'partial output\npermission denied')
})

test('whitelists presentation fields and bounds sanitized output and errors', async () => {
  const { buildAgentToolPresentation } = await import(presentationUrl)
  const outputSecret = 'output-token-secret'
  const view = buildAgentToolPresentation(
    'run_readonly_command',
    {
      command: 'printf --token command-token-secret',
      password: 'args-password-secret',
      privateKey: 'args-private-key-secret',
      bookmark: { host: 'hidden.example', token: 'bookmark-token-secret' }
    },
    {
      endpoint: {
        ...endpoint(),
        password: 'endpoint-password-secret',
        token: 'endpoint-token-secret',
        privateKey: 'endpoint-private-key-secret',
        bookmark: { password: 'nested-bookmark-secret' }
      },
      capturedAt: 3000,
      durationMs: 12,
      exitCode: 0,
      truncated: false,
      output: `token=${outputSecret}\n${'x'.repeat(100000)}`,
      password: 'result-password-secret',
      completeBookmark: { privateKey: 'result-private-key-secret' }
    }
  )
  const failed = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    { error: `password=error-password-secret\n${'e'.repeat(20000)}` },
    { endpoint: endpoint() }
  )
  const serialized = JSON.stringify({ view, failed })

  assert.deepEqual(Object.keys(view).sort(), [
    'capturedAt',
    'command',
    'durationMs',
    'exitCode',
    'kind',
    'output',
    'tabId',
    'target',
    'truncated'
  ])
  assert.ok(view.output.length <= 32768)
  assert.ok(failed.error.length <= 4096)
  assert.doesNotMatch(serialized, /command-token-secret|args-password-secret|args-private-key-secret/)
  assert.doesNotMatch(serialized, /bookmark-token-secret|endpoint-password-secret|endpoint-token-secret/)
  assert.doesNotMatch(serialized, /endpoint-private-key-secret|nested-bookmark-secret|output-token-secret/)
  assert.doesNotMatch(serialized, /result-password-secret|result-private-key-secret|error-password-secret/)
  assert.doesNotMatch(serialized, /privateKey|completeBookmark|bookmark|token-secret/)
})

test('allows filling only completed readonly evidence into the same idle connected SSH tab', async () => {
  const {
    buildAgentToolPresentation,
    getAgentCommandFillState
  } = await import(presentationUrl)
  const presentation = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    {
      endpoint: endpoint(),
      capturedAt: 1000,
      durationMs: 125,
      exitCode: 0,
      truncated: false,
      output: '1: lo'
    }
  )

  assert.deepEqual(getAgentCommandFillState({
    presentation,
    activeTabId: 'tab-a',
    terminal: connectedTerminal()
  }), { allowed: true, reason: '' })
})

test('rejects stale unsafe busy or incomplete terminal fill states with a reason', async () => {
  const {
    buildAgentToolPresentation,
    getAgentCommandFillState
  } = await import(presentationUrl)
  const completed = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    {
      endpoint: endpoint(),
      capturedAt: 1000,
      durationMs: 125,
      exitCode: 0,
      truncated: false,
      output: '1: lo'
    }
  )
  const running = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    null,
    { endpoint: endpoint() }
  )
  const withoutEndpoint = buildAgentToolPresentation(
    'run_readonly_command',
    { command: 'ip addr' },
    { error: 'SSH exec unavailable' }
  )
  const cases = [
    ['wrong tab', completed, 'tab-b', connectedTerminal()],
    ['disconnected', completed, 'tab-a', connectedTerminal({ props: { tab: { status: 'error' } } })],
    ['not SSH', completed, 'tab-a', connectedTerminal({ isSsh: () => false })],
    ['password prompt', completed, 'tab-a', connectedTerminal({ attachAddon: { _passwordPromptDetected: true } })],
    ['alternate buffer', completed, 'tab-a', connectedTerminal({ term: { buffer: { active: { type: 'alternate' } } } })],
    ['TUI', completed, 'tab-a', connectedTerminal({
      cmdAddon: {
        hasShellIntegration: () => true,
        isCommandInputActive: () => false
      }
    })],
    ['nonempty input', completed, 'tab-a', connectedTerminal({ getCurrentInput: () => 'echo pending' })],
    ['running', running, 'tab-a', connectedTerminal()],
    ['no endpoint', withoutEndpoint, 'tab-a', connectedTerminal()],
    ['empty command', { ...completed, command: '' }, 'tab-a', connectedTerminal()],
    ['wrong presentation', { kind: 'generic', command: 'ip addr', tabId: 'tab-a' }, 'tab-a', connectedTerminal()]
  ]

  for (const [label, presentation, activeTabId, terminal] of cases) {
    const state = getAgentCommandFillState({
      presentation,
      activeTabId,
      terminal
    })
    assert.equal(state.allowed, false, label)
    assert.ok(state.reason, `${label} must expose a reason`)
  }
})

test('readonly tool card keeps evidence primary and rechecks safe input-only fill on click', () => {
  const source = fs.readFileSync(
    path.join(aiRoot, 'agent-tool-call-card.jsx'),
    'utf8'
  )
  const copy = JSON.parse(fs.readFileSync(
    path.join(aiRoot, 'ai-agent-copy.json'),
    'utf8'
  ))

  assert.match(source, /presentation\.kind === 'readonly-exec'/)
  assert.equal(copy.toolCall.readonlyTitle, '只读执行')
  assert.equal(copy.toolCall.copyCommand, '复制命令')
  assert.equal(copy.toolCall.fillTerminal, '填入终端')
  assert.equal(copy.toolCall.truncatedLabel, '截断')
  assert.equal(copy.toolCall.yesLabel, '是')
  assert.equal(copy.toolCall.noLabel, '否')
  assert.match(source, /aiAgentCopy\.toolCall\.readonlyTitle/)
  assert.match(source, /presentation\.command/)
  assert.match(source, /presentation\.target/)
  assert.match(source, /presentation\.durationMs/)
  assert.match(source, /presentation\.exitCode/)
  assert.match(source, /presentation\.truncated/)
  assert.match(source, /presentation\.truncated !== undefined/)
  assert.match(source, /const \[outputExpanded, setOutputExpanded\] = useState\(false\)/)
  assert.match(source, /const \[rawExpanded, setRawExpanded\] = useState\(false\)/)
  assert.match(source, /copy\(presentation\.command\)/)
  assert.ok(
    (source.match(/getAgentCommandFillState\(/g) || []).length >= 2,
    'fill state must be calculated for render and recalculated immediately before click'
  )
  assert.match(source, /window\.store\.mcpSendTerminalCommand\(\{[\s\S]*?command: presentation\.command,[\s\S]*?tabId: presentation\.tabId,[\s\S]*?inputOnly: true,[\s\S]*?title: 'Agent 命令预览'/)
  assert.doesNotMatch(source, /presentation\.command\s*\+\s*['"]\\r/)
  assert.doesNotMatch(source, /presentation\.command\s*\+\s*['"]\\n/)
})
