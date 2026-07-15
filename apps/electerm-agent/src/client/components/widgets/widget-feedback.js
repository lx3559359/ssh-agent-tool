import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

export function formatWidgetSuccessMessage (result = {}, translate) {
  const detail = typeof result?.msg === 'string' ? result.msg : ''
  if (!detail.trim()) {
    return formatShellPilotTranslation(translate, 'shellpilotWidgetRunSucceeded')
  }
  return formatShellPilotTranslation(
    translate,
    'shellpilotWidgetRunSucceededWithDetail',
    { detail }
  )
}
