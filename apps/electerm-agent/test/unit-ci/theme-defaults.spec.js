const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

test('default light theme uses light terminal background with dark foreground', async () => {
  const {
    defaultThemeLight
  } = await import(pathToFileURL(path.resolve(__dirname, '../../src/client/common/theme-defaults.js')))

  const theme = defaultThemeLight()

  assert.equal(theme.themeConfig.background, '#f7f8fa')
  assert.equal(theme.themeConfig.foreground, '#1f2937')
  assert.equal(theme.themeConfig.cursor, '#2563eb')
})
