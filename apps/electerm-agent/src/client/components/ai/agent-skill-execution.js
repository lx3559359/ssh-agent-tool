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

function utf8Base64 (value) {
  const bytes = new TextEncoder().encode(String(value ?? ''))
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return globalThis.btoa(binary)
}

function encodedToken (value) {
  return `'${utf8Base64(value)}'`
}

function utf16LeBase64 (value) {
  const text = String(value ?? '')
  const bytes = new Uint8Array(text.length * 2)
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    bytes[index * 2] = code & 0xff
    bytes[index * 2 + 1] = code >>> 8
  }
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return globalThis.btoa(binary)
}

function interpreterInvocation (interpreter) {
  if (interpreter === 'bash') {
    return {
      prefix: 'bash -c',
      // eslint-disable-next-line no-template-curly-in-string
      wrapper: 'script_b64="$1"; shift; decoded=(); for item in "$@"; do value=$(printf %s "$item" | base64 -d) || exit 65; decoded+=("$value"); done; printf %s "$script_b64" | base64 -d | bash -s -- "${decoded[@]}"',
      leadingArgs: [encodedToken('shellpilot-skill')]
    }
  }
  if (interpreter === 'sh') {
    return {
      prefix: 'sh -c',
      // eslint-disable-next-line no-template-curly-in-string
      wrapper: 'script_b64="$1"; shift; tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/shellpilot-skill.XXXXXX") || exit 70; cleanup(){ rm -rf -- "$tmp_dir"; }; trap cleanup EXIT HUP INT TERM; index=0; for item in "$@"; do printf %s "$item" | base64 -d > "$tmp_dir/$index" || exit 65; index=$((index+1)); done; set --; cursor=0; while [ "$cursor" -lt "$index" ]; do value=$(cat "$tmp_dir/$cursor"; printf x); value=${value%x}; set -- "$@" "$value"; cursor=$((cursor+1)); done; printf %s "$script_b64" | base64 -d | sh -s -- "$@"',
      leadingArgs: [encodedToken('shellpilot-skill')]
    }
  }
  if (interpreter === 'node') {
    return {
      prefix: 'node -e',
      wrapper: 'const [script,...args]=process.argv.slice(1).map(value=>Buffer.from(value,"base64").toString("utf8")); process.argv=["node","skill.js",...args]; require("vm").runInThisContext(script,{filename:"skill.js"})',
      leadingArgs: []
    }
  }
  if (interpreter === 'python' || interpreter === 'python3') {
    return {
      prefix: `${interpreter} -c`,
      wrapper: 'import base64,sys; script=base64.b64decode(sys.argv[1]); sys.argv=["skill.py"]+[base64.b64decode(value).decode("utf-8") for value in sys.argv[2:]]; exec(compile(script,"skill.py","exec"))',
      leadingArgs: []
    }
  }
  throw skillError('SKILL_INTERPRETER_UNSUPPORTED', 'Skill artifact interpreter is unsupported.')
}

function commandFor (artifact, args, content) {
  if (artifact.interpreter === 'powershell' || artifact.interpreter === 'pwsh') {
    const payloads = [content, ...args]
      .map(value => `"${utf8Base64(value)}"`)
      .join(',')
    const wrapper = `$payloads=@(${payloads}); $encoding=[Text.Encoding]::UTF8; $script=$encoding.GetString([Convert]::FromBase64String($payloads[0])); $decoded=@(); for($index=1; $index -lt $payloads.Count; $index+=1){ $decoded+=$encoding.GetString([Convert]::FromBase64String($payloads[$index])) }; & ([scriptblock]::Create($script)) @decoded; if($LASTEXITCODE -ne $null){ exit $LASTEXITCODE }`
    const command = `${artifact.interpreter} -NoProfile -NonInteractive -EncodedCommand ${utf16LeBase64(wrapper)}`
    if (command.length > 24 * 1024) {
      throw skillError(
        'SKILL_REMOTE_COMMAND_TOO_LARGE',
        'Remote Skill script and arguments exceed the cross-shell command limit.'
      )
    }
    return command
  }
  const invocation = interpreterInvocation(artifact.interpreter)
  if (invocation.wrapper.includes("'")) {
    throw skillError('SKILL_INTERPRETER_WRAPPER_INVALID', 'Skill interpreter wrapper is invalid.')
  }
  const tokens = [
    `'${invocation.wrapper}'`,
    ...invocation.leadingArgs,
    encodedToken(content),
    ...args.map(encodedToken)
  ]
  const command = `${invocation.prefix} ${tokens.join(' ')}`
  if (command.length > 24 * 1024) {
    throw skillError(
      'SKILL_REMOTE_COMMAND_TOO_LARGE',
      'Remote Skill script and arguments exceed the cross-shell command limit.'
    )
  }
  return command
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
        command: commandFor(
          artifact,
          artifactArgs,
          file.content
        ),
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

export async function prepareSelectedSkillArtifactCall ({
  skillId,
  artifactId,
  args,
  skillBindings = [],
  endpoint,
  client = agentSkillClient
} = {}) {
  const selectedId = String(skillId || '').trim()
  const binding = skillBindings.find(item => bindingId(item) === selectedId)
  if (!binding) {
    throw skillError(
      'SKILL_NOT_SELECTED',
      'Only an explicitly or implicitly selected Skill artifact can run.'
    )
  }
  return prepareSkillArtifactCall({
    skillBinding: binding,
    artifactId,
    args,
    endpoint,
    client
  })
}
