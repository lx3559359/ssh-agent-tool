function createIncidentArchiveService ({ database, repository }) {
  return Object.freeze({
    list: filters => repository.list(filters || {}),
    get: id => repository.get(id),
    create: draft => repository.create(draft),
    update: (id, patch) => repository.update(id, patch),
    transition: (id, input) => repository.transition(id, input),
    addNote: (id, body) => repository.addNote(id, body),
    deleteNote: (id, noteId) => repository.deleteNote(id, noteId),
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
