const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const widgetI18nPath = path.resolve(
  __dirname,
  '../../src/client/components/widgets/widget-i18n.js'
)

test('widgets display built-in tools with Chinese names instead of raw English names', async () => {
  const {
    getWidgetDisplay,
    formatInstanceTitle
  } = await import(pathToFileURL(widgetI18nPath))

  const widgets = [
    ['batch-op', 'Batch Operation', '批量任务'],
    ['local-file-server', 'Static File Server', '静态文件服务'],
    ['local-ftp-server', 'Local FTP Server', '本地 FTP 服务'],
    ['mcp-server', 'MCP Server', 'MCP 服务'],
    ['rename', 'File Renamer', '批量重命名']
  ]

  for (const [id, rawName, displayName] of widgets) {
    const meta = getWidgetDisplay({
      id,
      info: {
        name: rawName,
        type: id === 'batch-op' || id === 'rename' ? 'frontend' : 'instance'
      }
    })
    assert.equal(meta.title, displayName)
    assert.notEqual(meta.title, rawName)
    assert.equal(formatInstanceTitle({
      widgetId: id,
      title: rawName,
      id: '1'
    }), `${displayName} (1)`)
  }
})

test('widgets page source keeps user-facing labels Chinese', () => {
  const files = [
    '../../src/client/components/widgets/widgets-list.jsx',
    '../../src/client/components/widgets/widget-form.jsx',
    '../../src/client/components/widgets/widget-instances.jsx',
    '../../src/client/components/setting-panel/setting-modal.jsx'
  ].map(file => fs.readFileSync(path.resolve(__dirname, file), 'utf8'))

  const source = files.join('\n')
  assert.match(source, /工具中心/)
  assert.match(source, /运行中/)
  assert.match(source, /搜索工具/)
  assert.doesNotMatch(source, /<sup>Beta<\/sup>/)
  assert.doesNotMatch(source, />\s*Widgets\s*</)
  assert.doesNotMatch(source, />\s*RunningInstances/)
  assert.doesNotMatch(source, />\s*Search widgets/)
})

test('setting sync page source keeps common prompts and validation messages Chinese', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/setting-sync/setting-sync-form.jsx'),
    'utf8'
  )

  assert.match(source, /查看 Gist/)
  assert.match(source, /跳过 SSL 校验/)
  assert.match(source, /代理/)
  assert.match(source, /最多 200 个字符/)
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
})
