const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importPermissionModule () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/sftp/sftp-editor-permission-error.js'
  )).href)
}

test('SFTP editor errors retain a stable stage marker without wrapping cancellation', async () => {
  const { markSftpEditorStage } = await importPermissionModule()
  const denied = markSftpEditorStage('metadata', new Error('Permission denied'))

  assert.match(denied.message, /SFTP_EDITOR_STAGE:metadata/)
  assert.equal(markSftpEditorStage('replace', denied), denied)

  const cancelled = new Error('cancelled')
  cancelled.name = 'AbortError'
  assert.equal(markSftpEditorStage('staging', cancelled), cancelled)
})

test('SFTP editor root permission guidance hides transaction internals', async () => {
  const {
    formatSftpEditorSaveError,
    markSftpEditorStage
  } = await importPermissionModule()
  const error = markSftpEditorStage(
    'metadata',
    new Error('Permission denied: /root/.shellpilot-transactions/save.execute')
  )
  const formatted = formatSftpEditorSaveError(error, {
    path: '/etc/example.conf',
    loginUsername: 'hik',
    effectiveUsername: 'root',
    channel: 'pty-root'
  })

  assert.notEqual(formatted, error)
  assert.match(formatted.message, /\/etc\/example\.conf/)
  assert.match(formatted.message, /SSH 登录：hik/)
  assert.match(formatted.message, /文件操作：root（当前终端）/)
  assert.match(formatted.message, /只读|ACL|不可变|chroot/i)
  assert.doesNotMatch(formatted.message, /\.shellpilot-transactions|\.execute/)
})

test('SFTP editor native permission guidance reports the login SFTP identity', async () => {
  const {
    formatSftpEditorSaveError,
    markSftpEditorStage
  } = await importPermissionModule()
  const formatted = formatSftpEditorSaveError(
    markSftpEditorStage('staging', new Error('EACCES')),
    {
      path: '/etc/example.conf',
      loginUsername: 'deploy',
      effectiveUsername: 'deploy',
      channel: 'sftp'
    }
  )

  assert.match(formatted.message, /SFTP 身份：deploy/)
  assert.doesNotMatch(formatted.message, /终端.*su|终端.*sudo/i)
  assert.doesNotMatch(formatted.message, /不会改变.*文件操作|不会改变.*SFTP/i)
})

test('SFTP editor leaves unrelated errors unchanged', async () => {
  const { formatSftpEditorSaveError } = await importPermissionModule()
  const original = new Error('connection reset')

  assert.equal(formatSftpEditorSaveError(original, {
    path: '/etc/example.conf',
    loginUsername: 'hik',
    effectiveUsername: 'root',
    channel: 'pty-root'
  }), original)
})
