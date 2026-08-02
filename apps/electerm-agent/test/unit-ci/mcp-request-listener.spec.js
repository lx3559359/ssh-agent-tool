const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const modulePath = path.resolve(
  __dirname,
  '../../src/client/store/mcp-request-listener.js'
)

async function loadModule () {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'MCP request listener lifecycle must be isolated in a testable module'
  )
  const url = pathToFileURL(modulePath)
  url.search = `test=${Date.now()}-${Math.random()}`
  return import(url)
}

function createIpcHarness () {
  const listeners = new Set()
  return {
    listeners,
    ipcOnEvent: (event, listener) => {
      assert.equal(event, 'mcp-request')
      listeners.add(listener)
    },
    ipcOffEvent: (event, listener) => {
      assert.equal(event, 'mcp-request')
      listeners.delete(listener)
    },
    emit: request => {
      for (const listener of [...listeners]) listener({}, request)
    }
  }
}

test('reinstalling the MCP request listener replaces the previous handler', async () => {
  const { installMcpRequestListener } = await loadModule()
  const ipc = createIpcHarness()
  const calls = []

  const first = installMcpRequestListener({
    ...ipc,
    handleToolCall: (...args) => calls.push(['first', ...args])
  })
  const second = installMcpRequestListener({
    ...ipc,
    previousListener: first,
    handleToolCall: (...args) => calls.push(['second', ...args])
  })

  assert.notStrictEqual(second, first)
  assert.equal(ipc.listeners.size, 1)
  ipc.emit({
    requestId: 'request-1',
    action: 'tool-call',
    data: { toolName: 'list_tabs', args: { active: true } }
  })
  assert.deepEqual(calls, [[
    'second',
    'request-1',
    'list_tabs',
    { active: true }
  ]])
})

test('MCP request listener ignores malformed and unrelated events', async () => {
  const { installMcpRequestListener } = await loadModule()
  const ipc = createIpcHarness()
  const calls = []

  installMcpRequestListener({
    ...ipc,
    handleToolCall: (...args) => calls.push(args)
  })

  ipc.emit(undefined)
  ipc.emit({ action: 'status', data: {} })
  ipc.emit({ action: 'tool-call' })
  ipc.emit({ action: 'tool-call', data: { toolName: 'list_tabs' } })
  ipc.emit({ action: 'tool-call', data: { toolName: '' } })
  assert.deepEqual(calls, [])
})
