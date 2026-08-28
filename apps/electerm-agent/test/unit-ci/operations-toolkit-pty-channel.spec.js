const test = require('node:test')
const assert = require('node:assert/strict')
const { importModule } = require('./helpers/import-esm')

const endpoint = Object.freeze({
  tabId: 'tab-1',
  pid: 88,
  terminalPid: 88,
  sessionType: 'ssh',
  host: 'example.com',
  port: 22,
  username: 'hik',
  connectionUsername: 'hik',
  sshSessionGeneration: 'ssh-generation-1',
  hostKeyFingerprint: 'SHA256:fixture'
})

function createTerminal (overrides = {}) {
  const calls = []
  const terminal = {
    pid: 88,
    isSsh: () => true,
    getTerminalSafetyEndpoint: () => ({ ...endpoint }),
    acquireOperationsPtyTask: async owner => {
      calls.push(owner)
      return {
        execute: async () => ({
          exitCode: 0,
          identity: { uid: '0', username: 'root' }
        }),
        release: async () => true
      }
    },
    ...overrides
  }
  return { terminal, calls }
}

test('PTY channel acquires the exact live SSH terminal without SSH exec', async () => {
  const { createPtyTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-channel.js'
  )
  const { terminal, calls } = createTerminal()
  const channel = createPtyTaskChannel({
    getTerminal: id => id === endpoint.tabId ? terminal : null
  })

  const lease = await channel.acquire({ endpoint, taskId: 'operations-1' })

  assert.deepEqual(await lease.execute({ script: 'id' }), {
    exitCode: 0,
    identity: { uid: '0', username: 'root' }
  })
  assert.deepEqual(calls, ['operations-1'])
  assert.equal(await lease.release(), true)
})

test('PTY channel rejects every incomplete or changed session identity before acquire', async () => {
  const { createPtyTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-channel.js'
  )
  const changedValues = {
    tabId: 'tab-2',
    pid: 89,
    terminalPid: 89,
    sessionType: 'local',
    host: 'other.example.com',
    port: 2222,
    username: 'other',
    connectionUsername: 'other',
    sshSessionGeneration: 'ssh-generation-2',
    hostKeyFingerprint: 'SHA256:other'
  }

  for (const [field, changed] of Object.entries(changedValues)) {
    const { terminal, calls } = createTerminal()
    const terminals = new Map([
      [endpoint.tabId, terminal],
      ['tab-2', terminal]
    ])
    const channel = createPtyTaskChannel({
      getTerminal: id => terminals.get(id) || null
    })
    await assert.rejects(
      channel.acquire({
        endpoint: { ...endpoint, [field]: changed },
        taskId: `changed-${field}`
      }),
      /端点|会话|SSH|登录用户/
    )
    assert.deepEqual(calls, [], field)
  }

  for (const field of Object.keys(changedValues)) {
    const { terminal, calls } = createTerminal()
    const channel = createPtyTaskChannel({ getTerminal: () => terminal })
    const incomplete = { ...endpoint }
    delete incomplete[field]
    await assert.rejects(
      channel.acquire({ endpoint: incomplete, taskId: `missing-${field}` }),
      /不完整/
    )
    assert.deepEqual(calls, [], field)
  }
})

test('PTY channel rejects a non-SSH terminal or unsupported terminal API', async () => {
  const { createPtyTaskChannel } = await importModule(
    'src/client/components/operations-toolkit/runtime/pty-task-channel.js'
  )
  for (const terminal of [
    null,
    createTerminal({ isSsh: () => false }).terminal,
    createTerminal({ acquireOperationsPtyTask: undefined }).terminal
  ]) {
    const channel = createPtyTaskChannel({ getTerminal: () => terminal })
    await assert.rejects(
      channel.acquire({ endpoint, taskId: 'unsupported' }),
      /不支持受控 PTY/
    )
  }
})
