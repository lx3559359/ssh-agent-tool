const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-center-operation-tasks.js'
)).href

function transferTask (extra = {}) {
  return {
    id: 'sftp-transfer-one',
    kind: 'sftp-transfer',
    status: 'interrupted',
    title: '上传 /tmp/a.log',
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root'
    },
    progress: {
      transferred: 512,
      total: 1024,
      percent: 50,
      speed: 128,
      etaSeconds: 4
    },
    metadata: {
      transferId: 'one',
      typeFrom: 'local',
      typeTo: 'remote',
      fromPath: 'C:\\logs\\a.log',
      toPath: '/tmp/a.log',
      checkpoint: {
        offset: 512,
        partialPath: '/tmp/.a.log.partial',
        source: { size: 1024 },
        target: { size: 512 }
      }
    },
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:01:00.000Z',
    ...extra
  }
}

test('builds Chinese operation task views for transfer tunnel and AI groups', async () => {
  const {
    buildOperationTaskView,
    operationTaskGroup,
    operationTaskSource,
    operationTaskStatusPresentations
  } = await import(moduleUrl)

  const transfer = transferTask()
  assert.equal(operationTaskGroup(transfer), 'running')
  assert.equal(operationTaskSource(transfer), 'sftp')
  assert.deepEqual(buildOperationTaskView(transfer), {
    id: 'sftp-transfer-one',
    kind: 'sftp-transfer',
    kindLabel: 'SFTP 传输',
    status: 'interrupted',
    statusLabel: '已中断',
    statusColor: 'warning',
    title: '上传 /tmp/a.log',
    endpoint: 'root@prod.example.com:22',
    detail: 'C:\\logs\\a.log → /tmp/a.log',
    progress: transfer.progress,
    updatedAt: transfer.updatedAt,
    events: []
  })

  assert.equal(operationTaskGroup(transferTask({
    kind: 'ssh-tunnel',
    status: 'completed'
  })), 'history')
  assert.equal(operationTaskSource(transferTask({
    kind: 'ssh-tunnel'
  })), 'ssh-tunnel')
  assert.equal(operationTaskSource(transferTask({
    kind: 'ai-file-change'
  })), 'agent')
  assert.equal(operationTaskStatusPresentations.interrupted[0], '已中断')
  assert.equal(operationTaskStatusPresentations.completed[0], '已完成')
})

test('rebuilds an interrupted SFTP transfer only for the same connected endpoint', async () => {
  const {
    buildTransferResumeItem
  } = await import(moduleUrl)
  const task = transferTask()
  const tab = {
    id: 'new-tab',
    type: 'ssh',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    title: '生产服务器'
  }

  const item = buildTransferResumeItem(task, tab)
  assert.equal(item.id, 'one')
  assert.equal(item.tabId, 'new-tab')
  assert.equal(item.checkpoint.offset, 512)
  assert.equal(item.status, 'resuming')
  assert.equal(item.host, 'prod.example.com')

  assert.throws(
    () => buildTransferResumeItem(task, { ...tab, host: 'other.example.com' }),
    error => error.code === 'TRANSFER_RESUME_ENDPOINT_MISMATCH'
  )
  assert.throws(
    () => buildTransferResumeItem(transferTask({
      metadata: {
        ...task.metadata,
        checkpoint: undefined
      }
    }), tab),
    error => error.code === 'TRANSFER_RESUME_CHECKPOINT_MISSING'
  )
})
