import { agentSkillClient } from './agent-skill-client.js'

const digestPattern = /^[a-f0-9]{64}$/
const localEnvironmentKeys = Object.freeze([
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'WINDIR'
])

function skillError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function cloneJson (value) {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function normalizeArguments (args) {
  if (args === undefined) return []
  if (!Array.isArray(args) || args.length > 64) {
    throw skillError('SKILL_ARGUMENTS_INVALID', 'Skill artifact arguments must be a bounded array.')
  }
  return args.map(value => {
    const text = String(value)
    if (text.length > 4096 || text.includes('\u0000') ||
      text.includes('\r') || text.includes('\n')) {
      throw skillError('SKILL_ARGUMENTS_INVALID', 'Skill artifact argument is invalid.')
    }
    return text
  })
}

function bindingId (binding = {}) {
  return String(binding.id || binding.skillId || '').trim()
}

function bindingDigest (binding = {}) {
  return String(binding.digest || binding.packageDigest || '').trim()
}

function assertBindingMetadata (metadata, binding) {
  const id = bindingId(binding)
  const digest = bindingDigest(binding)
  if (!id || !digestPattern.test(digest)) {
    throw skillError('SKILL_BINDING_INVALID', 'A selected Skill digest binding is required.')
  }
  if (!metadata || metadata.skillId !== id || metadata.enabled !== true ||
    metadata.state !== 'enabled' || metadata.valid !== true) {
    throw skillError('SKILL_NOT_ENABLED', 'The selected Skill is not enabled and valid.')
  }
  if (String(metadata.version || '') !== String(binding.version || '') ||
    metadata.packageDigest !== digest) {
    throw skillError('SKILL_DIGEST_MISMATCH', 'The selected Skill changed after selection.')
  }
  return metadata
}

function findArtifact (metadata, artifactId) {
  const id = String(artifactId || '').trim()
  const artifacts = metadata?.riskSummary?.scripts
  const artifact = Array.isArray(artifacts)
    ? artifacts.find(entry => entry?.id === id)
    : null
  if (!artifact || !artifact.path ||
    !['local', 'remote'].includes(artifact.target)) {
    throw skillError('SKILL_ARTIFACT_NOT_DECLARED', 'Skill artifact is not declared by the validated package.')
  }
  return artifact
}

function commandFor (artifact, args) {
  const suffix = args.length ? ` -- ${args.map(JSON.stringify).join(' ')}` : ''
  return `${artifact.interpreter} -s${suffix}`
}

export async function prepareSkillArtifactCall ({
  skillBinding,
  artifactId,
  args,
  endpoint,
  client = agentSkillClient
} = {}) {
  if (!client || typeof client.getAgentSkillMetadata !== 'function' ||
    typeof client.readAgentSkillFile !== 'function') {
    throw new TypeError('A confined Agent Skill client is required')
  }
  const id = bindingId(skillBinding)
  const artifactArgs = normalizeArguments(args)
  const before = assertBindingMetadata(
    await client.getAgentSkillMetadata(id),
    skillBinding
  )
  const artifact = findArtifact(before, artifactId)
  const file = await client.readAgentSkillFile(id, artifact.path)
  if (!file || file.path !== artifact.path || !digestPattern.test(String(file.digest || ''))) {
    throw skillError('SKILL_FILE_DIGEST_INVALID', 'Skill artifact file digest is invalid.')
  }
  const after = assertBindingMetadata(
    await client.getAgentSkillMetadata(id),
    skillBinding
  )
  const afterArtifact = findArtifact(after, artifactId)
  if (JSON.stringify(afterArtifact) !== JSON.stringify(artifact)) {
    throw skillError('SKILL_DIGEST_MISMATCH', 'Skill artifact declaration changed while loading.')
  }

  const requestedPermissions = [...new Set(
    (after.requestedPermissions || []).map(String)
  )].sort()
  const skillArtifact = deepFreeze({
    skillId: id,
    id: artifact.id,
    path: artifact.path,
    target: artifact.target,
    interpreter: artifact.interpreter,
    version: after.version,
    packageDigest: after.packageDigest,
    fileDigest: file.digest,
    arguments: artifactArgs,
    requestedPermissions
  })
  const boundEndpoint = deepFreeze(cloneJson(endpoint || {}))
  const localExecution = artifact.target === 'local'
    ? deepFreeze({
      shell: false,
      timeoutMs: 30000,
      outputLimitBytes: 64 * 1024,
      environmentKeys: [...localEnvironmentKeys],
      requestedPermissions
    })
    : undefined

  const validateArtifact = async () => {
    const currentBefore = assertBindingMetadata(
      await client.getAgentSkillMetadata(id),
      skillBinding
    )
    const currentArtifact = findArtifact(currentBefore, artifactId)
    if (JSON.stringify(currentArtifact) !== JSON.stringify(artifact)) {
      throw skillError('SKILL_DIGEST_MISMATCH', 'Skill artifact declaration changed before dispatch.')
    }
    const currentFile = await client.readAgentSkillFile(id, artifact.path)
    const currentAfter = assertBindingMetadata(
      await client.getAgentSkillMetadata(id),
      skillBinding
    )
    if (currentFile?.path !== artifact.path ||
      currentFile?.digest !== skillArtifact.fileDigest ||
      currentAfter.packageDigest !== skillArtifact.packageDigest) {
      throw skillError('SKILL_DIGEST_MISMATCH', 'Skill artifact content changed before dispatch.')
    }
    return true
  }

  const call = {
    toolName: artifact.target === 'remote'
      ? 'send_terminal_command'
      : 'run_local_cli',
    args: artifact.target === 'remote'
      ? deepFreeze({
        command: commandFor(artifact, artifactArgs),
        script: file.content,
        scriptArguments: artifactArgs
      })
      : deepFreeze({
        tool: artifact.interpreter,
        args: artifactArgs
      }),
    expandedContent: String(file.content || ''),
    skillArtifact,
    endpoint: boundEndpoint,
    validateArtifact,
    ...(localExecution ? { localExecution } : {})
  }
  return Object.freeze(call)
}
