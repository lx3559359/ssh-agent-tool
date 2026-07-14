/**
 * database default should init
 */

import { normalizeTerminalThemeConfig } from './shellpilot-theme-constraints.js'

function parsor (themeTxt) {
  return themeTxt.split('\n').reduce((prev, line) => {
    let [key = '', value = ''] = line.split('=')
    key = key.trim()
    value = value.trim()
    if (!key || !value) {
      return prev
    }
    prev[key] = value
    return prev
  }, {})
}

const defaultThemeDark = () => {
  return parsor(`
main-dark=#000
main-light=#2E3338
text=#ddd
text-light=#fff
text-dark=#888
text-disabled=#777
primary=#08c
info=#FFD166
success=#06D6A0
error=#EF476F
warn=#E55934
main=#121214
  `)
}
const defaultThemeLightFunc = () => {
  return parsor(`
      main=#ededed
      main-dark=#cccccc
      main-light=#fefefe
      text=#555
      text-light=#777
      text-dark=#444
      text-disabled=#888
      primary=#08c
      info=#FFD166
      success=#06D6A0
      error=#EF476F
      warn=#E55934
    `)
}

const defaultThemeLightTerminal = () => {
  return parsor(`
background=#f7f8fa
foreground=#1f2937
cursor=#2563eb
selectionBackground=rgba(37, 99, 235, 0.18)
cursorAccent=#ffffff
black=#111827
red=#dc2626
green=#15803d
yellow=#b45309
blue=#2563eb
magenta=#7c3aed
cyan=#0891b2
white=#e5e7eb
brightBlack=#6b7280
brightRed=#ef4444
brightGreen=#16a34a
brightYellow=#d97706
brightBlue=#3b82f6
brightMagenta=#8b5cf6
brightCyan=#06b6d4
brightWhite=#ffffff
    `
  )
}

const defaultThemeDarkTerminal = () => {
  return {
    foreground: '#bbbbbb',
    background: '#20111b',
    cursor: '#b5bd68',
    cursorAccent: '#1d1f21',
    selectionBackground: 'rgba(255, 255, 255, 0.3)',
    black: '#575757',
    red: '#FF2C6D',
    green: '#19f9d8',
    yellow: '#FFB86C',
    blue: '#45A9F9',
    magenta: '#FF75B5',
    cyan: '#B084EB',
    white: '#CDCDCD',
    brightBlack: '#757575',
    brightRed: '#FF2C6D',
    brightGreen: '#19f9d8',
    brightYellow: '#FFCC95',
    brightBlue: '#6FC1FF',
    brightMagenta: '#FF9AC1',
    brightCyan: '#BCAAFE',
    brightWhite: '#E6E6E6'
  }
}

export function defaultTheme () {
  return {
    id: 'default',
    name: 'default',
    themeConfig: normalizeTerminalThemeConfig(defaultThemeDarkTerminal()),
    uiThemeConfig: defaultThemeDark()
  }
}

export function defaultThemeLight () {
  return {
    id: 'defaultLight',
    name: 'default light',
    themeConfig: normalizeTerminalThemeConfig(defaultThemeLightTerminal()),
    uiThemeConfig: defaultThemeLightFunc()
  }
}
