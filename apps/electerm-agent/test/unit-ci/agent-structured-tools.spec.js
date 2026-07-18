const test = require('node:test')
const assert = require('node:assert/strict')
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
