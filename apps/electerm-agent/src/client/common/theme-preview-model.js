import { deriveSecondaryThemeTokens } from './ui-theme-tokens.js'
import { shellPilotTerminalBackground } from './shellpilot-theme-constraints.js'

export { shellPilotTerminalBackground }

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readColor (config, key, fallback) {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function normalizeThemePreview (theme) {
  const source = isPlainObject(theme) ? theme : {}
  const uiThemeConfig = isPlainObject(source.uiThemeConfig)
    ? { ...source.uiThemeConfig }
    : {}
  const terminalConfig = isPlainObject(source.themeConfig)
    ? source.themeConfig
    : {}
  return {
    uiThemeConfig,
    tokens: deriveSecondaryThemeTokens(uiThemeConfig),
    themeConfig: {
      ...terminalConfig,
      background: shellPilotTerminalBackground,
      foreground: readColor(terminalConfig, 'foreground', '#D7DEE8'),
      cursor: readColor(terminalConfig, 'cursor', '#C9DB65'),
      selectionBackground: readColor(
        terminalConfig,
        'selectionBackground',
        'rgba(255, 255, 255, 0.22)'
      )
    }
  }
}

export function getThemeCapabilities (theme) {
  const source = isPlainObject(theme) ? theme : {}
  const id = typeof source.id === 'string' ? source.id : ''
  const protectedTheme = Boolean(source.readonly) ||
    source.type === 'iterm' ||
    id.startsWith('default')
  return {
    view: true,
    select: true,
    preview: true,
    apply: true,
    copy: true,
    edit: !protectedTheme,
    write: !protectedTheme,
    delete: !protectedTheme
  }
}

export function selectThemeForDetails (theme, onSelect) {
  const capabilities = getThemeCapabilities(theme)
  if (!capabilities.select || typeof onSelect !== 'function') {
    return false
  }
  onSelect(theme)
  return true
}

function findDeletionFallback (themes, deletedId, currentThemeId) {
  const remaining = Array.isArray(themes)
    ? themes.filter(theme => theme && theme.id && theme.id !== deletedId)
    : []
  const current = remaining.find(theme => theme.id === currentThemeId)
  if (current) return current
  return remaining.find(theme => theme.id === 'default') ||
    remaining.find(theme => theme.id === 'defaultLight') ||
    remaining.find(theme => !getThemeCapabilities(theme).delete) ||
    remaining[0] || null
}

function findTerminalDeletionFallback (themes, deletedId) {
  const remaining = Array.isArray(themes)
    ? themes.filter(theme => {
      return theme?.id &&
        theme.id !== deletedId &&
        !theme.id.startsWith('shellpilot-')
    })
    : []
  return remaining.find(theme => theme.id === 'default') ||
    remaining.find(theme => theme.id === 'defaultLight') ||
    remaining.find(theme => !getThemeCapabilities(theme).delete) ||
    remaining[0] || null
}

export async function deleteThemeSafely (options = {}) {
  const {
    item,
    themes,
    currentThemeId,
    terminalThemeId,
    selectedThemeId,
    previewController,
    setTheme,
    setTerminalTheme,
    deleteTheme,
    onSelect
  } = options
  if (!item?.id || typeof deleteTheme !== 'function') {
    throw new TypeError('A theme and deleteTheme callback are required')
  }
  const deletingCurrentTheme = currentThemeId === item.id
  const deletingTerminalTheme = terminalThemeId === item.id
  const fallback = deletingTerminalTheme && !deletingCurrentTheme
    ? findTerminalDeletionFallback(themes, item.id)
    : findDeletionFallback(themes, item.id, currentThemeId)
  if (previewController?.getPreviewThemeId?.() === item.id) {
    previewController.clear()
  }
  if (deletingCurrentTheme) {
    if (!fallback || typeof setTheme !== 'function') {
      throw new Error('Cannot delete the active theme without a fallback')
    }
    await setTheme(fallback.id)
  } else if (deletingTerminalTheme) {
    if (!fallback || typeof setTerminalTheme !== 'function') {
      throw new Error('Cannot delete the active terminal theme without a fallback')
    }
    await setTerminalTheme(fallback.id)
  }
  await deleteTheme(item)
  if (selectedThemeId === item.id && fallback && typeof onSelect === 'function') {
    onSelect(fallback)
  }
  return {
    ok: true,
    fallback
  }
}

export async function applyThemeWithFeedback (options = {}) {
  const {
    controller,
    themeId,
    showError,
    errorMessage
  } = options
  try {
    return await controller.apply(themeId)
  } catch (error) {
    if (typeof showError === 'function') {
      showError(errorMessage)
    }
    return error.themeApplyResult || {
      ok: false,
      error,
      previewThemeId: controller.getPreviewThemeId()
    }
  }
}

export function createThemePreviewController (options = {}) {
  const {
    setTheme,
    getCurrentThemeId,
    onChange,
    onApplyingChange
  } = options
  if (typeof setTheme !== 'function') {
    throw new TypeError('setTheme must be a function')
  }
  const notifyChange = typeof onChange === 'function' ? onChange : () => {}
  const notifyApplying = typeof onApplyingChange === 'function'
    ? onApplyingChange
    : () => {}
  const readCurrentThemeId = typeof getCurrentThemeId === 'function'
    ? getCurrentThemeId
    : () => ''
  let previewThemeId = ''
  let previewRevision = 0
  let applying = false

  function updatePreview (themeId, notify = true) {
    const nextThemeId = typeof themeId === 'string' ? themeId : ''
    const changed = previewThemeId !== nextThemeId
    previewThemeId = nextThemeId
    if (changed) previewRevision++
    if (changed && notify) {
      notifyChange(previewThemeId)
    }
    return previewThemeId
  }

  function preview (themeId) {
    const nextThemeId = previewThemeId === themeId ? '' : themeId
    return updatePreview(nextThemeId)
  }

  function clear ({ notify = true } = {}) {
    return updatePreview('', notify)
  }

  async function apply (themeId) {
    if (applying) {
      return {
        ok: false,
        busy: true,
        previewThemeId
      }
    }
    applying = true
    notifyApplying(true)
    const previousThemeId = readCurrentThemeId()
    const requestPreviewRevision = previewRevision
    try {
      await setTheme(themeId)
      if (requestPreviewRevision === previewRevision) clear()
      return {
        ok: true,
        previewThemeId
      }
    } catch (error) {
      if (requestPreviewRevision === previewRevision) clear()
      let rollbackAttempted = false
      let rollbackError
      if (previousThemeId && readCurrentThemeId() !== previousThemeId) {
        rollbackAttempted = true
        try {
          await setTheme(previousThemeId)
        } catch (caughtRollbackError) {
          rollbackError = caughtRollbackError
        }
      }
      let applyError = error instanceof Error
        ? error
        : new Error(String(error))
      if (!Object.isExtensible(applyError)) {
        const wrappedError = new Error(applyError.message)
        wrappedError.cause = applyError
        applyError = wrappedError
      }
      const result = {
        ok: false,
        error: applyError,
        previewThemeId,
        rollbackAttempted,
        rollbackError
      }
      applyError.themeApplyResult = result
      throw applyError
    } finally {
      applying = false
      notifyApplying(false)
    }
  }

  return {
    preview,
    apply,
    clear,
    getPreviewThemeId: () => previewThemeId
  }
}
