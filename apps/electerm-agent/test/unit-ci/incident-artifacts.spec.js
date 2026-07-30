const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('creates, generates and links an incident review artifact', async () => {
  const source = path.resolve(
    __dirname,
    '../../src/client/components/incidents/incident-artifacts.js'
  )
  const { createIncidentReviewArtifact } = await import(
    `${pathToFileURL(source).href}?test=${Date.now()}`
  )
  const calls = []
  const artifact = await createIncidentReviewArtifact({
    incident: {
      id: 'incident-1',
      title: 'Nginx 故障',
      endpointRef: 'server-1',
      summary: '502 错误',
      timelineEvents: []
    },
    artifactClient: {
      createArtifact: async (draft, provenance) => {
        calls.push(['create', draft, provenance])
        return { id: 'artifact-1', version: 1 }
      },
      generateArtifact: async (id, version, formats) => {
        calls.push(['generate', id, version, formats])
      },
      getArtifact: async id => {
        calls.push(['get', id])
        return { id, version: 1, title: 'Nginx 故障 - 故障复盘' }
      }
    },
    appendTimelineEvent: async (incidentId, event) => {
      calls.push(['link', incidentId, event])
    }
  })

  assert.equal(artifact.id, 'artifact-1')
  assert.equal(calls[0][0], 'create')
  assert.equal(calls[0][1].type, 'incident-review')
  assert.equal(calls[0][2].incidentId, 'incident-1')
  assert.deepEqual(calls[1], [
    'generate',
    'artifact-1',
    1,
    ['md', 'docx', 'pdf', 'html']
  ])
  assert.equal(calls[3][0], 'link')
  assert.equal(calls[3][3], undefined)
  assert.equal(calls[3][2].kind, 'artifact')
  assert.equal(calls[3][2].metadata.artifactId, 'artifact-1')
})
