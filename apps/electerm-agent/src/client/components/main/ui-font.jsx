import { useEffect } from 'react'
import { notification } from '../common/notification'
import {
  getUiFontAvailability,
  getUiFontPreset
} from '../../common/ui-font-presets.js'

const warnedPresetIds = new Set()

export default function UiFont ({ presetId }) {
  useEffect(() => {
    const preset = getUiFontPreset(presetId)
    const availability = getUiFontAvailability(preset)
    const applied = availability === 'available'
      ? preset
      : getUiFontPreset('system')

    document.documentElement.style.setProperty(
      '--sp-ui-font-family',
      applied.stack
    )

    if (
      preset.id !== 'system' &&
      availability !== 'available' &&
      !warnedPresetIds.has(preset.id)
    ) {
      warnedPresetIds.add(preset.id)
      notification.warning({
        message: window.translate('uiFontFallbackNotice')
      })
    }
  }, [presetId])

  return null
}
