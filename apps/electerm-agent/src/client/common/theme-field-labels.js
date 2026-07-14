import { shellPilotTerminalBackground } from './shellpilot-theme-constraints.js'

const fieldLabels = Object.freeze({
  main: Object.freeze({ zh: '主界面色', en: 'Main' }),
  'main-dark': Object.freeze({ zh: '深色主界面色', en: 'Main Dark' }),
  'main-light': Object.freeze({ zh: '浅色主界面色', en: 'Main Light' }),
  text: Object.freeze({ zh: '文本色', en: 'Text' }),
  'text-light': Object.freeze({ zh: '浅色文本', en: 'Light Text' }),
  'text-dark': Object.freeze({ zh: '深色文本', en: 'Dark Text' }),
  'text-disabled': Object.freeze({ zh: '禁用文本', en: 'Disabled Text' }),
  primary: Object.freeze({ zh: '主色', en: 'Primary' }),
  info: Object.freeze({ zh: '信息色', en: 'Info' }),
  success: Object.freeze({ zh: '成功色', en: 'Success' }),
  error: Object.freeze({ zh: '错误色', en: 'Error' }),
  warn: Object.freeze({ zh: '警告色', en: 'Warning' }),
  'terminal:foreground': Object.freeze({ zh: '终端前景色', en: 'Terminal Foreground' }),
  'terminal:background': Object.freeze({ zh: '终端背景色', en: 'Terminal Background' }),
  'terminal:cursor': Object.freeze({ zh: '终端光标', en: 'Terminal Cursor' }),
  'terminal:cursorAccent': Object.freeze({ zh: '光标反色', en: 'Cursor Accent' }),
  'terminal:selectionBackground': Object.freeze({ zh: '选区背景色', en: 'Selection Background' }),
  'terminal:black': Object.freeze({ zh: 'ANSI 黑色', en: 'ANSI Black' }),
  'terminal:red': Object.freeze({ zh: 'ANSI 红色', en: 'ANSI Red' }),
  'terminal:green': Object.freeze({ zh: 'ANSI 绿色', en: 'ANSI Green' }),
  'terminal:yellow': Object.freeze({ zh: 'ANSI 黄色', en: 'ANSI Yellow' }),
  'terminal:blue': Object.freeze({ zh: 'ANSI 蓝色', en: 'ANSI Blue' }),
  'terminal:magenta': Object.freeze({ zh: 'ANSI 品红', en: 'ANSI Magenta' }),
  'terminal:cyan': Object.freeze({ zh: 'ANSI 青色', en: 'ANSI Cyan' }),
  'terminal:white': Object.freeze({ zh: 'ANSI 白色', en: 'ANSI White' }),
  'terminal:brightBlack': Object.freeze({ zh: 'ANSI 亮黑', en: 'ANSI Bright Black' }),
  'terminal:brightRed': Object.freeze({ zh: 'ANSI 亮红', en: 'ANSI Bright Red' }),
  'terminal:brightGreen': Object.freeze({ zh: 'ANSI 亮绿', en: 'ANSI Bright Green' }),
  'terminal:brightYellow': Object.freeze({ zh: 'ANSI 亮黄', en: 'ANSI Bright Yellow' }),
  'terminal:brightBlue': Object.freeze({ zh: 'ANSI 亮蓝', en: 'ANSI Bright Blue' }),
  'terminal:brightMagenta': Object.freeze({ zh: 'ANSI 亮品红', en: 'ANSI Bright Magenta' }),
  'terminal:brightCyan': Object.freeze({ zh: 'ANSI 亮青', en: 'ANSI Bright Cyan' }),
  'terminal:brightWhite': Object.freeze({ zh: 'ANSI 亮白', en: 'ANSI Bright White' }),
  name: Object.freeze({ zh: '主题名称', en: 'Theme Name' })
})

export const themeFieldKeys = Object.freeze(Object.keys(fieldLabels))

export function getThemeEditorLanguage (store = globalThis.window?.store) {
  return store?.previewLanguage || store?.config?.language || 'zh_cn'
}

export function getThemeFieldLabel (key, langId = 'zh_cn') {
  if (!Object.prototype.hasOwnProperty.call(fieldLabels, key)) {
    return typeof key === 'string' ? key : ''
  }
  const names = fieldLabels[key]
  const readableName = langId === 'zh_cn'
    ? `${names.zh} / ${names.en}`
    : names.en
  return `${readableName} (${key})`
}

export function isThemeFieldLocked (key) {
  return key === 'terminal:background'
}

export function getThemeFieldValue (key, value) {
  return isThemeFieldLocked(key)
    ? shellPilotTerminalBackground
    : value
}
