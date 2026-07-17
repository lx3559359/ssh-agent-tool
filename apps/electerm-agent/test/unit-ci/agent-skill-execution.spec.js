const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const executionModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-skill-execution.js'
)).href
const policyModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-tool-policy.js'
)).href
const gatewayModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/agent-tool-gateway.js'
)).href

const packageDigest = 'a'.repeat(64)
const fileDigest = 'b'.repeat(64)
const endpoint = Object.freeze({
  host: 'srv.test',
  port: 22,
  username: 'ops',
  tabId: 'tab-a',
  pid: 'pid-a',
  terminalPid: 'terminal-a',
  sessionType: 'ssh',
  hostKeyFingerprint: 'SHA256:abc'
})

function metadata (overrides = {}) {
  return {
    id: 'inspect-web-service',
    skillId: 'inspect-web-service',
    enabled: true,
    state: 'enabled',
    valid: true,
    version: '1.0.0',
    packageDigest,
    requestedPermissions: ['ssh.read'],
    riskSummary: {
      scripts: [{
        id: 'collect-evidence',
        path: 'scripts/collect-evidence.sh',
        interpreter: 'bash',
        target: 'remote'
      }]
    },
    ...overrides
  }
}

function clientFor (getCurrentMetadata = () => metadata()) {
  const calls = []
  return {
    calls,
    async getAgentSkillMetadata (id) {
      calls.push(['metadata', id])
      return getCurrentMetadata()
    },
    async readAgentSkillFile (id, relativePath) {
      calls.push(['read', id, relativePath])
      return {
        path: relativePath,
        content: 'systemctl status nginx\n',
        digest: fileDigest
      }
    }
  }
}

test('Skill repository and renderer client expose no execution bypass', () => {
  const repositorySource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/app/lib/agent-skill-repository.js'
  ), 'utf8')
  const clientSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/agent-skill-client.js'
  ), 'utf8')

  assert.doesNotMatch(repositorySource, /executeAgentSkill|runAgentSkill|spawn\s*\(/)
  assert.doesNotMatch(clientSource, /executeAgentSkill|runAgentSkill\s*=|rawSsh|credentialIpc/i)
})

test('prepares a digest-bound remote artifact call without executing it', async () => {
  const { prepareSkillArtifactCall } = await import(executionModuleUrl)
  const client = clientFor()
  let executed = false
  const call = await prepareSkillArtifactCall({
    skillBinding: { id: 'inspect-web-service', version: '1.0.0', digest: packageDigest },
    artifactId: 'collect-evidence',
    args: ['nginx'],
    endpoint,
    client,
    execute: () => { executed = true }
  })

  assert.equal(executed, false)
  assert.equal(call.toolName, 'send_terminal_command')
  assert.equal(call.expandedContent, 'systemctl status nginx\n')
  assert.equal(call.skillArtifact.packageDigest, packageDigest)
  assert.equal(call.skillArtifact.fileDigest, fileDigest)
  assert.equal(call.skillArtifact.interpreter, 'bash')
  assert.deepEqual(call.skillArtifact.arguments, ['nginx'])
  assert.deepEqual(call.skillArtifact.requestedPermissions, ['ssh.read'])
  assert.deepEqual(call.endpoint, endpoint)
  assert.equal(Object.isFrozen(call.skillArtifact), true)
  assert.deepEqual(client.calls, [
    ['metadata', 'inspect-web-service'],
    ['read', 'inspect-web-service', 'scripts/collect-evidence.sh'],
    ['metadata', 'inspect-web-service']
  ])
})

test('remote artifact arguments cannot expand shell variables or substitutions', async () => {
  const { prepareSkillArtifactCall } = await import(executionModuleUrl)
  const client = clientFor()
  const call = await prepareSkillArtifactCall({
    skillBinding: { id: 'inspect-web-service', version: '1.0.0', digest: packageDigest },
    artifactId: 'collect-evidence',
    args: ['$(touch /tmp/injected)', '`id`', '$HOME', "single'quote"],
    endpoint,
    client
  })

  assert.match(call.args.command, /'\$\(touch \/tmp\/injected\)'/)
  assert.match(call.args.command, /'`id`'/)
  assert.match(call.args.command, /'\$HOME'/)
  assert.match(call.args.command, /'single'"'"'quote'/)
  assert.match(call.args.command, /<<'SHELLPILOT_SKILL_b{16}'/)
  assert.match(call.args.command, /systemctl status nginx/)
})

test('production selection resolver accepts only a digest-bound selected Skill', async () => {
  const { prepareSelectedSkillArtifactCall } = await import(executionModuleUrl)
  const client = clientFor()
  const call = await prepareSelectedSkillArtifactCall({
    skillId: 'inspect-web-service',
    artifactId: 'collect-evidence',
    args: ['nginx'],
    skillBindings: [{
      id: 'inspect-web-service',
      version: '1.0.0',
      digest: packageDigest
    }],
    endpoint,
    client
  })

  assert.equal(call.toolName, 'send_terminal_command')
  await assert.rejects(prepareSelectedSkillArtifactCall({
    skillId: 'not-selected',
    artifactId: 'collect-evidence',
    skillBindings: [],
    endpoint,
    client
  }), error => error.code === 'SKILL_NOT_SELECTED')
})

test('Agent production tool chain exposes and routes selected artifacts through the gateway', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/client/components/ai/agent-tools.js'
  ), 'utf8')

  assert.match(source, /name:\s*'run_skill_artifact'/)
  assert.match(source, /prepareSelectedSkillArtifactCall/)
  assert.match(source, /skillArtifact:\s*controlledSkillCall\?\.skillArtifact/)
  assert.match(source, /validateArtifact:\s*controlledSkillCall\?\.validateArtifact/)
  assert.match(source, /type:\s*'skill-artifact'/)
})

test('artifact revalidation rejects package or file changes before gateway dispatch', async () => {
  const { prepareSkillArtifactCall } = await import(executionModuleUrl)
  const { executeAgentTool } = await import(gatewayModuleUrl)
  let changed = false
  let executed = false
  const client = clientFor(() => metadata({
    packageDigest: changed ? 'c'.repeat(64) : packageDigest
  }))
  const call = await prepareSkillArtifactCall({
    skillBinding: { id: 'inspect-web-service', version: '1.0.0', digest: packageDigest },
    artifactId: 'collect-evidence',
    endpoint,
    client
  })
  changed = true

  await assert.rejects(
    executeAgentTool({
      ...call,
      resolveEndpoint: () => endpoint,
      registry: {},
      assertTakeover: () => {},
      prepareRisky: async () => ({
        riskTransaction: {},
        riskPlanGrant: {},
        confirmedArgs: call.args
      }),
      execute: async () => { executed = true }
    }),
    error => error.code === 'SKILL_DIGEST_MISMATCH'
  )
  assert.equal(executed, false)
})

test('remote scripts stay risky and unenforceable permissions are blocked explicitly', async () => {
  const { classifyAgentCall, getAgentToolDescriptor } = await import(policyModuleUrl)
  const descriptor = getAgentToolDescriptor('send_terminal_command')
  const baseArtifact = {
    id: 'collect-evidence',
    target: 'remote',
    interpreter: 'bash',
    packageDigest,
    fileDigest,
    requestedPermissions: ['ssh.read']
  }

  assert.equal(classifyAgentCall({
    descriptor,
    args: { command: 'bash -s' },
    expandedContent: 'systemctl status nginx',
    skillArtifact: baseArtifact
  }).outcome, 'risky')

  const blocked = classifyAgentCall({
    descriptor,
    args: { command: 'bash -s' },
    expandedContent: 'systemctl status nginx',
    skillArtifact: {
      ...baseArtifact,
      requestedPermissions: ['credentials.read']
    }
  })
  assert.equal(blocked.outcome, 'blocked')
  assert.equal(blocked.reasonCode, 'SKILL_PERMISSION_UNENFORCEABLE')
  assert.equal(blocked.errorCode, 'SKILL_PERMISSION_UNENFORCEABLE')
})

test('local artifact envelopes are bounded and require explicit broad permissions', async () => {
  const { prepareSkillArtifactCall } = await import(executionModuleUrl)
  const { classifyAgentCall } = await import(policyModuleUrl)
  const localPermissions = [
    'local.process',
    'local.filesystem.read',
    'local.filesystem.write',
    'network'
  ]
  const client = clientFor(() => metadata({
    requestedPermissions: localPermissions,
    riskSummary: {
      scripts: [{
        id: 'local-check',
        path: 'scripts/local-check.py',
        interpreter: 'python3',
        target: 'local'
      }]
    }
  }))
  const call = await prepareSkillArtifactCall({
    skillBinding: { id: 'inspect-web-service', version: '1.0.0', digest: packageDigest },
    artifactId: 'local-check',
    args: ['--format', 'json'],
    endpoint,
    client
  })

  assert.equal(call.toolName, 'run_local_cli')
  assert.equal(call.localExecution.shell, false)
  assert.equal(call.localExecution.timeoutMs <= 30000, true)
  assert.equal(call.localExecution.outputLimitBytes <= 64 * 1024, true)
  assert.deepEqual(call.localExecution.environmentKeys, [
    'PATH', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR'
  ])
  const blocked = classifyAgentCall(call)
  assert.equal(blocked.outcome, 'blocked')
  assert.equal(blocked.errorCode, 'SKILL_PERMISSION_UNENFORCEABLE')

  const implicitNetwork = classifyAgentCall({
    ...call,
    skillArtifact: {
      ...call.skillArtifact,
      requestedPermissions: ['local.process']
    }
  })
  assert.equal(implicitNetwork.reasonCode, 'SKILL_PERMISSION_UNENFORCEABLE')
})
