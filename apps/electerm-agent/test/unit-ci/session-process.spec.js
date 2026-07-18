process.env.NODE_ENV = 'development'

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const childProcess = require('node:child_process')

const originalFork = childProcess.fork
const sessionProcessPath = require.resolve('../../src/app/server/session-process')

afterEach(() => {
  childProcess.fork = originalFork
  delete require.cache[sessionProcessPath]
})

test('cleans up the temporary child process when test connection fails', async () => {
  const children = []
  childProcess.fork = () => {
    const child = new EventEmitter()
    child.killed = false
    child.kill = () => {
      child.killed = true
      child.emit('exit')
    }
    child.send = (payload) => {
      if (payload?.data?.action !== 'test-terminal') {
        return
      }
      queueMicrotask(() => {
        child.emit('message', {
          id: payload.data.id,
          error: {
            message: 'SSH 连接失败'
          }
        })
      })
    }
    children.push(child)
    queueMicrotask(() => {
      child.emit('message', { serverInited: true })
    })
    return child
  }

  const { testConnection } = require('../../src/app/server/session-process')

  let error
  await testConnection({
    uid: 'failed-test-connection',
    host: '127.0.0.1',
    port: 22,
    username: 'root'
  }, null, 'request-1')
    .catch(err => {
      error = err
    })

  assert.match(error.message, /SSH 连接失败/)
  assert.equal(children.length, 1)
  assert.equal(children[0].killed, true)
})

test('returns only verified public SSH identity metadata from child creation', async () => {
  const children = []
  childProcess.fork = () => {
    const child = new EventEmitter()
    child.connected = true
    child.kill = () => {
      child.connected = false
      child.emit('exit', 0, null)
    }
    child.send = (payload) => {
      if (payload?.data?.action !== 'create-terminal') return
      queueMicrotask(() => {
        child.emit('message', {
          id: payload.data.id,
          data: {
            pid: 'tab-verified',
            hostKeyFingerprint: 'SHA256:verified-host-key',
            password: 'must-not-cross-process-boundary',
            privateKey: 'must-not-cross-process-boundary'
          }
        })
      })
    }
    children.push(child)
    queueMicrotask(() => child.emit('message', { serverInited: true }))
    return child
  }

  const sessionProcess = require('../../src/app/server/session-process')
  const result = await sessionProcess.terminal({
    uid: 'tab-verified',
    termType: 'ssh',
    host: 'prod.example.com',
    port: 22,
    username: 'deploy'
  }, null, 'request-verified')

  assert.equal(result.pid, 'tab-verified')
  assert.equal(Number.isInteger(result.port), true)
  assert.equal(result.hostKeyFingerprint, 'SHA256:verified-host-key')
  assert.equal(Object.hasOwn(result, 'password'), false)
  assert.equal(Object.hasOwn(result, 'privateKey'), false)

  await sessionProcess.closeTerminal('tab-verified', { timeoutMs: 10 })
  assert.equal(children[0].connected, false)
})
