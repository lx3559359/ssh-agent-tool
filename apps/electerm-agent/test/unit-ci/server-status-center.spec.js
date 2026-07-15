const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

function readSource (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

test('topbar exposes a read-only server status center for connected SSH sessions', () => {
  const topbar = readSource('src/client/components/main/aigshell-topbar.jsx')

  assert.match(topbar, /ServerStatusModal/)
  assert.match(topbar, /服务器状态/)
  assert.match(topbar, /serverStatusAvailable/)
  assert.match(topbar, /disabled: !serverStatusAvailable/)
  assert.match(topbar, /item\.disabled/)
  assert.match(topbar, /from 'manate\/react'/)
  assert.match(topbar, /export default auto\(function AIGShellTopBar/)
  assert.match(topbar, /store\.tabs\.find\(tab => tab\.id === store\.activeTabId\)/)
})

test('server status center uses the approved independent wide-panel layout', () => {
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')
  const style = readSource('src/client/components/server-status/server-status-modal.styl')

  assert.match(modal, /runServerStatusProbes/)
  assert.match(modal, /groupServerPlatforms/)
  assert.match(modal, /服务器状态中心/)
  assert.match(modal, /平台与服务/)
  assert.match(modal, /防火墙与安全/)
  assert.match(modal, /原始结果/)
  assert.match(modal, /刷新检测/)
  assert.match(modal, /发送给 AI/)
  assert.match(modal, /识别规则/)
  assert.match(modal, /normalizePlatformRules/)
  assert.match(modal, /safeSetItemJSON/)
  assert.doesNotMatch(modal, /setInterval/)
  assert.match(style, /max-height/)
  assert.match(style, /overflow-y auto/)
  assert.match(style, /@media/)
})

test('server status scan requires a live matching SSH terminal', () => {
  const modal = readSource('src/client/components/server-status/server-status-modal.jsx')

  assert.match(modal, /refs\.get\('term-'/)
  assert.match(modal, /terminal\.isSsh/)
  assert.match(modal, /terminal\.pid/)
  assert.match(modal, /host/)
  assert.match(modal, /port/)
  assert.match(modal, /username/)
  assert.match(modal, /runCmd\(terminal\.pid, command, options\)/)
})

test('terminal run-cmd transports safety execution options to the SSH layer', () => {
  const clientApi = readSource('src/client/components/terminal/terminal-apis.js')
  const terminalApi = readSource('src/app/server/terminal-api.js')
  const sessionProcess = readSource('src/app/server/session-process.js')
  const sessionApi = readSource('src/app/server/session-api.js')
  const sessionCommon = readSource('src/app/server/session-common.js')

  assert.match(clientApi, /timeoutMs/)
  assert.match(clientApi, /maxOutputBytes/)
  assert.match(clientApi, /executionId/)
  assert.match(terminalApi, /term\.runCmd\(cmd, id, \{/)
  assert.match(sessionProcess, /action: 'cancel-run-cmd'/)
  assert.match(sessionApi, /term\.runCmd\(cmd, undefined, \{/)
  assert.match(sessionApi, /term\.cancelRunCmd\(executionId\)/)
  assert.match(sessionCommon, /stream\.(?:close|destroy)\(\)/)
  assert.match(sessionCommon, /RunCmdTimeoutError/)
})

test('SSH command timeout closes the underlying exec stream', async () => {
  const { commonExtends } = require(path.resolve(
    __dirname,
    '../../src/app/server/session-common.js'
  ))
  let closed = false
  class FakeSession {}
  commonExtends(FakeSession)
  const session = new FakeSession()
  session.initOptions = {}
  session.client = {
    exec: (command, options, callback) => {
      const stream = new EventEmitter()
      stream.close = () => {
        closed = true
        stream.emit('close', null, 'TERM')
      }
      callback(null, stream)
    }
  }

  await assert.rejects(
    session.runCmd('sleep 60', undefined, { timeoutMs: 10 }),
    error => error.name === 'RunCmdTimeoutError'
  )
  assert.equal(closed, true)
})
