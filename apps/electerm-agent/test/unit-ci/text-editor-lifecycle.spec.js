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

function createTextEditorHarness ({ refsMap = new Map(), windowHarness } = {}) {
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
    generate: () => 'generated-id'
  }
  const fields = [
    'setStateProxy',
    'isCurrentEditorSession',
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
  await editor.cancel()
  tempWrite.resolve(true)
  assert.equal(await opening, false)

  assert.equal(calls.ipcOn.length, 0)
  assert.equal(calls.global.filter(call => call[0] === 'watchFile').length, 0)
  assert.equal(calls.unlinks.length, 1)
})

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
