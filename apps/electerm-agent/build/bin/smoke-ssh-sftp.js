const { Client } = require('@electerm/ssh2')
const crypto = require('crypto')
const path = require('path')
const {
  createSshHostVerification,
  normalizeExpectedHostFingerprint
} = require('./ssh-host-fingerprint')

const defaultPort = 22
const defaultTestDir = '/tmp'
const defaultTimeoutMs = 20000
const results = []
const sftpConnections = new WeakMap()
const sftpTimeouts = new WeakMap()

const sshCheckNames = [
  'remote command execution',
  'interactive shell Ctrl+C',
  'read-only server status scan'
]
const sftpCheckNames = [
  'SFTP directory operations',
  'SFTP file write/read',
  'SFTP rename/delete',
  'SFTP Unicode filename',
  'SFTP 1MB binary integrity',
  'file backup modify restore',
  'safe delete restore',
  'quick rollback script'
]

function resolveConfig (env = process.env) {
  return {
    host: String(env.SHELLPILOT_SSH_HOST || '').trim(),
    username: String(env.SHELLPILOT_SSH_USER || '').trim(),
    password: String(env.SHELLPILOT_SSH_PASSWORD || ''),
    hostFingerprint: String(env.SHELLPILOT_SSH_HOST_FINGERPRINT || '').trim(),
    port: Number(env.SHELLPILOT_SSH_PORT || defaultPort),
    testDir: String(env.SHELLPILOT_SSH_TEST_DIR || defaultTestDir),
    timeoutMs: Number(env.SHELLPILOT_SSH_TIMEOUT || defaultTimeoutMs)
  }
}

function validateConfig (config) {
  const normalized = {
    ...config,
    host: String(config?.host || '').trim(),
    username: String(config?.username || '').trim(),
    password: String(config?.password || ''),
    hostFingerprint: String(config?.hostFingerprint || '').trim(),
    port: Number(config?.port),
    testDir: String(config?.testDir || defaultTestDir),
    timeoutMs: Number(config?.timeoutMs)
  }
  const missing = [
    ['SHELLPILOT_SSH_HOST', normalized.host],
    ['SHELLPILOT_SSH_USER', normalized.username],
    ['SHELLPILOT_SSH_PASSWORD', normalized.password],
    ['SHELLPILOT_SSH_HOST_FINGERPRINT', normalized.hostFingerprint]
  ].filter(([, value]) => !value).map(([name]) => name)

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
  if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) {
    throw new Error('Invalid SSH smoke configuration: port must be an integer from 1 to 65535.')
  }
  if (!Number.isInteger(normalized.timeoutMs) ||
      normalized.timeoutMs < 1000 ||
      normalized.timeoutMs > 120000) {
    throw new Error('Invalid SSH smoke configuration: timeout must be an integer from 1000 to 120000 milliseconds.')
  }

  normalizeExpectedHostFingerprint(normalized.hostFingerprint)
  normalized.testDir = assertSafeTestRoot(normalized.testDir)
  return normalized
}

function collectSecretValues (secretContext) {
  const candidates = Array.isArray(secretContext)
    ? secretContext
    : secretContext && typeof secretContext === 'object' && !Buffer.isBuffer(secretContext)
      ? Object.values(secretContext)
      : [secretContext]
  return candidates
    .flat()
    .filter(value => typeof value === 'string' || Buffer.isBuffer(value))
    .map(String)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
}

function redactError (error, redactor) {
  const source = error instanceof Error ? error : new Error(String(error || ''))
  const safeError = new Error(redactor(source.message))
  safeError.name = redactor(source.name || 'Error')
  safeError.stack = redactor(source.stack || `${safeError.name}: ${safeError.message}`)
  for (const property of ['code', 'errno', 'status', 'statusCode']) {
    if (source[property] !== undefined) {
      safeError[property] = typeof source[property] === 'string'
        ? redactor(source[property])
        : source[property]
    }
  }
  return safeError
}

function resolveDefaultRedactionContext (env = process.env) {
  return {
    password: env.SHELLPILOT_SSH_PASSWORD,
    privateKey: [
      env.SHELLPILOT_SSH_PRIVATE_KEY,
      env.SHELLPILOT_SSH_PRIVATE_KEY_CONTENT
    ],
    passphrase: [
      env.SHELLPILOT_SSH_PASSPHRASE,
      env.SHELLPILOT_SSH_PRIVATE_KEY_PASSPHRASE
    ]
  }
}

function createRedactor (secretContext = resolveDefaultRedactionContext()) {
  const secrets = collectSecretValues(secretContext)
  const redactor = text => {
    let value = String(text || '')
    for (const secret of secrets) {
      value = value.replaceAll(secret, '[REDACTED]')
    }
    return value.replace(
      /((?:password|passphrase|private[_ -]?key|api[_ -]?key|token)\s*[:=]\s*)\S+/gi,
      '$1[REDACTED]'
    )
  }
  redactor.error = error => redactError(error, redactor)
  return redactor
}

function redact (text, secretContext) {
  return createRedactor(secretContext)(text)
}

function shellQuote (value) {
  return '\'' + String(value).replace(/'/g, '\'"\'"\'') + '\''
}

function normalizeRemotePath (value) {
  const normalized = path.posix.normalize(String(value || ''))
  return normalized.replace(/\/+$/, '') || '/'
}

function assertSafeTestRoot (testRoot) {
  const rawRoot = String(testRoot || '')
  const normalizedRoot = normalizeRemotePath(rawRoot)
  const isAllowedTemporaryRoot = normalizedRoot === '/tmp' ||
    normalizedRoot.startsWith('/tmp/') ||
    normalizedRoot === '/var/tmp' ||
    normalizedRoot.startsWith('/var/tmp/')
  const segments = rawRoot.split('/').filter(Boolean)
  const hasUnsafeSegment = segments.some(segment =>
    segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment)
  )
  if (!rawRoot ||
      !normalizedRoot.startsWith('/') ||
      normalizedRoot === '/' ||
      /\s/.test(rawRoot) ||
      !isAllowedTemporaryRoot ||
      hasUnsafeSegment) {
    throw new Error(`unsafe test root: ${normalizedRoot}`)
  }
  return normalizedRoot
}

function assertSafeCleanupTarget (testRoot, target) {
  const rawRoot = String(testRoot || '')
  const rawTarget = String(target || '')
  const normalizedRoot = assertSafeTestRoot(rawRoot)
  const normalizedTarget = normalizeRemotePath(rawTarget)
  const targetName = path.posix.basename(normalizedTarget)
  const unsafe = !rawRoot ||
    !rawTarget ||
    !normalizedRoot.startsWith('/') ||
    !normalizedTarget.startsWith('/') ||
    normalizedTarget === '/' ||
    normalizedTarget === '.' ||
    normalizedTarget === normalizedRoot ||
    path.posix.dirname(normalizedTarget) !== normalizedRoot ||
    !/^shellpilot-smoke-[a-f0-9]+(?:-[a-f0-9]+)*$/.test(targetName)
  if (unsafe) {
    throw new Error(`unsafe cleanup target: root=${normalizedRoot} target=${normalizedTarget}`)
  }
  return normalizedTarget
}

function createRemoteTestDir (baseDir = '/tmp') {
  const normalizedBase = normalizeRemotePath(baseDir || '/tmp')
  const token = [
    Date.now().toString(16),
    crypto.randomBytes(8).toString('hex')
  ].join('-')
  return `${normalizedBase === '/' ? '' : normalizedBase}/shellpilot-smoke-${token}`
}

function createRemotePaths (remoteTestDir) {
  const remote = name => `${remoteTestDir.replace(/\/+$/, '')}/${name}`
  return {
    sftpDir: remote('sftp'),
    nestedDir: remote('sftp/nested'),
    plainFile: remote('sftp/plain.txt'),
    renamedFile: remote('sftp/plain-renamed.txt'),
    unicodeFile: remote('sftp/unicode-\u4e2d\u6587-\u6d4b\u8bd5.txt'),
    binaryFile: remote('sftp/binary-1mb.bin'),
    backupDir: remote('.shellpilot-backups'),
    backupSource: remote('safety-config.txt'),
    backupFile: remote('.shellpilot-backups/safety-config.txt.bak'),
    trashDir: remote('.shellpilot-trash'),
    trashSource: remote('safe-delete.txt'),
    trashedFile: remote('.shellpilot-trash/safe-delete.txt'),
    rollbackScript: remote('shellpilot-rollback.sh'),
    rollbackState: remote('rollback-state.txt')
  }
}

function assertSafeRemoteTarget (remoteTestDir, target) {
  const normalizedRemoteTestDir = normalizeRemotePath(remoteTestDir)
  const normalizedTarget = normalizeRemotePath(target)
  if (!normalizedTarget.startsWith(`${normalizedRemoteTestDir}/`)) {
    throw new Error(`unsafe remote target: root=${normalizedRemoteTestDir} target=${normalizedTarget}`)
  }
  return normalizedTarget
}

function createValidatedRemoteScope (testRoot) {
  const normalizedTestRoot = assertSafeTestRoot(testRoot)
  const remoteTestDir = createRemoteTestDir(normalizedTestRoot)
  assertSafeCleanupTarget(normalizedTestRoot, remoteTestDir)
  const paths = createRemotePaths(remoteTestDir)
  for (const target of Object.values(paths)) {
    assertSafeRemoteTarget(remoteTestDir, target)
  }
  return {
    paths,
    remoteTestDir,
    testRoot: normalizedTestRoot
  }
}

async function connectWithValidatedScope (testRoot, connectFn) {
  const scope = createValidatedRemoteScope(testRoot)
  const conn = await connectFn()
  return { ...scope, conn }
}

async function executeCleanupIfSafe (testRoot, target, executor) {
  const cleanupTarget = assertSafeCleanupTarget(testRoot, target)
  return executor(cleanupTarget)
}

function buildCleanupAbsenceCondition (cleanupTarget) {
  return `[ ! -e ${shellQuote(cleanupTarget)} ] && [ ! -L ${shellQuote(cleanupTarget)} ] && [ ! -h ${shellQuote(cleanupTarget)} ]`
}

function isCleanupPathAbsent ({ exists, isSymbolicLink, isHardLinkAlias }) {
  return !exists && !isSymbolicLink && !isHardLinkAlias
}

function record (name, ok, detail = '', redactor = createRedactor()) {
  const safeDetail = redactor(detail)
  results.push({ name, ok, detail: safeDetail })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${safeDetail ? ' - ' + safeDetail : ''}`)
  if (!ok) {
    process.exitCode = 1
  }
}

function recordUnavailable (names, detail, redactor = createRedactor()) {
  for (const name of names) {
    record(name, false, detail, redactor)
  }
}

async function runCheck (name, task, redactor = createRedactor()) {
  try {
    const result = await task()
    const outcome = typeof result === 'object'
      ? result
      : { ok: Boolean(result) }
    record(name, Boolean(outcome.ok), outcome.detail || '', redactor)
    return Boolean(outcome.ok)
  } catch (err) {
    const safeError = redactor.error(err)
    record(name, false, safeError.stack || safeError.message, redactor)
    return false
  }
}

function buildSshConnectOptions (config) {
  const hostVerification = createSshHostVerification(config.hostFingerprint)
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    readyTimeout: config.timeoutMs,
    keepaliveInterval: 10000,
    ...hostVerification
  }
}

function connect (config = resolveConfig(process.env), createClient = () => new Client()) {
  const validatedConfig = validateConfig(config)
  const connectOptions = buildSshConnectOptions(validatedConfig)
  return new Promise((resolve, reject) => {
    const conn = createClient()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect(connectOptions)
  })
}

function execCommand (
  conn,
  command,
  commandTimeoutMs = defaultTimeoutMs,
  redactor = createRedactor()
) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let done = false
    let channel
    const finish = (err, result) => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      if (err) {
        reject(redactor.error(err))
      } else {
        resolve(result)
      }
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      const error = new Error(`exec timeout after ${commandTimeoutMs}ms`)
      error.code = 'ETIMEDOUT'
      try { channel?.close?.() } catch {}
      reject(redactor.error(error))
    }, commandTimeoutMs)

    const onExec = (err, stream) => {
      if (done) {
        try { stream?.close?.() } catch {}
        return
      }
      if (err) {
        finish(err)
        return
      }
      channel = stream
      stream.on('error', finish)
      stream.on('close', code => {
        finish(null, {
          code,
          stdout: redactor(stdout),
          stderr: redactor(stderr)
        })
      })
      stream.on('data', data => {
        stdout += data.toString('utf8')
      })
      stream.stderr.on('data', data => {
        stderr += data.toString('utf8')
      })
    }
    try {
      conn.exec(command, onExec)
    } catch (err) {
      finish(err)
    }
  })
}

function bestEffortEnd (resource) {
  if (!resource || typeof resource.end !== 'function') {
    return
  }
  try {
    resource.end()
  } catch (err) {
    // The original timeout error is more useful than a close failure.
  }
}

function normalizeSftpTimeout (value, label) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${label} timeout must be a positive number`)
  }
  return normalized
}

function sftpTimeoutError (label, boundedTimeoutMs) {
  const err = new Error(`${label} timeout after ${boundedTimeoutMs}ms`)
  err.code = 'ETIMEDOUT'
  return err
}

function sftpClient (conn, connectTimeoutMs = defaultTimeoutMs) {
  const boundedTimeoutMs = normalizeSftpTimeout(connectTimeoutMs, 'SFTP connect')
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) {
        return
      }
      done = true
      bestEffortEnd(conn)
      reject(sftpTimeoutError('SFTP connect', boundedTimeoutMs))
    }, boundedTimeoutMs)
    const finish = (err, sftp) => {
      if (done) {
        if (sftp) {
          bestEffortEnd(sftp)
        }
        return
      }
      done = true
      clearTimeout(timer)
      if (err) {
        reject(err)
        return
      }
      sftpConnections.set(sftp, conn)
      sftpTimeouts.set(sftp, boundedTimeoutMs)
      resolve(sftp)
    }

    try {
      conn.sftp(finish)
    } catch (err) {
      finish(err)
    }
  })
}

function sftpOpWithTimeout ({
  args = [],
  conn,
  method,
  operationTimeoutMs = defaultTimeoutMs,
  sftp
}) {
  const boundedTimeoutMs = normalizeSftpTimeout(
    operationTimeoutMs,
    `SFTP ${method}`
  )
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) {
        return
      }
      done = true
      bestEffortEnd(sftp)
      bestEffortEnd(conn)
      reject(sftpTimeoutError(`SFTP ${method}`, boundedTimeoutMs))
    }, boundedTimeoutMs)
    const finish = (err, result) => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timer)
      if (err) {
        reject(err)
      } else {
        resolve(result)
      }
    }

    try {
      if (!sftp || typeof sftp[method] !== 'function') {
        throw new Error(`Unsupported SFTP operation: ${method}`)
      }
      sftp[method](...args, finish)
    } catch (err) {
      finish(err)
    }
  })
}

function sftpOp (sftp, method, ...args) {
  return sftpOpWithTimeout({
    args,
    conn: sftpConnections.get(sftp),
    method,
    operationTimeoutMs: sftpTimeouts.get(sftp) || defaultTimeoutMs,
    sftp
  })
}

function isSftpNoSuchFileError (err) {
  if (!err) {
    return false
  }
  const noSuchFileCodes = new Set([
    2,
    '2',
    'ENOENT',
    'SSH_FX_NO_SUCH_FILE'
  ])
  if (noSuchFileCodes.has(err.code) ||
      noSuchFileCodes.has(err.status) ||
      noSuchFileCodes.has(err.statusCode) ||
      err.errno === -2 ||
      err.errno === 'ENOENT') {
    return true
  }
  return /no such file(?: or directory)?|(?:remote )?(?:file|path) does not exist/i.test(
    String(err.message || '')
  )
}

async function sftpExists (sftp, remotePath) {
  try {
    await sftpOp(sftp, 'stat', remotePath)
    return true
  } catch (err) {
    if (isSftpNoSuchFileError(err)) {
      return false
    }
    throw err
  }
}

function sha256 (content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function createServerStatusProbeCommands () {
  return [
    {
      id: 'system',
      command: "printf '__OS_RELEASE__\\n'; cat /etc/os-release 2>&1; printf '__HOSTNAME__\\n'; hostname 2>&1; printf '__KERNEL__\\n'; uname -r 2>&1; printf '__CPU_CORES__\\n'; getconf _NPROCESSORS_ONLN 2>&1; printf '__UPTIME_SECONDS__\\n'; cut -d ' ' -f 1 /proc/uptime 2>&1; printf '__INIT__\\n'; ps -p 1 -o comm= 2>&1"
    },
    {
      id: 'resources',
      command: "printf '__LOAD__\\n'; cat /proc/loadavg 2>&1; printf '__MEMINFO__\\n'; cat /proc/meminfo 2>&1; printf '__FILESYSTEMS__\\n'; df -P -B1 2>&1; printf '__INODES__\\n'; df -Pi 2>&1; printf '__PROCESSES__\\n'; ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>&1 | head -n 20"
    },
    {
      id: 'services',
      command: "if command -v systemctl >/dev/null 2>&1; then systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | while read -r unit _; do systemctl show \"$unit\" --property=Id,Description,LoadState,ActiveState,SubState,FragmentPath,ExecStart,WorkingDirectory 2>&1; printf '\\n'; done; else printf '__UNSUPPORTED__ systemctl command not found\\n'; fi"
    },
    {
      id: 'network',
      command: "if command -v ip >/dev/null 2>&1; then printf '__LINKS__\\n'; ip -o link show 2>&1; printf '__ADDRESSES__\\n'; ip -o address show 2>&1; printf '__ROUTES__\\n'; ip route show 2>&1; else printf '__UNSUPPORTED__ ip command not found\\n'; fi; printf '__DNS__\\n'; cat /etc/resolv.conf 2>&1; printf '__PORTS__\\n'; if command -v ss >/dev/null 2>&1; then ss -H -lntup 2>&1; elif command -v netstat >/dev/null 2>&1; then netstat -lntup 2>&1; else printf '__UNSUPPORTED__ ss and netstat command not found\\n'; fi"
    },
    {
      id: 'firewall',
      command: "printf '__FIREWALLD__\\n'; if command -v firewall-cmd >/dev/null 2>&1; then firewall-cmd --state 2>&1; fi; printf '__UFW__\\n'; if command -v ufw >/dev/null 2>&1; then ufw status 2>&1; fi; printf '__NFTABLES__\\n'; if command -v nft >/dev/null 2>&1; then nft list ruleset 2>&1; fi; printf '__IPTABLES__\\n'; if command -v iptables >/dev/null 2>&1; then iptables -S 2>&1; fi; printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi"
    },
    {
      id: 'security',
      command: "printf '__SELINUX__\\n'; if command -v getenforce >/dev/null 2>&1; then getenforce 2>&1; fi; printf '__APPARMOR__\\n'; if command -v aa-status >/dev/null 2>&1; then aa-status 2>&1; fi; printf '__USERS__\\n'; who 2>&1; printf '__FAILED_LOGINS__\\n'; if command -v lastb >/dev/null 2>&1; then lastb -n 20 2>&1; fi"
    },
    {
      id: 'containers',
      command: "printf '__DOCKER__\\n'; if command -v docker >/dev/null 2>&1; then docker ps -a --format '{{.Names}}\\t{{.Label \"com.docker.compose.service\"}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Label \"com.docker.compose.project\"}}' 2>&1; fi; printf '__PODMAN__\\n'; if command -v podman >/dev/null 2>&1; then podman ps -a --format '{{.Names}}\\t{{.Labels.service}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}\\t{{.Labels.io.podman.compose.project}}' 2>&1; fi; if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then printf '__UNSUPPORTED__ docker and podman command not found\\n'; fi"
    }
  ]
}

async function captureServerStatusFingerprint (
  conn,
  commandTimeoutMs = defaultTimeoutMs,
  redactor = createRedactor()
) {
  const result = await execCommand(
    conn,
    "printf '__ROUTES__\\n'; ip route show 2>&1; printf '__SERVICES__\\n'; systemctl list-unit-files --type=service --no-legend --no-pager 2>&1; printf '__FIREWALL__\\n'; if command -v nft >/dev/null 2>&1; then nft -s list ruleset 2>&1; elif command -v iptables-save >/dev/null 2>&1; then iptables-save -c 2>/dev/null | sed -E -e 's/\\[[0-9]+:[0-9]+\\]/[COUNTERS]/g' -e 's/^# (Generated|Completed).*/# \\1/'; fi",
    commandTimeoutMs,
    redactor
  )
  if (result.code !== 0) {
    throw new Error(`status fingerprint failed: ${result.stderr || result.stdout}`)
  }
  return sha256(result.stdout)
}

function buildRollbackScript (originalContent) {
  const encodedOriginal = Buffer.from(originalContent).toString('base64')
  return [
    '#!/bin/sh',
    'set -eu',
    'state_file=$1',
    `printf '%s' '${encodedOriginal}' | base64 -d > "$state_file"`,
    ''
  ].join('\n')
}

function isRollbackRestored (original, modified, restored) {
  const originalHash = sha256(original)
  return sha256(modified) !== originalHash && sha256(restored) === originalHash
}

function createCtrlCProbe (commandTimeoutMs) {
  const normalizedTimeoutMs = Number(commandTimeoutMs)
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    throw new Error('Ctrl+C probe timeout must be a positive number')
  }
  const totalTimeoutMs = normalizedTimeoutMs + 5000
  const sleepStartDelayMs = 800
  const signalDelayMs = 1800
  const markerDelayMs = 2600
  const minimumNaturalOverrunMs = 30000
  const resultMarker = '__SHELLPILOT_CTRL_C_RESULT_41037__'
  const resultCommand = 'printf \'__SHELLPILOT_CTRL_C_RESULT_%s__\\n\' "$((41000 + 37))"'
  const sleepSeconds = Math.ceil(
    (totalTimeoutMs + minimumNaturalOverrunMs - sleepStartDelayMs) / 1000
  )
  const sleepDurationMs = sleepSeconds * 1000
  return {
    markerDelayMs,
    naturalCompletionEarliestMs: sleepStartDelayMs + sleepDurationMs,
    resultCommand,
    resultMarker,
    signalDelayMs,
    sleepDurationMs,
    sleepSeconds,
    sleepStartDelayMs,
    totalTimeoutMs
  }
}

function hasStandaloneCtrlCResult (output, resultMarker) {
  return String(output).split(/\r?\n/).some(line => line.trim() === resultMarker)
}

function isCtrlCInterruptSpecific (probe, output, interruptElapsedMs) {
  return hasStandaloneCtrlCResult(output, '__SHELL_READY__') &&
    hasStandaloneCtrlCResult(output, probe.resultMarker) &&
    Number.isFinite(interruptElapsedMs) &&
    interruptElapsedMs >= probe.signalDelayMs &&
    interruptElapsedMs < probe.naturalCompletionEarliestMs &&
    interruptElapsedMs < probe.totalTimeoutMs
}

function shellTest (
  conn,
  remoteTestDir,
  timeoutMs = defaultTimeoutMs,
  redactor = createRedactor()
) {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
      if (err) {
        reject(redactor.error(err))
        return
      }
      let data = ''
      let done = false
      const probe = createCtrlCProbe(timeoutMs)
      const probeStartedAt = Date.now()
      const delayedWrites = []
      const finish = (finishError, value) => {
        if (done) {
          return
        }
        done = true
        clearTimeout(timer)
        for (const delayedWrite of delayedWrites) {
          clearTimeout(delayedWrite)
        }
        if (finishError) {
          reject(redactor.error(finishError))
        } else {
          resolve(value)
        }
      }
      const timer = setTimeout(() => {
        finish(new Error('interactive shell timeout'))
      }, probe.totalTimeoutMs)

      stream.on('error', finish)
      stream.on('close', () => {
        if (!hasStandaloneCtrlCResult(data, probe.resultMarker)) {
          finish(new Error('interactive shell closed before Ctrl+C verification'))
        }
      })
      stream.on('data', chunk => {
        data += chunk.toString('utf8')
        if (hasStandaloneCtrlCResult(data, probe.resultMarker)) {
          stream.end('exit\n')
          finish(null, {
            interruptElapsedMs: Date.now() - probeStartedAt,
            output: redactor(data),
            probe
          })
        }
      })
      stream.write(`cd -- ${shellQuote(remoteTestDir)} && printf "__SHELL_READY__\\n"\n`)
      delayedWrites.push(setTimeout(
        () => stream.write(`sleep ${probe.sleepSeconds}\n`),
        probe.sleepStartDelayMs
      ))
      delayedWrites.push(setTimeout(
        () => stream.write('\x03'),
        probe.signalDelayMs
      ))
      delayedWrites.push(setTimeout(
        () => stream.write(`${probe.resultCommand}\n`),
        probe.markerDelayMs
      ))
    })
  })
}

async function runSmoke (options = {}) {
  const resolvedConfig = resolveConfig(options.env || process.env)
  const redactor = createRedactor({ password: resolvedConfig.password })
  let config
  try {
    config = validateConfig(resolvedConfig)
  } catch (err) {
    console.error(redactor(err.message))
    process.exitCode = 2
    return
  }
  const started = Date.now()
  results.length = 0
  const recordResult = (name, ok, detail = '') => {
    record(name, ok, detail, redactor)
  }
  const recordUnavailableResults = (names, detail) => {
    recordUnavailable(names, detail, redactor)
  }
  const runSmokeCheck = (name, task) => runCheck(name, task, redactor)
  let remoteTestDir
  let paths
  let conn
  let sftp

  const runChecks = async () => {
    try {
      const connected = await connectWithValidatedScope(
        config.testDir,
        () => connect(config, options.clientFactory)
      )
      conn = connected.conn
      remoteTestDir = connected.remoteTestDir
      paths = connected.paths
      recordResult('SSH password login', true, `connected ${config.host}:${config.port} in ${Date.now() - started}ms`)
    } catch (err) {
      recordResult('SSH password login', false, err.stack || err.message)
      recordUnavailableResults([...sshCheckNames, ...sftpCheckNames], 'not run: SSH login failed')
      return
    }

    const setupOk = await runSmokeCheck('remote test directory setup', async () => {
      const setup = await execCommand(
        conn,
        `mkdir -p -- ${shellQuote(remoteTestDir)} && [ -d ${shellQuote(remoteTestDir)} ]`,
        config.timeoutMs,
        redactor
      )
      return {
        ok: setup.code === 0,
        detail: `dir=${remoteTestDir}`
      }
    })
    if (!setupOk) {
      recordUnavailableResults([...sshCheckNames, ...sftpCheckNames], 'not run: isolated directory setup failed')
      return
    }

    await runSmokeCheck('remote command execution', async () => {
      const basic = await execCommand(
        conn,
        `cd -- ${shellQuote(remoteTestDir)} && { printf 'user='; whoami; printf 'uid='; id -u; printf 'kernel='; uname -s; printf 'pwd='; pwd; printf '__COMMAND_OK__\\n'; }`,
        config.timeoutMs,
        redactor
      )
      return {
        ok: basic.code === 0 &&
          basic.stdout.includes(`user=${config.username}\n`) &&
          basic.stdout.includes('__COMMAND_OK__'),
        detail: basic.stdout.trim().replace(/\s+/g, ' | ')
      }
    })

    await runSmokeCheck('interactive shell Ctrl+C', async () => {
      const shellResult = await shellTest(conn, remoteTestDir, config.timeoutMs, redactor)
      return {
        ok: isCtrlCInterruptSpecific(
          shellResult.probe,
          shellResult.output,
          shellResult.interruptElapsedMs
        ),
        detail: `interruptElapsedMs=${shellResult.interruptElapsedMs} naturalSleepMs=${shellResult.probe.sleepDurationMs} totalTimeoutMs=${shellResult.probe.totalTimeoutMs}`
      }
    })

    await runSmokeCheck('read-only server status scan', async () => {
      const fingerprintBefore = await captureServerStatusFingerprint(conn, config.timeoutMs, redactor)
      const probeResults = await Promise.all(
        createServerStatusProbeCommands().map(async probe => {
          const result = await execCommand(conn, probe.command, 20000, redactor)
          return { ...result, id: probe.id }
        })
      )
      const fingerprintAfter = await captureServerStatusFingerprint(conn, config.timeoutMs, redactor)
      const coreProbeIds = new Set(['system', 'resources', 'services', 'network'])
      const coreProbesOk = probeResults
        .filter(result => coreProbeIds.has(result.id))
        .every(result => result.code === 0 && (
          result.id === 'services'
            ? result.stdout.includes('Id=')
            : result.stdout.includes('__')
        ))
      return {
        ok: probeResults.length === 7 &&
          coreProbesOk &&
          fingerprintBefore === fingerprintAfter,
        detail: `probes=${probeResults.length} unchanged=${fingerprintBefore === fingerprintAfter}`
      }
    })

    try {
      sftp = await sftpClient(conn, config.timeoutMs)
    } catch (err) {
      recordUnavailableResults(sftpCheckNames, `SFTP unavailable: ${redactor(err.message)}`)
      return
    }

    await runSmokeCheck('SFTP directory operations', async () => {
      await sftpOp(sftp, 'mkdir', paths.sftpDir)
      await sftpOp(sftp, 'mkdir', paths.nestedDir)
      const nestedStat = await sftpOp(sftp, 'stat', paths.nestedDir)
      await sftpOp(sftp, 'rmdir', paths.nestedDir)
      const nestedRemoved = !(await sftpExists(sftp, paths.nestedDir))
      return {
        ok: nestedStat.isDirectory() && nestedRemoved,
        detail: 'mkdir/stat/rmdir verified'
      }
    })

    await runSmokeCheck('SFTP file write/read', async () => {
      const content = Buffer.from(`ShellPilot SFTP smoke ${new Date().toISOString()}\n`)
      await sftpOp(sftp, 'writeFile', paths.plainFile, content)
      const stat = await sftpOp(sftp, 'stat', paths.plainFile)
      const readBack = await sftpOp(sftp, 'readFile', paths.plainFile)
      return {
        ok: stat.size === content.length && readBack.equals(content),
        detail: `size=${stat.size}`
      }
    })

    await runSmokeCheck('SFTP rename/delete', async () => {
      await sftpOp(sftp, 'rename', paths.plainFile, paths.renamedFile)
      const list = await sftpOp(sftp, 'readdir', paths.sftpDir)
      const renamedVisible = list.some(item => item.filename === 'plain-renamed.txt')
      await sftpOp(sftp, 'unlink', paths.renamedFile)
      const deleted = !(await sftpExists(sftp, paths.renamedFile))
      return {
        ok: renamedVisible && deleted,
        detail: 'rename/list/unlink verified'
      }
    })

    await runSmokeCheck('SFTP Unicode filename', async () => {
      const content = Buffer.from('ShellPilot Unicode path content\n')
      await sftpOp(sftp, 'writeFile', paths.unicodeFile, content)
      const readBack = await sftpOp(sftp, 'readFile', paths.unicodeFile)
      await sftpOp(sftp, 'unlink', paths.unicodeFile)
      return {
        ok: readBack.equals(content),
        detail: `file=${paths.unicodeFile.split('/').pop()}`
      }
    })

    await runSmokeCheck('SFTP 1MB binary integrity', async () => {
      const binary = crypto.randomBytes(1024 * 1024)
      await sftpOp(sftp, 'writeFile', paths.binaryFile, binary)
      const stat = await sftpOp(sftp, 'stat', paths.binaryFile)
      const readBack = await sftpOp(sftp, 'readFile', paths.binaryFile)
      await sftpOp(sftp, 'unlink', paths.binaryFile)
      const expectedHash = sha256(binary)
      const actualHash = sha256(readBack)
      return {
        ok: stat.size === binary.length && expectedHash === actualHash,
        detail: `size=${stat.size} sha256=${actualHash}`
      }
    })

    await runSmokeCheck('file backup modify restore', async () => {
      const original = Buffer.from('safe-original-state\n')
      const modified = Buffer.from('safe-modified-state\n')
      await sftpOp(sftp, 'mkdir', paths.backupDir)
      await sftpOp(sftp, 'writeFile', paths.backupSource, original)
      const beforeBackup = await sftpOp(sftp, 'readFile', paths.backupSource)
      await sftpOp(sftp, 'writeFile', paths.backupFile, beforeBackup)
      await sftpOp(sftp, 'writeFile', paths.backupSource, modified)
      const modifiedRead = await sftpOp(sftp, 'readFile', paths.backupSource)
      const backupRead = await sftpOp(sftp, 'readFile', paths.backupFile)
      await sftpOp(sftp, 'writeFile', paths.backupSource, backupRead)
      const restored = await sftpOp(sftp, 'readFile', paths.backupSource)
      return {
        ok: modifiedRead.equals(modified) &&
          sha256(backupRead) === sha256(original) &&
          sha256(restored) === sha256(original),
        detail: `restored-sha256=${sha256(restored)}`
      }
    })

    await runSmokeCheck('safe delete restore', async () => {
      const content = Buffer.from('safe-delete-original\n')
      await sftpOp(sftp, 'mkdir', paths.trashDir)
      await sftpOp(sftp, 'writeFile', paths.trashSource, content)
      await sftpOp(sftp, 'rename', paths.trashSource, paths.trashedFile)
      const sourceMissing = !(await sftpExists(sftp, paths.trashSource))
      const trashRead = await sftpOp(sftp, 'readFile', paths.trashedFile)
      await sftpOp(sftp, 'rename', paths.trashedFile, paths.trashSource)
      const restored = await sftpOp(sftp, 'readFile', paths.trashSource)
      return {
        ok: sourceMissing && trashRead.equals(content) && restored.equals(content),
        detail: 'hidden trash move and restore verified'
      }
    })

    await runSmokeCheck('quick rollback script', async () => {
      const original = Buffer.from('quick-rollback-original\n')
      const modified = Buffer.from('quick-rollback-modified\n')
      await sftpOp(sftp, 'writeFile', paths.rollbackState, original)
      const savedOriginal = await sftpOp(sftp, 'readFile', paths.rollbackState)
      const rollbackScript = buildRollbackScript(savedOriginal)
      await sftpOp(sftp, 'writeFile', paths.rollbackScript, Buffer.from(rollbackScript))
      await sftpOp(sftp, 'writeFile', paths.rollbackState, modified)
      const modifiedRead = await sftpOp(sftp, 'readFile', paths.rollbackState)
      const rollback = await execCommand(
        conn,
        `sh ${shellQuote(paths.rollbackScript)} ${shellQuote(paths.rollbackState)}`,
        config.timeoutMs,
        redactor
      )
      const restored = await sftpOp(sftp, 'readFile', paths.rollbackState)
      return {
        ok: rollback.code === 0 &&
          isRollbackRestored(savedOriginal, modifiedRead, restored),
        detail: `restored-sha256=${sha256(restored)}`
      }
    })
  }

  try {
    await runChecks()
  } catch (err) {
    recordResult('smoke flow error', false, err.stack || err.message)
  } finally {
    if (sftp) {
      try {
        sftp.end()
      } catch (err) {
        recordResult('SFTP session close', false, err.message)
      }
    }

    if (conn) {
      try {
        let cleanupTarget
        const cleanup = await executeCleanupIfSafe(config.testDir, remoteTestDir, safeTarget => {
          cleanupTarget = safeTarget
          return execCommand(
            conn,
            `rm -rf -- ${shellQuote(cleanupTarget)}; if ${buildCleanupAbsenceCondition(cleanupTarget)}; then printf '__CLEANUP_OK__'; else printf '__CLEANUP_FAILED__' >&2; exit 1; fi`,
            config.timeoutMs,
            redactor
          )
        })
        recordResult(
          'remote test directory cleanup',
          cleanup.code === 0 && cleanup.stdout.includes('__CLEANUP_OK__'),
          cleanup.stdout.includes('__CLEANUP_OK__')
            ? `removed ${cleanupTarget}`
            : cleanup.stderr.trim()
        )
      } catch (err) {
        recordResult('remote test directory cleanup', false, err.stack || err.message)
      }
      try {
        conn.end()
      } catch (err) {
        recordResult('SSH connection close', false, err.stack || err.message)
      }
    } else {
      recordResult('remote test directory cleanup', false, 'not run: SSH connection unavailable')
    }
  }

  const summary = {
    passed: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results: results.map(item => ({ ...item }))
  }
  console.log(`\nSUMMARY ${redactor(JSON.stringify(summary, null, 2))}`)
  return summary
}

module.exports = {
  assertSafeCleanupTarget,
  assertSafeRemoteTarget,
  assertSafeTestRoot,
  buildCleanupAbsenceCondition,
  buildRollbackScript,
  buildSshConnectOptions,
  connect,
  connectWithValidatedScope,
  createRedactor,
  createCtrlCProbe,
  createServerStatusProbeCommands,
  createRemotePaths,
  createRemoteTestDir,
  createValidatedRemoteScope,
  executeCleanupIfSafe,
  execCommand,
  hasStandaloneCtrlCResult,
  isCleanupPathAbsent,
  isCtrlCInterruptSpecific,
  isRollbackRestored,
  isSftpNoSuchFileError,
  captureServerStatusFingerprint,
  redact,
  resolveConfig,
  runSmoke,
  sftpClient,
  sftpExists,
  sftpOp,
  sftpOpWithTimeout,
  shellQuote,
  validateConfig
}

if (require.main === module) {
  runSmoke()
}
