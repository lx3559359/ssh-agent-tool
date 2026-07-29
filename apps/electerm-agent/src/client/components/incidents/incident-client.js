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
  create: draft => call('createIncidentArchive', draft),
  update: (id, patch) => call('updateIncidentArchive', id, patch),
  transition: (id, input) => call('transitionIncidentArchive', id, input),
  addNote: (id, body) => call('addIncidentNote', id, body),
  deleteNote: (id, noteId) => call('deleteIncidentNote', id, noteId),
  summary: () => call('getIncidentArchiveSummary'),
  storage: () => call('getIncidentArchiveStorage'),
  createBackup: () => call('createIncidentArchiveBackup'),
  restoreBackup: (filename, confirmation) => (
    call('restoreIncidentArchiveBackup', filename, confirmation)
  )
})
