const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const widgetI18nPath = path.resolve(
  __dirname,
  '../../src/client/components/widgets/widget-i18n.js'
)
const shellPilotI18nPath = path.resolve(
  __dirname,
  '../../src/client/common/shellpilot-i18n-overrides.js'
)
const widgetFeedbackPath = path.resolve(
  __dirname,
  '../../src/client/components/widgets/widget-feedback.js'
)

test('widgets display built-in tools in Chinese and English instead of raw internal names', async () => {
  const {
    getWidgetDisplay,
    formatInstanceTitle
  } = await import(pathToFileURL(widgetI18nPath))
  const { getShellPilotTranslation } = await import(pathToFileURL(shellPilotI18nPath))
  const translate = langId => key => getShellPilotTranslation(key, langId) || key

  const widgets = [
    ['batch-op', 'Batch Operation', '批量任务', 'Batch Tasks'],
    ['local-file-server', 'Static File Server', '静态文件服务', 'Static File Service'],
    ['local-ftp-server', 'Local FTP Server', '本地 FTP 服务', 'Local FTP Service'],
    ['mcp-server', 'MCP Server', 'MCP 服务', 'MCP Service'],
    ['rename', 'File Renamer', '批量重命名', 'Batch Rename']
  ]

  for (const [id, rawName, chineseName, englishName] of widgets) {
    const widget = {
      id,
      info: {
        name: rawName,
        type: id === 'batch-op' || id === 'rename' ? 'frontend' : 'instance'
      }
    }
    assert.equal(getWidgetDisplay(widget, translate('zh_cn')).title, chineseName)
    assert.equal(getWidgetDisplay(widget, translate('en_us')).title, englishName)
    assert.equal(formatInstanceTitle({
      widgetId: id,
      title: rawName,
      id: '1'
    }, translate('zh_cn')), `${chineseName} (1)`)
    assert.equal(formatInstanceTitle({
      widgetId: id,
      title: rawName,
      id: '1'
    }, translate('en_us')), `${englishName} (1)`)
  }
})

test('widgets page source routes user-facing labels through preview-language translation', () => {
  const files = [
    '../../src/client/components/widgets/widgets-list.jsx',
    '../../src/client/components/widgets/widget-form.jsx',
    '../../src/client/components/widgets/widget-instances.jsx',
    '../../src/client/components/setting-panel/setting-modal.jsx'
  ].map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8'))

  const source = files.join('\n')
  assert.match(source, /getWidgetDisplay\(widget, e\)/)
  assert.match(source, /languageVersion/)
  assert.match(source, /shellpilotWidgetToolCenter/)
  assert.doesNotMatch(source, /<sup>Beta<\/sup>/)
  assert.doesNotMatch(source, />\s*Widgets\s*</)
  assert.doesNotMatch(source, />\s*RunningInstances/)
  assert.doesNotMatch(source, />\s*Search widgets/)
})

test('widget cards expose stable widget identity and type attributes', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/widgets/widgets-list.jsx'
  ), 'utf8')

  assert.match(source, /data-widget-id=\{widget\.id\}/)
  assert.match(source, /data-widget-type=\{widget\.info\.type\}/)
})

test('widget success feedback preserves tool details with a localized prefix', async () => {
  const { formatWidgetSuccessMessage } = await import(pathToFileURL(widgetFeedbackPath))
  const { getShellPilotTranslation } = await import(pathToFileURL(shellPilotI18nPath))
  const translate = langId => key => getShellPilotTranslation(key, langId) || key
  const detail = 'Renamed 3 files successfully'

  assert.equal(
    formatWidgetSuccessMessage({ msg: detail }, translate('zh_cn')),
    `工具运行成功：${detail}`
  )
  assert.equal(
    formatWidgetSuccessMessage({ msg: detail }, translate('en_us')),
    `Tool completed successfully: ${detail}`
  )
  assert.equal(
    formatWidgetSuccessMessage({}, translate('en_us')),
    'Tool completed successfully'
  )

  const controlSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/widgets/widget-control.jsx'
  ), 'utf8')
  assert.match(controlSource, /formatWidgetSuccessMessage\(result, e\)/)
  assert.doesNotMatch(controlSource, /showMsg\(e\('shellpilotWidgetRunSucceeded'\)/)
})

test('setting sync page source routes prompts and validation through runtime translations', () => {
  const source = [
    '../../src/client/components/setting-sync/setting-sync-form.jsx',
    '../../src/client/components/setting-sync/sync-data-compare.jsx'
  ].map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8')).join('\\n')

  assert.match(source, /e\('shellpilotViewGist'\)/)
  assert.match(source, /e\('shellpilotSkipSslVerification'\)/)
  assert.match(source, /e\('shellpilotProxy'\)/)
  assert.match(source, /tf\('shellpilotMaxCharacters', \{ count: 200 \}\)/)
  assert.doesNotMatch(source, />Check gist</)
  assert.doesNotMatch(source, /Request failed/)
  assert.doesNotMatch(source, /Gitee data sync is not recommended/)
  assert.doesNotMatch(source, /200 chars max/)
  assert.doesNotMatch(source, /Server URL is required/)
  assert.doesNotMatch(source, /Username is required/)
  assert.doesNotMatch(source, /Password is required/)
  assert.doesNotMatch(source, /Skip SSL verify/)
  assert.doesNotMatch(source, /personal access token/)
  assert.doesNotMatch(source, /label='Proxy'/)
  assert.doesNotMatch(source, /Bookmark Groups/)
  assert.doesNotMatch(source, /Terminal Themes/)
  assert.doesNotMatch(source, /Quick Commands/)
  assert.doesNotMatch(source, /Address Bookmarks/)
})
