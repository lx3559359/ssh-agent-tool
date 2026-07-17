const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-delegation.js'
)).href

test('only operations with lower recovery preparation delegate confirmation', async () => {
  const {
    createDelegatedAgentSafetyPreparation,
    shouldDelegateAgentSafetyConfirmation
  } = await import(moduleUrl)

  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_del', {
    remotePath: '/srv/app/cache'
  }), true)
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

  const preparation = createDelegatedAgentSafetyPreparation('sftp_del', {
    remotePath: '/srv/app/cache'
  })
  assert.equal(Object.isFrozen(preparation), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs), true)
  preparation.executionState.result = '{"success":true}'
  assert.equal(preparation.executionState.result, '{"success":true}')
})
