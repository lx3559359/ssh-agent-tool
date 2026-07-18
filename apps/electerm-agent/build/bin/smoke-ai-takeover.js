const { Client } = require('@electerm/ssh2')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  createSshHostVerification,
  normalizeExpectedHostFingerprint
} = require('./ssh-host-fingerprint')
const {
  assertSafeTestRoot,
  createRedactor,
  execCommand,
  shellQuote
} = require('./smoke-ssh-sftp')

const recoveryAcknowledgement = 'I_HAVE_OUT_OF_BAND_RECOVERY'
const namespacePrefix = 'shellpilot-ai-takeover-smoke-'
const dedicatedServicePattern = /^shellpilot-ai-takeover-smoke-[a-z0-9][a-z0-9_.@-]*\.service$/

function parseArgs (argv = process.argv.slice(2)) {
  const configIndex = argv.indexOf('--config')
  return {
    isolated: argv.includes('--isolated'),
    configPath: configIndex >= 0 ? String(argv[configIndex + 1] || '') : ''
  }
}

function readConfigFile (configPath) {
  if (!configPath) {
    throw new Error('Missing --config <path> for the isolated AI takeover smoke.')
  }
  const absolutePath = path.resolve(configPath)
  const stat = fs.statSync(absolutePath)
  if (!stat.isFile()) {
    throw new Error('AI takeover smoke config must be a regular file.')
  }
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

function normalizeCredential (config, env = process.env) {
  const passwordEnv = String(config.passwordEnv || 'SHELLPILOT_SSH_PASSWORD')
  const passphraseEnv = String(config.passphraseEnv || 'SHELLPILOT_SSH_PRIVATE_KEY_PASSPHRASE')
  const password = String(config.password || env[passwordEnv] || '')
  const privateKeyPath = String(config.privateKeyPath || '')
  const privateKey = privateKeyPath
    ? fs.readFileSync(path.resolve(privateKeyPath))
    : undefined
  const passphrase = String(config.passphrase || env[passphraseEnv] || '')
  if (!password && !privateKey) {
    throw new Error('Missing SSH smoke credential: configure password/passwordEnv or privateKeyPath.')
  }
  return { password, privateKey, passphrase }
}

function validateTakeoverSmokeConfig (input, options = {}) {
  if (options.isolated !== true) {
    throw new Error('Refusing AI takeover smoke without the explicit --isolated flag.')
  }
  const config = {
    ...input,
    host: String(input?.host || '').trim(),
    username: String(input?.username || input?.user || '').trim(),
    hostFingerprint: String(input?.hostFingerprint || '').trim(),
    testRoot: String(input?.testRoot || '').trim(),
    dedicatedService: String(input?.dedicatedService || '').trim(),
    recoveryAcknowledgement: String(input?.recoveryAcknowledgement || '').trim(),
    port: Number(input?.port || 22),
    timeoutMs: Number(input?.timeoutMs || 20000)
  }
  if (!config.host || !config.username) {
    throw new Error('Missing SSH host or username for AI takeover smoke.')
  }
  if (!config.hostFingerprint) {
    throw new Error('Missing explicit SSH host fingerprint for AI takeover smoke.')
  }
  normalizeExpectedHostFingerprint(config.hostFingerprint)
  if (!config.testRoot) {
    throw new Error('Missing caller-provided test root for AI takeover smoke.')
  }
  try {
    config.testRoot = assertSafeTestRoot(config.testRoot)
  } catch (error) {
    throw new Error(`AI takeover smoke requires a safe temporary test root: ${error.message}`)
  }
  if (!dedicatedServicePattern.test(config.dedicatedService)) {
    throw new Error(
      'AI takeover smoke requires a dedicated test service named shellpilot-ai-takeover-smoke-*.service.'
    )
  }
  if (config.recoveryAcknowledgement !== recoveryAcknowledgement) {
    throw new Error(
      `AI takeover smoke requires out-of-band recovery acknowledgement: ${recoveryAcknowledgement}.`
    )
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('AI takeover smoke SSH port must be an integer from 1 to 65535.')
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 60000) {
    throw new Error('AI takeover smoke timeout must be between 1000 and 60000 milliseconds.')
  }
  return config
}

function createTakeoverSmokeScope (testRoot) {
  const normalizedRoot = assertSafeTestRoot(testRoot)
  const remoteTestDir = path.posix.join(
    normalizedRoot,
    `${namespacePrefix}${crypto.randomUUID()}`
  )
  return {
    testRoot: normalizedRoot,
    remoteTestDir,
    paths: {
      state: path.posix.join(remoteTestDir, 'state.txt'),
      backup: path.posix.join(remoteTestDir, 'state.backup'),
      cancellationMarker: path.posix.join(remoteTestDir, 'cancelled-command-ran')
    }
  }
}

function assertSafeTakeoverCleanupTarget (testRoot, target) {
  const normalizedRoot = assertSafeTestRoot(testRoot)
  const normalizedTarget = path.posix.normalize(String(target || '')).replace(/\/+$/, '')
  const relative = path.posix.relative(normalizedRoot, normalizedTarget)
  if (!relative ||
      relative.startsWith('../') ||
      relative.includes('/') ||
      !relative.startsWith(namespacePrefix) ||
      !/^shellpilot-ai-takeover-smoke-[a-f0-9-]+$/.test(relative)) {
    throw new Error(`unsafe takeover cleanup target: ${normalizedTarget || '(empty)'}`)
  }
  return normalizedTarget
}

function connect (config, credential) {
  const verification = createSshHostVerification(config.hostFingerprint)
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.once('ready', () => resolve(conn))
    conn.once('error', reject)
    conn.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: credential.password || undefined,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase || undefined,
      readyTimeout: config.timeoutMs,
      keepaliveInterval: 10000,
      ...verification
    })
  })
}

function cancelRemoteCommand (conn, markerPath, timeoutMs, redactor) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(redactor.error(error))
      else resolve(result)
    }
    const timeout = setTimeout(() => {
      finish(new Error(`cancellation probe timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    conn.exec(
      `sleep 120; printf '%s\\n' cancelled > ${shellQuote(markerPath)}`,
      (error, channel) => {
        if (error) {
          finish(error)
          return
        }
        channel.once('close', () => finish(null, { ok: true }))
        channel.once('error', finish)
        setTimeout(() => channel.close(), 150)
      }
    )
  })
}

async function runCheck (results, name, task, redactor) {
  try {
    const detail = await task()
    results.push({ name, ok: true, detail: String(detail || '') })
    console.log(`[PASS] ${name}${detail ? `: ${redactor(detail)}` : ''}`)
    return true
  } catch (error) {
    const safeError = redactor.error(error)
    results.push({ name, ok: false, detail: safeError.message })
    console.error(`[FAIL] ${name}: ${safeError.message}`)
    process.exitCode = 1
    return false
  }
}

async function runTakeoverSmoke (input, options = {}) {
  const config = validateTakeoverSmokeConfig(input, options)
  const credential = normalizeCredential(config, options.env)
  const redactor = createRedactor([credential.password, credential.privateKey, credential.passphrase])
  const scope = createTakeoverSmokeScope(config.testRoot)
  const results = []
  let conn
  let remoteScopeVerified = false

  try {
    conn = await connect(config, credential)
    await runCheck(results, 'bounded read-only diagnostics', async () => {
      const result = await execCommand(
        conn,
        `uname -s; uptime; df -Pk -- ${shellQuote(scope.testRoot)} | tail -n 1`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0 || result.stdout.length > 32768) {
        throw new Error(result.stderr || 'read-only diagnostics exceeded its output boundary')
      }
      return 'completed within 32 KiB output boundary'
    }, redactor)

    remoteScopeVerified = await runCheck(results, 'remote test root boundary', async () => {
      const expectedRoot = shellQuote(scope.testRoot)
      const result = await execCommand(
        conn,
        `set -eu; test -d ${expectedRoot}; test ! -L ${expectedRoot}; ` +
          `test ! -h ${expectedRoot}; actual=$(cd -- ${expectedRoot} && pwd -P); ` +
          `[ "$actual" = ${expectedRoot} ]`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0) {
        throw new Error('test root must already exist, must not be a link, and must resolve to itself')
      }
      return scope.testRoot
    }, redactor)
    if (!remoteScopeVerified) {
      throw new Error('Refusing writes because the remote test root boundary was not verified.')
    }

    const namespaceReady = await runCheck(results, 'isolated test namespace write', async () => {
      const result = await execCommand(
        conn,
        `set -eu; mkdir -p -- ${shellQuote(scope.remoteTestDir)}; ` +
          `printf '%s\\n' original > ${shellQuote(scope.paths.state)}; ` +
          `test -f ${shellQuote(scope.paths.state)}`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0) throw new Error(result.stderr || 'isolated namespace write failed')
      return scope.remoteTestDir
    }, redactor)
    if (!namespaceReady) {
      throw new Error('Refusing further smoke operations because the isolated namespace was not created.')
    }

    const rollbackVerified = await runCheck(results, 'verified backup change rollback', async () => {
      const result = await execCommand(
        conn,
        `set -eu; cp -- ${shellQuote(scope.paths.state)} ${shellQuote(scope.paths.backup)}; ` +
          `printf '%s\\n' changed > ${shellQuote(scope.paths.state)}; ` +
          `grep -qx changed ${shellQuote(scope.paths.state)}; ` +
          `cp -- ${shellQuote(scope.paths.backup)} ${shellQuote(scope.paths.state)}; ` +
          `grep -qx original ${shellQuote(scope.paths.state)}`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0) throw new Error(result.stderr || 'rollback verification failed')
      return 'original bytes restored'
    }, redactor)
    if (!rollbackVerified) {
      throw new Error('Refusing further smoke operations because rollback was not verified.')
    }

    const cancellationVerified = await runCheck(results, 'cancellation closes its channel', async () => {
      await cancelRemoteCommand(conn, scope.paths.cancellationMarker, config.timeoutMs, redactor)
      const result = await execCommand(
        conn,
        `test ! -e ${shellQuote(scope.paths.cancellationMarker)}`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0) throw new Error('cancelled command created its marker')
      return 'cancelled command did not reach its write'
    }, redactor)
    if (!cancellationVerified) {
      throw new Error('Refusing service restart because cancellation was not verified.')
    }

    await runCheck(results, 'dedicated test service restart', async () => {
      const service = shellQuote(config.dedicatedService)
      const result = await execCommand(
        conn,
        `sudo -n systemctl restart -- ${service} && systemctl is-active -- ${service}`,
        config.timeoutMs,
        redactor
      )
      if (result.code !== 0 || !/^active$/m.test(result.stdout)) {
        throw new Error(result.stderr || 'dedicated test service did not return active')
      }
      return config.dedicatedService
    }, redactor)
  } finally {
    if (conn && remoteScopeVerified) {
      await runCheck(results, 'isolated namespace cleanup', async () => {
        const cleanupTarget = assertSafeTakeoverCleanupTarget(scope.testRoot, scope.remoteTestDir)
        const result = await execCommand(
          conn,
          `rm -rf -- ${shellQuote(cleanupTarget)}; ` +
            `test ! -e ${shellQuote(cleanupTarget)} && ` +
            `test ! -L ${shellQuote(cleanupTarget)} && ` +
            `test ! -h ${shellQuote(cleanupTarget)}`,
          config.timeoutMs,
          redactor
        )
        if (result.code !== 0) throw new Error(result.stderr || 'isolated cleanup failed')
        return cleanupTarget
      }, redactor)
    }
    if (conn) {
      await runCheck(results, 'SSH disconnect', async () => {
        conn.end()
        return 'connection closed by the smoke runner'
      }, redactor)
    }
  }

  const summary = {
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    results
  }
  console.log(`SUMMARY ${redactor(JSON.stringify(summary, null, 2))}`)
  return summary
}

async function main () {
  const args = parseArgs()
  if (!args.isolated) {
    throw new Error('Refusing AI takeover smoke without the explicit --isolated flag.')
  }
  const configPath = args.configPath || process.env.SHELLPILOT_AI_TAKEOVER_SMOKE_CONFIG
  const config = readConfigFile(configPath)
  await runTakeoverSmoke(config, { isolated: true })
}

module.exports = {
  assertSafeTakeoverCleanupTarget,
  createTakeoverSmokeScope,
  parseArgs,
  readConfigFile,
  runTakeoverSmoke,
  validateTakeoverSmokeConfig
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
