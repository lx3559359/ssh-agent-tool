process.env.NODE_ENV = 'development'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const net = require('net')
const globalState = require('../../src/app/server/global-state')
const sessionApi = require('../../src/app/server/session-api')
const { serializeTunnelError } = require('../../src/app/server/ssh-tunnel-runtime')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('session API forwards SSH tunnel operations to the active session', async () => {
  const pid = 'ssh-tunnel-api-session'
  const calls = []
  const tunnel = { id: 'tunnel-local-http' }
  globalState.setSession(pid, {
    startSshTunnel: async value => {
      calls.push(['start', value])
      return { id: value.id, state: 'running' }
    },
    stopSshTunnel: async id => {
      calls.push(['stop', id])
      return { id, state: 'stopped' }
    },
    listSshTunnels: () => {
      calls.push(['list'])
      return [{ id: tunnel.id, state: 'running' }]
    },
    testSshTunnel: async id => {
      calls.push(['test', id])
      return { id, ok: true }
    }
  })

  try {
    assert.deepEqual(
      await sessionApi.startSshTunnel({ pid, tunnel }),
      { id: tunnel.id, state: 'running' }
    )
    assert.deepEqual(
      await sessionApi.stopSshTunnel({ pid, tunnelId: tunnel.id }),
      { id: tunnel.id, state: 'stopped' }
    )
    assert.deepEqual(
      await sessionApi.listSshTunnels({ pid }),
      [{ id: tunnel.id, state: 'running' }]
    )
    assert.deepEqual(
      await sessionApi.testSshTunnel({ pid, tunnelId: tunnel.id }),
      { id: tunnel.id, ok: true }
    )
    assert.deepEqual(calls, [
      ['start', tunnel],
      ['stop', tunnel.id],
      ['list'],
      ['test', tunnel.id]
    ])
  } finally {
    globalState.removeSession(pid)
  }
})

test('all SSH tunnel actions are registered across renderer and process bridges', () => {
  const actions = [
    'ssh-tunnel-start',
    'ssh-tunnel-stop',
    'ssh-tunnel-list',
    'ssh-tunnel-test'
  ]
  const files = [
    'src/client/components/terminal/terminal-apis.js',
    'src/app/server/dispatch-center.js',
    'src/app/server/session-process.js',
    'src/app/server/session-server.js'
  ]

  for (const file of files) {
    const contents = source(file)
    for (const action of actions) {
      assert.match(contents, new RegExp(`['"]${action}['"]`), `${file} must handle ${action}`)
    }
  }
  const terminalApi = source('src/app/server/terminal-api.js')
  for (const name of [
    'startSshTunnel',
    'stopSshTunnel',
    'listSshTunnels',
    'testSshTunnel'
  ]) {
    assert.match(terminalApi, new RegExp(`function ${name} \\(`))
    assert.match(terminalApi, new RegExp(`exports\\.${name} = ${name}`))
  }
})

test('SSH tunnel errors sent to the renderer never expose stack traces', () => {
  const error = new Error('listen EADDRINUSE 127.0.0.1:8080')
  error.code = 'EADDRINUSE'
  error.stack = 'private local stack'

  assert.deepEqual(serializeTunnelError(error), {
    code: 'EADDRINUSE',
    message: 'listen EADDRINUSE 127.0.0.1:8080'
  })
})

test('renderer fetch errors preserve only the SSH tunnel port suggestion fields', () => {
  const contents = source('src/client/common/fetch-from-server.js')

  assert.match(contents, /remoteError\.details/)
  assert.match(contents, /requestedPort/)
  assert.match(contents, /suggestedPort/)
  assert.match(contents, /error\.details/)
  assert.doesNotMatch(contents, /Object\.assign\(error,\s*remoteError/)
})

test('SSH sessions own tunnel runtime lifecycle and close it on disconnect', () => {
  const contents = source('src/app/server/session-ssh.js')
  for (const method of [
    'ensureSshTunnelRuntime',
    'startSshTunnel',
    'stopSshTunnel',
    'listSshTunnels',
    'testSshTunnel',
    'closeAllSshTunnels'
  ]) {
    assert.match(contents, new RegExp(`\\n  (?:async )?${method} \\(`))
  }
  assert.match(
    contents,
    /endConns \(\) \{[\s\S]*closeAllSshTunnels\('ssh-disconnected'\)/
  )
  assert.match(
    contents,
    /kill \(\) \{[\s\S]*closeAllSshTunnels\('session-killed'\)/
  )
})

test('SSH sessions preserve legacy tunnel bookmarks and isolate auto-start selection', () => {
  const { getConfiguredSshTunnels } = require('../../src/app/server/session-ssh')
  const legacy = {
    id: 'server-1',
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080
  }

  assert.deepEqual(getConfiguredSshTunnels(legacy), [{
    id: 'legacy-server-1',
    sshTunnel: 'dynamicForward',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 1080,
    sshTunnelRemoteHost: undefined,
    sshTunnelRemotePort: undefined,
    autoStart: true,
    name: undefined
  }])
  assert.deepEqual(getConfiguredSshTunnels({
    sshTunnels: [
      { id: 'auto', sshTunnel: 'dynamicForward', sshTunnelLocalPort: 1080 },
      { id: 'manual', sshTunnel: 'dynamicForward', sshTunnelLocalPort: 1081, autoStart: false },
      { id: 'invalid', sshTunnel: 'dynamicForward' }
    ]
  }).map(item => item.id), ['auto'])
})

test('SSH session probes the local tunnel endpoint and reports latency', async () => {
  const { TerminalSshBase } = require('../../src/app/server/session-ssh')
  assert.equal(typeof TerminalSshBase, 'function')
  const server = net.createServer(socket => socket.end())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const session = new TerminalSshBase({
    uid: 'ssh-tunnel-probe',
    type: 'ssh'
  })

  try {
    const result = await session.probeSshTunnel({
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: port
    })
    assert.equal(result.ok, true)
    assert.equal(Number.isInteger(result.latencyMs), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('SSH session rejects an occupied local tunnel port before starting its controller', async () => {
  const { TerminalSshBase } = require('../../src/app/server/session-ssh')
  const occupied = net.createServer()
  await new Promise((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(0, '127.0.0.1', resolve)
  })
  const port = occupied.address().port
  const session = new TerminalSshBase({
    uid: 'ssh-tunnel-conflict',
    type: 'ssh'
  })
  let controllerStarted = false
  session.ensureSshTunnelRuntime = () => ({
    start: async () => {
      controllerStarted = true
      return { state: 'running' }
    }
  })

  try {
    await assert.rejects(
      session.startSshTunnel({
        id: 'occupied-local-port',
        sshTunnel: 'forwardLocalToRemote',
        sshTunnelLocalHost: '127.0.0.1',
        sshTunnelLocalPort: port,
        sshTunnelRemoteHost: '127.0.0.1',
        sshTunnelRemotePort: 80
      }),
      error => {
        assert.equal(error.code, 'SSH_TUNNEL_PORT_IN_USE')
        assert.equal(error.details.requestedPort, port)
        assert.equal(typeof error.details.suggestedPort, 'number')
        return true
      }
    )
    assert.equal(controllerStarted, false)
  } finally {
    await new Promise(resolve => occupied.close(resolve))
  }
})

test('SSH shell becomes ready before saved tunnels finish auto-starting', async () => {
  const { TerminalSshBase } = require('../../src/app/server/session-ssh')
  const session = new TerminalSshBase({
    uid: 'ssh-shell-before-tunnels',
    type: 'ssh',
    srcTabId: 'ssh-shell-before-tunnels-tab',
    sshTunnels: [{
      id: 'slow-auto-start',
      sshTunnel: 'dynamicForward',
      sshTunnelLocalPort: 1080,
      autoStart: true
    }]
  })
  let finishTunnel
  let tunnelStarted = false
  session.runTunnel = async tunnel => {
    tunnelStarted = true
    return new Promise(resolve => {
      finishTunnel = () => resolve({ state: 'running', sshTunnel: tunnel })
    })
  }
  session.conn = {
    shell: (window, options, callback) => callback(null, {
      stderr: new EventTarget(),
      on: () => {}
    })
  }
  session.shellWindow = {}
  session.shellOpts = {}
  session.ws = { s: () => {} }

  try {
    const ready = session.onInitSshReady()
    const result = await Promise.race([
      ready.then(() => 'ready'),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 40))
    ])
    assert.equal(result, 'ready')
    assert.equal(tunnelStarted, true)
  } finally {
    finishTunnel?.()
    globalState.removeSession(session.pid)
  }
})
