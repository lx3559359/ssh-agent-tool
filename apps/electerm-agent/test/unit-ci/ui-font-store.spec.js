const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const storeModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/store/ui-font.js'
)).href

test('previews applies cancels and normalizes UI font independently', async () => {
  const { default: extend } = await import(storeModuleUrl)
  class Store {
    constructor () {
      this._config = {
        uiFontPresetId: 'system',
        theme: 'shellpilot-ocean',
        fontFamily: 'Maple Mono'
      }
      this.previewUiFontPresetId = ''
    }

    get config () {
      return { ...this._config }
    }

    setConfig (value) {
      Object.assign(this._config, value)
    }
  }
  extend(Store)
  const store = new Store()
  global.window = { store }

  assert.equal(store.previewUiFontPreset('segoe-ui'), true)
  assert.equal(store.getUiFontPresetId(), 'segoe-ui')
  store.cancelUiFontPreview()
  assert.equal(store.getUiFontPresetId(), 'system')
  store.previewUiFontPreset('microsoft-yahei-ui')
  store.applyUiFontPreset()
  assert.equal(store.config.uiFontPresetId, 'microsoft-yahei-ui')
  assert.equal(store.config.theme, 'shellpilot-ocean')
  assert.equal(store.config.fontFamily, 'Maple Mono')
  assert.equal(store.previewUiFontPreset('not-a-preset'), false)

  delete global.window
})
