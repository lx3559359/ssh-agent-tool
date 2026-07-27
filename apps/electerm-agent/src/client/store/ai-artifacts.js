import { artifactClient } from '../components/artifacts/artifact-client'

function errorMessage (error) {
  return error?.message || '成果物操作失败，请稍后重试。'
}

function backendFilters (filters) {
  return {
    category: filters.category || 'recent',
    query: filters.query || '',
    server: filters.server || '',
    format: filters.format || ''
  }
}

export default Store => {
  Store.prototype.openArtifactWorkspace = function (id = '') {
    const store = window.store
    store.mainWorkspaceMode = 'artifacts'
    store.activeArtifactId = id
    store.artifactError = ''
    if (id) store.selectArtifact(id)
    return true
  }

  Store.prototype.closeArtifactWorkspace = function () {
    const store = window.store
    if (store.mainWorkspaceMode !== 'artifacts') return false
    store.mainWorkspaceMode = 'terminal'
    return true
  }

  Store.prototype.loadArtifacts = async function (filters = {}) {
    const store = window.store
    store.artifactFilters = {
      ...store.artifactFilters,
      ...filters
    }
    store.artifactLoading = true
    store.artifactError = ''
    try {
      store.artifactItems = await artifactClient.listArtifacts(
        backendFilters(store.artifactFilters)
      )
      if (
        store.activeArtifactId &&
        !store.artifactItems.some(item => item.id === store.activeArtifactId)
      ) {
        store.activeArtifactId = ''
        store.activeArtifact = null
      }
      return store.artifactItems
    } catch (error) {
      store.artifactError = errorMessage(error)
      return []
    } finally {
      store.artifactLoading = false
    }
  }

  Store.prototype.selectArtifact = async function (id) {
    const store = window.store
    store.activeArtifactId = id || ''
    store.artifactError = ''
    if (!id) {
      store.activeArtifact = null
      return null
    }
    try {
      store.activeArtifact = await artifactClient.getArtifact(id)
      return store.activeArtifact
    } catch (error) {
      store.activeArtifact = null
      store.artifactError = errorMessage(error)
      return null
    }
  }

  Store.prototype.createArtifactVersion = async function (id, draft) {
    const store = window.store
    try {
      const artifact = await artifactClient.createArtifactVersion(id, draft)
      store.activeArtifact = artifact
      await store.loadArtifacts()
      return artifact
    } catch (error) {
      store.artifactError = errorMessage(error)
      return null
    }
  }

  Store.prototype.deleteArtifact = async function (id) {
    const store = window.store
    try {
      const removed = await artifactClient.deleteArtifact(id)
      if (store.activeArtifactId === id) {
        store.activeArtifactId = ''
        store.activeArtifact = null
      }
      await store.loadArtifacts()
      return removed
    } catch (error) {
      store.artifactError = errorMessage(error)
      return false
    }
  }
}
