function incidentIpcError (payload = {}) {
  const error = new Error(
    payload.message || 'Incident archive operation failed.'
  )
  error.code = payload.code || 'INCIDENT_IPC_ERROR'
  return error
}

function cloneIpcValue (value) {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value))
}

async function call (method, ...args) {
  const result = await window.pre.runGlobalAsync(
    method,
    ...args.map(cloneIpcValue)
  )
  if (!result?.ok) throw incidentIpcError(result?.error)
  return result.value
}

export const incidentClient = Object.freeze({
  list: filters => call('listIncidentArchives', filters || {}),
  get: id => call('getIncidentArchive', id),
  listCandidates: filters => call('listIncidentCandidates', filters || {}),
  captureCandidate: draft => call('captureIncidentCandidate', draft),
  dismissCandidate: id => call('dismissIncidentCandidate', id),
  reopenCandidate: id => call('reopenIncidentCandidate', id),
  convertCandidate: (id, draft) => (
    call('convertIncidentCandidate', id, draft)
  ),
  appendTimelineEvent: (id, draft) => (
    call('appendIncidentTimelineEvent', id, draft)
  ),
  create: draft => call('createIncidentArchive', draft),
  update: (id, patch) => call('updateIncidentArchive', id, patch),
  transition: (id, input) => call('transitionIncidentArchive', id, input),
  addNote: (id, body) => call('addIncidentNote', id, body),
  deleteNote: (id, noteId) => call('deleteIncidentNote', id, noteId),
  delete: id => call('deleteIncidentArchive', id),
  export: (id, format) => call('exportIncidentArchive', id, format),
  summary: () => call('getIncidentArchiveSummary')
})
