const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/terminal/ssh-reconnect-policy.js')
).href

test('ssh reconnect policy keeps retrying transient network errors', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('SSH 连接超时：root@10.0.1.23:22'), true)
  assert.equal(shouldRetryAutoReconnectError('connect ECONNREFUSED 10.0.1.23:22'), true)
  assert.equal(shouldRetryAutoReconnectError('read ECONNRESET'), true)
  assert.equal(shouldRetryAutoReconnectError('socket closed'), true)
})

test('ssh reconnect policy stops on credential and configuration errors', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('SSH 认证失败：root@10.0.1.23:22'), false)
  assert.equal(shouldRetryAutoReconnectError('All configured authentication methods failed'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 私钥无法使用：root@10.0.1.23:22'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 主机密钥校验失败'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 目标端口不是 SSH 服务：10.0.1.23:443'), false)
  assert.equal(shouldRetryAutoReconnectError('SSH 算法不兼容'), false)
  assert.equal(shouldRetryAutoReconnectError('no matching key exchange algorithm'), false)
})

test('ssh reconnect policy retries unknown errors to preserve existing reconnect behavior', async () => {
  const { shouldRetryAutoReconnectError } = await import(moduleUrl)

  assert.equal(shouldRetryAutoReconnectError('unexpected terminal session error'), true)
  assert.equal(shouldRetryAutoReconnectError(''), true)
})

class FakeClock {
  now = 0
  nextId = 1
  tasks = new Map()

  setTimeout = (callback, delay) => this.add(callback, delay, 0)
  setInterval = (callback, delay) => this.add(callback, delay, delay)
  clearTimeout = id => this.tasks.delete(id)
  clearInterval = id => this.tasks.delete(id)

  add (callback, delay, repeat) {
    const id = this.nextId++
    this.tasks.set(id, { callback, at: this.now + delay, repeat })
    return id
  }

  tick (duration) {
    const end = this.now + duration
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!due) break
      const [id, task] = due
      this.now = task.at
      if (task.repeat && this.tasks.has(id)) {
        task.at += task.repeat
      } else {
        this.tasks.delete(id)
      }
      task.callback()
    }
    this.now = end
  }
}

test('reconnect scheduler uses bounded 3/6/12/30/30 second backoff', async () => {
  const { createSshReconnectScheduler, SSH_RECONNECT_DELAYS } = await import(moduleUrl)
  const clock = new FakeClock()
  const reconnects = []
  const states = []
  const scheduler = createSshReconnectScheduler({
    clock,
    onReconnect: attempt => reconnects.push(attempt),
    onStateChange: state => states.push(state)
  })

  assert.deepEqual(SSH_RECONNECT_DELAYS, [3000, 6000, 12000, 30000, 30000])
  for (let attempt = 1; attempt <= SSH_RECONNECT_DELAYS.length; attempt++) {
    assert.equal(scheduler.schedule(), true)
    assert.deepEqual(states.at(-1), {
      status: 'waiting',
      attempt,
      maxAttempts: 5,
      countdown: SSH_RECONNECT_DELAYS[attempt - 1] / 1000
    })
    clock.tick(SSH_RECONNECT_DELAYS[attempt - 1])
    assert.deepEqual(reconnects, [attempt])
    reconnects.length = 0
  }

  assert.equal(scheduler.schedule(), false)
  assert.deepEqual(states.at(-1), {
    status: 'failed',
    attempt: 5,
    maxAttempts: 5,
    countdown: null
  })
  clock.tick(60000)
  assert.deepEqual(reconnects, [])
})

test('reconnect scheduler publishes countdown ticks and reset starts again at attempt one', async () => {
  const { createSshReconnectScheduler } = await import(moduleUrl)
  const clock = new FakeClock()
  const states = []
  const scheduler = createSshReconnectScheduler({
    clock,
    onReconnect: () => {},
    onStateChange: state => states.push(state)
  })

  scheduler.schedule()
  clock.tick(1000)
  assert.equal(states.at(-1).countdown, 2)
  clock.tick(1000)
  assert.equal(states.at(-1).countdown, 1)

  scheduler.reset()
  assert.equal(clock.tasks.size, 0)
  scheduler.schedule()
  assert.equal(states.at(-1).attempt, 1)
})

test('stop clears all timers and prevents reload', async () => {
  const { createSshReconnectScheduler } = await import(moduleUrl)
  const clock = new FakeClock()
  let reloads = 0
  const states = []
  const scheduler = createSshReconnectScheduler({
    clock,
    onReconnect: () => { reloads += 1 },
    onStateChange: state => states.push(state)
  })

  scheduler.schedule()
  scheduler.stop()
  assert.equal(clock.tasks.size, 0)
  assert.equal(states.at(-1).status, 'stopped')
  clock.tick(60000)
  assert.equal(reloads, 0)
})

test('reconnect now clears countdown and triggers exactly one reload', async () => {
  const { createSshReconnectScheduler } = await import(moduleUrl)
  const clock = new FakeClock()
  const reconnects = []
  const scheduler = createSshReconnectScheduler({
    clock,
    onReconnect: attempt => reconnects.push(attempt),
    onStateChange: () => {}
  })

  scheduler.schedule()
  assert.equal(scheduler.reconnectNow(), true)
  assert.equal(clock.tasks.size, 0)
  assert.deepEqual(reconnects, [1])
  assert.equal(scheduler.reconnectNow(), false)
  clock.tick(60000)
  assert.deepEqual(reconnects, [1])
})

test('terminal reconnect UI wires attempt actions, failure state, and success reset', () => {
  const terminalSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
    'utf8'
  )
  const overlaySource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/terminal/reconnect-overlay.jsx'),
    'utf8'
  )

  assert.match(terminalSource, /createSshReconnectScheduler/)
  assert.match(terminalSource, /reconnectScheduler\.reset\(\)/)
  assert.match(terminalSource, /onReconnectNow=/)
  assert.match(terminalSource, /onStopReconnect=/)
  assert.match(overlaySource, /立即重连/)
  assert.match(overlaySource, /停止重连/)
  assert.match(overlaySource, /重连失败/)
})
