const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-delegation.js'
)).href

const sshEndpoint = Object.freeze({
  host: 'srv.test',
  port: 22,
  username: 'ops',
  tabId: 'tab-a',
  pid: 'pid-a',
  terminalPid: 'terminal-a',
  sessionType: 'ssh',
  hostKeyFingerprint: 'SHA256:a'
})

test('only operations with lower recovery preparation delegate confirmation', async () => {
  const {
    createDelegatedAgentSafetyPreparation,
    shouldDelegateAgentSafetyConfirmation
  } = await import(moduleUrl)

  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_del', {
    remotePath: '/srv/app/cache'
  }, { endpoint: sshEndpoint }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_del', {
    remotePath: '/srv/app/cache'
  }, { endpoint: { ...sshEndpoint, sessionType: 'ftp' } }), false)
  assert.equal(shouldDelegateAgentSafetyConfirmation('send_terminal_command', {
    command: '/usr/bin/systemctl start nginx.service'
  }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('run_background_command', {
    command: '/usr/bin/systemctl start nginx.service'
  }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('send_terminal_command', {
    command: 'rm -rf /srv/app/cache'
  }), false)
  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_upload', {
    localPath: 'C:/tmp/app.conf',
    remotePath: '/etc/app.conf'
  }), false)
  assert.equal(shouldDelegateAgentSafetyConfirmation('run_local_cli', {
    tool: 'node',
    args: ['script.js']
  }), false)

  const preparation = createDelegatedAgentSafetyPreparation(
    'sftp_del',
    { remotePath: '/srv/app/cache' },
    {
      endpoint: sshEndpoint,
      verification: [{ name: 'read_file_range', args: { length: 1 } }]
    }
  )
  assert.equal(Object.isFrozen(preparation), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs), true)
  assert.equal(Object.isFrozen(preparation.verification), true)
  assert.equal(preparation.verification[0].name, 'read_file_range')
  preparation.executionState.result = '{"success":true}'
  assert.equal(preparation.executionState.result, '{"success":true}')
})
