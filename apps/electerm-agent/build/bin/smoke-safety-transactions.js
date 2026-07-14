const { Client } = require('@electerm/ssh2')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  assertSafeRemoteTarget,
  buildCleanupAbsenceCondition,
  createValidatedRemoteScope,
  execCommand,
  executeCleanupIfSafe,
  shellQuote
} = require('./smoke-ssh-sftp')

const root = path.resolve(__dirname, '../..')
const defaultTimeoutMs = 15000
const maxPrivateKeyBytes = 1024 * 1024
const processGoneMarker = '__PROCESS_GONE__'
const markerAbsentMarker = '__MARKER_ABSENT__'

function safeError (error, secrets = []) {
  let message = String(error?.message || error || '未知错误')
  for (const secret of secrets) {
    const value = String(secret || '')
    if (value) message = message.replaceAll(value, '[REDACTED]')
  }
  return message
    .replace(/(password|passphrase|private[_ -]?key|api[_ -]?key|token)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 1000)
}

function check (name, ok, detail = '') {
  return {
    name: String(name),
    ok: ok === true,
    detail: String(detail || '').slice(0, 1000)
  }
}

async function runLocalChecks () {
  const domainRoot = path.join(root, 'src/client/common/safety-transactions')
  const importDomain = file => import(pathToFileURL(path.join(domainRoot, file)).href)
  const results = []

  try {
    const { classifyCommand } = await importDomain('command-classifier.js')
    const readonly = classifyCommand('uptime')
    const reversible = classifyCommand('/usr/bin/chmod 600 /tmp/shellpilot-safety-smoke-file')
    const blocked = classifyCommand('/sbin/reboot')
    results.push(check(
      'readonly classification',
      readonly.risk === 'readonly' && readonly.requiresConfirmation === false,
      `risk=${readonly.risk}`
    ))
    results.push(check(
      'reversible change classification',
      reversible.risk === 'change' && reversible.reversible === true && reversible.provider === 'permissions',
      `risk=${reversible.risk} provider=${reversible.provider || 'none'}`
    ))
    results.push(check(
      'blocked command classification',
      blocked.risk === 'blocked' && blocked.reversible === false,
      `risk=${blocked.risk}`
    ))
  } catch (error) {
    results.push(check('command classification model', false, safeError(error)))
  }

  try {
    const { assertSameEndpoint, buildEndpointKey } = await importDomain('endpoint-guard.js')
    const original = { host: 'Example.COM', port: 22, username: 'root' }
    const reconnected = { host: 'example.com.', port: '22', username: 'root' }
    const endpointKey = buildEndpointKey(original)
    results.push(check(
      'endpoint reconnect guard',
      assertSameEndpoint(original, reconnected) === true && endpointKey === 'root@example.com:22',
      endpointKey
    ))
    let rejected = false
    try {
      assertSameEndpoint(original, { ...reconnected, username: 'other' })
    } catch {
      rejected = true
    }
    results.push(check('endpoint mismatch rejection', rejected))
  } catch (error) {
    results.push(check('endpoint guard model', false, safeError(error)))
  }

  try {
    const { operationStates, validateRecoveryStructure } = await importDomain('models.js')
    const invalid = validateRecoveryStructure({
      state: operationStates.rollbackAvailable,
      reversible: true
    })
    results.push(check(
      'rollback structure verification',
      operationStates.rollbackAvailable === 'rollback-available' && invalid.valid === false,
      invalid.error
    ))
  } catch (error) {
    results.push(check('rollback model', false, safeError(error)))
  }

  return results
}

function readPrivateKey (file) {
  if (!file) return undefined
  const absolute = path.resolve(file)
  const stat = fs.statSync(absolute)
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxPrivateKeyBytes) {
    throw new Error('SSH 私钥文件无效或超过安全大小限制。')
  }
  return fs.readFileSync(absolute)
}

function normalizeSafetyTestRoot (value) {
  const raw = String(value || '')
  const normalized = path.posix.normalize(raw).replace(/\/+$/, '') || '/'
  const isAllowedPrefix = normalized === '/tmp' ||
    normalized.startsWith('/tmp/') ||
    normalized === '/var/tmp' ||
    normalized.startsWith('/var/tmp/')
  const segments = raw.split('/').slice(1)
  const hasUnsafeSegment = segments.some(segment =>
    !segment ||
    segment === '.' ||
    segment === '..' ||
    !/^[A-Za-z0-9._-]+$/.test(segment)
  )
  if (!raw ||
      raw !== normalized ||
      /\s/.test(raw) ||
      !isAllowedPrefix ||
      hasUnsafeSegment) {
    throw new Error('远程 smoke 临时目录必须是 /tmp、/var/tmp 或其下仅含安全路径段的既有目录。')
  }
  return normalized
}

function normalizeHostFingerprint (value) {
  const raw = String(value || '').trim()
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase()

  const match = /^SHA256:([A-Za-z0-9+/]{43}=?)$/.exec(raw)
  if (!match) throw new Error('Invalid SHA256 host fingerprint.')
  const unpadded = match[1].replace(/=+$/, '')
  const digest = Buffer.from(`${unpadded}=`, 'base64')
  if (digest.length !== 32 || digest.toString('base64').replace(/=+$/, '') !== unpadded) {
    throw new Error('Invalid SHA256 host fingerprint.')
  }
  return digest.toString('hex')
}

function hostFingerprintMatches (expected, actual) {
  try {
    return normalizeHostFingerprint(expected) === normalizeHostFingerprint(actual)
  } catch {
    return false
  }
}

function resolveRemoteConfig (env = process.env) {
  const requested = env.SHELLPILOT_SAFETY_SMOKE_REAL === '1'
  const host = String(env.SHELLPILOT_SSH_HOST || '').trim()
  const username = String(env.SHELLPILOT_SSH_USER || '').trim()
  const password = String(env.SHELLPILOT_SSH_PASSWORD || '')
  const privateKeyPath = String(env.SHELLPILOT_SSH_PRIVATE_KEY || '').trim()
  const hostFingerprint = String(env.SHELLPILOT_SSH_HOST_FINGERPRINT || '').trim()
  const hasCredential = Boolean(password || privateKeyPath)
  const complete = Boolean(host && username && hasCredential)

  return {
    requested,
    complete,
    host,
    username,
    password,
    privateKeyPath,
    hostFingerprint,
    port: Number(env.SHELLPILOT_SSH_PORT || 22),
    testRoot: String(env.SHELLPILOT_SAFETY_SMOKE_DIR || env.SHELLPILOT_SSH_TEST_DIR || '/tmp'),
    timeoutMs: Number(env.SHELLPILOT_SAFETY_SMOKE_TIMEOUT_MS || defaultTimeoutMs)
  }
}

function isAllowedTemporaryRoot (value) {
  try {
    normalizeSafetyTestRoot(value)
    return true
  } catch {
    return false
  }
}

function validateRemoteConfig (config) {
  if (!config.requested) return { enabled: false, reason: '未显式启用真实服务器模式。' }
  if (!config.complete) return { enabled: false, error: '真实服务器模式缺少主机、账号或认证信息。' }
  if (!config.hostFingerprint) {
    return { enabled: false, error: '真实服务器模式缺少 SHELLPILOT_SSH_HOST_FINGERPRINT。' }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return { enabled: false, error: 'SSH 端口无效。' }
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 120000) {
    return { enabled: false, error: 'smoke 超时时间必须在 1000 到 120000 毫秒之间。' }
  }
  try {
    normalizeHostFingerprint(config.hostFingerprint)
    const testRoot = normalizeSafetyTestRoot(config.testRoot)
    const scope = createValidatedRemoteScope(testRoot)
    return { enabled: true, scope }
  } catch (error) {
    return { enabled: false, error: safeError(error) }
  }
}

function buildSshConnectOptions (config, privateKey) {
  const expectedFingerprint = normalizeHostFingerprint(config.hostFingerprint)
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password || undefined,
    privateKey,
    readyTimeout: config.timeoutMs,
    keepaliveInterval: 10000,
    hostHash: 'sha256',
    hostVerifier: actual => hostFingerprintMatches(expectedFingerprint, actual)
  }
}

function connectRemote (config) {
  return new Promise((resolve, reject) => {
    let connectOptions
    let privateKey
    try {
      normalizeHostFingerprint(config.hostFingerprint)
      privateKey = readPrivateKey(config.privateKeyPath)
      connectOptions = buildSshConnectOptions(config, privateKey)
    } catch (error) {
      reject(error)
      return
    }
    const conn = new Client()
    conn.once('ready', () => resolve(conn))
    conn.once('error', reject)
    conn.connect(connectOptions)
  })
}

function buildRemoteRootValidationCommand (testRoot) {
  const normalized = normalizeSafetyTestRoot(testRoot)
  return `if [ -d ${shellQuote(normalized)} ] && [ ! -L ${shellQuote(normalized)} ] && [ ! -h ${shellQuote(normalized)} ]; then readlink -f -- ${shellQuote(normalized)}; else exit 1; fi`
}

function assertResolvedRemoteRoot (testRoot, result) {
  const expected = normalizeSafetyTestRoot(testRoot)
  if (!result || result.code !== 0) {
    throw new Error('Remote test root must be an existing directory and not a symbolic link.')
  }
  const lines = String(result.stdout || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter(Boolean)
  if (lines.length !== 1) throw new Error('Remote test root realpath output is invalid.')

  let resolved
  try {
    resolved = normalizeSafetyTestRoot(lines[0])
  } catch {
    throw new Error('Remote test root resolved outside the allowed temporary roots.')
  }
  if (resolved !== expected) {
    throw new Error('Remote test root realpath does not match its lexical path.')
  }
  return resolved
}

function assertCancellationArtifactPath (value, expectedName) {
  const normalized = path.posix.normalize(String(value || ''))
  const remoteDir = path.posix.dirname(normalized)
  const testRoot = path.posix.dirname(remoteDir)
  normalizeSafetyTestRoot(testRoot)
  if (!/^shellpilot-smoke-[a-f0-9]+(?:-[a-f0-9]+)*$/.test(path.posix.basename(remoteDir)) ||
      path.posix.basename(normalized) !== expectedName) {
    throw new Error('Unsafe cancellation artifact path.')
  }
  return assertSafeRemoteTarget(remoteDir, normalized)
}

function buildCancellationPlan (remoteDir) {
  const pidFile = assertCancellationArtifactPath(`${remoteDir}/cancel-worker.pid`, 'cancel-worker.pid')
  const markerFile = assertCancellationArtifactPath(`${remoteDir}/cancel-worker-finished.txt`, 'cancel-worker-finished.txt')
  const workerCommand = [
    `pid_file=${shellQuote(pidFile)}`,
    `marker=${shellQuote(markerFile)}`,
    'child_pid=',
    'terminate_worker () { if [ -n "$child_pid" ]; then kill -TERM "$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; fi; exit 143; }',
    'trap terminate_worker HUP INT TERM',
    'printf \'%s\\n\' "$$" > "$pid_file"',
    'sleep 20 &',
    'child_pid=$!',
    'wait "$child_pid"',
    'child_pid=',
    'printf \'finished\\n\' > "$marker"'
  ].join('\n')
  return { markerFile, pidFile, workerCommand }
}

function buildReadWorkerPidCommand (pidFile) {
  const safePath = assertCancellationArtifactPath(pidFile, 'cancel-worker.pid')
  return `if [ -f ${shellQuote(safePath)} ] && [ ! -L ${shellQuote(safePath)} ] && [ ! -h ${shellQuote(safePath)} ]; then cat -- ${shellQuote(safePath)}; else exit 1; fi`
}

function normalizeWorkerPid (value) {
  const pid = String(value || '').trim()
  if (!/^[1-9][0-9]*$/.test(pid)) throw new Error('Invalid remote worker PID.')
  return pid
}

function buildTerminateWorkerCommand (pid) {
  return `kill -TERM ${shellQuote(normalizeWorkerPid(pid))}`
}

function buildWorkerGoneCommand (pid) {
  return `if kill -0 ${shellQuote(normalizeWorkerPid(pid))} 2>/dev/null; then exit 1; else printf '${processGoneMarker}\\n'; fi`
}

function buildMarkerAbsenceCommand (markerFile) {
  const safePath = assertCancellationArtifactPath(markerFile, 'cancel-worker-finished.txt')
  return `if [ ! -e ${shellQuote(safePath)} ] && [ ! -L ${shellQuote(safePath)} ] && [ ! -h ${shellQuote(safePath)} ]; then printf '${markerAbsentMarker}\\n'; else exit 1; fi`
}

function isCancellationComplete (result) {
  return result?.terminateResult?.code === 0 &&
    result?.goneResult?.code === 0 &&
    String(result.goneResult.stdout || '').includes(processGoneMarker) &&
    result?.stableGoneResult?.code === 0 &&
    String(result.stableGoneResult.stdout || '').includes(processGoneMarker) &&
    result?.markerResult?.code === 0 &&
    String(result.markerResult.stdout || '').includes(markerAbsentMarker) &&
    result?.channelSettled === true
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function pollRemoteCommand (conn, command, accept, deadline) {
  let lastResult
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now())
    lastResult = await execCommand(conn, command, Math.min(remaining, 1000))
    if (accept(lastResult)) return lastResult
    await delay(Math.min(50, Math.max(1, deadline - Date.now())))
  }
  throw new Error('Remote cancellation condition timed out.')
}

async function cancelRemoteCommand (conn, remoteDir, timeoutMs) {
  const plan = buildCancellationPlan(remoteDir)
  const deadline = Date.now() + timeoutMs
  let pid
  let completed = false
  const channelOutcome = execCommand(conn, plan.workerCommand, timeoutMs)
    .then(result => ({ result, settled: true }), error => ({ error, settled: false }))

  try {
    const pidResult = await pollRemoteCommand(
      conn,
      buildReadWorkerPidCommand(plan.pidFile),
      result => result.code === 0 && /^[1-9][0-9]*$/.test(String(result.stdout || '').trim()),
      deadline
    )
    pid = normalizeWorkerPid(pidResult.stdout)
    const terminateResult = await execCommand(
      conn,
      buildTerminateWorkerCommand(pid),
      Math.max(50, deadline - Date.now())
    )
    const goneResult = await pollRemoteCommand(
      conn,
      buildWorkerGoneCommand(pid),
      result => result.code === 0 && String(result.stdout || '').includes(processGoneMarker),
      deadline
    )
    const channel = await channelOutcome
    if (!channel.settled) throw channel.error

    const stableWindowMs = Math.min(500, Math.max(200, Math.floor(timeoutMs / 5)))
    if (Date.now() + stableWindowMs >= deadline) {
      throw new Error('Remote cancellation has no time left for a stable verification window.')
    }
    await delay(stableWindowMs)
    const stableGoneResult = await execCommand(
      conn,
      buildWorkerGoneCommand(pid),
      Math.max(50, deadline - Date.now())
    )
    const markerResult = await execCommand(
      conn,
      buildMarkerAbsenceCommand(plan.markerFile),
      Math.max(50, deadline - Date.now())
    )
    const result = {
      channelSettled: true,
      goneResult,
      markerResult,
      stableGoneResult,
      terminateResult
    }
    if (!isCancellationComplete(result)) {
      throw new Error('Remote cancellation could not be proven complete.')
    }
    completed = true
    return result
  } finally {
    if (!completed && pid) {
      try {
        await execCommand(conn, buildTerminateWorkerCommand(pid), Math.min(timeoutMs, 1000))
      } catch {}
    }
  }
}

async function runRemoteChecks (config, scope) {
  const results = []
  const remoteDir = scope.remoteTestDir
  const stateFile = `${remoteDir}/state.txt`
  let conn
  let rootVerified = false
  let setupAttempted = false

  try {
    conn = await connectRemote(config)
    const rootProbe = await execCommand(
      conn,
      buildRemoteRootValidationCommand(scope.testRoot),
      config.timeoutMs
    )
    try {
      assertResolvedRemoteRoot(scope.testRoot, rootProbe)
      rootVerified = true
      results.push(check('remote temporary root verification', true, `path=${scope.testRoot}`))
    } catch (error) {
      results.push(check('remote temporary root verification', false, safeError(error, [config.password])))
      return results
    }

    setupAttempted = true
    const setup = await execCommand(
      conn,
      `mkdir -m 700 -- ${shellQuote(remoteDir)} && printf 'original-state\\n' > ${shellQuote(stateFile)} && chmod 640 -- ${shellQuote(stateFile)}`,
      config.timeoutMs
    )
    results.push(check('remote temporary scope setup', setup.code === 0, `path=${remoteDir}`))
    if (setup.code !== 0) return results

    const before = await execCommand(
      conn,
      `printf 'mode='; stat -c '%a' -- ${shellQuote(stateFile)}; printf 'content='; cat -- ${shellQuote(stateFile)}`,
      config.timeoutMs
    )
    results.push(check(
      'remote temporary snapshot',
      before.code === 0 && before.stdout.includes('mode=640') && before.stdout.includes('content=original-state')
    ))

    const changed = await execCommand(
      conn,
      `printf 'changed-state\\n' > ${shellQuote(stateFile)} && chmod 600 -- ${shellQuote(stateFile)}`,
      config.timeoutMs
    )
    results.push(check('remote temporary write and chmod', changed.code === 0))

    const restored = await execCommand(
      conn,
      `printf 'original-state\\n' > ${shellQuote(stateFile)} && chmod 640 -- ${shellQuote(stateFile)} && test "$(stat -c '%a' -- ${shellQuote(stateFile)})" = 640 && test "$(cat -- ${shellQuote(stateFile)})" = original-state`,
      config.timeoutMs
    )
    results.push(check('remote temporary restore verification', restored.code === 0))

    const cancellation = await cancelRemoteCommand(
      conn,
      remoteDir,
      Math.min(config.timeoutMs, 5000)
    )
    results.push(check(
      'remote cancellation terminates worker and leaves no completed marker',
      isCancellationComplete(cancellation)
    ))
  } catch (error) {
    results.push(check('remote safety smoke', false, safeError(error, [config.password])))
  } finally {
    if (conn) {
      if (rootVerified && setupAttempted) {
        try {
          const cleanup = await executeCleanupIfSafe(scope.testRoot, remoteDir, safeTarget => {
            return execCommand(
              conn,
              `rm -rf -- ${shellQuote(safeTarget)}; ${buildCleanupAbsenceCondition(safeTarget)}`,
              config.timeoutMs
            )
          })
          results.push(check('remote temporary scope cleanup', cleanup.code === 0))
        } catch (error) {
          results.push(check('remote temporary scope cleanup', false, safeError(error, [config.password])))
        }
      }
      try { conn.end() } catch {}
    }
  }

  return results
}

async function runSafetySmoke (options = {}) {
  const env = options.env || process.env
  const localResults = await runLocalChecks()
  const config = resolveRemoteConfig(env)
  const remoteValidation = validateRemoteConfig(config)
  let remoteResults = []
  let remote

  if (remoteValidation.enabled) {
    remoteResults = await runRemoteChecks(config, remoteValidation.scope)
    remote = { requested: true, skipped: false }
  } else if (remoteValidation.error) {
    remoteResults = [check('remote configuration', false, remoteValidation.error)]
    remote = { requested: config.requested, skipped: true, reason: remoteValidation.error }
  } else {
    remote = { requested: false, skipped: true, reason: remoteValidation.reason }
  }

  const checks = [...localResults, ...remoteResults]
  return {
    kind: 'shellpilot-safety-smoke',
    schemaVersion: 1,
    mode: remoteValidation.enabled ? 'real' : 'local',
    passed: checks.filter(item => item.ok).length,
    failed: checks.filter(item => !item.ok).length,
    remote,
    checks
  }
}

module.exports = {
  assertResolvedRemoteRoot,
  buildCancellationPlan,
  buildMarkerAbsenceCommand,
  buildReadWorkerPidCommand,
  buildRemoteRootValidationCommand,
  buildSshConnectOptions,
  buildTerminateWorkerCommand,
  buildWorkerGoneCommand,
  cancelRemoteCommand,
  connectRemote,
  hostFingerprintMatches,
  isAllowedTemporaryRoot,
  isCancellationComplete,
  normalizeHostFingerprint,
  normalizeSafetyTestRoot,
  resolveRemoteConfig,
  runLocalChecks,
  runRemoteChecks,
  runSafetySmoke,
  safeError,
  validateRemoteConfig
}

if (require.main === module) {
  runSafetySmoke()
    .then(summary => {
      console.log(JSON.stringify(summary))
      if (summary.failed > 0) process.exitCode = 1
    })
    .catch(error => {
      console.log(JSON.stringify({
        kind: 'shellpilot-safety-smoke',
        schemaVersion: 1,
        mode: 'local',
        passed: 0,
        failed: 1,
        remote: { requested: false, skipped: true },
        checks: [check('smoke runner', false, safeError(error))]
      }))
      process.exitCode = 1
    })
}
