import { incidentClient } from '../components/incidents/incident-client'
import {
  openIncidentArchive,
  closeIncidentArchive
} from '../components/incidents/incident-navigation'
import {
  getOperation,
  getTask,
  safetyTransactionUpdatedEvent
} from '../common/safety-transactions/transaction-store.js'
import {
  captureIncidentTransactionChange
} from '../components/incidents/incident-transaction-capture.js'
import {
  createIncidentReviewArtifact
} from '../components/incidents/incident-artifacts.js'

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

async function captureSafetyTransactionChange (event) {
  await captureIncidentTransactionChange({
    detail: event?.detail,
    store: window.store,
    getOperation,
    getTask
  })
}

let safetyTransactionListenerInstalled = false

export default Store => {
  if (
    !safetyTransactionListenerInstalled &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    safetyTransactionListenerInstalled = true
    window.addEventListener(safetyTransactionUpdatedEvent, event => {
      captureSafetyTransactionChange(event).catch(() => {})
    })
  }

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

  Store.prototype.loadIncidentCandidates = async function (filters = {}) {
    const store = window.store
    store.incidentCandidateFilters = {
      ...store.incidentCandidateFilters,
      ...filters
    }
    store.incidentCandidatePage = (
      filters.page || store.incidentCandidatePage
    )
    store.incidentCandidatePageSize = (
      filters.pageSize || store.incidentCandidatePageSize
    )
    store.incidentCandidateLoading = true
    try {
      const result = await incidentClient.listCandidates({
        ...store.incidentCandidateFilters,
        page: store.incidentCandidatePage,
        pageSize: store.incidentCandidatePageSize
      })
      store.incidentCandidates = result.items
      store.incidentCandidatePage = result.page
      store.incidentCandidatePageSize = result.pageSize
      store.incidentCandidateTotal = result.total
      const statuses = store.incidentCandidateFilters.status || []
      if (statuses.length === 1 && statuses[0] === 'pending') {
        store.incidentPendingCandidateTotal = result.total
      } else {
        const pending = await incidentClient.listCandidates({
          status: ['pending'],
          page: 1,
          pageSize: 20
        })
        store.incidentPendingCandidateTotal = pending.total
      }
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentCandidateLoading = false
    }
  }

  Store.prototype.captureIncidentCandidate = async function (draft) {
    const store = window.store
    const candidate = await incidentClient.captureCandidate(draft)
    await store.loadIncidentCandidates()
    return candidate
  }

  Store.prototype.captureIncidentCandidateSafely = async function (draft) {
    try {
      return await window.store.captureIncidentCandidate(draft)
    } catch (error) {
      console.warn('Incident candidate capture failed', error)
      return null
    }
  }

  Store.prototype.dismissIncidentCandidate = async function (id) {
    const store = window.store
    const candidate = await incidentClient.dismissCandidate(id)
    await store.loadIncidentCandidates()
    return candidate
  }

  Store.prototype.reopenIncidentCandidate = async function (id) {
    const store = window.store
    const candidate = await incidentClient.reopenCandidate(id)
    await store.loadIncidentCandidates()
    return candidate
  }

  Store.prototype.convertIncidentCandidate = async function (id, draft) {
    const store = window.store
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const incident = await incidentClient.convertCandidate(id, draft)
      store.activeIncidentId = incident.id
      store.activeIncident = incident
      await Promise.all([
        refreshIncidentViews(store),
        store.loadIncidentCandidates()
      ])
      return incident
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.appendIncidentTimelineEvent = async function (
    incidentId,
    draft
  ) {
    const store = window.store
    const event = await incidentClient.appendTimelineEvent(
      incidentId,
      draft
    )
    if (store.activeIncidentId === incidentId) {
      store.activeIncident = await incidentClient.get(incidentId)
    }
    return event
  }

  Store.prototype.generateActiveIncidentReview = async function () {
    const store = window.store
    if (!store.activeIncident?.id) return null
    store.incidentArtifactCreating = true
    store.incidentError = ''
    try {
      const artifact = await createIncidentReviewArtifact({
        incident: store.activeIncident,
        appendTimelineEvent: (
          incidentId,
          timelineEvent
        ) => store.appendIncidentTimelineEvent(incidentId, timelineEvent)
      })
      store.openArtifactWorkspace?.(artifact.id)
      return artifact
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentArtifactCreating = false
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
    const incidentId = store.activeIncidentId
    return saveIncident(store, async () => {
      await incidentClient.addNote(incidentId, body)
      return incidentClient.get(incidentId)
    })
  }

  Store.prototype.deleteActiveIncidentNote = async function (noteId) {
    const store = window.store
    if (!store.activeIncidentId) return null
    const incidentId = store.activeIncidentId
    return saveIncident(store, async () => {
      await incidentClient.deleteNote(incidentId, noteId)
      return incidentClient.get(incidentId)
    })
  }

  Store.prototype.deleteActiveIncident = async function () {
    const store = window.store
    if (!store.activeIncidentId) return null
    const incidentId = store.activeIncidentId
    store.incidentSaving = true
    store.incidentError = ''
    try {
      const result = await incidentClient.delete(incidentId)
      store.activeIncidentId = ''
      store.activeIncident = null
      await Promise.all([
        store.loadIncidentArchives({ page: 1 }),
        store.loadIncidentSummary(),
        store.loadIncidentCandidates()
      ])
      return result
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
  }

  Store.prototype.exportIncidentArchives = async function (
    format = 'md',
    incidentId = ''
  ) {
    const store = window.store
    const id = incidentId || store.activeIncidentId
    if (!id) return null
    store.incidentSaving = true
    store.incidentError = ''
    try {
      return await incidentClient.export(id, format)
    } catch (error) {
      store.incidentError = incidentErrorMessage(error)
      return null
    } finally {
      store.incidentSaving = false
    }
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
}
