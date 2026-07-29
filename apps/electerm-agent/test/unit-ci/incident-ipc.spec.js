const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ipcPath = path.resolve(__dirname, '../../src/app/lib/ipc.js')

test('incident client unwraps plain ipc values and preserves error codes', async () => {
  const calls = []
  const originalWindow = global.window
  global.window = {
    pre: {
      runGlobalAsync: async (method, ...args) => {
        calls.push([method, ...args])
        if (method === 'getIncidentArchive') {
          return {
            ok: false,
            error: { code: 'INCIDENT_NOT_FOUND', message: 'Not found.' }
          }
        }
        return {
          ok: true,
          value: {
            items: [],
            page: 1,
            pageSize: 40,
            total: 0,
            totalPages: 1
          }
        }
      }
    }
  }

  try {
    const clientPath = path.resolve(
      __dirname,
      '../../src/client/components/incidents/incident-client.js'
    )
    const moduleUrl = pathToFileURL(clientPath).href
    const { incidentClient } = await import(`${moduleUrl}?test=${Date.now()}`)
    await incidentClient.list({ page: 1 })
    await assert.rejects(
      () => incidentClient.get('missing'),
      error => error.code === 'INCIDENT_NOT_FOUND'
    )
    assert.deepEqual(calls[0], ['listIncidentArchives', { page: 1 }])
  } finally {
    global.window = originalWindow
  }
})

test('ipc registers incident methods without constructing storage at startup', () => {
  const source = fs.readFileSync(ipcPath, 'utf8')
  assert.match(source, /let incidentArchiveService/)
  assert.match(source, /function getIncidentArchiveService/)
  assert.match(source, /listIncidentArchives/)
  assert.doesNotMatch(
    source,
    /const incidentArchiveService = createIncidentArchiveService/
  )
})
