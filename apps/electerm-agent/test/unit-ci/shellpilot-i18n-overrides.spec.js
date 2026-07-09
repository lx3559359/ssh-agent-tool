const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const i18nPath = path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-i18n-overrides.js'
)

test('ShellPilot fills missing Chinese labels from the Electerm locale package', async () => {
  const { getShellPilotTranslation } = await import(pathToFileURL(i18nPath))

  assert.equal(getShellPilotTranslation('ssh', 'zh_cn'), '终端')
  assert.equal(getShellPilotTranslation('sftp', 'zh_cn'), 'SFTP')
  assert.equal(getShellPilotTranslation('widgets', 'zh_cn'), '工具中心')
  assert.equal(getShellPilotTranslation('unknownKey', 'zh_cn'), undefined)
})
