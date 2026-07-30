import {
  createAgentTaskIncidentCandidate,
  createAgentTaskTimelineEvent,
  createSafetyOperationIncidentCandidate,
  createSafetyOperationTimelineEvent
} from './incident-capture.js'

function endpointReferences (record = {}) {
  const endpoint = record.endpoint || {}
  return new Set([
    endpoint.tabId,
    endpoint.bookmarkId,
    record.endpointRef
  ].filter(Boolean).map(String))
}

function incidentMatchesRecord (incident, record) {
  if (!incident?.id) return false
  const references = endpointReferences(record)
  if (!references.size) return false
  if (references.has(String(incident.endpointRef || ''))) return true
  return (incident.sessionRefs || [])
    .some(reference => references.has(String(reference)))
}

export async function captureIncidentTransactionChange ({
  detail,
  store,
  getOperation,
  getTask
} = {}) {
  const recordType = detail?.recordType
  const getRecord = recordType === 'operation'
    ? getOperation
    : recordType === 'task'
      ? getTask
      : null
  if (typeof getRecord !== 'function' || !store) return
  const record = await getRecord(detail.id)
  if (!record) return

  const candidate = recordType === 'operation'
    ? createSafetyOperationIncidentCandidate(record)
    : createAgentTaskIncidentCandidate(record)
  if (candidate) await store.captureIncidentCandidateSafely(candidate)

  if (!incidentMatchesRecord(store.activeIncident, record)) return
  const timelineEvent = recordType === 'operation'
    ? createSafetyOperationTimelineEvent(record)
    : createAgentTaskTimelineEvent(record)
  if (!timelineEvent) return
  await store.appendIncidentTimelineEvent(
    store.activeIncident.id,
    timelineEvent
  )
}
