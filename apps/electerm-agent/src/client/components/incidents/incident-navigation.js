const terminalWorkspaceMode = 'terminal'
const incidentWorkspaceMode = 'incident-archives'

export function openIncidentArchive (store, id = '') {
  const changed = (
    store.mainWorkspaceMode !== incidentWorkspaceMode ||
    store.activeIncidentId !== id
  )
  store.mainWorkspaceMode = incidentWorkspaceMode
  store.activeIncidentId = id
  return changed
}

export function closeIncidentArchive (store) {
  if (store.mainWorkspaceMode !== incidentWorkspaceMode) return false
  store.mainWorkspaceMode = terminalWorkspaceMode
  return true
}

export function getIncidentWorkspaceAccessibility (active) {
  return {
    inert: active,
    'aria-hidden': active
  }
}

export function focusIncidentWorkspace (active, element) {
  if (!active || typeof element?.focus !== 'function') return false
  element.focus({ preventScroll: true })
  return true
}
