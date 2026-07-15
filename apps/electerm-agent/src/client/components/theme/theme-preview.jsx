import { normalizeThemePreview } from '../../common/theme-preview-model.js'

const e = window.translate

function buildScopedStyle (tokens) {
  return Object.entries(tokens).reduce((result, [key, value]) => {
    const cssKey = key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)
    result[`--sp-${cssKey}`] = value
    return result
  }, {})
}

export default function ThemePreview ({ theme }) {
  if (!theme || typeof theme !== 'object') {
    return null
  }
  const normalized = normalizeThemePreview(theme)
  const style = buildScopedStyle(normalized.tokens)
  const terminalStyle = {
    background: normalized.themeConfig.background,
    color: normalized.themeConfig.foreground,
    '--sp-theme-preview-cursor': normalized.themeConfig.cursor,
    '--sp-theme-preview-selection': normalized.themeConfig.selectionBackground
  }

  return (
    <aside className='sp-theme-preview-scope' style={style}>
      <div className='sp-theme-preview-heading'>
        <div>
          <h3>{e('themePreview')}</h3>
          <p>{e('terminalBackgroundLocked')}</p>
        </div>
        <span className='sp-theme-preview-status'>{e('connectionHealthy')}</span>
      </div>
      <div className='sp-theme-preview-ui'>
        <div className='sp-card sp-theme-preview-card'>
          <strong>{e('generalSettings')}</strong>
          <label className='sp-theme-preview-field'>
            <span>{e('language')}</span>
            <i />
          </label>
          <label className='sp-theme-preview-field'>
            <span>{e('themeUpdateChannel')}</span>
            <i />
          </label>
          <span className='sp-theme-preview-action' aria-hidden='true'>
            {e('apply')}
          </span>
        </div>
        <div className='sp-theme-preview-menu' role='presentation'>
          <strong>{e('themeContextMenu')}</strong>
          <span>{e('copy')}</span>
          <span>{e('paste')}</span>
          <span>{e('edit')}</span>
        </div>
      </div>
      <div className='sp-theme-preview-terminal' style={terminalStyle}>
        <span className='sp-theme-preview-terminal-lock'>
          {e('terminalBackgroundLocked')}
        </span>
        <code>
          <span>root@server:~# </span>
          <mark>systemctl status nginx</mark>
          <br />
          <b>● active (running)</b>
          <i aria-hidden='true' />
        </code>
      </div>
    </aside>
  )
}
