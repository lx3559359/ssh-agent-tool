const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-structured-tools.js'
)).href

const endpoint = Object.freeze({
  host: 'srv.test',
  port: 22,
  username: 'ops',
  tabId: 'tab-a',
  pid: 'pid-a',
  terminalPid: 'term-a',
  sessionType: 'ssh',
  type: 'ssh',
  hostKeyFingerprint: 'SHA256:abc'
})

test('structured inspection arguments are bounded and reject shell fragments', async () => {
  const { validateStructuredArgs } = await import(moduleUrl)

  assert.throws(
    () => validateStructuredArgs('read_recent_logs', { unit: 'nginx', limit: 0 }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_recent_logs', { unit: 'nginx', limit: 1001 }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_recent_logs', { unit: 'nginx; id', limit: 10 }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_service_status', { service: 'nginx$(id)' }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('verify_listening_port', { port: '22; id' }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_file_range', {
      remotePath: '/var/log/app.log; id',
      offset: 0,
      length: 1024
    }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_file_range', {
      remotePath: '/var/log/app.log',
      offset: -1,
      length: 1024
    }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
  assert.throws(
    () => validateStructuredArgs('read_file_range', {
      remotePath: '/var/log/app.log',
      offset: 0,
      length: 32769
    }),
    error => error.code === 'AGENT_ARGUMENT_INVALID'
  )
})

test('structured inspection commands use fixed templates with validated values', async () => {
  const { buildStructuredCommand } = await import(moduleUrl)

  assert.equal(
    buildStructuredCommand('read_service_status', { service: 'nginx.service' }),
    'systemctl show --no-pager --property=LoadState,ActiveState,SubState,UnitFileState nginx.service'
  )
  assert.equal(
    buildStructuredCommand('read_recent_logs', { unit: 'nginx.service', limit: 25 }),
    'journalctl --no-pager --unit=nginx.service --lines=25 --output=short-iso'
  )
  assert.equal(
    buildStructuredCommand('verify_listening_port', { port: 443, protocol: 'tcp' }),
    "ss -lntp 'sport = :443'"
  )
})

test('structured results are bounded and carry endpoint identity plus cursors', async () => {
  const {
    executeStructuredAgentTool
  } = await import(moduleUrl)
  const commands = []
  const status = await executeStructuredAgentTool({
    toolName: 'read_service_status',
    args: { service: 'nginx' },
    endpoint,
    capturedAt: () => 1000,
    executeCommand: async command => {
      commands.push(command)
      return { exitCode: 0, output: 'ActiveState=active' }
    }
  })

  assert.equal(commands.length, 1)
  assert.equal(status.exitCode, 0)
  assert.equal(status.truncated, false)
  assert.equal(status.nextCursor, null)
  assert.equal(status.capturedAt, 1000)
  assert.deepEqual(status.endpoint, endpoint)

  const file = await executeStructuredAgentTool({
    toolName: 'read_file_range',
    args: { remotePath: '/var/log/app.log', offset: 10, length: 4 },
    endpoint,
    capturedAt: () => 2000,
    readFile: async args => ({
      content: 'data',
      nextOffset: 14,
      hasMore: true,
      ...args
    })
  })

  assert.equal(file.exitCode, 0)
  assert.equal(file.truncated, true)
  assert.equal(file.nextCursor, '14')
  assert.equal(file.capturedAt, 2000)
  assert.deepEqual(file.endpoint, endpoint)
})

test('all command-backed structured reads share one exec adapter and file range stays SFTP-only', async () => {
  const { executeStructuredAgentTool } = await import(moduleUrl)
  const commands = []
  const fileReads = []
  const executeCommand = async command => {
    commands.push(command)
    return { exitCode: 0, output: command }
  }
  const readFile = async args => {
    fileReads.push(args)
    return { content: 'slice', nextOffset: args.offset + args.maxBytes, hasMore: false }
  }

  await executeStructuredAgentTool({
    toolName: 'read_service_status',
    args: { service: 'nginx' },
    endpoint,
    executeCommand,
    readFile
  })
  await executeStructuredAgentTool({
    toolName: 'read_recent_logs',
    args: { unit: 'nginx', limit: 20 },
    endpoint,
    executeCommand,
    readFile
  })
  await executeStructuredAgentTool({
    toolName: 'verify_listening_port',
    args: { port: 443 },
    endpoint,
    executeCommand,
    readFile
  })
  await executeStructuredAgentTool({
    toolName: 'read_file_range',
    args: { remotePath: '/var/log/nginx/error.log', offset: 5, length: 8 },
    endpoint,
    executeCommand,
    readFile
  })

  assert.equal(commands.length, 3)
  assert.equal(fileReads.length, 1)
  assert.deepEqual(fileReads[0], {
    remotePath: '/var/log/nginx/error.log',
    offset: 5,
    maxBytes: 8,
    tabId: undefined
  })
})

test('read_file_range aborts promptly and safely ignores a late SFTP rejection', async () => {
  const { executeStructuredAgentTool } = await import(moduleUrl)
  const controller = new AbortController()
  let rejectRead
  let observedSignal
  const pending = executeStructuredAgentTool({
    toolName: 'read_file_range',
    args: { remotePath: '/var/log/app.log', offset: 0, length: 16 },
    endpoint,
    resolveEndpoint: () => endpoint,
    signal: controller.signal,
    readFile: (_args, options) => {
      observedSignal = options.signal
      return new Promise((_resolve, reject) => { rejectRead = reject })
    }
  })

  controller.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(observedSignal, controller.signal)
  rejectRead(new Error('late SFTP failure'))
  await new Promise(resolve => setImmediate(resolve))
})

test('read_file_range rejects stale evidence when its exact endpoint changes', async () => {
  const { executeStructuredAgentTool } = await import(moduleUrl)
  let current = endpoint
  await assert.rejects(executeStructuredAgentTool({
    toolName: 'read_file_range',
    args: { remotePath: '/var/log/app.log', offset: 0, length: 16 },
    endpoint,
    resolveEndpoint: () => current,
    readFile: async () => {
      current = { ...endpoint, pid: 'pid-b' }
      return { content: 'stale evidence', hasMore: false }
    }
  }), error => error.code === 'SESSION_ENDPOINT_CHANGED')
})

test('ordinary and risk verification file reads share signal and endpoint boundaries', () => {
  const aiRoot = path.resolve(__dirname, '../../src/client/components/ai')
  const source = fs.readFileSync(path.join(aiRoot, 'agent-tools.js'), 'utf8')
  const ordinary = source.slice(
    source.indexOf('async function executeResolvedAgentTool'),
    source.indexOf("case 'send_terminal_command'")
  )
  const verification = source.slice(
    source.indexOf('async function verifyPreparedAgentRisk'),
    source.indexOf('function completePreparedAgentRisk')
  )
  for (const boundary of [ordinary, verification]) {
    assert.match(boundary, /signal:\s*runtime\.signal/)
    assert.match(boundary, /resolveEndpoint:/)
    assert.match(boundary, /mcpSftpReadFile\(fileArgs,\s*\{\s*signal:\s*runtime\.signal\s*\}\)/)
  }

  const mcp = fs.readFileSync(path.resolve(
    aiRoot,
    '../../store/mcp-handler.js'
  ), 'utf8')
  const read = mcp.slice(
    mcp.indexOf('Store.prototype.mcpSftpReadFile'),
    mcp.indexOf('Store.prototype.mcpSftpDel')
  )
  assert.match(read, /options\s*=\s*\{\}/)
  assert.match(read, /assertMcpActive\(options\.signal/)
  assert.match(read, /abortableMcpOperation/)
  assert.ok((read.match(/mcpGetSshSftpRef/g) || []).length >= 2)
  assert.match(read, /SESSION_ENDPOINT_CHANGED/)
})

test('initial structured tool registry exposes only the four bounded diagnostics', async () => {
  const { structuredAgentTools } = await import(moduleUrl)
  assert.deepEqual(
    structuredAgentTools.map(tool => tool.function.name),
    [
      'read_service_status',
      'read_recent_logs',
      'verify_listening_port',
      'read_file_range'
    ]
  )
  for (const tool of structuredAgentTools) {
    assert.equal(tool.type, 'function')
    assert.equal(tool.function.parameters.type, 'object')
  }
})
