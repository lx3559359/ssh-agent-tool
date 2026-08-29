const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default

const projectRoot = path.resolve(__dirname, '../..')
const textEditorSource = fs.readFileSync(path.resolve(
  projectRoot,
  'src/client/components/text-editor/text-editor.jsx'
), 'utf8')
const textEditorAst = parser.parse(textEditorSource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})
const fileItemSource = fs.readFileSync(path.resolve(
  projectRoot,
  'src/client/components/sftp/file-item.jsx'
), 'utf8')
const fileItemAst = parser.parse(fileItemSource, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining']
})

function findClassField (ast, name) {
  let initializer
  traverse(ast, {
    ClassProperty (nodePath) {
      if (nodePath.node.key?.name === name) initializer = nodePath.node.value
    }
  })
  return initializer
}

function installClassField (target, ast, name, dependencies = {}) {
  const initializer = findClassField(ast, name)
  assert.ok(initializer, `component must define ${name}`)
  target[name] = vm.runInNewContext(`
    (function installClassField () {
      return (${generate(initializer).code})
    }).call(__target)
  `, { ...dependencies, __target: target })
  return target[name]
}

function installOptionalClassField (target, ast, name, dependencies = {}) {
  const initializer = findClassField(ast, name)
  if (!initializer) return undefined
  target[name] = vm.runInNewContext(`
    (function installClassField () {
      return (${generate(initializer).code})
    }).call(__target)
  `, { ...dependencies, __target: target })
  return target[name]
}

function installClassMethod (target, ast, name, dependencies = {}) {
  let method
  traverse(ast, {
    ClassMethod (nodePath) {
      if (nodePath.node.key?.name === name) method = nodePath.node
    }
  })
  if (!method) return undefined
  const expression = {
    ...method,
    type: 'FunctionExpression',
    id: null
  }
  target[name] = vm.runInNewContext(`(${generate(expression).code})`, dependencies)
  return target[name]
}

function deferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

function flushAsync () {
  return new Promise(resolve => setImmediate(resolve))
}

function createWindowHarness () {
  const calls = {
    errors: [],
    ipcOn: [],
    ipcOff: [],
    global: [],
    writes: [],
    opens: [],
    reveals: [],
    unlinks: []
  }
  const listeners = []
  const windowHarness = {
    et: { isWebApp: true },
    store: {
      showEditor: false,
      onError: error => calls.errors.push(error)
    },
    pre: {
      tempDir: 'C:\\temp',
      resolve: (...parts) => parts.join('/'),
      ipcOnEvent: (channel, listener) => {
        calls.ipcOn.push({ channel, listener })
        listeners.push(listener)
      },
      ipcOffEvent: (channel, listener) => {
        calls.ipcOff.push({ channel, listener })
      },
      runGlobalAsync: async (...args) => {
        calls.global.push(args)
        return true
      },
      showItemInFolder: file => calls.reveals.push(file)
    },
    fs: {
      writeFile: async (...args) => {
        calls.writes.push(args)
        return true
      },
      openFile: async file => {
        calls.opens.push(file)
        return true
      },
      unlink: async file => {
        calls.unlinks.push(file)
        return true
      }
    }
  }
  return { calls, listeners, windowHarness }
}

function createTextEditorHarness ({
  refsMap = new Map(),
  windowHarness,
  generateFn = () => 'generated-id'
} = {}) {
  const actualWindow = windowHarness || createWindowHarness().windowHarness
  const editor = {
    state: {
      text: '',
      path: 'loading...',
      file: null,
      id: '',
      loading: true
    },
    setState (update, callback) {
      const patch = typeof update === 'function'
        ? update(this.state)
        : update
      if (patch) this.state = { ...this.state, ...patch }
      callback?.()
    }
  }
  const dependencies = {
    window: actualWindow,
    refs: { get: key => refsMap.get(key) },
    refsStatic: { remove: () => {} },
    resolve: (parent, name) => `${parent}/${name}`,
    generate: generateFn
  }
  const fields = [
    'setStateProxy',
    'beginEditorTransition',
    'captureEditorTransition',
    'isCurrentEditorTransition',
    'isCurrentEditorSession',
    'waitForExternalEditorOpens',
    'cleanupExternalEditorResource',
    'disposeExternalEditor',
    'closeEditorSession',
    'openEditor',
    'fetchText',
    'getAutoOpenCustomEditorCommand',
    'editWithSystemEditorDone',
    'doSubmit',
    'handleSubmit',
    'openExternalEditor',
    'editWith',
    'editWithCustom',
    'cancel'
  ]
  for (const name of fields) {
    installOptionalClassField(editor, textEditorAst, name, dependencies)
  }
  installClassMethod(editor, textEditorAst, 'componentWillUnmount', dependencies)
  return editor
}

function remoteFile (name = 'app.conf') {
  return {
    id: `remote-${name}`,
    path: '/root-only',
    name,
    type: 'remote',
    mode: 0o600
  }
}

test('editor save survives compensation refresh unmounting the file row', async () => {
  const read = deferred()
  const readStarted = deferred()
  const refsMap = new Map()
  const saved = []
  let refreshCount = 0
  const session = {
    readText: async () => {
      readStarted.resolve()
      return read.promise
    },
    saveText: async request => {
      saved.push(request)
      return true
    },
    refresh: async () => { refreshCount += 1 }
  }
  refsMap.set('file-old-id', {
    fetchEditorText: session.readText,
    onSubmitEditFile: session.saveText
  })
  const editor = createTextEditorHarness({ refsMap })

  const opening = editor.openEditor({
    id: 'file-old-id',
    file: remoteFile(),
    session
  })
  await readStarted.promise
  refsMap.delete('file-old-id')
  read.resolve('enabled=false\n')
  await opening
  await flushAsync()

  assert.equal(editor.state.text, 'enabled=false\n')
  assert.equal(editor.state.loading, false)
  assert.equal(await editor.handleSubmit({ text: 'enabled=true\n' }), true)
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{
    path: '/root-only/app.conf',
    text: 'enabled=true\n',
    mode: 0o600,
    type: 'remote'
  }])
  assert.equal(refreshCount, 1)
  assert.equal(editor.state.file, null)
})

test('file row gives the editor a session detached from the row instance', async () => {
  const readCalls = []
  const saveCalls = []
  const editorCalls = []
  let refreshCount = 0
  const row = {
    id: 'file-old-id',
    state: { file: remoteFile() },
    props: {
      readRemoteFile: async path => {
        readCalls.push(path)
        return 'source'
      },
      saveRemoteEditorFile: async request => {
        saveCalls.push(request)
        return true
      },
      remoteList: async () => { refreshCount += 1 }
    },
    get editor () {
      return { openEditor: data => editorCalls.push(data) }
    }
  }
  installOptionalClassField(row, fileItemAst, 'createEditorSession', {
    window: { fs: {} },
    typeMap: { remote: 'remote' }
  })
  installClassField(row, fileItemAst, 'editFile', {
    refs: { add: () => {} }
  })

  row.editFile()
  assert.equal(editorCalls.length, 1)
  const session = editorCalls[0].session
  assert.ok(session)
  row.props = null
  row.state = null

  assert.equal(await session.readText('/root-only/app.conf'), 'source')
  assert.equal(await session.saveText({
    path: '/root-only/app.conf',
    text: 'changed',
    mode: 0o600,
    type: 'remote'
  }), true)
  await session.refresh()
  assert.deepEqual(readCalls, ['/root-only/app.conf'])
  assert.deepEqual(JSON.parse(JSON.stringify(saveCalls)), [{
    path: '/root-only/app.conf',
    text: 'changed',
    mode: 0o600
  }])
  assert.equal(refreshCount, 1)
})

test('old external-editor callbacks cannot write into a newer editor session', async () => {
  const { calls, listeners, windowHarness } = createWindowHarness()
  const firstSession = {
    readText: async () => 'first',
    saveText: async () => true,
    refresh: async () => {}
  }
  const secondSession = {
    readText: async () => 'second',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({ windowHarness })

  await editor.openEditor({
    id: 'first',
    file: remoteFile('first.conf'),
    session: firstSession
  })
  await editor.editWith()
  const oldListener = listeners.at(-1)
  assert.equal(typeof oldListener, 'function')

  await editor.openEditor({
    id: 'second',
    file: remoteFile('second.conf'),
    session: secondSession
  })
  oldListener({}, 'stale-change')

  assert.equal(editor.state.text, 'second')
  assert.equal(editor.state.file.name, 'second.conf')
  assert.equal(calls.ipcOff.length, 1)
})

test('a late A-to-B cleanup cannot overwrite a newer C editor transition', async () => {
  const firstCleanup = deferred()
  const secondCleanup = deferred()
  const sessionA = {
    readText: async () => 'A',
    saveText: async () => true,
    refresh: async () => {}
  }
  const sessionB = {
    readText: async () => 'B',
    saveText: async () => true,
    refresh: async () => {}
  }
  const sessionC = {
    readText: async () => 'C',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness()
  editor.editorSession = sessionA
  editor.state = {
    ...editor.state,
    file: remoteFile('a.conf'),
    id: 'A',
    text: 'A',
    loading: false
  }
  let cleanupCount = 0
  editor.disposeExternalEditor = session => {
    if (session !== sessionA) return Promise.resolve()
    cleanupCount += 1
    return cleanupCount === 1 ? firstCleanup.promise : secondCleanup.promise
  }

  const openingB = editor.openEditor({
    id: 'B',
    file: remoteFile('b.conf'),
    session: sessionB
  })
  await flushAsync()
  const openingC = editor.openEditor({
    id: 'C',
    file: remoteFile('c.conf'),
    session: sessionC
  })
  await flushAsync()

  secondCleanup.resolve(true)
  await openingC
  firstCleanup.resolve(true)
  await openingB

  assert.equal(editor.editorSession, sessionC)
  assert.equal(editor.state.file.name, 'c.conf')
  assert.equal(editor.state.text, 'C')
})

test('a completed save cannot close or refresh over a newly opened file', async () => {
  const cleanupStarted = deferred()
  const cleanup = deferred()
  let refreshA = 0
  const sessionA = {
    readText: async () => 'A',
    saveText: async () => true,
    refresh: async () => { refreshA += 1 }
  }
  const sessionB = {
    readText: async () => 'B',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness()
  await editor.openEditor({
    id: 'A',
    file: remoteFile('a.conf'),
    session: sessionA
  })
  editor.disposeExternalEditor = session => {
    if (session !== sessionA) return Promise.resolve()
    cleanupStarted.resolve()
    return cleanup.promise
  }

  const saving = editor.handleSubmit({ text: 'saved A' })
  await cleanupStarted.promise
  await editor.openEditor({
    id: 'B',
    file: remoteFile('b.conf'),
    session: sessionB
  })
  cleanup.resolve(true)
  assert.equal(await saving, true)

  assert.equal(editor.editorSession, sessionB)
  assert.equal(editor.state.file.name, 'b.conf')
  assert.equal(editor.state.text, 'B')
  assert.equal(refreshA, 0)
})

test('unmount preempts an editor open waiting for old cleanup', async () => {
  const cleanup = deferred()
  const sessionA = {
    readText: async () => 'A',
    saveText: async () => true,
    refresh: async () => {}
  }
  const sessionB = {
    readText: async () => 'B',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness()
  editor.editorSession = sessionA
  editor.state = {
    ...editor.state,
    file: remoteFile('a.conf'),
    id: 'A',
    text: 'A',
    loading: false
  }
  editor.disposeExternalEditor = session => session === sessionA
    ? cleanup.promise
    : Promise.resolve()

  const opening = editor.openEditor({
    id: 'B',
    file: remoteFile('b.conf'),
    session: sessionB
  })
  await flushAsync()
  const fileAtUnmount = editor.state.file
  const textAtUnmount = editor.state.text
  const unmounting = editor.componentWillUnmount()
  cleanup.resolve(true)
  await Promise.all([opening, unmounting])

  assert.equal(editor.editorSession, null)
  assert.equal(editor.state.file, fileAtUnmount)
  assert.equal(editor.state.text, textAtUnmount)
})

test('cancel and unmount idempotently release listener watcher and remote temp file', async () => {
  const { calls, windowHarness } = createWindowHarness()
  const session = {
    readText: async () => 'source',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({ windowHarness })

  await editor.openEditor({
    id: 'remote',
    file: remoteFile(),
    session
  })
  await editor.editWith()
  await editor.cancel()
  await editor.componentWillUnmount?.()

  assert.equal(calls.ipcOn.length, 1)
  assert.equal(calls.ipcOff.length, 1)
  assert.equal(calls.global.filter(call => call[0] === 'watchFile').length, 1)
  assert.equal(calls.global.filter(call => call[0] === 'unwatchFile').length, 1)
  assert.equal(calls.unlinks.length, 1)
  assert.equal(editor.state.file, null)
})

test('cancel during remote temp creation still removes the completed temp file', async () => {
  const tempWrite = deferred()
  const { calls, windowHarness } = createWindowHarness()
  windowHarness.fs.writeFile = async (...args) => {
    calls.writes.push(args)
    return tempWrite.promise
  }
  const session = {
    readText: async () => 'source',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({ windowHarness })
  await editor.openEditor({ id: 'remote', file: remoteFile(), session })

  const opening = editor.editWith()
  await flushAsync()
  let cancelSettled = false
  const cancelling = Promise.resolve(editor.cancel())
    .then(() => { cancelSettled = true })
  await flushAsync()
  assert.equal(cancelSettled, false)
  tempWrite.resolve(true)
  assert.deepEqual(await Promise.all([opening, cancelling]), [false, undefined])

  assert.equal(calls.ipcOn.length, 0)
  assert.equal(calls.global.filter(call => call[0] === 'watchFile').length, 0)
  assert.equal(calls.unlinks.length, 1)
})

test('same-session concurrent external opens clean every unique temporary resource', async () => {
  const firstWrite = deferred()
  const secondWrite = deferred()
  const writes = [firstWrite, secondWrite]
  const { calls, windowHarness } = createWindowHarness()
  windowHarness.fs.writeFile = async (...args) => {
    const index = calls.writes.length
    calls.writes.push(args)
    return writes[index].promise
  }
  let sequence = 0
  const session = {
    readText: async () => 'source',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({
    windowHarness,
    generateFn: () => `unique-${++sequence}`
  })
  await editor.openEditor({ id: 'remote', file: remoteFile(), session })

  const first = editor.editWith()
  await flushAsync()
  assert.equal(calls.writes.length, 1)
  const second = editor.editWith()
  await flushAsync()
  assert.equal(calls.writes.length, 2)
  assert.notEqual(calls.writes[0][0], calls.writes[1][0])

  firstWrite.resolve(true)
  assert.equal(await first, false)
  secondWrite.resolve(true)
  assert.equal(await second, true)
  await editor.cancel()

  assert.equal(calls.ipcOff.length, calls.ipcOn.length)
  assert.equal(
    calls.global.filter(call => call[0] === 'unwatchFile').length,
    calls.global.filter(call => call[0] === 'watchFile').length
  )
  assert.deepEqual(
    [...calls.unlinks].sort(),
    calls.writes.map(call => call[0]).sort()
  )
  assert.equal(editor.externalEditorResource, null)
})

test('a third same-session open cannot overtake pending watcher cleanup', async () => {
  const firstWatch = deferred()
  const { calls, windowHarness } = createWindowHarness()
  windowHarness.pre.runGlobalAsync = async (...args) => {
    calls.global.push(args)
    if (args[0] === 'watchFile' && args[1].includes('unique-1')) {
      return firstWatch.promise
    }
    return true
  }
  let sequence = 0
  const session = {
    readText: async () => 'source',
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({
    windowHarness,
    generateFn: () => `unique-${++sequence}`
  })
  await editor.openEditor({ id: 'remote', file: remoteFile(), session })

  const first = editor.editWith()
  await flushAsync()
  assert.equal(
    calls.global.filter(call => call[0] === 'watchFile').length,
    1
  )
  const second = editor.editWith()
  await flushAsync()
  const third = editor.editWith()
  await flushAsync()
  assert.equal(
    calls.global.filter(call => call[0] === 'watchFile').length,
    1
  )

  firstWatch.resolve(true)
  assert.deepEqual(await Promise.all([first, second, third]), [false, false, true])
  const firstUnwatch = calls.global.findIndex(call => (
    call[0] === 'unwatchFile' && call[1].includes('unique-1')
  ))
  const lastWatch = calls.global.findLastIndex(call => call[0] === 'watchFile')
  assert.ok(firstUnwatch > -1 && firstUnwatch < lastWatch)
  await editor.cancel()
})

test('a new session waits for cancelled pending watcher cleanup before reading', async () => {
  const firstWatch = deferred()
  const { calls, windowHarness } = createWindowHarness()
  windowHarness.pre.runGlobalAsync = async (...args) => {
    calls.global.push(args)
    if (args[0] === 'watchFile' && args[1].includes('first.conf')) {
      return firstWatch.promise
    }
    return true
  }
  let secondReads = 0
  const sessionA = {
    readText: async () => 'A',
    saveText: async () => true,
    refresh: async () => {}
  }
  const sessionB = {
    readText: async () => {
      secondReads += 1
      return 'B'
    },
    saveText: async () => true,
    refresh: async () => {}
  }
  const editor = createTextEditorHarness({ windowHarness })
  await editor.openEditor({
    id: 'A',
    file: remoteFile('first.conf'),
    session: sessionA
  })
  const externalA = editor.editWith()
  await flushAsync()
  const cancellingA = editor.cancel()
  const openingB = editor.openEditor({
    id: 'B',
    file: remoteFile('second.conf'),
    session: sessionB
  })
  await flushAsync()

  assert.equal(secondReads, 0)
  firstWatch.resolve(true)
  await Promise.all([externalA, cancellingA, openingB])
  assert.equal(secondReads, 1)
  assert.equal(await editor.editWith(), true)
  assert.ok(
    calls.global.findIndex(call => call[0] === 'unwatchFile') <
    calls.global.findIndex(call => (
      call[0] === 'watchFile' && call[1].includes('second.conf')
    ))
  )
  await editor.cancel()
})

for (const failurePoint of ['watch', 'open']) {
  test(`${failurePoint} failure clears external ownership and cleans exactly once`, async () => {
    const failure = new Error(`${failurePoint} failed`)
    const { calls, windowHarness } = createWindowHarness()
    if (failurePoint === 'watch') {
      windowHarness.pre.runGlobalAsync = async (...args) => {
        calls.global.push(args)
        if (args[0] === 'watchFile') throw failure
        return true
      }
    } else {
      windowHarness.fs.openFile = async file => {
        calls.opens.push(file)
        throw failure
      }
    }
    const session = {
      readText: async () => 'source',
      saveText: async () => true,
      refresh: async () => {}
    }
    const editor = createTextEditorHarness({ windowHarness })
    await editor.openEditor({ id: 'remote', file: remoteFile(), session })

    assert.equal(await editor.editWith(), false)
    assert.equal(editor.externalEditorResource, null)
    assert.equal(calls.ipcOff.length, calls.ipcOn.length)
    assert.equal(
      calls.global.filter(call => call[0] === 'unwatchFile').length,
      1
    )
    assert.equal(calls.unlinks.length, 1)
    assert.deepEqual(calls.errors, [failure])
  })
}

test('editor form receives loading so repeated UI opens are disabled', () => {
  const renderSource = textEditorSource.slice(
    textEditorSource.indexOf('const pops ='),
    textEditorSource.indexOf('\n    return (', textEditorSource.indexOf('const pops ='))
  )
  assert.match(renderSource, /loading[,\s]/)
})

for (const action of ['cancel', 'unmount']) {
  test(`${action} waits for delayed watcher setup before exact cleanup`, async () => {
    const watchSetup = deferred()
    const { calls, windowHarness } = createWindowHarness()
    windowHarness.pre.runGlobalAsync = async (...args) => {
      calls.global.push(args)
      if (args[0] === 'watchFile') return watchSetup.promise
      return true
    }
    const session = {
      readText: async () => 'source',
      saveText: async () => true,
      refresh: async () => {}
    }
    const editor = createTextEditorHarness({ windowHarness })
    await editor.openEditor({ id: 'remote', file: remoteFile(), session })
    const opening = editor.editWith()
    await flushAsync()

    let cleanupSettled = false
    const cleanup = Promise.resolve(action === 'cancel'
      ? editor.cancel()
      : editor.componentWillUnmount())
      .then(() => { cleanupSettled = true })
    await flushAsync()
    assert.equal(cleanupSettled, false)
    assert.equal(
      calls.global.filter(call => call[0] === 'unwatchFile').length,
      0
    )

    watchSetup.resolve(true)
    await Promise.all([opening, cleanup])
    assert.equal(
      calls.global.filter(call => call[0] === 'unwatchFile').length,
      1
    )
    assert.equal(calls.unlinks.length, 1)
  })
}

test('failed save restores loading and keeps the same editor session retryable', async () => {
  const failure = new Error('save failed')
  const { calls, windowHarness } = createWindowHarness()
  let attempts = 0
  let refreshCount = 0
  const session = {
    readText: async () => 'before',
    saveText: async () => {
      attempts += 1
      if (attempts === 1) throw failure
      return true
    },
    refresh: async () => { refreshCount += 1 }
  }
  const editor = createTextEditorHarness({ windowHarness })
  await editor.openEditor({ id: 'remote', file: remoteFile(), session })

  assert.equal(await editor.handleSubmit({ text: 'after' }), false)
  assert.equal(editor.state.loading, false)
  assert.equal(editor.state.file.name, 'app.conf')
  assert.deepEqual(calls.errors, [failure])

  assert.equal(await editor.handleSubmit({ text: 'after' }), true)
  assert.equal(refreshCount, 1)
  assert.equal(editor.state.file, null)
})
