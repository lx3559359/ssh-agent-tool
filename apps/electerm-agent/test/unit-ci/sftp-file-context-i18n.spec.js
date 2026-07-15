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
    'quickBackup',
    'restoreLatestBackup',
    'openSafetyCenter',
    'editFile',
    'del',
    'onCopy',
    'onCut',
    'onPaste',
    'doRename',
    'onCopyPath',
    'newFile',
    'newDirectory',
    'selectAll',
    'refresh',
    'editPermission',
    'showInfo'
  ]

  assert.deepEqual(zhItems.map(item => item.func), expectedActions)
  assert.deepEqual(enItems.map(item => item.func), expectedActions)
  assert.equal(zhItems.find(item => item.func === 'askAiAboutFile').text, '让 AI 分析此文件')
  assert.equal(enItems.find(item => item.func === 'askAiAboutFile').text, 'Analyze This File with AI')
  assert.equal(zhItems.find(item => item.func === 'del').text, '安全删除（可恢复）')
  assert.equal(enItems.find(item => item.func === 'del').text, 'Safe Delete (Recoverable)')
  assert.equal(zhItems.find(item => item.func === 'restoreLatestBackup').disabled, false)
  assert.equal(enItems.find(item => item.func === 'restoreLatestBackup').disabled, false)
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
