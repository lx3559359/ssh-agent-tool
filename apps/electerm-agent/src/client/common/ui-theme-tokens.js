function expandHex (value, fallback) {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    return fallback.toUpperCase()
  }
  const source = value.length === 4
    ? `#${value.slice(1).split('').map(channel => channel.repeat(2)).join('')}`
    : value
  return source.toUpperCase()
}

function mix (left, right, ratio) {
  const values = [left, right].map(value => {
    return value.slice(1).match(/.{2}/g).map(hex => parseInt(hex, 16))
  })
  const rgb = values[0].map((value, index) => {
    return Math.round(value * (1 - ratio) + values[1][index] * ratio)
  })
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function relativeLuminance (hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio (left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)]
    .sort((first, second) => second - first)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function minimumContrast (color, backgrounds) {
  return Math.min(...backgrounds.map(background => contrastRatio(color, background)))
}

function ensureTextContrast (color, backgrounds) {
  const minimumRatio = 4.5
  if (minimumContrast(color, backgrounds) >= minimumRatio) {
    return color
  }
  const black = '#000000'
  const white = '#FFFFFF'
  const target = minimumContrast(white, backgrounds) > minimumContrast(black, backgrounds)
    ? white
    : black
  for (let step = 1; step <= 255; step++) {
    const adjusted = mix(color, target, step / 255)
    if (minimumContrast(adjusted, backgrounds) >= minimumRatio) {
      return adjusted
    }
  }
  return target
}

function normalizeTheme (theme) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    return {}
  }
  const prototype = Object.getPrototypeOf(theme)
  return prototype === Object.prototype || prototype === null ? theme : {}
}

export function deriveSecondaryThemeTokens (theme = {}) {
  theme = normalizeTheme(theme)
  const page = expandHex(theme.main, '#F3F6FA')
  const surfaceMixRatio = relativeLuminance(page) < 0.5 ? 0.12 : 0.84
  const surface = expandHex(theme['main-light'], mix(page, '#FFFFFF', surfaceMixRatio))
  const backgrounds = [page, surface]
  const textFallback = relativeLuminance(surface) < 0.5 ? '#FFFFFF' : '#253249'
  const text = ensureTextContrast(expandHex(theme.text, textFallback), backgrounds)
  const primary = expandHex(theme.primary, '#2878E6')
  const textMuted = ensureTextContrast(
    expandHex(theme['text-dark'], mix(text, page, 0.52)),
    backgrounds
  )
  const danger = ensureTextContrast(expandHex(theme.error, '#CF3F50'), backgrounds)

  return {
    page,
    surface,
    surfaceSubtle: mix(surface, page, 0.55),
    surfaceElevated: surface,
    text,
    textMuted,
    textDisabled: expandHex(theme['text-disabled'], mix(text, page, 0.64)),
    border: mix(text, surface, 0.84),
    borderStrong: mix(text, surface, 0.72),
    primary,
    primarySoft: mix(primary, surface, 0.88),
    success: expandHex(theme.success, '#168A74'),
    info: expandHex(theme.info, '#2878E6'),
    warning: expandHex(theme.warn, '#C56A20'),
    danger,
    radiusControl: '7px',
    radiusCard: '10px',
    radiusOverlay: '9px',
    shadowCard: '0 3px 12px rgba(30, 58, 95, 0.08)',
    shadowOverlay: '0 13px 30px rgba(30, 41, 59, 0.18)'
  }
}

export function buildUiThemeCss (theme) {
  const tokens = deriveSecondaryThemeTokens(theme)
  const variables = Object.entries(tokens).map(([key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
    return `--sp-${cssKey}: ${value};`
  }).join('\n')
  return `:root {\n${variables}\n}`
}
