const { Client } = require('@electerm/ssh2')
const crypto = require('crypto')
const path = require('path')

const env = process.env
const host = env.SHELLPILOT_SSH_HOST
const username = env.SHELLPILOT_SSH_USER
const password = env.SHELLPILOT_SSH_PASSWORD
const port = Number(env.SHELLPILOT_SSH_PORT || 22)
const testDir = env.SHELLPILOT_SSH_TEST_DIR || '/tmp'
const timeoutMs = Number(env.SHELLPILOT_SSH_TIMEOUT || 20000)
const started = Date.now()
const results = []
const sftpConnections = new WeakMap()

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

function redact (text, secret = password) {
  const value = String(text || '')
  return secret ? value.replaceAll(secret, '[REDACTED]') : value
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
  if (!rawRoot || !normalizedRoot.startsWith('/') || normalizedRoot === '/') {
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

function record (name, ok, detail = '') {
  const safeDetail = redact(detail)
  results.push({ name, ok, detail: safeDetail })
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${safeDetail ? ' - ' + safeDetail : ''}`)
  if (!ok) {
    process.exitCode = 1
  }
}

function recordUnavailable (names, detail) {
  for (const name of names) {
    record(name, false, detail)
  }
}

async function runCheck (name, task) {
  try {
    const result = await task()
    const outcome = typeof result === 'object'
      ? result
      : { ok: Boolean(result) }
    record(name, Boolean(outcome.ok), outcome.detail || '')
    return Boolean(outcome.ok)
  } catch (err) {
    record(name, false, redact(err.stack || err.message))
    return false
  }
}

function failMissingEnv () {
  const missing = [
    ['SHELLPILOT_SSH_HOST', host],
    ['SHELLPILOT_SSH_USER', username],
    ['SHELLPILOT_SSH_PASSWORD', password]
  ].filter(([, value]) => !value).map(([name]) => name)
  if (!missing.length) {
    return
  }
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  console.error('Example: set SHELLPILOT_SSH_HOST, SHELLPILOT_SSH_USER and SHELLPILOT_SSH_PASSWORD, then run npm run smoke:ssh-sftp')
  process.exit(2)
}

function connect () {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => resolve(conn))
    conn.on('error', reject)
    conn.connect({
      host,
      port,
      username,
      password,
      readyTimeout: timeoutMs,
      keepaliveInterval: 10000,
      hostVerifier: () => true
    })
  })
}

function execCommand (conn, command, commandTimeoutMs = timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let done = false
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
    const timer = setTimeout(() => {
      finish(new Error(`exec timeout: ${command}`))
    }, commandTimeoutMs)

    conn.exec(command, (err, stream) => {
      if (err) {
        finish(err)
        return
      }
      stream.on('error', finish)
      stream.on('close', code => {
        finish(null, {
          code,
          stdout: redact(stdout),
          stderr: redact(stderr)
        })
      })
      stream.on('data', data => {
        stdout += data.toString('utf8')
      })
      stream.stderr.on('data', data => {
        stderr += data.toString('utf8')
      })
    })
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

function sftpClient (conn, connectTimeoutMs = timeoutMs) {
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
  operationTimeoutMs = timeoutMs,
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
    operationTimeoutMs: timeoutMs,
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

async function captureServerStatusFingerprint (conn) {
  const result = await execCommand(
    conn,
    "printf '__ROUTES__\\n'; ip route show 2>&1; printf '__SERVICES__\\n'; systemctl list-unit-files --type=service --no-legend --no-pager 2>&1; printf '__FIREWALL__\\n'; if command -v nft >/dev/null 2>&1; then nft -s list ruleset 2>&1; elif command -v iptables-save >/dev/null 2>&1; then iptables-save -c 2>/dev/null | sed -E -e 's/\\[[0-9]+:[0-9]+\\]/[COUNTERS]/g' -e 's/^# (Generated|Completed).*/# \\1/'; fi"
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

function shellTest (conn, remoteTestDir) {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
      if (err) {
        reject(err)
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
          reject(finishError)
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
            output: redact(data),
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

async function runSmoke () {
  failMissingEnv()
  let remoteTestDir
  let paths
  let conn
  let sftp

  try {
    try {
      const connected = await connectWithValidatedScope(testDir, connect)
      conn = connected.conn
      remoteTestDir = connected.remoteTestDir
      paths = connected.paths
      record('SSH password login', true, `connected ${host}:${port} in ${Date.now() - started}ms`)
    } catch (err) {
      record('SSH password login', false, redact(err.stack || err.message))
      recordUnavailable([...sshCheckNames, ...sftpCheckNames], 'not run: SSH login failed')
      return
    }

    const setupOk = await runCheck('remote test directory setup', async () => {
      const setup = await execCommand(
        conn,
        `mkdir -p -- ${shellQuote(remoteTestDir)} && [ -d ${shellQuote(remoteTestDir)} ]`
      )
      return {
        ok: setup.code === 0,
        detail: `dir=${remoteTestDir}`
      }
    })
    if (!setupOk) {
      recordUnavailable([...sshCheckNames, ...sftpCheckNames], 'not run: isolated directory setup failed')
      return
    }

    await runCheck('remote command execution', async () => {
      const basic = await execCommand(
        conn,
        `cd -- ${shellQuote(remoteTestDir)} && { printf 'user='; whoami; printf 'uid='; id -u; printf 'kernel='; uname -s; printf 'pwd='; pwd; printf '__COMMAND_OK__\\n'; }`
      )
      return {
        ok: basic.code === 0 &&
          basic.stdout.includes(`user=${username}\n`) &&
          basic.stdout.includes('__COMMAND_OK__'),
        detail: basic.stdout.trim().replace(/\s+/g, ' | ')
      }
    })

    await runCheck('interactive shell Ctrl+C', async () => {
      const shellResult = await shellTest(conn, remoteTestDir)
      return {
        ok: isCtrlCInterruptSpecific(
          shellResult.probe,
          shellResult.output,
          shellResult.interruptElapsedMs
        ),
        detail: `interruptElapsedMs=${shellResult.interruptElapsedMs} naturalSleepMs=${shellResult.probe.sleepDurationMs} totalTimeoutMs=${shellResult.probe.totalTimeoutMs}`
      }
    })

    await runCheck('read-only server status scan', async () => {
      const fingerprintBefore = await captureServerStatusFingerprint(conn)
      const probeResults = await Promise.all(
        createServerStatusProbeCommands().map(async probe => {
          const result = await execCommand(conn, probe.command, 20000)
          return { ...result, id: probe.id }
        })
      )
      const fingerprintAfter = await captureServerStatusFingerprint(conn)
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
      sftp = await sftpClient(conn)
    } catch (err) {
      recordUnavailable(sftpCheckNames, `SFTP unavailable: ${redact(err.message)}`)
      return
    }

    await runCheck('SFTP directory operations', async () => {
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

    await runCheck('SFTP file write/read', async () => {
      const content = Buffer.from(`ShellPilot SFTP smoke ${new Date().toISOString()}\n`)
      await sftpOp(sftp, 'writeFile', paths.plainFile, content)
      const stat = await sftpOp(sftp, 'stat', paths.plainFile)
      const readBack = await sftpOp(sftp, 'readFile', paths.plainFile)
      return {
        ok: stat.size === content.length && readBack.equals(content),
        detail: `size=${stat.size}`
      }
    })

    await runCheck('SFTP rename/delete', async () => {
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

    await runCheck('SFTP Unicode filename', async () => {
      const content = Buffer.from('ShellPilot Unicode path content\n')
      await sftpOp(sftp, 'writeFile', paths.unicodeFile, content)
      const readBack = await sftpOp(sftp, 'readFile', paths.unicodeFile)
      await sftpOp(sftp, 'unlink', paths.unicodeFile)
      return {
        ok: readBack.equals(content),
        detail: `file=${paths.unicodeFile.split('/').pop()}`
      }
    })

    await runCheck('SFTP 1MB binary integrity', async () => {
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

    await runCheck('file backup modify restore', async () => {
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

    await runCheck('safe delete restore', async () => {
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

    await runCheck('quick rollback script', async () => {
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
        `sh ${shellQuote(paths.rollbackScript)} ${shellQuote(paths.rollbackState)}`
      )
      const restored = await sftpOp(sftp, 'readFile', paths.rollbackState)
      return {
        ok: rollback.code === 0 &&
          isRollbackRestored(savedOriginal, modifiedRead, restored),
        detail: `restored-sha256=${sha256(restored)}`
      }
    })
  } catch (err) {
    record('smoke flow error', false, redact(err.stack || err.message))
  } finally {
    if (sftp) {
      try {
        sftp.end()
      } catch (err) {
        record('SFTP session close', false, redact(err.message))
      }
    }

    if (conn) {
      try {
        let cleanupTarget
        const cleanup = await executeCleanupIfSafe(testDir, remoteTestDir, safeTarget => {
          cleanupTarget = safeTarget
          return execCommand(
            conn,
            `rm -rf -- ${shellQuote(cleanupTarget)}; if ${buildCleanupAbsenceCondition(cleanupTarget)}; then printf '__CLEANUP_OK__'; else printf '__CLEANUP_FAILED__' >&2; exit 1; fi`
          )
        })
        record(
          'remote test directory cleanup',
          cleanup.code === 0 && cleanup.stdout.includes('__CLEANUP_OK__'),
          cleanup.stdout.includes('__CLEANUP_OK__')
            ? `removed ${cleanupTarget}`
            : cleanup.stderr.trim()
        )
      } catch (err) {
        record('remote test directory cleanup', false, redact(err.stack || err.message))
      }
      conn.end()
    } else {
      record('remote test directory cleanup', false, 'not run: SSH connection unavailable')
    }

    const summary = {
      passed: results.filter(item => item.ok).length,
      failed: results.filter(item => !item.ok).length,
      results
    }
    console.log(`\nSUMMARY ${JSON.stringify(summary, null, 2)}`)
  }
}

module.exports = {
  assertSafeCleanupTarget,
  assertSafeRemoteTarget,
  assertSafeTestRoot,
  buildCleanupAbsenceCondition,
  buildRollbackScript,
  connect,
  connectWithValidatedScope,
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
  sftpClient,
  sftpExists,
  sftpOp,
  sftpOpWithTimeout,
  shellQuote
}

if (require.main === module) {
  runSmoke()
}
