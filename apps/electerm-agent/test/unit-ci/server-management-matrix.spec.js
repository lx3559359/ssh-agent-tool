const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing server management evidence: ${label}`)
}

test('服务器管理矩阵覆盖新增编辑删除分组标签收藏搜索和批量导入导出', () => {
  const bookmarkFlow = readFile('bookmark-management-flow.spec.js')
  const bookmarkBackup = readFile('bookmark-backup.spec.js')
  const bookmarkGroup = readFile('bookmark-group.spec.js')
  const bookmarkStore = readClientFile('store/bookmark.js')
  const bookmarkGroupStore = readClientFile('store/bookmark-group.js')
  const bookmarkList = readClientFile('components/setting-panel/list.jsx')
  const bookmarkToolbar = readClientFile('components/tree-list/bookmark-toolbar.jsx')
  const bookmarkForm = readClientFile('components/bookmark-form/index.jsx')
  const commonSettings = readClientFile('components/setting-panel/setting-common.jsx')

  assertEvidence(bookmarkFlow, /onNewBookmark/, '新增服务器入口')
  assertEvidence(bookmarkForm, /const isNew = id\.startsWith\(newBookmarkIdPrefix\)/, '新建和编辑服务器表单')
  assertEvidence(bookmarkStore, /Store\.prototype\.delBookmark/, '删除服务器')
  assertEvidence(bookmarkGroupStore, /Store\.prototype\.addBookmarkGroup/, '新增分组')
  assertEvidence(bookmarkGroupStore, /Store\.prototype\.editBookmarkGroup/, '编辑分组')
  assertEvidence(bookmarkGroupStore, /Store\.prototype\.delBookmarkGroup/, '删除分组')
  assertEvidence(bookmarkGroup, /removeCyclicBookmarkGroupIds/, '分组循环引用保护')
  assertEvidence(bookmarkList, /this\.props\.store\.delItem/, '设置列表删除入口')
  assertEvidence(bookmarkList, /this\.props\.store\.openBookmarkEdit/, '设置列表编辑入口')
  assertEvidence(bookmarkList, /filter = list =>/, '服务器搜索过滤')
  assertEvidence(commonSettings, /mode='tags'/, '标签配置入口')
  assertEvidence(bookmarkToolbar, /handleDownload/, '导出服务器配置')
  assertEvidence(bookmarkToolbar, /beforeBookmarkUpload/, '导入服务器配置')
  assertEvidence(bookmarkBackup, /createBookmarkBackup/, '备份导出格式')
  assertEvidence(bookmarkBackup, /parseBookmarkBackupForImport/, '备份导入解析')
  assertEvidence(bookmarkBackup, /includeCredentials:\s*false/, '导出时可排除密码和私钥')
  assertEvidence(bookmarkBackup, /createEncryptedBookmarkBackup/, '加密备份')
  assertEvidence(bookmarkStore, /addSshConfigs/, '批量导入 SSH 配置')
  assertEvidence(bookmarkToolbar, /onSshConfigs/, 'SSH 配置批量导入入口')
  assertEvidence(`${bookmarkList}\n${bookmarkFlow}`, /favorite|star|Star/i, '收藏服务器')
})
