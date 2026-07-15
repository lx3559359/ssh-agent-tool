const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('default light UI still uses the locked near-black terminal background', async () => {
  const {
    defaultThemeLight
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/theme-defaults.js')))

  const theme = defaultThemeLight()

  assert.equal(theme.themeConfig.background, '#0E0F12')
  assert.equal(theme.themeConfig.foreground, '#1f2937')
  assert.equal(theme.themeConfig.cursor, '#2563eb')
})
