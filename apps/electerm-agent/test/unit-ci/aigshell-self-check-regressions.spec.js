const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Windows test preparation uses cross-env and a current Playwright version', () => {
  const pkg = JSON.parse(read('package.json'))
  const script = pkg.scripts['prepare-test']

  assert.match(script, /cross-env\s+PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/)
  assert.doesNotMatch(script, /playwright@1\.28\.1/)
  assert.match(script, /@playwright\/test@1\.61\.1/)
})

test('developer scripts avoid POSIX-only local binary paths on Windows', () => {
  const pkg = JSON.parse(read('package.json'))
  const scriptNames = ['lint', 'fix', 'test1', 'test2', 'test3']

  for (const name of scriptNames) {
    assert.doesNotMatch(pkg.scripts[name], /\.\/node_modules\/\.bin\//, name)
  }
})

test('e2e SSH helpers target the AIGShell Chinese UI', () => {
  const common = read('test/e2e/common/common.js')

  assert.match(common, /aigshell-topbar-action/)
  assert.doesNotMatch(common, /\.btns\s+\.anticon-plus-circle/)
  assert.match(common, /Trust and Save/)
  assert.match(common, /信任并保存/)
  assert.match(common, /\.session-current\s+\.term-sftp-tabs\s+\.type-tab:visible/)
})

test('SSH form exposes a clear temporary connect action and localized feedback', () => {
  const submitButtons = read('src/client/components/bookmark-form/common/submit-buttons.jsx')
  const formRenderer = read('src/client/components/bookmark-form/form-renderer.jsx')

  assert.match(submitButtons, /仅连接/)
  assert.match(submitButtons, /不保存配置/)
  assert.match(formRenderer, /连接成功/)
  assert.match(formRenderer, /连接失败/)
})

test('AI chat copy is readable Simplified Chinese', () => {
  const copy = read('src/client/components/ai/ai-agent-copy.json')
  const chat = read('src/client/components/ai/ai-chat.jsx')

  assert.match(copy, /"ask":\s*"对话"/)
  assert.match(copy, /输入你的问题/)
  assert.match(copy, /Enter 发送/)
  assert.match(chat, /引用终端/)
  assert.match(chat, /引用选中/)
  assert.match(chat, /生成命令/)
  assert.doesNotMatch(chat, /ai-help-link/)
  assert.doesNotMatch(chat, />帮助</)
})

test('only the ShellPilot top bar renders desktop window controls', () => {
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')
  const tabs = read('src/client/components/tabs/index.jsx')

  assert.match(topbar, /import WindowControl/)
  assert.match(topbar, /<WindowControl store=\{store\}/)
  assert.doesNotMatch(tabs, /import WindowControl/)
  assert.doesNotMatch(tabs, /renderWindowControl/)
})

test('AIGShell top bar labels avoid ambiguous unfinished actions', () => {
  const topbar = read('src/client/components/main/aigshell-topbar.jsx')

  assert.match(topbar, /label:\s*'备份同步'/)
  assert.match(topbar, /label:\s*'检查更新'/)
  assert.doesNotMatch(topbar, /label:\s*'备份'/)
})
test('right AI panel title avoids duplicate AI wording', () => {
  const sidePanel = read('src/client/components/side-panel-r/side-panel-r.jsx')

  assert.doesNotMatch(sidePanel, /\{tag\}\s*\{isAI\s*\?\s*'AI\s/)
  assert.match(sidePanel, /isAI\s*\?\s*'助手'/)
})
