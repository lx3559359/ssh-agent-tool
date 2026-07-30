const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function loadModule () {
  const source = path.resolve(
    __dirname,
    '../../src/client/components/incidents/incident-transaction-capture.js'
  )
  return import(`${pathToFileURL(source).href}?test=${Date.now()}`)
}

function createStore (activeIncident = null) {
  const candidates = []
  const timeline = []
  return {
    activeIncident,
    candidates,
    timeline,
    async captureIncidentCandidateSafely (candidate) {
      candidates.push(candidate)
    },
    async appendIncidentTimelineEvent (incidentId, event) {
      timeline.push({ incidentId, event })
    }
  }
}

test('links completed AI diagnostic tasks to the matching incident', async () => {
  const { captureIncidentTransactionChange } = await loadModule()
  const store = createStore({
    id: 'incident-1',
    endpointRef: 'tab-1',
    sessionRefs: []
  })
  await captureIncidentTransactionChange({
    detail: { recordType: 'task', id: 'task-1' },
    store,
    getTask: async () => ({
      id: 'task-1',
      summary: '检查 Nginx',
      status: 'completed',
      endpoint: { tabId: 'tab-1' },
      steps: [{ id: 'status', status: 'completed', output: 'active' }]
    }),
    getOperation: async () => null
  })

  assert.equal(store.candidates.length, 0)
  assert.equal(store.timeline.length, 1)
  assert.equal(store.timeline[0].incidentId, 'incident-1')
  assert.equal(store.timeline[0].event.source, 'ai-diagnostic')
})

test('captures failed AI diagnostics even without an active matching incident', async () => {
  const { captureIncidentTransactionChange } = await loadModule()
  const store = createStore({
    id: 'incident-other',
    endpointRef: 'tab-other',
    sessionRefs: []
  })
  await captureIncidentTransactionChange({
    detail: { recordType: 'task', id: 'task-failed' },
    store,
    getTask: async () => ({
      id: 'task-failed',
      purpose: '检查数据库',
      status: 'failed',
      error: 'connection refused',
      endpoint: { bookmarkId: 'bookmark-db' }
    }),
    getOperation: async () => null
  })

  assert.equal(store.candidates.length, 1)
  assert.equal(store.candidates[0].source, 'ai-diagnostic')
  assert.equal(store.timeline.length, 0)
})

test('keeps safety operation capture behavior in the shared event handler', async () => {
  const { captureIncidentTransactionChange } = await loadModule()
  const store = createStore({
    id: 'incident-1',
    endpointRef: 'bookmark-1',
    sessionRefs: []
  })
  await captureIncidentTransactionChange({
    detail: { recordType: 'operation', id: 'operation-1' },
    store,
    getTask: async () => null,
    getOperation: async () => ({
      id: 'operation-1',
      title: '更新配置',
      state: 'failed',
      risk: 'change',
      endpoint: { bookmarkId: 'bookmark-1' }
    })
  })

  assert.equal(store.candidates.length, 1)
  assert.equal(store.candidates[0].source, 'safety-operation')
  assert.equal(store.timeline.length, 1)
  assert.equal(store.timeline[0].event.source, 'safety-operation')
})
