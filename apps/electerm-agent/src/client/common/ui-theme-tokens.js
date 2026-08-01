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

function ensureContrast (color, backgrounds, minimumRatio) {
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

function ensureTextContrast (color, backgrounds) {
  return ensureContrast(color, backgrounds, 4.5)
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
  const darkSurface = relativeLuminance(surface) < 0.5
  const surfaceSoft = expandHex(theme['surface-soft'], mix(surface, page, 0.55))
  const surfaceElevated = mix(surface, '#FFFFFF', darkSurface ? 0.06 : 0.34)
  const surfaceInset = mix(surface, page, darkSurface ? 0.42 : 0.58)
  const highlight = darkSurface
    ? 'rgba(255, 255, 255, 0.08)'
    : 'rgba(255, 255, 255, 0.82)'
  const backgrounds = [page, surface]
  const disabledTextBackgrounds = [...backgrounds, surfaceElevated]
  const textFallback = relativeLuminance(surface) < 0.5 ? '#FFFFFF' : '#253249'
  const text = ensureTextContrast(expandHex(theme.text, textFallback), backgrounds)
  const primary = expandHex(theme.primary, '#2878E6')
  const primaryAlt = expandHex(
    theme['primary-alt'],
    mix(primary, '#FFFFFF', darkSurface ? 0.18 : 0.12)
  )
  const cyan = expandHex(theme.cyan, darkSurface ? '#2CB7EB' : '#149BD7')
  const border = expandHex(theme.border, mix(text, surface, 0.84))
  const textMuted = ensureTextContrast(
    expandHex(theme['text-dark'], mix(text, page, 0.52)),
    backgrounds
  )
  const danger = expandHex(theme.error, '#CF3F50')
  const shadowSm = darkSurface
    ? '0 4px 10px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(116, 109, 255, 0.10)'
    : '0 4px 10px rgba(62, 58, 160, 0.10)'
  const shadowMd = darkSurface
    ? '0 10px 24px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(116, 109, 255, 0.12)'
    : '0 10px 24px rgba(73, 66, 196, 0.16)'
  const shadowLg = darkSurface
    ? '0 18px 42px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(116, 109, 255, 0.14)'
    : '0 18px 42px rgba(75, 66, 202, 0.22)'
  const shadowFocus = darkSurface
    ? '0 8px 18px rgba(116, 109, 255, 0.30)'
    : '0 8px 18px rgba(77, 70, 245, 0.28)'

  return {
    page,
    canvas: page,
    surface,
    surfaceSubtle: surfaceSoft,
    surfaceSoft,
    surfaceInset,
    surfaceElevated,
    highlightTop: highlight,
    highlight,
    text,
    textMuted,
    textDisabled: ensureContrast(
      expandHex(theme['text-disabled'], mix(text, page, 0.64)),
      disabledTextBackgrounds,
      3
    ),
    border,
    borderStrong: mix(text, surface, 0.72),
    primary,
    primaryAlt,
    primarySoft: mix(primary, surface, 0.88),
    cyan,
    success: expandHex(theme.success, '#168A74'),
    info: expandHex(theme.info, cyan),
    warning: expandHex(theme.warn, '#C56A20'),
    danger,
    radiusSmall: '8px',
    radiusControl: '10px',
    radiusToolbar: '14px',
    radiusCard: '18px',
    radiusPanel: '18px',
    radiusOverlay: '18px',
    shadowSm,
    shadowMd,
    shadowLg,
    shadowFocus,
    shadowControl: shadowSm,
    shadowCard: shadowMd,
    shadowOverlay: shadowLg,
    motionFast: '120ms',
    motionNormal: '180ms'
  }
}

export function buildUiThemeCss (theme) {
  const tokens = deriveSecondaryThemeTokens(theme)
  const variables = Object.entries(tokens).map(([key, value]) => {
    const cssKey = key === 'primaryAlt'
      ? 'primary-2'
      : key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
    return `--sp-${cssKey}: ${value};`
  }).join('\n')
  return `:root {\n${variables}\n}`
}
