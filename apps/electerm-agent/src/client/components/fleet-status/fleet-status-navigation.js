const terminalWorkspaceMode = 'terminal'
const fleetStatusWorkspaceMode = 'fleet-status'

const terminalIntentShortcuts = new Set([
  'cloneToNextLayoutShortcut',
  'duplicateTabShortcut',
  'newBookmarkShortcut',
  'newTabShortcut',
  'toggleAddBtnShortcut'
])

const fleetRunnableShortcuts = new Set([
  'nextTabShortcut',
  'prevTabShortcut',
  'zoominShortcut',
  'zoomoutShortcut'
])

export function isFleetStatusActive (store) {
  return store?.mainWorkspaceMode === fleetStatusWorkspaceMode
}

export function openFleetStatus (store) {
  const changed = store.mainWorkspaceMode !== fleetStatusWorkspaceMode
  store.mainWorkspaceMode = fleetStatusWorkspaceMode
  return changed
}

export function closeFleetStatus (store) {
  const changed = store.mainWorkspaceMode !== terminalWorkspaceMode
  store.mainWorkspaceMode = terminalWorkspaceMode
  return changed
}

export function beginTerminalWorkspaceIntent (store) {
  return closeFleetStatus(store)
}

export function getTerminalWorkspaceAccessibility (fleetStatusActive) {
  return {
    inert: fleetStatusActive,
    'aria-hidden': fleetStatusActive
  }
}

export function focusFleetStatusWorkspace (active, workspace) {
  if (!active || typeof workspace?.focus !== 'function') {
    return false
  }
  workspace.focus({ preventScroll: true })
  return true
}

export function getFleetStatusShortcutAction (funcName) {
  if (!funcName) {
    return 'ignore'
  }
  if (terminalIntentShortcuts.has(funcName)) {
    return 'exit-and-run'
  }
  if (fleetRunnableShortcuts.has(funcName)) {
    return 'run'
  }
  return 'block'
}

export function routeFleetStatusShortcut ({
  active,
  funcName,
  event,
  close,
  invoke
}) {
  const action = getFleetStatusShortcutAction(funcName)
  if (!active || action === 'ignore') {
    return { routed: false }
  }
  if (action === 'block') {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return { routed: true, value: false }
  }
  if (action === 'exit-and-run') {
    close?.()
  }
  return {
    routed: true,
    value: invoke?.()
  }
}

export function dispatchAiChatShortcut ({
  event,
  rightPanelTab,
  activeElement,
  submit
}) {
  const matches = (
    rightPanelTab === 'ai' &&
    event?.ctrlKey &&
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    activeElement?.tagName === 'TEXTAREA' &&
    activeElement.classList?.contains('ai-chat-textarea')
  )
  if (!matches) {
    return false
  }
  submit?.()
  return true
}
