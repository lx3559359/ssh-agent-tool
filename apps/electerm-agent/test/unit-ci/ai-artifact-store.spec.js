const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

function loadArtifactStore (artifactClient, window) {
  const source = readClient('store/ai-artifacts.js')
    .replace(/^import .*?\r?\n/m, '')
    .replace('export default Store =>', 'module.exports = Store =>')
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    window,
    artifactClient
  })
  return module.exports
}

test('artifact workspace state is initialized without changing terminal state', () => {
  const source = readClient('store/init-state.js')
  assert.match(source, /mainWorkspaceMode:\s*'terminal'/)
  assert.match(source, /activeArtifactId:\s*''/)
  assert.match(source, /artifactItems:\s*\[\]/)
  assert.match(source, /artifactFilters:\s*\{/)
  assert.match(source, /artifactLoading:\s*false/)
  assert.match(source, /artifactError:\s*''/)
})

test('artifact workspace actions switch modes and preserve terminal tabs', async () => {
  const calls = []
  const artifactClient = {
    listArtifacts: async filters => {
      calls.push(['list', filters])
      return [{ id: 'artifact-1', title: '巡检报告' }]
    },
    getArtifact: async id => ({ id, title: '巡检报告' }),
    createArtifactVersion: async (id, draft) => {
      calls.push(['version', id, draft])
      return { id, version: 2 }
    },
    deleteArtifact: async id => {
      calls.push(['delete', id])
      return true
    }
  }
  class Store {}
  const window = {}
  loadArtifactStore(artifactClient, window)(Store)
  const tabs = [{ id: 'ssh-1' }]
  const store = new Store()
  Object.assign(store, {
    mainWorkspaceMode: 'terminal',
    activeArtifactId: '',
    artifactItems: [],
    artifactFilters: { category: 'recent', query: '', server: '', format: '' },
    artifactLoading: false,
    artifactError: '',
    tabs,
    activeTabId: 'ssh-1'
  })
  window.store = store

  store.openArtifactWorkspace('artifact-1')
  assert.equal(store.mainWorkspaceMode, 'artifacts')
  assert.equal(store.activeArtifactId, 'artifact-1')
  assert.equal(store.tabs, tabs)
  assert.equal(store.activeTabId, 'ssh-1')

  await store.loadArtifacts({ query: '巡检' })
  assert.equal(store.artifactItems.length, 1)
  assert.equal(store.artifactLoading, false)
  assert.deepEqual({ ...calls[0][1] }, {
    category: 'recent',
    query: '巡检',
    server: '',
    format: ''
  })

  store.closeArtifactWorkspace()
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.tabs, tabs)
})
