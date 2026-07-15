import { formatShellPilotTranslation } from './shellpilot-i18n-overrides.js'

function isEditableTarget (target) {
  if (!target || typeof target !== 'object') {
    return false
  }
  const tagName = String(target.tagName || '').toUpperCase()
  return tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    Boolean(target.isContentEditable) ||
    Boolean(target.classList?.contains?.('xterm-helper-textarea'))
}

export function shouldHandleSettingsSearchShortcut (event = {}) {
  if (event.isComposing || event.key?.toLowerCase() !== 'k') {
    return false
  }
  if (!(event.ctrlKey || event.metaKey)) {
    return false
  }
  const activeElement = event.activeElement || event.target?.ownerDocument?.activeElement
  return !isEditableTarget(event.target) && !isEditableTarget(activeElement)
}

export function getSettingsSearchShortcutLabel (isMac) {
  return isMac ? '⌘K' : 'Ctrl+K'
}

export function formatSettingsSearchShortcutTitle (translate, isMac) {
  return formatShellPilotTranslation(translate, 'searchSettingsShortcut', {
    shortcut: getSettingsSearchShortcutLabel(isMac)
  })
}
