const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function toDataUrl (source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

async function importMainGuards () {
  const source = read('src/client/components/main/main.jsx')
  const start = source.indexOf('export function getSafeRightPanelTitle')
  const componentStart = /\r?\n\r?\nexport default/.exec(source.slice(start))
  const end = componentStart ? start + componentStart.index : -1

  assert.notEqual(start, -1, 'safe right panel title resolver must be exported from main')
  assert.notEqual(end, -1, 'safe right panel title resolver must end before the main component')
  return import(toDataUrl(source.slice(start, end)))
}

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

test('test3 uses a Playwright file regex instead of a shell-dependent glob', () => {
  const pkg = JSON.parse(read('package.json'))
  const script = pkg.scripts.test3

  assert.ok(script.includes('test/e2e/02.*\\.js'))
  assert.doesNotMatch(script, /test\/e2e\/02\*\.js/)
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

  assert.match(submitButtons, /e\('temporaryConnection'\)/)
  assert.match(submitButtons, /e\('temporaryConnectionHint'\)/)
  assert.match(formRenderer, /e\('connectionSucceeded'\)/)
  assert.match(formRenderer, /e\('connectionFailed'\)/)
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

test('renderer shell guards empty tabs and a missing current tab', () => {
  const main = read('src/client/components/main/main.jsx')

  assert.match(main, /const\s+tabs\s*=\s*\(store\.getTabs\(\)\s*\|\|\s*\[\]\)\.filter\(Boolean\)/)
  assert.match(main, /const\s+currentTab\s*=\s*store\.currentTab\s*\|\|\s*null/)
  assert.match(main, /const\s+activeTabId\s*=\s*currentTab\?\.id\s*\|\|\s*store\.activeTabId\s*\|\|\s*''/)
  assert.doesNotMatch(main, /store\.getTabs\(\)\.filter/)
})

test('renderer shell and right AI panel tolerate a null config', () => {
  const main = read('src/client/components/main/main.jsx')
  const sidePanel = read('src/client/components/side-panel-r/side-panel-r.jsx')

  assert.match(main, /const\s+rawConfig\s*=\s*store\.config/)
  assert.match(main, /const\s+config\s*=\s*rawConfig\s*\|\|\s*\{\}/)
  assert.doesNotMatch(main, /store\.config\.useSystemTitleBar/)
  assert.match(sidePanel, /const\s+safeConfig\s*=\s*config\s*\|\|\s*\{\}/)
  assert.match(sidePanel, /getActiveAIConfig\(safeConfig\)\s*\|\|\s*\{\}/)
  assert.doesNotMatch(sidePanel, /getActiveAIConfig\(config\)/)
})

test('renderer shell reads the right panel title only after raw config is available', async () => {
  const { getSafeRightPanelTitle } = await importMainGuards()
  let configAvailable = false
  let titleReads = 0
  const store = {
    get rightPanelTitle () {
      titleReads += 1
      if (!configAvailable) {
        throw new Error('rightPanelTitle read before config fallback')
      }
      return 'AI assistant'
    }
  }

  assert.equal(getSafeRightPanelTitle(store, null), '')
  assert.equal(titleReads, 0)
  configAvailable = true
  assert.equal(getSafeRightPanelTitle(store, {}), 'AI assistant')
  assert.equal(titleReads, 1)

  const main = read('src/client/components/main/main.jsx')
  const storeDestructureStart = main.indexOf('const {', main.indexOf('const { store }'))
  const storeDestructureEnd = main.indexOf('} = store', storeDestructureStart)
  const storeDestructure = main.slice(storeDestructureStart, storeDestructureEnd)
  const rawConfigIndex = main.indexOf('const rawConfig = store.config')
  const configFallbackIndex = main.indexOf('const config = rawConfig || {}')
  const titleIndex = main.indexOf('const rightPanelTitle = getSafeRightPanelTitle')

  assert.doesNotMatch(storeDestructure, /rightPanelTitle/)
  assert.notEqual(rawConfigIndex, -1)
  assert.ok(
    titleIndex > configFallbackIndex && configFallbackIndex > rawConfigIndex,
    'rightPanelTitle must be resolved after the raw config fallback'
  )
})

test('renderer startup cleanup only owns component callbacks listeners and timers', () => {
  const main = read('src/client/components/main/main.jsx')

  assert.doesNotMatch(main, /createAsyncResultGuard|asyncResultGuard\.run/)
  assert.match(main, /store\.initData\(\)/)
  assert.match(main, /return\s*\(\)\s*=>\s*\{/)
  assert.match(main, /clearTimeout\(resizeTimer\)/)
  assert.match(main, /window\.removeEventListener\('resize', store\.onResize\)/)
  assert.match(main, /ipcOffEvent\('open-tab', openTab\)/)
})
