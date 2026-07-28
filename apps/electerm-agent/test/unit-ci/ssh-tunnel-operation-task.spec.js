const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ssh-tunnel/ssh-tunnel-operation-task.js'
)).href

function tunnel (state, extra = {}) {
  return {
    id: 'tunnel-one',
    state,
    startedAt: 1785225600000,
    definition: {
      id: 'tunnel-one',
      name: 'Web 预览',
      sshTunnel: 'forwardLocalToRemote',
      localPort: 8080,
      remoteHost: '127.0.0.1',
      remotePort: 80
    },
    events: [
      {
        at: 1785225601000,
        state,
        code: `SSH_TUNNEL_${state.toUpperCase()}`,
        message: state
      }
    ],
    ...extra
  }
}

test('persists tunnel health changes and disconnect history without blocking runtime', async () => {
  const {
    createSshTunnelOperationTaskTracker
  } = await import(moduleUrl)
  const records = new Map()
  let patchCount = 0
  const saveTask = async task => {
    records.set(task.id, structuredClone(task))
    return task
  }
  const patchTask = async (id, patch) => {
    patchCount += 1
    const current = records.get(id)
    records.set(id, {
      ...current,
      ...patch,
      metadata: {
        ...current.metadata,
        ...patch.metadata
      }
    })
    return records.get(id)
  }
  const tracker = createSshTunnelOperationTaskTracker({
    saveTask,
    patchTask
  })
  const session = {
    pid: 'ssh-pid-one',
    host: 'prod.example.com',
    port: 22,
    username: 'root'
  }

  await tracker.sync(session, [tunnel('healthy')])
  const [taskId] = records.keys()
  assert.match(taskId, /^ssh-tunnel-/)
  assert.equal(records.get(taskId).status, 'running')
  assert.equal(records.get(taskId).metadata.health, 'healthy')
  assert.equal(patchCount, 0)

  await tracker.sync(session, [tunnel('healthy')])
  assert.equal(
    patchCount,
    0,
    '相同健康快照不应每轮重复写入任务数据库'
  )

  await tracker.sync(session, [tunnel('session-lost')])
  assert.equal(patchCount, 1)
  assert.equal(records.get(taskId).status, 'interrupted')
  assert.equal(records.get(taskId).metadata.events.at(-1).code, 'SSH_TUNNEL_SESSION-LOST')

  await tracker.sync(session, [tunnel('healthy')])
  assert.equal(records.get(taskId).status, 'running')
  assert.equal(records.get(taskId).metadata.health, 'healthy')

  await tracker.stopped(session, tunnel('stopped'))
  assert.equal(records.get(taskId).status, 'completed')
  assert.equal(records.get(taskId).metadata.health, 'stopped')
})
