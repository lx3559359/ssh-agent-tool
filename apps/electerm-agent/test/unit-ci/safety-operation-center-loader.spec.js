const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/main/safety-operation-center-loader.js'
)).href

function importLoader () {
  return import(moduleUrl)
}

test('keeps legacy safety records when the optional operation task table is unavailable', async () => {
  const { loadSafetyCenterRecords } = await importLoader()
  const optionalErrors = []
  const integrityResults = new Map([['operation-1', { ok: true }]])

  const result = await loadSafetyCenterRecords({
    listOperations: async () => [{ id: 'operation-1' }],
    listTasks: async () => [{ id: 'task-1' }],
    listOperationTasks: async () => {
      throw new Error('operationTasks table is unavailable')
    },
    buildIntegrityResults: async () => integrityResults,
    onOptionalError: error => optionalErrors.push(error)
  })

  assert.deepEqual(result.records, [{ id: 'operation-1' }])
  assert.deepEqual(result.tasks, [{ id: 'task-1' }])
  assert.deepEqual(result.operationTasks, [])
  assert.equal(result.integrityResults, integrityResults)
  assert.equal(optionalErrors.length, 1)
  assert.match(optionalErrors[0].message, /operationTasks/)
})

test('still rejects when the primary safety operation source fails', async () => {
  const { loadSafetyCenterRecords } = await importLoader()

  await assert.rejects(
    loadSafetyCenterRecords({
      listOperations: async () => {
        throw new Error('primary records failed')
      },
      listTasks: async () => [],
      listOperationTasks: async () => [],
      buildIntegrityResults: async () => new Map()
    }),
    /primary records failed/
  )
})
