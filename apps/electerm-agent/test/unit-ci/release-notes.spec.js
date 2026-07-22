const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const pack = JSON.parse(read('package.json'))

test('current release notes clearly separate added fixed and changed items', () => {
  const notes = read(`docs/releases/v${pack.version}.md`)

  assert.match(notes, /^## \[新增\]/m)
  assert.match(notes, /^## \[修复\]/m)
  assert.match(notes, /^## \[改动\]/m)
})

test('v0.4.6 release metadata documents the readonly Agent usability release', () => {
  const notes = read('docs/releases/v0.4.6.md')
  for (const section of ['新增', '修复', '改动']) {
    assert.match(notes, new RegExp(`^## \\[${section}\\]`, 'm'))
  }
  for (const phrase of [
    '只读 exec 快路径',
    '人工命令直通',
    '风险单弹窗',
    '运行图标',
    '工具卡',
    '真实 VPS 只读验证'
  ]) {
    assert.match(notes, new RegExp(phrase))
  }
})

test('v0.4.7 release metadata documents the online update republish', () => {
  const notes = read('docs/releases/v0.4.7.md')
  for (const section of ['新增', '修复', '改动']) {
    assert.match(notes, new RegExp(`^## \\[${section}\\]`, 'm'))
  }
  for (const phrase of [
    '0.4.7',
    '0.4.6',
    '在线更新',
    'ModelScope',
    'latest.yml'
  ]) {
    assert.match(notes, new RegExp(phrase))
  }
})

test('v0.4.8 release metadata documents the UI modernization release', () => {
  const notes = read('docs/releases/v0.4.8.md')
  for (const section of ['新增', '修复', '改动']) {
    assert.match(notes, new RegExp(`^## \\[${section}\\]`, 'm'))
  }
  for (const phrase of [
    'UI 配色',
    '20 种 UI 字体',
    '简体中文与英文',
    '终端背景',
    '右键菜单',
    '文字挤压'
  ]) {
    assert.match(notes, new RegExp(phrase))
  }
})

test('v0.4.9 release metadata documents quick command safety and tracking fixes', () => {
  const notes = read('docs/releases/v0.4.9.md')
  for (const section of ['新增', '修复', '改动']) {
    assert.match(notes, new RegExp(`^## \\[${section}\\]`, 'm'))
  }
  for (const phrase of [
    '快捷命令',
    'Shell Integration',
    'PROMPT_COMMAND',
    'SFTP',
    'UI 美化'
  ]) {
    assert.match(notes, new RegExp(phrase))
  }
})

test('GitHub release script loads versioned Markdown release notes', () => {
  const source = read('build/bin/release-github.js')

  assert.match(source, /docs[\\/]releases/)
  assert.match(source, /v\$\{pack\.version\}\.md/)
  assert.match(source, /fs\.readFileSync/)
})
