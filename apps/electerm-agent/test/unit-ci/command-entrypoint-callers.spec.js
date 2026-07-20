const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const agentTerminalUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-terminal-command.js'
)).href
const zmodemSafetyUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/store/mcp-zmodem-safety.js'
)).href
const modelsUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/models.js'
)).href
const submissionHooksUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions/command-submission-hooks.js'
)).href

function readClientSource (relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../src/client', relativePath),
    'utf8'
  )
}

test('Agent terminal commands use the safety entrypoint and preserve idle results', async () => {
  const { runAgentTerminalCommand } = await import(agentTerminalUrl)
  const calls = []
  const idle = { output: 'ok', timedOut: false, tabId: 'tab-1' }
  const traceContext = {
    traceId: 'sp-1784304000000-12345678',
    taskId: 'agent-task-1',
    module: 'ai',
    action: 'agent-run'
  }
  const store = {
    activeTabId: 'tab-1',
    async runSafetyCommand (command, options) {
      calls.push(['safety', command, options])
      return { sent: true, operationId: 'operation-1' }
    },
    async mcpWaitForTerminalIdle (options) {
      calls.push(['wait', options])
      return idle
    }
  }

  const result = await runAgentTerminalCommand({
    store,
    args: { command: 'uptime', traceContext }
  })

  assert.deepEqual(result, idle)
  assert.deepEqual(calls, [
    ['safety', 'uptime', {
      tabId: 'tab-1',
      source: 'agent',
      title: 'Agent 终端命令',
      traceContext
    }],
    ['wait', {
      tabId: 'tab-1',
      timeout: 30000,
      lines: 100
    }]
  ])
})

test('Agent safety cancellation never waits for terminal output', async () => {
  const { runAgentTerminalCommand } = await import(agentTerminalUrl)
  let waits = 0
  const result = await runAgentTerminalCommand({
    store: {
      activeTabId: 'tab-1',
      runSafetyCommand: async () => ({ sent: false, cancelled: true }),
      mcpWaitForTerminalIdle: async () => { waits += 1 }
    },
    args: { command: 'custom-mutate target' }
  })

  assert.equal(result.cancelled, true)
  assert.equal(waits, 0)
})

test('Zmodem download quotes remote paths and rejects newline or NUL injection', async () => {
  const { buildZmodemDownload } = await import(zmodemSafetyUrl)
  const quote = String.fromCharCode(39)
  const malicious = `/tmp/report${quote}; touch /tmp/pwned; printf ${quote}`
  const built = buildZmodemDownload({
    protocol: 'rzsz',
    saveFolder: 'C:\\downloads',
    remoteFiles: [malicious, '/tmp/normal file.txt']
  })

  assert.equal(
    built.command,
    `sz -- ${quote}/tmp/report${quote}"${quote}"${quote}; touch /tmp/pwned; printf ${quote}"${quote}"${quote}${quote} ${quote}/tmp/normal file.txt${quote}`
  )
  assert.throws(() => buildZmodemDownload({
    saveFolder: 'C:\\downloads',
    remoteFiles: ['/tmp/good\nrm -rf /']
  }), /换行|NUL|路径/)
  assert.throws(() => buildZmodemDownload({
    saveFolder: 'C:\\downloads',
    remoteFiles: ['/tmp/good\0bad']
  }), /换行|NUL|路径/)
})

test('Zmodem upload and download submit their real commands through safety classification', async () => {
  const {
    runZmodemUploadSafety,
    runZmodemDownloadSafety
  } = await import(zmodemSafetyUrl)
  const { buildSafetyRequest } = await import(modelsUrl)
  const { resolveInternalSubmissionHooks } = await import(submissionHooksUrl)
  const calls = []
  const selections = []
  const store = {
    activeTabId: 'tab-1',
    tabs: [{ id: 'tab-1' }],
    async runSafetyCommand (command, options) {
      calls.push({ command, options })
      return { sent: true, operationId: `operation-${calls.length}` }
    }
  }

  const upload = await runZmodemUploadSafety({
    store,
    args: { protocol: 'trzsz', files: ['C:\\tmp\\a.txt'] },
    setSelectedFiles: files => selections.push(files)
  })
  const download = await runZmodemDownloadSafety({
    store,
    args: {
      protocol: 'rzsz',
      saveFolder: 'C:\\downloads',
      remoteFiles: ['/tmp/a;echo injected']
    },
    setSelectedFolder: folder => selections.push(folder)
  })

  assert.equal(upload.success, true)
  assert.equal(download.success, true)
  assert.equal(calls[0].command, 'trz')
  assert.equal(calls[0].options.metadata.remoteLandingKnown, false)
  assert.equal(calls[1].command, "sz -- '/tmp/a;echo injected'")
  assert.deepEqual(calls.map(call => call.options.source), ['agent', 'agent'])
  assert.equal(buildSafetyRequest({
    source: 'agent',
    endpoint: { host: 'example.com', username: 'root' },
    command: calls[0].command
  }).risk, 'unknown')
  assert.notEqual(buildSafetyRequest({
    source: 'agent',
    endpoint: { host: 'example.com', username: 'root' },
    command: calls[1].command
  }).risk, 'readonly')
  assert.deepEqual(selections, [undefined, undefined])

  const uploadHooks = resolveInternalSubmissionHooks(
    calls[0].options.submissionHooks
  )
  const downloadHooks = resolveInternalSubmissionHooks(
    calls[1].options.submissionHooks
  )
  assert.equal(typeof uploadHooks.beforeSubmit, 'function')
  assert.equal(typeof uploadHooks.onAbort, 'function')
  uploadHooks.beforeSubmit()
  downloadHooks.beforeSubmit()
  assert.deepEqual(selections.slice(-2), [
    ['C:\\tmp\\a.txt'],
    'C:\\downloads'
  ])
  uploadHooks.onAbort()
  downloadHooks.onAbort()
  assert.deepEqual(selections.slice(-2), [undefined, undefined])
})

test('Zmodem safety cancellation leaves no control selection for a later manual transfer', async () => {
  const { runZmodemUploadSafety } = await import(zmodemSafetyUrl)
  const selections = []
  const result = await runZmodemUploadSafety({
    store: {
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1' }],
      runSafetyCommand: async () => ({ sent: false, cancelled: true })
    },
    args: { files: ['C:\\tmp\\cancelled.txt'] },
    setSelectedFiles: files => selections.push(files)
  })

  assert.equal(result.cancelled, true)
  assert.deepEqual(selections, [undefined, undefined])
})

test('quick, AI, Agent and MCP callers contain no naked terminal command send', () => {
  const quick = readClientSource('store/quick-command.js')
  const ai = readClientSource('components/ai/ai-ssh-context.js')
  const agent = readClientSource('components/ai/agent-tools.js')
  const mcp = readClientSource('store/mcp-handler.js')

  assert.match(quick, /Store\.prototype\.runSafetyCommand/)
  assert.match(quick, /term\?\.runSafetyCommand/)
  assert.match(quick, /runSafetyCommandSequence/)
  assert.match(quick, /return store\.runQuickCommand/)
  assert.match(ai, /store\?\.runSafetyCommand/)
  assert.doesNotMatch(ai, /mcpSendTerminalCommand/)
  assert.match(agent, /runAgentTerminalCommand/)
  assert.doesNotMatch(
    agent.match(/case 'send_terminal_command':[\s\S]*?case 'get_terminal_output'/)?.[0] || '',
    /mcpSendTerminalCommand|_sendData/
  )
  assert.match(mcp, /Store\.prototype\.mcpSendTerminalCommand = async/)
  assert.match(mcp, /await store\.runSafetyCommand/)
  const background = mcp.match(
    /Store\.prototype\.mcpRunBackgroundCommand[\s\S]*?Store\.prototype\.mcpGetBackgroundTaskStatus/
  )?.[0] || ''
  assert.match(background, /executionMode:\s*'background'/)
  assert.doesNotMatch(background, /btoa|nohup|submittedCommand|mcpSendTerminalCommand/)
  assert.match(mcp, /createBackgroundTaskRegistry/)
  assert.match(background, /finalize:\s*submission\.finalizeBackground/)
  assert.match(background, /cancel:\s*submission\.cancelBackground/)
  assert.match(background, /completion:\s*submission\.completion/)
  assert.match(mcp, /backgroundTasks\.status\(args\.taskId\)/)
  assert.match(mcp, /backgroundTasks\.cancel\(args\.taskId\)/)
  const monitor = mcp.match(
    /async function runMonitorCmd[\s\S]*?const backgroundTasks/
  )?.[0] || ''
  assert.match(monitor, /refs\.get\('term-' \+ tabId\)/)
  assert.match(monitor, /runCmd\(term\.pid,\s*cmd,\s*\{[\s\S]*?timeoutMs:\s*5000[\s\S]*?maxOutputBytes:\s*4096/)
  assert.doesNotMatch(monitor, /mcpSendTerminalCommand|mcpWaitForTerminalIdle/)
  const zmodem = mcp.match(
    /Store\.prototype\.mcpZmodemUpload[\s\S]*?^}/m
  )?.[0] || ''
  assert.doesNotMatch(zmodem, /term\.runQuickCommand/)
})

test('new quick command execution does not create legacy localStorage records', () => {
  const source = readClientSource(
    'components/quick-commands/quick-commands-box.jsx'
  )
  const start = source.indexOf('function handlePendingOk ()')
  const end = source.indexOf('function handleClose ()', start)
  const body = source.slice(start, end)

  assert.notEqual(start, -1)
  assert.doesNotMatch(body, /createQuickCommandSafetyRecord|saveRollbackRecord/)
  assert.match(source, /readSafetyOperationRecords/)
  assert.match(source, /handleRollbackAction/)
})

test('footer and batch operation commands have no raw terminal send path', () => {
  const footer = readClientSource('components/footer/footer-entry.jsx')
  const terminal = readClientSource('components/terminal/terminal.jsx')
  const batchRunner = readClientSource('components/batch-op/batch-op-runner.jsx')
  const commonStore = readClientSource('store/common.js')

  assert.match(footer, /runBatchSafetyCommand/)
  assert.doesNotMatch(
    footer.match(/function batchInput[\s\S]*?function handleSwitchEncoding/)?.[0] || '',
    /term\?\.batchInput|_sendData|runQuickCommand/
  )
  assert.match(
    terminal.match(/batchInput = \(cmd\)[\s\S]*?onResizeTerminal/)?.[0] || '',
    /runSafetyCommand/
  )
  assert.doesNotMatch(
    terminal.match(/batchInput = \(cmd\)[\s\S]*?onResizeTerminal/)?.[0] || '',
    /_sendData|runQuickCommand/
  )
  assert.match(terminal, /cancelCurrentExecution\([\s\S]*?终端已切换/)
  assert.match(
    readClientSource('components/terminal/terminal-command-safety-modal.jsx'),
    /shellpilotCommandRetry[\s\S]*?shellpilotCommandPrepareRetry/
  )
  const commandStep = batchRunner.match(
    /async _batchStepCommand[\s\S]*?async _batchStepSftpUpload/
  )?.[0] || ''
  assert.match(commandStep, /runSafetyCommand/)
  assert.match(commandStep, /waitForSafetyCompletion/)
  assert.doesNotMatch(commandStep, /runQuickCommand|_sendData/)
  assert.doesNotMatch(
    commonStore.match(/Store\.prototype\.runCommandInTerminal[\s\S]*?Store\.prototype\.removeAiHistory/)?.[0] || '',
    /runQuickCommand|_sendData/
  )
})
