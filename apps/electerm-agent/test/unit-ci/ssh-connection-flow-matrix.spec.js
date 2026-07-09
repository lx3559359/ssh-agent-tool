const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

function readTestFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
}

function readClientFile (relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../src/client', relativePath), 'utf8')
}

function assertEvidence (source, pattern, label) {
  assert.match(source, pattern, `Missing SSH connection flow evidence: ${label}`)
}

test('SSH 连接全流程矩阵覆盖新建保存认证失败提示超时和重连', () => {
  const bookmarkFlow = readTestFile('bookmark-management-flow.spec.js')
  const serverManagement = readTestFile('server-management-matrix.spec.js')
  const feedback = readTestFile('ssh-connection-feedback-localization.spec.js')
  const sshPasswordFirst = readTestFile('session-ssh-password-first.spec.js')
  const ssh = readTestFile('session-ssh.spec.js')
  const sshAgent = readTestFile('session-ssh-agent.spec.js')
  const sshErrors = readTestFile('session-ssh-errors.spec.js')
  const reconnectPolicy = readTestFile('ssh-reconnect-policy.spec.js')
  const formRenderer = readClientFile('components/bookmark-form/form-renderer.jsx')
  const terminal = readClientFile('components/terminal/terminal.jsx')

  assertEvidence(bookmarkFlow, /handleNewBookmark/, '新建连接入口')
  assertEvidence(formRenderer, /action\.current = 'save'/, '保存连接按钮')
  assertEvidence(formRenderer, /addItem\(obj,\s*settingMap\.bookmarks\)/, '新连接写入服务器列表')
  assertEvidence(formRenderer, /editItem\(obj\.id,\s*tar,\s*settingMap\.bookmarks\)/, '编辑后保存连接')
  assertEvidence(serverManagement, /批量导入 SSH 配置/, '批量导入 SSH 配置')
  assertEvidence(sshPasswordFirst, /password auth works|password auth is tried before publickey/, '密码登录')
  assertEvidence(ssh, /connects with an rsa key protected by a passphrase/, 'RSA 私钥登录')
  assertEvidence(ssh, /connects with an ed25519 key protected by a passphrase/, 'ED25519 私钥登录')
  assertEvidence(sshAgent, /SSH agent auth|ssh agent/i, 'SSH Agent 登录')
  assertEvidence(ssh, /rejects wrong password with a normalized authentication error/, '错误密码提示')
  assertEvidence(ssh, /rejects a silent tcp endpoint with a normalized handshake timeout/, '超时提示')
  assertEvidence(sshErrors, /adds the configured ssh timeout seconds to timeout diagnostics/, '超时秒数说明')
  assertEvidence(sshErrors, /redacts inline secrets from ssh connection diagnostics/, '连接失败日志脱敏')
  assertEvidence(ssh, /emits close when an established ssh session is disconnected by the server/, '服务端断开连接')
  assertEvidence(reconnectPolicy, /keeps retrying transient network errors/, '瞬时网络错误自动重连')
  assertEvidence(reconnectPolicy, /stops on credential and configuration errors/, '认证或配置错误不盲目重连')
  assertEvidence(terminal, /scheduleAutoReconnect\(3000\)/, '终端断线自动重连调度')
  assertEvidence(terminal, /handleCancelAutoReconnect/, '手动断开或重连可取消自动重连')
  assertEvidence(feedback, /连接成功/, '连接测试成功中文提示')
  assertEvidence(feedback, /连接失败/, '连接测试失败中文提示')
})
