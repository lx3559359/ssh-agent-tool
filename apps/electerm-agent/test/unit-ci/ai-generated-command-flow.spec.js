const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const contextPath = path.resolve(
  __dirname,
  '../../src/client/components/ai/ai-ssh-context.js'
)
const moduleUrl = pathToFileURL(contextPath).href

test('AI command run action is limited to supported shell code blocks', async () => {
  const { isShellCodeBlock } = await import(moduleUrl)

  for (const language of [
    'bash',
    'sh',
    'shell',
    'zsh',
    'fish',
    'powershell',
    'ps1',
    'cmd',
    'bat',
    'batch'
  ]) {
    assert.equal(isShellCodeBlock(`language-${language}`), true, language)
  }

  for (const language of ['json', 'yaml', 'javascript', 'python', 'text']) {
    assert.equal(isShellCodeBlock(`language-${language}`), false, language)
  }
  assert.equal(isShellCodeBlock(''), false)
})

test('AI command execution lock prevents duplicate code until released', async () => {
  const {
    acquireAICommandExecutionLock,
    releaseAICommandExecutionLock
  } = await import(moduleUrl)
  const running = new Set()

  assert.equal(acquireAICommandExecutionLock(running, 'pwd'), true)
  assert.equal(acquireAICommandExecutionLock(running, 'pwd'), false)
  assert.equal(acquireAICommandExecutionLock(running, 'whoami'), true)
  releaseAICommandExecutionLock(running, 'pwd')
  assert.equal(acquireAICommandExecutionLock(running, 'pwd'), true)
})

test('confirmed AI commands send, wait, and report against one active tab', async () => {
  const { confirmAndRunAICommand } = await import(moduleUrl)
  const events = []
  const confirmations = []
  const idleResult = {
    tabId: 'tab-active',
    output: 'nginx is running',
    timedOut: false
  }
  const store = {
    activeTabId: 'tab-active',
    runSafetyCommand: async (command, options) => {
      events.push(['safety', command, options])
      store.activeTabId = 'tab-switched-after-send'
      return { sent: true, operationId: 'operation-1' }
    },
    mcpWaitForTerminalIdle: async args => {
      events.push(['wait', args])
      return idleResult
    }
  }

  const accepted = await confirmAndRunAICommand({
    code: '# inspect\nsystemctl status nginx',
    store,
    confirm: message => {
      confirmations.push(message)
      return true
    },
    onResult: payload => events.push(['result', payload])
  })

  assert.equal(accepted, true)
  assert.equal(confirmations.length, 2)
  assert.match(confirmations[1], /\u6700\u8fd1\u7ec8\u7aef\u8f93\u51fa/)
  assert.match(
    confirmations[1],
    /\u5386\u53f2\u547d\u4ee4\u3001\u8def\u5f84\u3001\u4ee4\u724c\u6216\u5176\u4ed6\u654f\u611f\u4fe1\u606f/
  )
  assert.deepEqual(events, [
    ['safety', 'systemctl status nginx', {
      tabId: 'tab-active',
      source: 'agent',
      title: 'AI 代码块'
    }],
    ['wait', {
      tabId: 'tab-active',
      timeout: 30000,
      lines: 100
    }],
    ['result', {
      command: 'systemctl status nginx',
      tabId: 'tab-active',
      result: idleResult
    }]
  ])
})

test('AI command result upload can be declined after execution', async () => {
  const { confirmAndRunAICommand } = await import(moduleUrl)
  const events = []
  let resultConfirmation = ''
  const store = {
    activeTabId: 'tab-active',
    runSafetyCommand: async () => {
      events.push('safety')
      return { sent: true }
    },
    mcpWaitForTerminalIdle: async () => {
      events.push('wait')
      return { output: 'secret-token' }
    }
  }

  const accepted = await confirmAndRunAICommand({
    code: 'env',
    store,
    confirm: () => true,
    confirmResult: message => {
      resultConfirmation = message
      return false
    },
    onResult: () => events.push('result')
  })

  assert.equal(accepted, true)
  assert.match(resultConfirmation, /\u6700\u8fd1\u7ec8\u7aef\u8f93\u51fa/)
  assert.deepEqual(events, ['safety', 'wait'])
})

test('confirmed AI command safely cancels without an active tab', async () => {
  const { confirmAndRunAICommand } = await import(moduleUrl)
  const events = []
  const store = {
    activeTabId: '',
    runSafetyCommand: () => events.push('safety'),
    mcpWaitForTerminalIdle: () => events.push('wait')
  }

  const accepted = await confirmAndRunAICommand({
    code: 'pwd',
    store,
    confirm: () => true,
    onResult: () => events.push('result')
  })

  assert.equal(accepted, false)
  assert.deepEqual(events, [])
})

test('AI command execution summary prompt is Chinese and bounded', async () => {
  const { buildAICommandResultSummaryPrompt } = await import(moduleUrl)
  const prompt = buildAICommandResultSummaryPrompt({
    command: 'systemctl status nginx',
    result: { output: 'x'.repeat(500), timedOut: false },
    maxChars: 80
  })

  assert.match(prompt, /\u8bf7\u603b\u7ed3\u6267\u884c\u7ed3\u679c/)
  assert.match(prompt, /systemctl status nginx/)
  assert.match(prompt, /\u6267\u884c\u7ed3\u679c\u5df2\u622a\u65ad/)
  assert.equal(prompt.includes('x'.repeat(100)), false)
  assert.ok(prompt.length < 500)
})

test('AIOutput only wires shell run actions and submits command results for summary', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-output.jsx'),
    'utf8'
  )

  assert.match(source, /import \{ refsStatic \} from '\.\.\/common\/ref'/)
  assert.match(source, /buildAICommandResultSummaryPrompt/)
  assert.match(source, /onResult:\s*handleCommandResult/)
  assert.match(source, /const runningCommandsRef = useRef\(new Set\(\)\)/)
  assert.match(
    source,
    /if \(!acquireAICommandExecutionLock\(runningCommandsRef\.current, code\)\) \{\s*return/
  )
  assert.match(source, /try \{\s*await confirmAndRunAICommand/)
  assert.match(
    source,
    /catch \(error\) \{\s*window\.store\.onError\(error\)/
  )
  assert.match(
    source,
    /finally \{\s*releaseAICommandExecutionLock\(runningCommandsRef\.current, code\)/
  )
  assert.match(
    source,
    /refsStatic\.get\('AIChat'\)\?\.handleSubmit\(prompt\)/
  )
  assert.match(
    source,
    /\{isShellCodeBlock\(className\) && \(\s*<PlayCircleOutlined/
  )
})
