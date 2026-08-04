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

function hexToRgba (hex, alpha) {
  const channels = expandHex(hex, '#000000')
    .slice(1)
    .match(/.{2}/g)
    .map(value => parseInt(value, 16))
  return `rgba(${channels.join(', ')}, ${alpha})`
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
  const success = expandHex(theme.success, '#168A74')
  const info = expandHex(theme.info, cyan)
  const warning = expandHex(theme.warn, '#C56A20')
  const danger = expandHex(theme.error, '#CF3F50')
  const pageDot = expandHex(theme['page-dot'], mix(primary, page, 0.58))
  const cardStart = expandHex(theme['card-start'], surfaceElevated)
  const cardMid = expandHex(theme['card-mid'], surfaceSoft)
  const cardEnd = expandHex(theme['card-end'], surfaceInset)
  const panelStart = expandHex(
    theme['panel-start'],
    mix(cardStart, page, 0.18)
  )
  const panelMid = expandHex(
    theme['panel-mid'],
    mix(cardMid, page, 0.16)
  )
  const panelEnd = expandHex(
    theme['panel-end'],
    mix(cardEnd, page, 0.14)
  )
  const flatBackground = expandHex(theme.flat, surfaceInset)
  const topbarStart = expandHex(theme['topbar-start'], primary)
  const topbarMid = expandHex(
    theme['topbar-mid'],
    mix(primary, primaryAlt, 0.5)
  )
  const topbarEnd = expandHex(theme['topbar-end'], primaryAlt)
  const pageBackground = `radial-gradient(circle at 1px 1px, ${hexToRgba(pageDot, darkSurface ? '0.18' : '0.30')} 1px, transparent 1.2px), linear-gradient(180deg, ${page} 0%, ${mix(page, surface, 0.12)} 100%)`
  const topbarBackground = `linear-gradient(100deg, ${topbarStart} 0%, ${topbarMid} 52%, ${topbarEnd} 100%)`
  const controlBackground = `linear-gradient(145deg, ${cardStart} 0%, ${cardMid} 100%)`
  const cardBackground = darkSurface
    ? `radial-gradient(110% 90% at 15% 0%, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.04) 34%, transparent 72%), linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 54%, ${cardEnd} 100%)`
    : `radial-gradient(110% 90% at 15% 0%, #FFFFFF 0%, rgba(255, 255, 255, 0.72) 34%, transparent 72%), linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 54%, ${cardEnd} 100%)`
  const panelBackground = `linear-gradient(150deg, ${panelStart} 0%, ${panelMid} 58%, ${panelEnd} 100%)`
  const overlayBackground = darkSurface
    ? `linear-gradient(150deg, ${cardStart} 0%, ${cardMid} 52%, ${cardEnd} 100%)`
    : cardBackground
  const shadowControl = darkSurface
    ? '0 2px 4px rgba(0, 0, 0, 0.34), 0 8px 18px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(160, 148, 255, 0.12)'
    : '0 2px 4px rgba(44, 62, 84, 0.10), 0 7px 15px rgba(54, 77, 103, 0.14)'
  const shadowCard = darkSurface
    ? '0 3px 6px rgba(0, 0, 0, 0.38), 0 16px 32px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(160, 148, 255, 0.16)'
    : '0 3px 6px rgba(44, 62, 84, 0.13), 0 14px 27px rgba(54, 77, 103, 0.20)'
  const shadowPanel = darkSurface
    ? '0 5px 10px rgba(0, 0, 0, 0.42), 0 22px 44px rgba(0, 0, 0, 0.46), 0 0 0 1px rgba(160, 148, 255, 0.20)'
    : '0 4px 8px rgba(44, 62, 84, 0.15), 0 20px 40px rgba(54, 77, 103, 0.23)'
  const shadowOverlay = darkSurface
    ? '0 8px 16px rgba(0, 0, 0, 0.46), 0 30px 58px rgba(0, 0, 0, 0.54), 0 0 0 1px rgba(160, 148, 255, 0.24)'
    : '0 6px 12px rgba(38, 54, 74, 0.18), 0 28px 52px rgba(49, 70, 96, 0.28)'
  const shadowSm = shadowControl
  const shadowMd = shadowCard
  const shadowLg = shadowOverlay
  const shadowFocus = darkSurface
    ? '0 0 0 3px rgba(133, 131, 255, 0.28), 0 10px 24px rgba(0, 0, 0, 0.36)'
    : '0 0 0 3px rgba(92, 91, 233, 0.24), 0 8px 20px rgba(68, 91, 118, 0.14)'

  return {
    page,
    canvas: page,
    surface,
    surfaceSubtle: surfaceSoft,
    surfaceSoft,
    surfaceInset,
    surfaceElevated,
    pageBackground,
    topbarBackground,
    controlBackground,
    cardBackground,
    panelBackground,
    overlayBackground,
    flatBackground,
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
    success,
    successSoft: mix(success, surface, 0.88),
    info,
    infoSoft: mix(info, surface, 0.88),
    warning,
    warningSoft: mix(warning, surface, 0.88),
    danger,
    dangerSoft: mix(danger, surface, 0.88),
    radiusSmall: '8px',
    radiusControl: '12px',
    radiusToolbar: '16px',
    radiusCard: '18px',
    radiusPanel: '22px',
    radiusOverlay: '24px',
    shadowSm,
    shadowMd,
    shadowLg,
    shadowFocus,
    shadowControl,
    shadowCard,
    shadowPanel,
    shadowOverlay,
    focusOffset: '2px',
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
