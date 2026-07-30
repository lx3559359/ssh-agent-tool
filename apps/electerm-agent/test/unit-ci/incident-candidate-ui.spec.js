const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('incident workspace exposes pending candidates without hiding archives', () => {
  const workspace = source(
    'src/client/components/incidents/incident-workspace.jsx'
  )
  const candidateList = source(
    'src/client/components/incidents/incident-candidate-list.jsx'
  )

  assert.match(workspace, /incidentPendingCandidateTotal/)
  assert.match(workspace, /IncidentCandidateList/)
  assert.match(candidateList, /shellpilotIncidentCandidateConfirm/)
  assert.match(candidateList, /shellpilotIncidentCandidateDismiss/)
  assert.match(candidateList, /convertIncidentCandidate/)
  assert.match(candidateList, /dismissIncidentCandidate/)
  assert.match(candidateList, /reopenIncidentCandidate/)
  assert.match(candidateList, /shellpilotIncidentCandidateIgnored/)
  assert.match(candidateList, /Input\.TextArea/)
})

test('incident detail renders the automatic activity timeline', () => {
  const detail = source(
    'src/client/components/incidents/incident-detail.jsx'
  )
  assert.match(detail, /timelineEvents/)
  assert.match(detail, /incident-timeline/)
})
