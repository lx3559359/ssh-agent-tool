const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('top bar exposes an in-client Chinese help center', () => {
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')
  const help = read('src/client/components/main/help-center-modal.jsx')

  assert.match(topbar, /QuestionCircleOutlined/)
  assert.match(topbar, /label:\s*'帮助'/)
  assert.match(topbar, /<HelpCenterModal/)
  assert.match(help, /ShellPilot 帮助中心/)
  for (const topic of ['SSH 终端', 'SFTP', '安全备份与恢复', 'AI 助手', '快捷命令', 'MCP 与 CLI', '在线更新', '工具日志']) {
    assert.match(help, new RegExp(topic))
  }
})

test('repository includes an offline Chinese user guide', () => {
  const guide = read('docs/USER_GUIDE_ZH.md')

  assert.match(guide, /# ShellPilot 中文使用帮助/)
  assert.match(guide, /SSH 终端/)
  assert.match(guide, /SFTP/)
  assert.match(guide, /更新源/)
  assert.match(guide, /安全操作中心/)
})
