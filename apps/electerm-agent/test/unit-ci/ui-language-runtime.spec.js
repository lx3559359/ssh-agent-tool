const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('first run resolves OS language from stored config before merged defaults', () => {
  const ipc = read('src/app/lib/ipc.js')
  assert.match(ipc, /const \{\s*userConfig,\s*config\s*\} = await getConfig/)
  assert.match(ipc, /getLang\(userConfig, sysLocale, langs\)/)
  assert.doesNotMatch(ipc, /getLang\(config, sysLocale, langs\)/)
})

test('Ant Design follows effective preview or saved language', () => {
  const main = read('src/client/components/main/main.jsx')
  assert.match(main, /import enUS from 'antd\/locale\/en_US'/)
  assert.match(main, /const effectiveLanguage = store\.previewLanguage \|\| config\.language \|\| 'zh_cn'/)
  assert.match(main, /locale=\{effectiveLanguage === 'en_us' \? enUS : zhCN\}/)
})

test('preview apply cancel remains explicit and does not require reload', () => {
  const header = read('src/client/components/setting-panel/setting-header.jsx')
  assert.match(header, /handlePreviewLanguage/)
  assert.match(header, /store\.setConfig\(\{ language \}\)/)
  assert.match(header, /handleCancelLanguage/)
  assert.match(header, /store\.previewLanguage = ''/)
  assert.doesNotMatch(header, /window\.location\.reload/)
})
