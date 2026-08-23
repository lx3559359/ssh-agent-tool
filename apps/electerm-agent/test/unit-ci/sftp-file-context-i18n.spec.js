const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const builderUrl = pathToFileURL(path.join(
  clientRoot,
  'components/sftp/sftp-file-context-menu.js'
)).href
const i18nUrl = pathToFileURL(path.join(
  clientRoot,
  'common/shellpilot-i18n-overrides.js'
)).href

function flattenActions (items) {
  return items.flatMap(item => item?.children?.length
    ? flattenActions(item.children)
    : item?.func ? [item.func] : [])
}

test('real SFTP file menu builder preserves action order while labels follow preview language', async () => {
  const menuModule = await import(builderUrl).catch(() => ({}))
  assert.equal(typeof menuModule.buildSftpFileContextItems, 'function')
  const i18n = await import(i18nUrl)
  const translate = language => key => {
    return i18n.getShellPilotTranslation(key, language) || ({
      download: 'Download',
      edit: 'Edit',
      copy: 'Copy',
      cut: 'Cut',
      paste: 'Paste',
      rename: 'Rename',
      copyFilePath: 'Copy path',
      newFile: 'New file',
      newFolder: 'New folder',
      selectAll: 'Select all',
      refresh: 'Refresh',
      editPermission: 'Edit permissions',
      info: 'Info'
    })[key] || key
  }
  const options = {
    file: {
      id: 'remote-file',
      type: 'remote',
      path: '/srv',
      name: 'deploy.sh',
      isDirectory: false,
      size: 128
    },
    selectedFiles: new Set(['remote-file']),
    tab: { host: 'server.example', enableSsh: true },
    isWin: true,
    isWebApp: false,
    isFtp: false,
    canPaste: false,
    hasRecovery: true,
    maxEditFileSize: 1024,
    shortcutModifier: 'ctrl'
  }
  const zhItems = menuModule.buildSftpFileContextItems({
    ...options,
    translate: translate('zh_cn')
  })
  const enItems = menuModule.buildSftpFileContextItems({
    ...options,
    translate: translate('en_us')
  })
  const expectedActions = [
    'doTransfer',
    'askAiAboutFile',
    'editFile',
    'del',
    'quickDelete',
    'doRename',
    'onCopyPath',
    'quickBackup',
    'restoreLatestBackup',
    'openSafetyCenter',
    'onCopy',
    'onCut',
    'onPaste',
    'newFile',
    'newDirectory',
    'selectAll',
    'refresh',
    'editPermission',
    'showInfo'
  ]

  assert.deepEqual(flattenActions(zhItems), expectedActions)
  assert.deepEqual(flattenActions(enItems), expectedActions)
  assert.deepEqual(
    zhItems.map(item => item.type || item.func),
    enItems.map(item => item.type || item.func)
  )
  assert.equal(zhItems.find(item => item.func === 'askAiAboutFile').text, '让 AI 分析此文件')
  assert.equal(enItems.find(item => item.func === 'askAiAboutFile').text, 'Analyze This File with AI')
  assert.equal(zhItems.find(item => item.func === 'del').text, '安全删除（可恢复）')
  assert.equal(enItems.find(item => item.func === 'del').text, 'Safe Delete (Recoverable)')
  assert.equal(zhItems.find(item => item.func === 'quickDelete').text, '快速删除（不可恢复）')
  assert.equal(enItems.find(item => item.func === 'quickDelete').text, 'Fast Delete (Permanent)')
  const zhBackup = zhItems.find(item => item.func === 'backupRecoveryMenu')
  const enBackup = enItems.find(item => item.func === 'backupRecoveryMenu')
  assert.equal(zhBackup.children.find(item => item.func === 'restoreLatestBackup').disabled, false)
  assert.equal(enBackup.children.find(item => item.func === 'restoreLatestBackup').disabled, false)
  assert.equal(zhBackup.text, '备份与恢复')
  assert.equal(enBackup.text, 'Backup & Recovery')
})

test('SFTP file menu component delegates labels to the builder and target files contain no hardcoded Chinese copy', () => {
  const fileItem = fs.readFileSync(path.join(
    clientRoot,
    'components/sftp/file-item.jsx'
  ), 'utf8')
  const listTable = fs.readFileSync(path.join(
    clientRoot,
    'components/sftp/list-table-ui.jsx'
  ), 'utf8')

  assert.match(fileItem, /buildSftpFileContextItems/)
  assert.match(fileItem, /renderContextItems \(\)[\s\S]*return buildSftpFileContextItems/)
  assert.doesNotMatch(fileItem, /[\u3400-\u9fff]/)
  assert.doesNotMatch(listTable, /[\u3400-\u9fff]/)
})

test('permanent fast delete confirmation and result copy has Chinese and English coverage', async () => {
  const i18n = await import(i18nUrl)
  const keys = [
    'shellpilotSftpFastDeleteSelected',
    'shellpilotSftpFastDeletePermanent',
    'shellpilotSftpFastDeleteConfirmTitle',
    'shellpilotSftpFastDeleteConfirmBody',
    'shellpilotSftpFastDeleteConfirmAction',
    'shellpilotSftpFastDeleteSucceeded',
    'shellpilotSftpFastDeletePartial',
    'shellpilotSftpFastDeleteFailed'
  ]

  for (const key of keys) {
    const zh = i18n.getShellPilotTranslation(key, 'zh_cn')
    const en = i18n.getShellPilotTranslation(key, 'en_us')
    assert.match(zh, /[\u3400-\u9fff]/, `${key} must have Chinese copy`)
    assert.match(en, /[A-Za-z]/, `${key} must have English copy`)
    assert.notEqual(zh, en)
  }
  for (const key of [
    'shellpilotSftpFastDeletePartial',
    'shellpilotSftpFastDeleteFailed'
  ]) {
    const zh = i18n.getShellPilotTranslation(key, 'zh_cn')
    const en = i18n.getShellPilotTranslation(key, 'en_us')
    assert.match(zh, /\{items\}/)
    assert.match(en, /\{items\}/)
    assert.match(zh, /刷新/)
    assert.match(en, /refresh/i)
  }
})
