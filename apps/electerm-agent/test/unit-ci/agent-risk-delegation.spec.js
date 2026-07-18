const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-risk-delegation.js'
)).href
const scopesUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-tool-scopes.js'
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
    expected: { exitCode: 0, contains: 'ActiveState=active' }
  }]
})
const sessionControlRiskContext = Object.freeze({
  purpose: 'switch the visible workspace tab',
  impactTargets: ['tab:tab-a'],
  verification: []
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
    assertAgentRiskContext,
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
    {
      endpoint: sshEndpoint,
      classification: {
        outcome: 'risky',
        reasonCode: 'COMMAND_CHANGES_STATE'
      }
    }
  )

  assert.equal(Object.isFrozen(preparation), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs), true)
  assert.equal(Object.isFrozen(preparation.confirmedArgs.riskContext), true)
  assert.equal(Object.isFrozen(preparation.endpoint), true)
  assert.equal(Object.isFrozen(preparation.verification), true)
  assert.equal(Object.isFrozen(preparation.safetyDelegationCapability), true)
  assert.deepEqual(preparation.endpoint, sshEndpoint)
  assert.deepEqual(preparation.verification, riskContext.verification)
  assert.deepEqual(assertAgentRiskContext(riskContext), riskContext)

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

test('risk context schema and runtime validation require non-empty authorization details', async () => {
  const {
    agentRiskContextSchema,
    agentArtifactRiskContextSchema,
    agentRemoteRiskContextSchema,
    agentSessionControlRiskContextSchema,
    assertAgentRiskContext,
    assertAgentRiskContextForCall
  } = await import(moduleUrl)

  assert.deepEqual(agentRiskContextSchema.required, [
    'purpose',
    'impactTargets',
    'verification'
  ])
  assert.equal(agentRiskContextSchema.properties.purpose.minLength, 1)
  assert.equal(agentRiskContextSchema.properties.impactTargets.minItems, 1)
  assert.equal(agentRiskContextSchema.properties.impactTargets.items.minLength, 1)
  assert.equal(agentRiskContextSchema.properties.verification.minItems, 1)
  assert.deepEqual(
    agentRiskContextSchema.properties.verification.items.required,
    ['name', 'args']
  )
  const expectedSchema = agentRiskContextSchema.properties.verification
    .items.properties.expected
  assert.equal(expectedSchema.minProperties, 1)
  assert.equal(expectedSchema.additionalProperties, false)
  assert.deepEqual(expectedSchema.properties, {
    exitCode: { type: 'integer' },
    contains: { type: 'string', minLength: 1 },
    notContains: { type: 'string', minLength: 1 }
  })
  assert.equal(agentRiskContextSchema, agentRemoteRiskContextSchema)
  assert.equal(agentRemoteRiskContextSchema.properties.verification.minItems, 1)
  assert.equal(agentSessionControlRiskContextSchema.properties.verification.minItems, 0)
  assert.equal(agentSessionControlRiskContextSchema.properties.verification.maxItems, 0)
  assert.equal(agentArtifactRiskContextSchema.properties.verification.minItems, 0)
  assert.equal(
    Object.hasOwn(agentArtifactRiskContextSchema.properties.verification, 'maxItems'),
    false
  )

  for (const invalid of [
    undefined,
    {},
    { ...riskContext, purpose: '   ' },
    { ...riskContext, impactTargets: [] },
    { ...riskContext, impactTargets: [''] },
    { ...riskContext, verification: [] },
    { ...riskContext, verification: [{ name: 'read_service_status' }] },
    { ...riskContext, verification: [{ name: 'unknown', args: {} }] },
    {
      ...riskContext,
      verification: [{ name: 'read_service_status', args: {}, expected: {} }]
    },
    {
      ...riskContext,
      verification: [{
        name: 'read_service_status',
        args: {},
        expected: { equals: 'active' }
      }]
    },
    {
      ...riskContext,
      verification: [{
        name: 'read_service_status',
        args: {},
        expected: { exitCode: '0' }
      }]
    },
    {
      ...riskContext,
      verification: [{
        name: 'read_service_status',
        args: {},
        expected: { contains: '' }
      }]
    },
    {
      ...riskContext,
      verification: [{
        name: 'read_service_status',
        args: { nonJsonValue: 1n }
      }]
    }
  ]) {
    assert.throws(
      () => assertAgentRiskContext(invalid),
      error => error.code === 'AGENT_RISK_CONTEXT_REQUIRED'
    )
  }

  const validated = assertAgentRiskContext(riskContext)
  assert.equal(Object.isFrozen(validated), true)
  assert.equal(Object.isFrozen(validated.verification), true)

  const implicit = assertAgentRiskContext({
    ...riskContext,
    verification: [{ name: 'read_service_status', args: { service: 'nginx' } }]
  })
  assert.deepEqual(implicit.verification[0].expected, { exitCode: 0 })
  assert.equal(Object.isFrozen(implicit.verification[0].expected), true)

  assert.equal(assertAgentRiskContextForCall({
    toolName: 'send_terminal_command',
    args: { command: 'ip addr' },
    classification: { outcome: 'allowlisted-readonly' }
  }), null)
  assert.throws(() => assertAgentRiskContextForCall({
    toolName: 'send_terminal_command',
    args: { command: 'journalctl -f' },
    classification: { outcome: 'risky' }
  }), error => error.code === 'AGENT_RISK_CONTEXT_REQUIRED')
  assert.deepEqual(assertAgentRiskContextForCall({
    toolName: 'run_background_command',
    args: { command: 'uptime', riskContext },
    descriptor: { name: 'run_background_command', scope: 'session-write' },
    classification: { outcome: 'risky' }
  }), riskContext)
})

test('one central verification dispatcher enforces every declared predicate', async () => {
  const {
    agentVerificationToolNames,
    assertAgentVerificationExpectation
  } = await import(moduleUrl)

  assert.deepEqual(agentVerificationToolNames, [
    'read_service_status',
    'read_recent_logs',
    'verify_listening_port',
    'read_file_range'
  ])
  assert.doesNotThrow(() => assertAgentVerificationExpectation({
    name: 'read_recent_logs',
    expected: { exitCode: 7 }
  }, { exitCode: 7, output: 'nginx ready' }))
  assert.doesNotThrow(() => assertAgentVerificationExpectation({
    name: 'read_recent_logs',
    expected: { exitCode: 0, contains: 'nginx', notContains: 'panic' }
  }, { exitCode: 0, output: 'nginx ready' }))

  for (const [expected, result] of [
    [{ exitCode: 0 }, { exitCode: 1, output: '' }],
    [{ contains: 'ready' }, { exitCode: 0, output: 'starting' }],
    [{ notContains: 'panic' }, { exitCode: 0, output: 'panic detected' }]
  ]) {
    assert.throws(
      () => assertAgentVerificationExpectation({
        name: 'read_recent_logs',
        expected
      }, result),
      /Verification/
    )
  }
})

test('runtime context modes cover every write and control policy without fake verification', async () => {
  const {
    agentRiskCallsRequireVerification,
    assertAgentRiskContextForCall,
    resolveAgentRiskContextMode
  } = await import(moduleUrl)
  const { AGENT_TOOL_SCOPES } = await import(scopesUrl)

  for (const [name, scope] of Object.entries(AGENT_TOOL_SCOPES)) {
    if (scope !== 'session-write' && scope !== 'session-control') continue
    const descriptor = { name, scope }
    const mode = resolveAgentRiskContextMode({
      toolName: name,
      descriptor,
      classification: { outcome: 'risky' }
    })
    const expectedMode = name === 'run_skill_artifact'
      ? 'artifact'
      : scope === 'session-control'
        ? 'session-control'
        : 'remote-verification'
    assert.equal(mode, expectedMode, name)

    const context = expectedMode === 'session-control'
      ? sessionControlRiskContext
      : riskContext
    assert.deepEqual(assertAgentRiskContextForCall({
      toolName: name,
      descriptor,
      args: { riskContext: context },
      classification: { outcome: 'risky' }
    }), context, name)

    assert.throws(() => assertAgentRiskContextForCall({
      toolName: name,
      descriptor,
      args: {},
      classification: { outcome: 'risky' }
    }), error => error.code === 'AGENT_RISK_CONTEXT_REQUIRED', name)
  }

  assert.throws(() => assertAgentRiskContextForCall({
    toolName: 'send_terminal_command',
    descriptor: { name: 'send_terminal_command', scope: 'session-write' },
    args: { riskContext: sessionControlRiskContext },
    classification: { outcome: 'risky' }
  }), error => error.code === 'AGENT_RISK_CONTEXT_REQUIRED')

  assert.equal(assertAgentRiskContextForCall({
    toolName: 'send_terminal_command',
    descriptor: { name: 'send_terminal_command', scope: 'session-write' },
    args: { command: 'uptime' },
    classification: { outcome: 'allowlisted-readonly' }
  }), null)

  assert.equal(agentRiskCallsRequireVerification([{
    name: 'switch_tab',
    classification: { outcome: 'risky' }
  }]), false)
  assert.equal(agentRiskCallsRequireVerification([{
    name: 'send_terminal_command',
    classification: { outcome: 'risky' }
  }]), true)
  assert.equal(agentRiskCallsRequireVerification([]), true)
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
