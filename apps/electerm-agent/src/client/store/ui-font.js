import {
  normalizeUiFontPresetId,
  uiFontPresets
} from '../common/ui-font-presets.js'

export default Store => {
  Store.prototype.getUiFontPresetId = function () {
    const { store } = window
    return normalizeUiFontPresetId(
      store.previewUiFontPresetId || store.config.uiFontPresetId
    )
  }

  Store.prototype.previewUiFontPreset = function (id) {
    const { store } = window
    if (!uiFontPresets.some(item => item.id === id)) return false
    store.previewUiFontPresetId = id
    return true
  }

  Store.prototype.applyUiFontPreset = function () {
    const { store } = window
    const id = normalizeUiFontPresetId(
      store.previewUiFontPresetId || store.config.uiFontPresetId
    )
    store.setConfig({ uiFontPresetId: id })
    store.previewUiFontPresetId = ''
    return id
  }

  Store.prototype.cancelUiFontPreview = function () {
    window.store.previewUiFontPresetId = ''
  }
}
