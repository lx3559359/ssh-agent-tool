function createIncidentArchiveService ({ database, repository }) {
  const { exportIncident } = require('./incident-export')
  return Object.freeze({
    list: filters => repository.list(filters || {}),
    get: id => repository.get(id),
    listCandidates: filters => repository.listCandidates(filters || {}),
    captureCandidate: draft => repository.upsertCandidate(draft),
    dismissCandidate: id => repository.dismissCandidate(id),
    reopenCandidate: id => repository.reopenCandidate(id),
    convertCandidate: (id, draft) => repository.convertCandidate(id, draft),
    appendTimelineEvent: (id, draft) => (
      repository.appendTimelineEvent(id, draft)
    ),
    create: draft => repository.create(draft),
    update: (id, patch) => repository.update(id, patch),
    transition: (id, input) => repository.transition(id, input),
    addNote: (id, body) => repository.addNote(id, body),
    deleteNote: (id, noteId) => repository.deleteNote(id, noteId),
    delete: id => repository.delete(id),
    export: (id, options) => exportIncident(repository.get(id), options),
    summary: () => repository.summary(),
    storage: () => ({
      ...database.getStorageStats(),
      backups: database.listBackups()
    }),
    createBackup: () => database.createBackup('manual'),
    restoreBackup: (filename, confirmation) => {
      const result = database.restoreBackup(filename, confirmation)
      return { ...result, summary: repository.summary() }
    }
  })
}

module.exports = {
  createIncidentArchiveService
}
