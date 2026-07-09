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
  assert.ok(tools.includes('codex'))
  assert.ok(tools.includes('curl'))
  assert.ok(tools.includes('ssh'))
  assert.ok(tools.includes('nslookup'))
  assert.ok(tools.includes('ipconfig'))
  assert.ok(tools.includes('where'))
  assert.equal(tools.includes('powershell'), false)
  assert.equal(tools.includes('cmd'), false)
})

test('Codex CLI status checker reports official CLI availability without reading credentials', async () => {
  const {
    createCodexCliStatusChecker
  } = require(localCliPath)
  const calls = []
  const checker = createCodexCliStatusChecker({
    platform: 'win32',
    execFileImpl: (file, args, options, callback) => {
      calls.push({ file, args, options })
      if (file === 'where.exe') {
        callback(null, 'C:\\Tools\\codex.exe\n', '')
        return
      }
      callback(null, 'codex-cli 0.128.0\n', '')
    }
  })

  const result = await checker()

  assert.equal(result.provider, 'codex')
  assert.equal(result.installed, true)
  assert.equal(result.available, true)
  assert.equal(result.authMode, 'official-cli')
  assert.equal(result.canUseExistingLogin, true)
  assert.match(result.version, /0\.128\.0/)
  assert.equal(calls[0].file, 'where.exe')
  assert.equal(calls[1].file, 'codex')
  assert.equal(calls[1].options.shell, false)

  const source = fs.readFileSync(localCliPath, 'utf8')
  assert.doesNotMatch(source, /auth\.json/)
  assert.doesNotMatch(source, /\.codex[\\/]auth/)
})

test('Codex CLI status checker falls back to the Codex Desktop bundled CLI on Windows', async () => {
  const {
    createCodexCliStatusChecker
  } = require(localCliPath)
  const calls = []
  const checker = createCodexCliStatusChecker({
    platform: 'win32',
    codexDesktopCandidatePaths: ['C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe'],
    execFileImpl: (file, args, options, callback) => {
      calls.push({ file, args, options })
      if (file === 'where.exe') {
        callback(null, 'C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe\n', '')
        return
      }
      if (file === 'codex') {
        const error = new Error('Access is denied')
        error.code = 'EACCES'
        callback(error, '', 'Access is denied')
        return
      }
      callback(null, 'codex-cli 0.142.5\n', '')
    }
  })

  const result = await checker()

  assert.equal(result.installed, true)
  assert.equal(result.available, true)
  assert.equal(result.canUseExistingLogin, true)
  assert.equal(result.installPath, 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe')
  assert.match(result.version, /0\.142\.5/)
  assert.equal(calls[2].file, 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe')
  assert.equal(calls[2].options.shell, false)
})

test('Codex CLI status checker distinguishes installed but unusable clients', async () => {
  const {
    createCodexCliStatusChecker
  } = require(localCliPath)
  const checker = createCodexCliStatusChecker({
    platform: 'win32',
    execFileImpl: (file, args, options, callback) => {
      if (file === 'where.exe') {
        callback(null, 'C:\\WindowsApps\\codex.exe\n', '')
        return
      }
      const error = new Error('Access is denied')
      error.code = 'EACCES'
      callback(error, '', 'Access is denied')
    }
  })

  const result = await checker()

  assert.equal(result.installed, true)
  assert.equal(result.available, false)
  assert.equal(result.canUseExistingLogin, false)
  assert.match(result.error, /Access is denied/)
  assert.match(result.guidance, /Codex CLI/)
})

test('local CLI runner executes codex through the resolved Codex Desktop CLI when needed', async () => {
  const {
    createLocalCliRunner
  } = require(localCliPath)
  const calls = []
  const runner = createLocalCliRunner({
    platform: 'win32',
    codexDesktopCandidatePaths: ['C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe'],
    execFileImpl: (file, args, options, callback) => {
      calls.push({ file, args, options })
      if (file === 'codex' && args[0] === '--version') {
        const error = new Error('Access is denied')
        error.code = 'EACCES'
        callback(error, '', 'Access is denied')
        return
      }
      if (file.endsWith('codex.exe') && args[0] === '--version') {
        callback(null, 'codex-cli 0.142.5\n', '')
        return
      }
      callback(null, 'codex ran\n', '')
    }
  })

  const result = await runner({
    tool: 'codex',
    args: ['--help']
  })

  assert.equal(result.ok, true)
  assert.equal(result.tool, 'codex')
  assert.equal(result.resolvedTool, 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe')
  assert.equal(result.stdout, 'codex ran\n')
  assert.equal(calls.at(-1).file, 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe')
  assert.deepEqual(calls.at(-1).args, ['--help'])
  assert.equal(calls.at(-1).options.shell, false)
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

test('Agent tools expose Codex CLI status discovery without command confirmation', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.match(source, /name:\s*'get_codex_cli_status'/)
  assert.match(source, /case 'get_codex_cli_status':[\s\S]*runGlobalAsync\('getCodexCliStatus'/)
  assert.doesNotMatch(source, /case 'get_codex_cli_status':[\s\S]{0,180}confirmAgentToolExecution/)
})

test('main process exposes runLocalCli through the async IPC allowlist', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/lib/ipc.js'),
    'utf8'
  )

  assert.match(source, /runLocalCli/)
  assert.match(source, /getAllowedLocalCliTools/)
  assert.match(source, /getCodexCliStatus/)
  assert.match(source, /const \{ runLocalCli \} = require\('\.\/local-cli'\)/)
})

test('AI chat exposes a usable local CLI context action', async () => {
  const {
    buildLocalCliContextPrompt
  } = await import(clientLocalCliModuleUrl)
  const prompt = buildLocalCliContextPrompt()
  assert.match(prompt, /ssh-keygen/)
  assert.match(prompt, /Codex CLI/)
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
