/**
 * theme related functions
 */

import {
  settingMap
} from '../common/constants'
import { convertTheme } from '../common/terminal-theme'
import { normalizeTerminalThemeConfig } from '../common/shellpilot-theme-constraints.js'
import { buildShellPilotBuiltInThemes } from '../common/shellpilot-ui-palettes.js'
import {
  defaultTheme,
  defaultThemeLight
} from '../common/theme-defaults'

const shellPilotThemePrefix = 'shellpilot-'

function isShellPilotUiTheme (id) {
  return typeof id === 'string' && id.startsWith(shellPilotThemePrefix)
}

function getTerminalThemeId (config = {}) {
  if (!isShellPilotUiTheme(config.theme)) {
    return config.theme || config.terminalTheme || 'default'
  }
  return !isShellPilotUiTheme(config.terminalTheme) && config.terminalTheme
    ? config.terminalTheme
    : 'default'
}

function findTerminalTheme (themes, config) {
  const terminalThemeId = getTerminalThemeId(config)
  return themes.find(theme => theme?.id === terminalThemeId) ||
    themes.find(theme => theme?.id === 'default')
}

export default Store => {
  Store.prototype.getTerminalThemes = function () {
    const { store } = window
    const t1 = defaultTheme()
    const t2 = defaultThemeLight()
    const builtInIds = buildShellPilotBuiltInThemes(t1.themeConfig)
      .map(theme => theme.id)
    const reservedIds = new Set([t1.id, t2.id, ...builtInIds])
    const userThemes = store.getItems(settingMap.terminalThemes)
      .filter(theme => {
        if (!theme || !theme.id || reservedIds.has(theme.id)) {
          return false
        }
        reservedIds.add(theme.id)
        return true
      })
    const terminalTheme = findTerminalTheme([
      t1,
      t2,
      ...userThemes,
      ...(store.itermThemes || [])
    ], store.config) || t1
    const builtIns = buildShellPilotBuiltInThemes(terminalTheme.themeConfig)
    return [
      t1,
      t2,
      ...builtIns,
      ...userThemes
    ]
  }

  Store.prototype.setTheme = function (id) {
    const { store } = window
    const update = { theme: id }
    if (isShellPilotUiTheme(id)) {
      update.terminalTheme = getTerminalThemeId(store.config)
    } else {
      update.terminalTheme = id
    }
    store.updateConfig(update)
  }

  Store.prototype.addTheme = function (theme) {
    window.store.addItem(theme, settingMap.terminalThemes)
  }

  Store.prototype.editTheme = function (id, updates) {
    return window.store.editItem(
      id, updates, settingMap.terminalThemes
    )
  }

  Store.prototype.delTheme = function ({ id }) {
    window.store.delItem({ id }, settingMap.terminalThemes)
  }

  Store.prototype.getThemeConfig = function () {
    const { store } = window
    const all = store.getSidebarList(settingMap.terminalThemes)
    const selected = findTerminalTheme(all, store.config)
    return normalizeTerminalThemeConfig(selected?.themeConfig || {})
  }

  Store.prototype.fixThemes = function (themes) {
    return themes.map(t => {
      const d1 = defaultTheme()
      const d2 = defaultThemeLight()
      const isDefaultTheme = t.id === d1.id
      const isDefaultThemeLight = t.id === d2.id
      if (isDefaultTheme) {
        Object.assign(t, d1)
      } else if (isDefaultThemeLight) {
        Object.assign(t, d2)
      } else if (!t.uiThemeConfig) {
        t.uiThemeConfig = d1.uiThemeConfig
      }
      return t
    })
  }

  Store.prototype.setItermThemes = function (arr) {
    window.store.itermThemes = arr
  }

  Store.prototype.fetchItermThemes = async function () {
    const list = await window.pre.runGlobalAsync('listItermThemes')
    window.store.setItermThemes(
      list.map(d => {
        const obj = convertTheme(d)
        return {
          ...obj,
          id: 'iterm#' + obj.name,
          readonly: true,
          type: 'iterm'
        }
      })
    )
  }
}
