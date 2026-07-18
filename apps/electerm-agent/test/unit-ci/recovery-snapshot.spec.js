const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  createRecoverySnapshotManager
} = require('../../src/app/lib/quality/recovery-snapshot')

function createStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-recovery-'))
  return {
    dir,
    storagePath: path.join(dir, 'recovery-snapshot.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  }
}

function safeClientState () {
  return {
    schemaVersion: 1,
    savedAt: '2026-07-18T02:00:00.000Z',
    layout: 'c2',
    activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1',
      type: 'ssh',
      title: '生产服务器',
      host: 'example.internal',
      port: 22,
      username: 'root',
      batch: 0,
      pane: 'terminal',
      connectionState: 'disconnected'
    }],
    pendingTasks: [{
      id: 'task-1',
      type: 'agent',
      status: 'interrupted',
      title: 'Agent 任务已中断',
      startedAt: '2026-07-18T01:59:00.000Z'
    }]
  }
}

test('startup writes an unclean marker and a clean shutdown suppresses recovery', () => {
  const store = createStore()
  try {
    const first = createRecoverySnapshotManager({
      storagePath: store.storagePath,
      runId: 'run-a',
      now: () => Date.parse('2026-07-18T02:00:00.000Z')
    })
    assert.equal(first.initialize(), null)
    first.saveClientState(safeClientState())
    let persisted = JSON.parse(fs.readFileSync(store.storagePath, 'utf8'))
    assert.equal(persisted.cleanExit, false)
    assert.equal(persisted.clientState.tabs.length, 1)

    assert.equal(first.markCleanExitSync(), true)
    persisted = JSON.parse(fs.readFileSync(store.storagePath, 'utf8'))
    assert.equal(persisted.cleanExit, true)

    const second = createRecoverySnapshotManager({
      storagePath: store.storagePath,
      runId: 'run-b',
      now: () => Date.parse('2026-07-18T02:01:00.000Z')
    })
    assert.equal(second.initialize(), null)
  } finally {
    store.cleanup()
  }
})

test('an unclean prior run yields a bounded recovery plan without auto actions', () => {
  const store = createStore()
  try {
    fs.mkdirSync(path.dirname(store.storagePath), { recursive: true })
    fs.writeFileSync(store.storagePath, JSON.stringify({
      schemaVersion: 1,
      runId: 'run-a',
      cleanExit: false,
      reason: 'renderer-crashed',
      updatedAt: '2026-07-18T02:00:00.000Z',
      clientState: safeClientState()
    }))
    const manager = createRecoverySnapshotManager({
      storagePath: store.storagePath,
      runId: 'run-b',
      now: () => Date.parse('2026-07-18T02:01:00.000Z')
    })
    const plan = manager.initialize()
    assert.equal(plan.abnormalExit, true)
    assert.equal(plan.reason, 'renderer-crashed')
    assert.equal(plan.clientState.tabs[0].connectionState, 'disconnected')
    assert.equal(plan.clientState.pendingTasks[0].status, 'interrupted')
    assert.equal(Object.hasOwn(plan, 'autoReconnect'), false)
    assert.equal(Object.hasOwn(plan, 'commands'), false)
  } finally {
    store.cleanup()
  }
})

test('snapshot persistence is an atomic temp-file replacement and redacts unsafe fields', () => {
  const store = createStore()
  try {
    const manager = createRecoverySnapshotManager({
      storagePath: store.storagePath,
      runId: 'run-a'
    })
    manager.initialize()
    manager.saveClientState({
      ...safeClientState(),
      tabs: [{
        ...safeClientState().tabs[0],
        password: 'secret-password',
        privateKey: 'private-key-body',
        terminalOutput: 'sensitive terminal text',
        command: 'rm -rf /'
      }]
    })

    const text = fs.readFileSync(store.storagePath, 'utf8')
    assert.equal(fs.existsSync(`${store.storagePath}.tmp`), false)
    assert.doesNotMatch(text, /secret-password|private-key-body|sensitive terminal text|rm -rf/)
    assert.doesNotMatch(text, /"password"|"privateKey"|"terminalOutput"|"command"/)
  } finally {
    store.cleanup()
  }
})

test('corrupt snapshots are quarantined and never block startup', () => {
  const store = createStore()
  try {
    fs.writeFileSync(store.storagePath, '{broken', 'utf8')
    const manager = createRecoverySnapshotManager({
      storagePath: store.storagePath,
      runId: 'run-a',
      now: () => 1784340000000
    })
    assert.equal(manager.initialize(), null)
    assert.equal(
      fs.readdirSync(store.dir).some(name => name.includes('.corrupt-1784340000000')),
      true
    )
    assert.equal(JSON.parse(fs.readFileSync(store.storagePath, 'utf8')).cleanExit, false)
  } finally {
    store.cleanup()
  }
})

test('snapshot write failures degrade without changing application behavior', () => {
  const warnings = []
  const manager = createRecoverySnapshotManager({
    storagePath: 'recovery.json',
    runId: 'run-a',
    logger: { warn: message => warnings.push(message) },
    fileSystem: {
      readFileSync: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
      mkdirSync: () => {},
      openSync: () => { throw new Error('disk unavailable') },
      writeFileSync: () => {},
      fsyncSync: () => {},
      closeSync: () => {},
      renameSync: () => {}
    }
  })

  assert.equal(manager.initialize(), null)
  assert.equal(manager.saveClientState(safeClientState()), false)
  assert.equal(manager.markCleanExitSync(), false)
  assert.equal(warnings.length, 1)
})

test('application and renderer lifecycle sources wire recovery without automatic execution', () => {
  const root = path.resolve(__dirname, '../..')
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  const createApp = read('src/app/lib/create-app.js')
  const onClose = read('src/app/lib/on-close.js')
  const ipc = read('src/app/lib/ipc.js')
  const watch = read('src/client/store/watch.js')
  const loadData = read('src/client/store/load-data.js')

  assert.match(createApp, /createRecoverySnapshotManager/)
  assert.match(createApp, /recoverySnapshot\.initialize\(\)/)
  assert.match(createApp, /globalState\.set\('recoverySnapshot'/)
  assert.match(onClose, /markCleanExitSync\(\)/)
  assert.match(ipc, /saveRecoverySnapshot/)
  assert.match(ipc, /getRecoveryPlan/)
  assert.match(ipc, /dismissRecoveryPlan/)
  assert.match(watch, /serializeClientRecoveryState/)
  assert.match(watch, /saveRecoverySnapshot/)
  assert.match(loadData, /buildClientRecoveryPlan/)
  assert.match(loadData, /getRecoveryPlan/)
  assert.doesNotMatch(loadData, /recoveryPlan[\s\S]{0,400}(?:sendCommand|runSafetyCommand|nativeUpdateInstall)/)
})
