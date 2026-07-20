export const systemUiFontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', Arial, sans-serif"

const preset = (id, zh, en, family, group, aliases = []) => Object.freeze({
  id,
  zh,
  en,
  family,
  group,
  aliases: Object.freeze(aliases),
  stack: family ? `'${family}', ${systemUiFontStack}` : systemUiFontStack
})

export const uiFontPresets = Object.freeze([
  preset('system', '跟随系统', 'System Default', '', 'recommended', ['系统', 'default']),
  preset('microsoft-yahei-ui', '微软雅黑 UI', 'Microsoft YaHei UI', 'Microsoft YaHei UI', 'recommended', ['雅黑', 'yahei']),
  preset('dengxian', '等线', 'DengXian', 'DengXian', 'recommended'),
  preset('noto-sans-sc', 'Noto Sans SC', 'Noto Sans SC', 'Noto Sans SC', 'recommended'),
  preset('misan', 'MiSans', 'MiSans', 'MiSans', 'recommended'),
  preset('source-han-sans-sc', '思源黑体', 'Source Han Sans SC', 'Source Han Sans SC', 'recommended', ['思源']),
  preset('harmonyos-sans-sc', 'HarmonyOS Sans', 'HarmonyOS Sans', 'HarmonyOS Sans SC', 'recommended'),
  preset('microsoft-jhenghei-ui', '微软正黑体 UI', 'Microsoft JhengHei UI', 'Microsoft JhengHei UI', 'recommended', ['正黑']),
  preset('segoe-ui', 'Segoe UI', 'Segoe UI', 'Segoe UI', 'modern'),
  preset('segoe-ui-variable', 'Segoe UI Variable', 'Segoe UI Variable', 'Segoe UI Variable', 'modern'),
  preset('bahnschrift', 'Bahnschrift', 'Bahnschrift', 'Bahnschrift', 'modern'),
  preset('calibri', 'Calibri', 'Calibri', 'Calibri', 'modern'),
  preset('arial', 'Arial', 'Arial', 'Arial', 'modern'),
  preset('tahoma', 'Tahoma', 'Tahoma', 'Tahoma', 'modern'),
  preset('verdana', 'Verdana', 'Verdana', 'Verdana', 'modern'),
  preset('trebuchet-ms', 'Trebuchet MS', 'Trebuchet MS', 'Trebuchet MS', 'modern'),
  preset('corbel', 'Corbel', 'Corbel', 'Corbel', 'more'),
  preset('candara', 'Candara', 'Candara', 'Candara', 'more'),
  preset('ebrima', 'Ebrima', 'Ebrima', 'Ebrima', 'more'),
  preset('yu-gothic-ui', '游ゴシック UI', 'Yu Gothic UI', 'Yu Gothic UI', 'more', ['游黑'])
])

export function normalizeUiFontPresetId (value) {
  return uiFontPresets.some(item => item.id === value) ? value : 'system'
}

export function getUiFontPreset (value) {
  const id = normalizeUiFontPresetId(value)
  return uiFontPresets.find(item => item.id === id)
}

export function searchUiFontPresets (query = '') {
  const needle = String(query).trim().toLocaleLowerCase()
  if (!needle) return uiFontPresets
  return uiFontPresets.filter(item => {
    return [item.zh, item.en, item.family, ...item.aliases]
      .some(value => value.toLocaleLowerCase().includes(needle))
  })
}

function browserMeasure (family, fallback = 'monospace') {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  context.font = `72px '${family}', ${fallback}`
  return context.measureText('mmmmmmmmmmWWWWWW1234567890').width
}

export function getUiFontAvailability (item, options = {}) {
  if (!item || item.id === 'system' || !item.family) return 'available'
  const measure = options.measure || browserMeasure
  try {
    const baselines = ['monospace', 'sans-serif']
    const differs = baselines.some(fallback => {
      return measure(item.family, fallback) !== measure(fallback, fallback)
    })
    return differs ? 'available' : 'unavailable'
  } catch {
    return 'unknown'
  }
}
