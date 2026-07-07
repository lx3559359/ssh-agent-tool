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
