const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

function loadIncidentStore (incidentClient, navigation, window) {
  const file = 'store/incident-archives.js'
  const source = readClient(file)
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['optionalChaining']
  })

  traverse(ast, {
    ImportDeclaration (modulePath) {
      const source = modulePath.node.source.value
      const imported = source.includes('incident-client')
        ? { incidentClient }
        : navigation
      const declarations = modulePath.node.specifiers.map(specifier => {
        const importedName = specifier.imported?.name || 'default'
        return t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(specifier.local.name),
            t.memberExpression(
              t.identifier(source.includes('incident-client')
                ? '__incidentClient'
                : '__navigation'),
              t.identifier(importedName)
            )
          )
        ])
      })
      assert.ok(imported)
      modulePath.replaceWithMultiple(declarations)
    },
    ExportDefaultDeclaration (exportPath) {
      exportPath.replaceWith(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('module'), t.identifier('exports')),
            t.toExpression(exportPath.node.declaration)
          )
        )
      )
    }
  })

  const module = { exports: {} }
  vm.runInNewContext(generate(ast).code, {
    module,
    exports: module.exports,
    window,
    __incidentClient: { incidentClient },
    __navigation: navigation
  }, { filename: file })
  return module.exports
}

function createHarness () {
  const calls = []
  const incidentClient = {
    list: async filters => {
      calls.push(['list', filters])
      return {
        items: [{ id: 'incident-1', state: 'investigating' }],
        page: filters.page,
        pageSize: filters.pageSize,
        total: 1
      }
    },
    get: async id => {
      calls.push(['get', id])
      return { id, state: 'investigating' }
    },
    create: async draft => ({ id: 'incident-created', ...draft }),
    update: async (id, patch) => ({ id, ...patch }),
    transition: async (id, input) => ({ id, ...input }),
    addNote: async (id, body) => {
      calls.push(['addNote', id, body])
      return { id: 'note-1', incidentId: id, body }
    },
    deleteNote: async (id, noteId) => {
      calls.push(['deleteNote', id, noteId])
      return { deleted: true, noteId }
    },
    summary: async () => {
      calls.push(['summary'])
      return { unresolved: 1 }
    },
    listCandidates: async filters => {
      calls.push(['listCandidates', filters])
      return {
        items: [{
          id: 'candidate-1',
          status: 'pending',
          title: 'Nginx 服务异常'
        }],
        page: 1,
        pageSize: 40,
        total: 1
      }
    },
    captureCandidate: async draft => {
      calls.push(['captureCandidate', draft])
      return { id: 'candidate-1', status: 'pending', ...draft }
    },
    dismissCandidate: async id => {
      calls.push(['dismissCandidate', id])
      return { id, status: 'dismissed' }
    },
    reopenCandidate: async id => {
      calls.push(['reopenCandidate', id])
      return { id, status: 'pending' }
    },
    convertCandidate: async (id, draft) => {
      calls.push(['convertCandidate', id, draft])
      return { id: 'incident-from-candidate', ...draft, timelineEvents: [] }
    },
    appendTimelineEvent: async (id, draft) => {
      calls.push(['appendTimelineEvent', id, draft])
      return { id: 'event-1', incidentId: id, ...draft }
    }
  }
  const navigation = {
    openIncidentArchive: (store, id = '') => {
      store.mainWorkspaceMode = 'incident-archives'
      store.activeIncidentId = id
      return true
    },
    closeIncidentArchive: store => {
      if (store.mainWorkspaceMode !== 'incident-archives') return false
      store.mainWorkspaceMode = 'terminal'
      return true
    }
  }
  class Store {}
  const window = {}
  loadIncidentStore(incidentClient, navigation, window)(Store)
  const tabs = [{ id: 'ssh-1' }]
  const store = new Store()
  Object.assign(store, {
    mainWorkspaceMode: 'terminal',
    tabs,
    activeTabId: 'ssh-1',
    activeIncidentId: '',
    activeIncident: null,
    incidentItems: [],
    incidentFilters: {
      query: '',
      endpointRef: '',
      state: [],
      severity: [],
      serviceTags: [],
      customTags: [],
      updatedFrom: null,
      updatedTo: null,
      favoriteOnly: false
    },
    incidentPage: 1,
    incidentPageSize: 40,
    incidentTotal: 0,
    incidentSummary: null,
    incidentLoading: false,
    incidentSaving: false,
    incidentError: '',
    incidentCandidates: [],
    incidentCandidateFilters: { status: ['pending'], endpointRef: '' },
    incidentCandidatePage: 1,
    incidentCandidatePageSize: 40,
    incidentCandidateTotal: 0,
    incidentCandidateLoading: false
  })
  window.store = store
  return { calls, store, tabs }
}

test('incident archive state is initialized for a 40 item page', () => {
  const source = readClient('store/init-state.js')
  assert.match(source, /incidentItems:\s*\[\]/)
  assert.match(source, /activeIncidentId:\s*''/)
  assert.match(source, /incidentPage:\s*1/)
  assert.match(source, /incidentPageSize:\s*40/)
  assert.match(source, /incidentSummary:\s*null/)
  assert.match(source, /incidentLoading:\s*false/)
  assert.match(source, /incidentError:\s*''/)
  assert.match(source, /incidentCandidates:\s*\[\]/)
  assert.match(source, /incidentCandidateTotal:\s*0/)
})

test('loads, captures, dismisses and converts incident candidates', async () => {
  const { calls, store } = createHarness()

  await store.loadIncidentCandidates()
  assert.equal(store.incidentCandidates[0].id, 'candidate-1')
  assert.equal(store.incidentCandidateTotal, 1)

  await store.captureIncidentCandidate({
    fingerprint: 'fleet:server-1:nginx',
    source: 'fleet-status',
    title: 'Nginx 服务异常'
  })
  assert.ok(calls.some(([name]) => name === 'captureCandidate'))

  await store.dismissIncidentCandidate('candidate-1')
  assert.ok(calls.some(([name]) => name === 'dismissCandidate'))

  const converted = await store.convertIncidentCandidate('candidate-1', {
    title: 'Nginx 服务异常'
  })
  assert.equal(converted.id, 'incident-from-candidate')
  assert.equal(store.activeIncidentId, 'incident-from-candidate')
  assert.ok(calls.some(([name]) => name === 'convertCandidate'))
})

test('automatic candidate capture is best effort and never throws', async () => {
  const { store } = createHarness()
  const original = store.captureIncidentCandidate
  store.captureIncidentCandidate = async () => {
    throw new Error('storage unavailable')
  }
  await assert.doesNotReject(() => store.captureIncidentCandidateSafely({
    fingerprint: 'operations:task-1',
    source: 'operations',
    title: '诊断失败'
  }))
  store.captureIncidentCandidate = original
})

test('workspace and list actions preserve terminal state and pagination', async () => {
  const { calls, store, tabs } = createHarness()

  store.openIncidentArchiveWorkspace('incident-1')
  assert.equal(store.mainWorkspaceMode, 'incident-archives')
  assert.equal(store.activeIncidentId, 'incident-1')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(store.activeTabId, 'ssh-1')

  await store.loadIncidentArchives({ query: 'nginx', page: 2 })
  assert.equal(store.incidentItems[0].id, 'incident-1')
  assert.equal(store.incidentPage, 2)
  assert.equal(store.incidentPageSize, 40)
  assert.equal(store.incidentTotal, 1)
  assert.equal(store.incidentLoading, false)
  assert.deepEqual({ ...calls.at(-1)[1] }, {
    query: 'nginx',
    endpointRef: '',
    state: [],
    severity: [],
    serviceTags: [],
    customTags: [],
    updatedFrom: null,
    updatedTo: null,
    favoriteOnly: false,
    page: 2,
    pageSize: 40
  })
})

test('writes refresh the active incident, list and summary', async () => {
  const { calls, store } = createHarness()
  store.activeIncidentId = 'incident-1'

  await store.transitionActiveIncident({
    state: 'verifying',
    verificationStatus: 'pending'
  })
  assert.equal(store.activeIncident.state, 'verifying')
  assert.equal(store.activeIncident.verificationStatus, 'pending')
  assert.equal(store.incidentSaving, false)
  assert.equal(store.incidentSummary.unresolved, 1)
  assert.ok(calls.some(([name]) => name === 'list'))
})

test('note mutations reload the complete active incident', async () => {
  const { calls, store } = createHarness()
  store.activeIncidentId = 'incident-1'

  await store.addActiveIncidentNote('timeline evidence')
  assert.deepEqual(
    calls.slice(-3).map(([name]) => name),
    ['get', 'list', 'summary']
  )
  assert.equal(store.activeIncident.id, 'incident-1')
  assert.equal(store.activeIncident.state, 'investigating')

  await store.deleteActiveIncidentNote('note-1')
  assert.deepEqual(
    calls.slice(-3).map(([name]) => name),
    ['get', 'list', 'summary']
  )
  assert.equal(store.activeIncident.id, 'incident-1')
  assert.equal(store.activeIncident.state, 'investigating')
})
