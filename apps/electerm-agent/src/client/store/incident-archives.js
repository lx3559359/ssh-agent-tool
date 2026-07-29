import { incidentClient } from '../components/incidents/incident-client'
import {
  openIncidentArchive,
  closeIncidentArchive
} from '../components/incidents/incident-navigation'

function incidentErrorMessage (error) {
  return error?.message || '故障档案操作失败，请稍后重试。'
}

async function refreshIncidentViews (store) {
  await Promise.all([
    store.loadIncidentArchives(),
    store.loadIncidentSummary()
  ])
}

async function saveIncident (store, operation) {
  store.incidentSaving = true
  store.incidentError = ''
  try {
    const incident = await operation()
    store.activeIncident = incident
    await refreshIncidentViews(store)
    return incident
  } catch (error) {
    store.incidentError = incidentErrorMessage(error)
    return null
  } finally {
    store.incidentSaving = false
  }
}

export default Store => {
  Store.prototype.openIncidentArchiveWorkspace = function (id = '') {
    const store = window.store
    openIncidentArchive(store, id)
    store.incidentError = ''
    if (id) store.selectIncidentArchive(id)
    return true
  }

  Store.prototype.closeIncidentArchiveWorkspace = function () {
    return closeIncidentArchive(window.store)
  }

  Store.prototype.loadIncidentArchives = async function (filters = {}) {
    const store = window.store
    store.incidentFilters = {
      ...store.incidentFilters,
      ...filters
    }
    store.incidentPage = filters.page || store.incidentPage
    store.incidentPageSize = filters.pageSize || store.incidentPageSize
    store.incidentLoading = true
    store.incidentError = ''
    try {
      const result = await incidentClient.list({
        ...store.incidentFilters,
        page: store.incidentPage,
        pageSize: store.incidentPageSize
      })
      store.incidentItems = result.items
      store.incidentPage = result.page
      store.incidentPageSize = result.pageSize
      store.incidentTotal = result.total
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentLoading = false
    }
  }

  Store.prototype.selectIncidentArchive = async function (id) {
    const store = window.store
    store.activeIncidentId = id || ''
    store.incidentError = ''
    if (!id) {
      store.activeIncident = null
      return null
    }
    try {
      store.activeIncident = await incidentClient.get(id)
      return store.activeIncident
    } catch (error) {
      store.activeIncident = null
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.createIncidentArchive = async function (draft) {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const created = await incidentClient.create(draft)
      store.activeIncidentId = created.id
      store.activeIncident = created
      await refreshIncidentViews(store)
      return created
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.updateActiveIncident = async function (patch) {
    const store = window.store
    if (!store.activeIncidentId) return null
    return saveIncident(store, () => (
      incidentClient.update(store.activeIncidentId, patch)
    ))
  }

  Store.prototype.transitionActiveIncident = async function (input) {
    const store = window.store
    if (!store.activeIncidentId) return null
    return saveIncident(store, () => (
      incidentClient.transition(store.activeIncidentId, input)
    ))
  }

  Store.prototype.addActiveIncidentNote = async function (body) {
    const store = window.store
    if (!store.activeIncidentId) return null
    return saveIncident(store, () => (
      incidentClient.addNote(store.activeIncidentId, body)
    ))
  }

  Store.prototype.deleteActiveIncidentNote = async function (noteId) {
    const store = window.store
    if (!store.activeIncidentId) return null
    return saveIncident(store, () => (
      incidentClient.deleteNote(store.activeIncidentId, noteId)
    ))
  }

  Store.prototype.loadIncidentSummary = async function () {
    const store = window.store
    try {
      store.incidentSummary = await incidentClient.summary()
      return store.incidentSummary
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.loadIncidentStorage = async function () {
    const store = window.store
    try {
      store.incidentStorage = await incidentClient.storage()
      return store.incidentStorage
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    }
  }

  Store.prototype.createIncidentBackup = async function () {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      await incidentClient.createBackup()
      return await store.loadIncidentStorage()
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.restoreIncidentBackup = async function (
    filename,
    confirmation
  ) {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const result = await incidentClient.restoreBackup(
        filename,
        confirmation
      )
      store.activeIncidentId = ''
      store.activeIncident = null
      await Promise.all([
        store.loadIncidentArchives({ page: 1 }),
        store.loadIncidentSummary(),
        store.loadIncidentStorage()
      ])
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }
}
