const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const toolbarSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/client/components/tree-list/bookmark-toolbar.jsx'),
  'utf8'
)

test('bookmark toolbar uses encrypted backup for its primary export action', () => {
  assert.match(
    toolbarSource,
    /onClick=\{handleDownloadEncrypted\}[\s\S]*?className='download-bookmark-icon'/
  )
  assert.match(
    toolbarSource,
    /label:\s*'加密备份（推荐）'[\s\S]*?onClick:\s*handleDownloadEncrypted/
  )
})

test('plaintext credential export is explicitly warned and confirmed', () => {
  assert.match(toolbarSource, /const handleDownloadPlaintext = \(\) =>/)
  assert.match(toolbarSource, /window\.confirm\('警告：该文件将以明文包含服务器密码/)
  assert.match(toolbarSource, /label:\s*'明文备份（含凭据，不推荐）'/)
  assert.match(toolbarSource, /onClick:\s*handleDownloadPlaintext/)
})

test('encrypted backup requires matching passphrase confirmation', () => {
  assert.match(toolbarSource, /const confirmation = window\.prompt\('再次输入备份加密密码'/)
  assert.match(toolbarSource, /if \(confirmation !== passphrase\)/)
  assert.match(toolbarSource, /message\.error\('两次输入的备份密码不一致'/)
})

test('bookmark toolbar provides an in-app cross-device migration guide', () => {
  assert.match(toolbarSource, /跨电脑迁移说明/)
  assert.match(toolbarSource, /源电脑/)
  assert.match(toolbarSource, /目标电脑/)
  assert.match(toolbarSource, /本地私钥文件/)
  assert.match(toolbarSource, /AI 模型配置/)
  assert.match(toolbarSource, /终端历史/)
  assert.match(toolbarSource, /Modal\.info/)
})
