export const glacierThemeId = 'shellpilot-glacier'
export const graphiteSilverThemeId = 'shellpilot-graphite-silver'

const pairedThemes = Object.freeze({
  [glacierThemeId]: graphiteSilverThemeId,
  [graphiteSilverThemeId]: glacierThemeId
})

export function getThemeToggleTarget (themeId) {
  return pairedThemes[themeId] || (
    themeId === 'defaultLight' ? 'default' : 'defaultLight'
  )
}

export function isLightUiTheme (themeId, themes = []) {
  const active = themes.find(theme => theme && theme.id === themeId)
  if (active && (active.mode === 'light' || active.mode === 'dark')) {
    return active.mode === 'light'
  }
  return themeId === glacierThemeId || themeId === 'defaultLight'
}
