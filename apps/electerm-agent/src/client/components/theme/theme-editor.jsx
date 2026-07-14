// import { buildDefaultThemes } from '../../common/terminal-theme'
import ThemeEditSlot from './theme-edit-slot'
import {
  getThemeEditorLanguage,
  getThemeFieldLabel,
  getThemeFieldValue,
  isThemeFieldLocked
} from '../../common/theme-field-labels.js'

export default function ThemeEditor (props) {
  const { themeText, disabled } = props
  const obj = themeText.split('\n').reduce((prev, line) => {
    let [key = '', value = ''] = line.split('=')
    key = key.trim()
    value = value.trim()
    if (!key || !value) {
      return prev
    }
    prev[key] = value
    return prev
  }, {})
  const keys = Object.keys(obj)
  const language = getThemeEditorLanguage()
  function onChange (value, name) {
    props.onChange(value, name)
  }
  return (
    <div className='editor-u-picker'>
      {
        keys.map(k => {
          const locked = isThemeFieldLocked(k)
          return (
            <ThemeEditSlot
              key={k}
              name={k}
              label={getThemeFieldLabel(k, language)}
              value={getThemeFieldValue(k, obj[k])}
              disabled={disabled || locked}
              locked={locked}
              onChange={onChange}
            />
          )
        })
      }
    </div>
  )
}
