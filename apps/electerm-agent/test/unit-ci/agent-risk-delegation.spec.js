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

const riskContext = Object.freeze({
  purpose: 'restart nginx after configuration validation',
  impactTargets: ['nginx.service'],
  verification: [{
    name: 'read_service_status',
    args: { service: 'nginx' },
    expected: { contains: 'ActiveState=active' }
  }]
})

test('SSH command safety confirmation delegates to the single lower transaction', async () => {
  const { shouldDelegateAgentSafetyConfirmation } = await import(moduleUrl)

  assert.equal(shouldDelegateAgentSafetyConfirmation('send_terminal_command', {
    command: 'systemctl restart nginx',
    riskContext
  }, { endpoint: sshEndpoint }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('run_background_command', {
    command: 'systemctl restart nginx',
    riskContext
  }, { endpoint: sshEndpoint }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('send_terminal_command', {
    command: 'rm -rf /srv/app/cache',
    riskContext
  }, { endpoint: sshEndpoint }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('send_terminal_command', {
    command: 'systemctl restart nginx',
    riskContext
  }, { endpoint: { ...sshEndpoint, sessionType: 'ftp' } }), false)
  assert.equal(shouldDelegateAgentSafetyConfirmation('run_local_cli', {
    tool: 'node',
    args: ['script.js'],
    riskContext
  }, { endpoint: sshEndpoint }), false)
})

test('delegated preparation freezes full args endpoint and verification', async () => {
  const {
    createDelegatedAgentSafetyPreparation,
    validateDelegatedAgentSafetyPreparation
  } = await import(moduleUrl)
  const args = {
    command: 'systemctl restart nginx',
    tabId: 'tab-a',
    riskContext
  }
  const preparation = createDelegatedAgentSafetyPreparation(
    'send_terminal_command',
    args,
    { endpoint: sshEndpoint }
  )

  assert.equal(Object.isFrozen(preparation), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs.riskContext), true)
  assert.equal(Object.isFrozen(preparation.endpoint), true)
  assert.equal(Object.isFrozen(preparation.verification), true)
  assert.deepEqual(preparation.endpoint, sshEndpoint)
  assert.deepEqual(preparation.verification, riskContext.verification)

  const validated = validateDelegatedAgentSafetyPreparation({
    toolName: 'send_terminal_command',
    args,
    endpoint: sshEndpoint,
    delegatedPreparation: preparation
  })
  assert.deepEqual(validated.args, preparation.confirmedArgs)

  assert.throws(() => validateDelegatedAgentSafetyPreparation({
    toolName: 'send_terminal_command',
    args: { ...args, command: 'systemctl restart sshd' },
    endpoint: sshEndpoint,
    delegatedPreparation: preparation
  }), error => error.code === 'AGENT_RISK_CONFIRMATION_REQUIRED')

  assert.throws(() => validateDelegatedAgentSafetyPreparation({
    toolName: 'send_terminal_command',
    args,
    endpoint: { ...sshEndpoint, pid: 'pid-b' },
    delegatedPreparation: preparation
  }), error => error.code === 'AGENT_RISK_CONFIRMATION_REQUIRED')
})

test('SFTP delete keeps its existing delegated SSH safety path', async () => {
  const { shouldDelegateAgentSafetyConfirmation } = await import(moduleUrl)

  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_del', {
    remotePath: '/srv/app/cache',
    riskContext
  }, { endpoint: sshEndpoint }), true)
  assert.equal(shouldDelegateAgentSafetyConfirmation('sftp_del', {
    remotePath: '/srv/app/cache',
    riskContext
  }, { endpoint: { ...sshEndpoint, sessionType: 'ftp' } }), false)
})
