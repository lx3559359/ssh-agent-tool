export const shellPilotTerminalBackground = '#0E0F12'

function isPlainObject (value) {
  if (!value || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function normalizeTerminalThemeConfig (themeConfig = {}) {
  const config = isPlainObject(themeConfig) ? themeConfig : {}
  return {
    ...config,
    background: shellPilotTerminalBackground
  }
}
