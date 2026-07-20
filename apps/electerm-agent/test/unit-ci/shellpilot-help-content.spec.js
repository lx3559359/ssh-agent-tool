const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const helpUrl = pathToFileURL(path.join(
  root,
  'src/client/common/shellpilot-help-content.js'
)).href
const catalogUrl = pathToFileURL(path.join(
  root,
  'src/client/common/shellpilot-i18n-overrides.js'
)).href

test('English help covers every section with paired navigation labels', async () => {
  const { shellpilotEnglishHelpItems } = await import(helpUrl)
  const { getShellPilotTranslation } = await import(catalogUrl)
  const keys = shellpilotEnglishHelpItems.map(item => item.key)

  assert.equal(shellpilotEnglishHelpItems.length, 19)
  assert.equal(new Set(keys).size, shellpilotEnglishHelpItems.length)
  for (const item of shellpilotEnglishHelpItems) {
    assert.equal(typeof item.intro, 'string')
    assert.ok(item.intro.trim())
    assert.ok((item.steps?.length || 0) + (item.tips?.length || 0) > 0)
    assert.ok(getShellPilotTranslation(item.labelKey, 'zh_cn'))
    assert.ok(getShellPilotTranslation(item.labelKey, 'en_us'))
  }
})

