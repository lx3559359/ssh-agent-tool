const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/common/ui-font-presets.js'
)).href

test('exposes exactly twenty stable grouped UI font presets', async () => {
  const { uiFontPresets } = await import(moduleUrl)
  assert.equal(uiFontPresets.length, 20)
  assert.equal(new Set(uiFontPresets.map(item => item.id)).size, 20)
  assert.deepEqual(uiFontPresets.map(item => item.id), [
    'system', 'microsoft-yahei-ui', 'dengxian', 'noto-sans-sc', 'misan',
    'source-han-sans-sc', 'harmonyos-sans-sc', 'microsoft-jhenghei-ui',
    'segoe-ui', 'segoe-ui-variable', 'bahnschrift', 'calibri', 'arial',
    'tahoma', 'verdana', 'trebuchet-ms', 'corbel', 'candara', 'ebrima',
    'yu-gothic-ui'
  ])
  assert.equal(Object.isFrozen(uiFontPresets), true)
})

test('normalizes unknown values and searches Chinese English and aliases', async () => {
  const { normalizeUiFontPresetId, searchUiFontPresets } = await import(moduleUrl)
  assert.equal(normalizeUiFontPresetId('segoe-ui'), 'segoe-ui')
  assert.equal(normalizeUiFontPresetId('missing-font'), 'system')
  assert.deepEqual(searchUiFontPresets('雅黑').map(item => item.id), ['microsoft-yahei-ui'])
  assert.deepEqual(searchUiFontPresets('trebuchet').map(item => item.id), ['trebuchet-ms'])
  assert.deepEqual(searchUiFontPresets('system').map(item => item.id), ['system'])
})

test('reports available unavailable and unknown font detection states', async () => {
  const { getUiFontAvailability } = await import(moduleUrl)
  assert.equal(getUiFontAvailability({ id: 'system' }), 'available')
  assert.equal(getUiFontAvailability(
    { id: 'known', family: 'Known UI' },
    { measure: family => family.includes('Known UI') ? 120 : 100 }
  ), 'available')
  assert.equal(getUiFontAvailability(
    { id: 'missing', family: 'Missing UI' },
    { measure: () => 100 }
  ), 'unavailable')
  assert.equal(getUiFontAvailability(
    { id: 'broken', family: 'Broken UI' },
    { measure: () => { throw new Error('canvas unavailable') } }
  ), 'unknown')
})

test('font picker uses the fixed catalog and exposes accessible explicit controls', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/setting-panel/ui-font-picker.jsx'
  ), 'utf8')

  assert.match(source, /searchUiFontPresets/)
  assert.match(source, /getUiFontAvailability/)
  assert.match(source, /role='searchbox'/)
  assert.match(source, /role='listbox'/)
  assert.match(source, /role='option'/)
  assert.match(source, /aria-disabled/)
  assert.match(source, /fontNotInstalled/)
  assert.match(source, /fontDetectionUnavailable/)
  assert.match(source, /applyUiFont/)
  assert.match(source, /cancelUiFontPreview/)
})
