const { Client } = require('@electerm/ssh2')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  buildCleanupAbsenceCondition,
  createValidatedRemoteScope,
  execCommand,
  executeCleanupIfSafe,
  shellQuote
} = require('./smoke-ssh-sftp')

const root = path.resolve(__dirname, '../..')
const defaultTimeoutMs = 15000
const maxPrivateKeyBytes = 1024 * 1024

function safeError (error) {
  return String(error?.message || error || '未知错误')
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

function resolveRemoteConfig (env = process.env) {
  const requested = env.SHELLPILOT_SAFETY_SMOKE_REAL === '1'
  const host = String(env.SHELLPILOT_SSH_HOST || '').trim()
  const username = String(env.SHELLPILOT_SSH_USER || '').trim()
  const password = String(env.SHELLPILOT_SSH_PASSWORD || '')
  const privateKeyPath = String(env.SHELLPILOT_SSH_PRIVATE_KEY || '').trim()
  const hasCredential = Boolean(password || privateKeyPath)
  const complete = Boolean(host && username && hasCredential)

  return {
    requested,
    complete,
    host,
    username,
    password,
    privateKeyPath,
    port: Number(env.SHELLPILOT_SSH_PORT || 22),
    testRoot: String(env.SHELLPILOT_SAFETY_SMOKE_DIR || env.SHELLPILOT_SSH_TEST_DIR || '/tmp'),
    timeoutMs: Number(env.SHELLPILOT_SAFETY_SMOKE_TIMEOUT_MS || defaultTimeoutMs)
  }
}

function isAllowedTemporaryRoot (value) {
  const normalized = path.posix.normalize(String(value || ''))
    .replace(/\/+$/, '') || '/'
  return normalized === '/tmp' ||
    normalized.startsWith('/tmp/') ||
    normalized === '/var/tmp' ||
    normalized.startsWith('/var/tmp/')
}

function validateRemoteConfig (config) {
  if (!config.requested) return { enabled: false, reason: '未显式启用真实服务器模式。' }
  if (!config.complete) return { enabled: false, error: '真实服务器模式缺少主机、账号或认证信息。' }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return { enabled: false, error: 'SSH 端口无效。' }
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 120000) {
    return { enabled: false, error: 'smoke 超时时间必须在 1000 到 120000 毫秒之间。' }
  }
  if (!isAllowedTemporaryRoot(config.testRoot)) {
    return { enabled: false, error: '远程 smoke 只允许使用 /tmp 或 /var/tmp 下的临时目录。' }
  }
  try {
    const scope = createValidatedRemoteScope(config.testRoot)
    return { enabled: true, scope }
  } catch (error) {
    return { enabled: false, error: safeError(error) }
  }
}

function connectRemote (config) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    let privateKey
    try {
      privateKey = readPrivateKey(config.privateKeyPath)
    } catch (error) {
      reject(error)
      return
    }
    conn.once('ready', () => resolve(conn))
    conn.once('error', reject)
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password || undefined,
      privateKey,
      readyTimeout: config.timeoutMs,
      keepaliveInterval: 10000,
      hostVerifier: () => true
    })
  })
}

function cancelRemoteCommand (conn, command, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stream
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(cancelTimer)
      clearTimeout(timeoutTimer)
      if (error) reject(error)
      else resolve(result)
    }
    const cancelTimer = setTimeout(() => {
      try {
        stream?.signal?.('TERM')
        stream?.close?.()
      } catch {}
    }, 250)
    const timeoutTimer = setTimeout(() => {
      try { stream?.close?.() } catch {}
      finish(new Error('取消测试未在限定时间内结束。'))
    }, timeoutMs)

    conn.exec(command, (error, channel) => {
      if (error) {
        finish(error)
        return
      }
      stream = channel
      channel.once('error', finish)
      channel.once('close', code => finish(null, { code }))
    })
  })
}

async function runRemoteChecks (config, scope) {
  const results = []
  const remoteDir = scope.remoteTestDir
  const stateFile = `${remoteDir}/state.txt`
  const cancelMarker = `${remoteDir}/cancelled-command-finished.txt`
  let conn

  try {
    conn = await connectRemote(config)
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

    await cancelRemoteCommand(
      conn,
      `sh -c 'trap "exit 130" HUP INT TERM; sleep 20; printf finished > ${shellQuote(cancelMarker)}'`,
      Math.min(config.timeoutMs, 5000)
    )
    await new Promise(resolve => setTimeout(resolve, 300))
    const cancelled = await execCommand(
      conn,
      `test ! -e ${shellQuote(cancelMarker)} && test ! -L ${shellQuote(cancelMarker)}`,
      config.timeoutMs
    )
    results.push(check('remote cancellation leaves no completed marker', cancelled.code === 0))
  } catch (error) {
    results.push(check('remote safety smoke', false, safeError(error)))
  } finally {
    if (conn) {
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
        results.push(check('remote temporary scope cleanup', false, safeError(error)))
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
  cancelRemoteCommand,
  isAllowedTemporaryRoot,
  resolveRemoteConfig,
  runLocalChecks,
  runRemoteChecks,
  runSafetySmoke,
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
