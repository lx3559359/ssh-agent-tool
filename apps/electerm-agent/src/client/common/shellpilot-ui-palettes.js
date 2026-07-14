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
    main: '#F4F2FA',
    mainLight: '#FFFFFF',
    text: '#302C45',
    primary: '#5B43C3'
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
    main: '#10161F',
    mainLight: '#19212C',
    text: '#DBE4EF',
    primary: '#55A8FF'
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
    const statusColors = isDark
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
        'main-dark': isDark ? '#0B1018' : '#DDE5EF',
        text: palette.text,
        'text-light': isDark ? '#FFFFFF' : '#526176',
        'text-dark': isDark ? '#91A0B5' : '#667489',
        'text-disabled': isDark ? '#66758A' : '#98A3B3',
        primary: palette.primary,
        ...statusColors
      },
      themeConfig: normalizeTerminalThemeConfig(baseTerminalTheme)
    }
  })
}
