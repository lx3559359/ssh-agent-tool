import { normalizeTerminalThemeConfig } from './shellpilot-theme-constraints.js'

const paletteConfigs = [
  {
    key: 'ocean',
    name: 'Ocean Blue',
    nameKey: 'shellpilotThemeOcean',
    descriptionKey: 'shellpilotThemeOceanDesc',
    mode: 'light',
    main: '#F3F6FB',
    mainLight: '#FFFFFF',
    text: '#253249',
    primary: '#1E63C6'
  },
  {
    key: 'jade',
    name: 'Jade Green',
    nameKey: 'shellpilotThemeJade',
    descriptionKey: 'shellpilotThemeJadeDesc',
    mode: 'light',
    main: '#EFF7F5',
    mainLight: '#FFFFFF',
    text: '#203A36',
    primary: '#0E6B59'
  },
  {
    key: 'indigo',
    name: 'Cloud Indigo',
    nameKey: 'shellpilotThemeIndigo',
    descriptionKey: 'shellpilotThemeIndigoDesc',
    mode: 'light',
    main: '#F6F7FF',
    mainLight: '#FFFFFF',
    mainDark: '#DDE1F3',
    surfaceSoft: '#F0F2FF',
    text: '#111B3F',
    textLight: '#111B3F',
    textMuted: '#69708E',
    textDisabled: '#858CA8',
    primary: '#4D46F5',
    primaryAlt: '#6C63FF',
    cyan: '#149BD7',
    border: '#DDE1F3',
    statusColors: {
      info: '#149BD7',
      success: '#20B66A',
      error: '#E5484D',
      warn: '#F2A11D'
    }
  },
  {
    key: 'amber',
    name: 'Warm Amber',
    nameKey: 'shellpilotThemeAmber',
    descriptionKey: 'shellpilotThemeAmberDesc',
    mode: 'light',
    main: '#F7F3EB',
    mainLight: '#FFFDFA',
    text: '#3D3528',
    primary: '#9A4A10'
  },
  {
    key: 'graphite',
    name: 'Graphite Night',
    nameKey: 'shellpilotThemeGraphite',
    descriptionKey: 'shellpilotThemeGraphiteDesc',
    mode: 'dark',
    main: '#0B1020',
    mainLight: '#11182A',
    mainDark: '#070B16',
    surfaceSoft: '#171F35',
    text: '#EDF1FF',
    textLight: '#EDF1FF',
    textMuted: '#9CA6C4',
    textDisabled: '#727E9E',
    primary: '#746DFF',
    primaryAlt: '#8A82FF',
    cyan: '#2CB7EB',
    border: '#28334F',
    statusColors: {
      info: '#2CB7EB',
      success: '#32D583',
      error: '#FF6B70',
      warn: '#F7B84B'
    }
  }
]

export function getThemeDisplayName (theme = {}, translate) {
  const { name, nameKey, type } = theme || {}
  if (type !== 'shellpilot' || !nameKey || typeof translate !== 'function') {
    return name
  }
  const translatedName = translate(nameKey)
  const normalizedName = typeof translatedName === 'string'
    ? translatedName.trim()
    : ''
  if (!normalizedName || normalizedName.toLowerCase() === nameKey.toLowerCase()) {
    return name
  }
  return normalizedName
}

export function buildShellPilotBuiltInThemes (baseTerminalTheme = {}) {
  return paletteConfigs.map(palette => {
    const isDark = palette.mode === 'dark'
    const currentStatusColors = isDark
      ? {
          info: '#6DB7FF',
          success: '#4FD1B5',
          error: '#FF7185',
          warn: '#F0A45D'
        }
      : {
          info: '#1E63C6',
          success: '#0E6B59',
          error: '#B42338',
          warn: '#9A4A10'
        }
    const statusColors = {
      ...currentStatusColors,
      ...palette.statusColors
    }
    return {
      id: `shellpilot-${palette.key}`,
      name: palette.name,
      nameKey: palette.nameKey,
      descriptionKey: palette.descriptionKey,
      mode: palette.mode,
      readonly: true,
      type: 'shellpilot',
      uiThemeConfig: {
        main: palette.main,
        'main-light': palette.mainLight,
        'main-dark': palette.mainDark || (isDark ? '#0B1018' : '#DDE5EF'),
        ...(palette.surfaceSoft ? { 'surface-soft': palette.surfaceSoft } : {}),
        text: palette.text,
        'text-light': palette.textLight || (isDark ? '#FFFFFF' : '#526176'),
        'text-dark': palette.textMuted || (isDark ? '#91A0B5' : '#667489'),
        'text-disabled': palette.textDisabled || (isDark ? '#66758A' : '#98A3B3'),
        primary: palette.primary,
        ...(palette.primaryAlt ? { 'primary-alt': palette.primaryAlt } : {}),
        ...(palette.cyan ? { cyan: palette.cyan } : {}),
        ...(palette.border ? { border: palette.border } : {}),
        ...statusColors
      },
      themeConfig: normalizeTerminalThemeConfig(baseTerminalTheme)
    }
  })
}
