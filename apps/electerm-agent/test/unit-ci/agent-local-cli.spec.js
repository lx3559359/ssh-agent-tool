const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const localCliPath = path.resolve(__dirname, '../../src/app/lib/local-cli.js')
const clientLocalCliModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-local-cli-tools.js')
).href
const confirmModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-tool-confirm.js')
).href

test('local CLI runner exposes a controlled allowlist for common ops tools', () => {
  assert.equal(fs.existsSync(localCliPath), true)
  const {
    getAllowedLocalCliTools
  } = require(localCliPath)

  const tools = getAllowedLocalCliTools()
  assert.ok(tools.includes('ssh-keygen'))
  assert.ok(tools.includes('scp'))
  assert.ok(tools.includes('ping'))
  assert.ok(tools.includes('traceroute'))
  assert.ok(tools.includes('kubectl'))
  assert.ok(tools.includes('docker'))
  assert.ok(tools.includes('git'))
  assert.ok(tools.includes('curl'))
  assert.ok(tools.includes('ssh'))
  assert.ok(tools.includes('nslookup'))
  assert.ok(tools.includes('ipconfig'))
  assert.ok(tools.includes('where'))
  assert.equal(tools.includes('powershell'), false)
  assert.equal(tools.includes('cmd'), false)
})

test('local CLI runner rejects tools outside the allowlist', async () => {
  const {
    createLocalCliRunner
  } = require(localCliPath)
  const runner = createLocalCliRunner({
    execFileImpl: () => {
      throw new Error('should not execute')
    }
  })

  const result = await runner({
    tool: 'powershell',
    args: ['-NoProfile']
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /不允许/)
})

test('local CLI runner uses execFile without shell and returns bounded output', async () => {
  const {
    createLocalCliRunner
  } = require(localCliPath)
  const calls = []
  const runner = createLocalCliRunner({
    execFileImpl: (file, args, options, callback) => {
      calls.push({ file, args, options })
      callback(null, 'pong\n'.repeat(2000), '')
    }
  })

  const result = await runner({
    tool: 'ping',
    args: ['127.0.0.1'],
    timeoutMs: 1200
  })

  assert.equal(result.ok, true)
  assert.equal(calls[0].file, 'ping')
  assert.deepEqual(calls[0].args, ['127.0.0.1'])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.timeout, 1200)
  assert.equal(result.stdout.length <= 12000, true)
})

test('Agent local CLI tool requires user confirmation before execution', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const result = await confirmAgentToolExecution({
    toolName: 'run_local_cli',
    args: {
      tool: 'ping',
      args: ['127.0.0.1']
    },
    confirm: message => {
      assert.match(message, /ping 127\.0\.0\.1/)
      return false
    }
  })

  assert.equal(result.accepted, false)
  assert.equal(result.cancelled, true)
})

test('Agent tools expose and route run_local_cli through confirmation and IPC', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.match(source, /name:\s*'run_local_cli'/)
  assert.match(source, /case 'run_local_cli':[\s\S]*confirmAgentToolExecution/)
  assert.match(source, /case 'run_local_cli':[\s\S]*runGlobalAsync\('runLocalCli'/)
})

test('Agent tools expose local CLI discovery without command confirmation', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.match(source, /name:\s*'list_local_cli_tools'/)
  assert.match(source, /case 'list_local_cli_tools':[\s\S]*runGlobalAsync\('getAllowedLocalCliTools'/)
  assert.doesNotMatch(source, /case 'list_local_cli_tools':[\s\S]{0,160}confirmAgentToolExecution/)
})

test('main process exposes runLocalCli through the async IPC allowlist', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(source, /runLocalCli/)
  assert.match(source, /getAllowedLocalCliTools/)
  assert.match(source, /const \{ runLocalCli \} = require\('\.\/local-cli'\)/)
})

test('AI chat exposes a usable local CLI context action', async () => {
  const {
    buildLocalCliContextPrompt
  } = await import(clientLocalCliModuleUrl)
  const prompt = buildLocalCliContextPrompt()
  assert.match(prompt, /ssh-keygen/)
  assert.match(prompt, /kubectl/)
  assert.match(prompt, /用户确认/)

  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )
  assert.match(source, /handleQuoteLocalCliTools/)
  assert.match(source, /buildLocalCliContextPrompt/)
  assert.doesNotMatch(source, /showUnavailableContextAction\('cli'\)/)
})

test('Agent system prompt includes local CLI safety guidance', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
    'utf8'
  )

  assert.match(source, /buildAgentLocalCliPrompt/)
  assert.match(source, /localCliPrompt/)
})
