const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const stylus = require('stylus')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '../..')

function read (relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), 'utf8')
}

function compileStylus (relativePath) {
  const absolutePath = path.resolve(projectRoot, relativePath)
  return new Promise((resolve, reject) => {
    stylus(read(relativePath))
      .set('filename', absolutePath)
      .set('paths', [path.dirname(absolutePath)])
      .render((error, css) => error ? reject(error) : resolve(css))
  })
}

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/sftp/context-menu-utils.js')
).href
const fileItemSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/client/components/sftp/file-item.jsx'),
  'utf8'
)

function createItems (count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `item-${index + 1}`,
    label: `菜单 ${index + 1}`
  }))
}

test('sftp context menu keeps all items when there is enough viewport space', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(5)

  assert.deepEqual(
    splitOverflowMenu({ items, clientY: 80, windowHeight: 600 }),
    items
  )
})

test('sftp context menu uses a readable chinese more submenu when it would overflow', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(10)
  const result = splitOverflowMenu({ items, clientY: 520, windowHeight: 600 })
  const more = result[result.length - 1]

  assert.equal(result.length, 6)
  assert.equal(more.key, 'more-submenu')
  assert.equal(more.label, '更多')
  assert.deepEqual(more.children, items.slice(5))
  assert.deepEqual(result.slice(0, 5), items.slice(0, 5))
})

test('sftp context menu does not create an overflow submenu for short menus', async () => {
  const { splitOverflowMenu } = await import(moduleUrl)
  const items = createItems(6)

  assert.deepEqual(
    splitOverflowMenu({ items, clientY: 590, windowHeight: 600 }),
    items
  )
})

test('sftp file context menu uses safe AI analysis outside the edit-size guard', () => {
  const methodSource = fileItemSource.slice(
    fileItemSource.indexOf('askAiAboutFile = async'),
    fileItemSource.indexOf('transferOrEnterDirectory = async')
  )
  const aiMenuIndex = fileItemSource.indexOf("func: 'askAiAboutFile'")
  const showEditIndex = fileItemSource.indexOf('if (showEdit)')

  assert.match(fileItemSource, /func:\s*'askAiAboutFile'/)
  assert.match(fileItemSource, /text:\s*'让 AI 分析此文件'/)
  assert.match(fileItemSource, /buildSftpFileTerminalAnalysisPrompt/)
  assert.ok(aiMenuIndex > -1 && aiMenuIndex < showEditIndex)
  assert.match(methodSource, /readSftpFileContext/)
  assert.doesNotMatch(methodSource, /fetchEditorText\(filePath,\s*type\)/)
})

test('all application context menu surfaces use the shared overlay class', () => {
  const contracts = [
    ['src/client/components/tree-list/tree-list-row.jsx', /overlayClassName:\s*'shellpilot-context-menu'/],
    ['src/client/components/terminal/terminal.jsx', /overlayClassName:\s*'shellpilot-context-menu'/],
    ['src/client/components/sftp/list-table-ui.jsx', /overlayClassName:\s*'shellpilot-context-menu'/],
    ['src/client/components/sftp/file-table-header.jsx', /overlayClassName:\s*'shellpilot-context-menu'/],
    ['src/client/components/tabs/tab.jsx', /overlayClassName:\s*'shellpilot-context-menu'/],
    ['src/client/components/common/input-context-menu.jsx', /overlayClassName='shellpilot-context-menu'/],
    ['src/client/components/sidebar/transfer-list.jsx', /overlayClassName:\s*'transfer-list-card shellpilot-context-menu shellpilot-transfer-history-popover'/],
    ['src/client/components/sftp/file-item.jsx', /popupClassName:\s*'shellpilot-context-menu'/]
  ]

  for (const [relativePath, pattern] of contracts) {
    assert.match(read(relativePath), pattern, relativePath)
  }
})

test('existing destructive SFTP and tab actions are marked dangerous without changing dispatch', () => {
  const tabSource = read('src/client/components/tabs/tab.jsx')
  const listSource = read('src/client/components/sftp/list-table-ui.jsx')

  assert.match(fileItemSource, /key:\s*func,[\s\S]{0,180}danger:\s*requireConfirm/)
  for (const key of ['handleClose', 'closeOther', 'closeTabsRight']) {
    assert.match(tabSource, new RegExp(`key: '${key}'[\\s\\S]{0,180}danger: true`))
  }
  assert.match(listSource, /if \(key !== 'more-submenu'\)[\s\S]{0,120}inst\[key\]\(\)/)
  assert.match(fileItemSource, /if \(key !== 'more-submenu'\)[\s\S]{0,100}this\[key\]\(\)/)
})

test('shared and system menu styles compile with viewport-safe wrapping contracts', async () => {
  const stylePath = path.resolve(projectRoot, 'src/client/components/common/context-menu.styl')
  assert.equal(fs.existsSync(stylePath), true, 'shared context menu stylesheet must exist')

  const shared = read('src/client/components/common/context-menu.styl')
  const basic = read('src/client/css/basic.styl')
  const system = read('src/client/components/sys-menu/sys-menu.styl')
  const systemComponent = read('src/client/components/sys-menu/sys-menu.jsx')

  const [sharedCss, , systemCss] = await Promise.all([
    compileStylus('src/client/components/common/context-menu.styl'),
    compileStylus('src/client/css/basic.styl'),
    compileStylus('src/client/components/sys-menu/sys-menu.styl')
  ])

  assert.match(basic, /@require '\.\.\/components\/common\/context-menu'/)
  assert.match(shared, /min-width 220px/)
  assert.match(sharedCss, /max-width:\s*min\(360px, calc\(100vw - 16px\)\)/)
  assert.match(shared, /max-height calc\(100vh - 16px\)/)
  assert.match(shared, /overflow-y auto/)
  assert.match(shared, /grid-template-columns auto minmax\(0, 1fr\) auto/)
  assert.match(shared, /overflow-wrap anywhere/)
  assert.doesNotMatch(shared, /text-overflow ellipsis/)
  assert.match(shared, /var\(--sp-surface-elevated\)/)
  assert.match(shared, /var\(--sp-shadow-overlay\)/)
  assert.match(shared, /var\(--sp-danger\)/)
  assert.match(shared, /var\(--sp-text-disabled\)/)

  assert.doesNotMatch(system, /width 280px/)
  assert.doesNotMatch(system, /#08c/i)
  assert.doesNotMatch(system, /text-overflow ellipsis/)
  assert.match(systemCss, /max-width:\s*min\(360px, calc\(100vw - 16px\)\)/)
  assert.match(system, /overflow-wrap anywhere/)
  assert.match(systemComponent, /className='context-item-label'/)

  for (const viewport of [590, 393]) {
    assert.ok(Math.min(360, viewport - 16) <= viewport - 16)
  }
})
