export const shellPilotTerminalBackground = '#0E0F12'
export const shellPilotTerminalForeground = '#D7DEE8'

const minimumTerminalForegroundContrast = 4.5

function parseHexColor (value) {
  const match = typeof value === 'string'
    ? value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)
    : null
  if (!match) {
    return null
  }
  const hex = match[1].length === 3
    ? match[1].split('').map(char => char + char).join('')
    : match[1]
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: 1
  }
}

function parseRgbaColor (value) {
  const match = typeof value === 'string'
    ? value.trim().match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|0?\.\d+|1)\s*\)$/i)
    : null
  if (!match) {
    return null
  }
  const channels = match.slice(1, 4).map(Number)
  if (channels.some(channel => channel > 255)) {
    return null
  }
  return {
    red: channels[0],
    green: channels[1],
    blue: channels[2],
    alpha: Number(match[4])
  }
}

function blendColor (foreground, background) {
  const alpha = foreground.alpha
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha)
  }
}

function relativeLuminance ({ red, green, blue }) {
  const channels = [red, green, blue].map(value => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function hasReadableForeground (value) {
  const background = parseHexColor(shellPilotTerminalBackground)
  const parsed = parseHexColor(value) || parseRgbaColor(value)
  if (!parsed || !background) {
    return false
  }
  const foreground = blendColor(parsed, background)
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05) >= minimumTerminalForegroundContrast
}

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
    background: shellPilotTerminalBackground,
    foreground: hasReadableForeground(config.foreground)
      ? config.foreground
      : shellPilotTerminalForeground
  }
}
