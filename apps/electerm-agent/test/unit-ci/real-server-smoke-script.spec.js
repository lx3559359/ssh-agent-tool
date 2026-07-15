const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const scriptPath = path.join(root, 'build/bin/smoke-ssh-sftp.js')
const source = fs.readFileSync(scriptPath, 'utf8')
const smokeHelpers = require(scriptPath)

function findPosixShell () {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\bin\\sh.exe',
        'C:\\Program Files\\Git\\usr\\bin\\sh.exe'
      ]
    : ['/bin/sh', '/usr/bin/sh']
  return candidates.find(candidate => fs.existsSync(candidate))
}

function probeHelpers () {
  const probe = `
    const helpers = require(${JSON.stringify(scriptPath)})
    const remoteTestDir = helpers.createRemoteTestDir('/tmp/base path/')
    const paths = helpers.createRemotePaths(remoteTestDir)
    process.stdout.write(JSON.stringify({
      remoteTestDir,
      anotherDir: helpers.createRemoteTestDir('/tmp/base path/'),
      quoted: helpers.shellQuote("/tmp/base path/O'Brien"),
      redacted: helpers.redact('before super-secret after super-secret', 'super-secret'),
      paths
    }))
  `
  const result = spawnSync(process.execPath, ['-e', probe], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHELLPILOT_SSH_HOST: '',
      SHELLPILOT_SSH_USER: '',
      SHELLPILOT_SSH_PASSWORD: ''
    }
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

test('real-server smoke helpers create unique isolated paths and quote shell arguments', () => {
  const probe = probeHelpers()

  assert.match(probe.remoteTestDir, /^\/tmp\/base path\/shellpilot-smoke-[a-f0-9-]+$/)
  assert.match(probe.anotherDir, /^\/tmp\/base path\/shellpilot-smoke-[a-f0-9-]+$/)
  assert.notEqual(probe.remoteTestDir, probe.anotherDir)
  assert.equal(probe.quoted, "'/tmp/base path/O'\"'\"'Brien'")
  assert.equal(probe.redacted, 'before [REDACTED] after [REDACTED]')

  const remotePaths = Object.values(probe.paths)
  assert.ok(remotePaths.length >= 12)
  assert.ok(remotePaths.every(value => value.startsWith(`${probe.remoteTestDir}/`)))
  assert.ok(remotePaths.some(value => value.includes('/.shellpilot-backups/')))
  assert.ok(remotePaths.some(value => value.includes('/.shellpilot-trash/')))
  assert.ok(
    remotePaths.some(value => Array.from(value).some(char => char.codePointAt(0) > 127)),
    'expected a Unicode remote filename'
  )
})

test('cleanup boundary only accepts a direct generated child of the normalized test root', () => {
  const assertSafeCleanupTarget = smokeHelpers.assertSafeCleanupTarget
  assert.equal(typeof assertSafeCleanupTarget, 'function')

  assert.equal(
    assertSafeCleanupTarget(
      '/tmp/smoke-root/./',
      '/tmp/smoke-root/shellpilot-smoke-abc-123'
    ),
    '/tmp/smoke-root/shellpilot-smoke-abc-123'
  )

  for (const target of [
    '',
    '/',
    '.',
    '/tmp/smoke-root',
    '/tmp/shellpilot-smoke-abc-123',
    '/tmp/smoke-root/nested/shellpilot-smoke-abc-123',
    '/tmp/smoke-root/not-a-smoke-dir',
    '/tmp/smoke-root/shellpilot-smoke-',
    'shellpilot-smoke-abc-123'
  ]) {
    assert.throws(
      () => assertSafeCleanupTarget('/tmp/smoke-root', target),
      /unsafe cleanup target/,
      `expected cleanup rejection for ${JSON.stringify(target)}`
    )
  }
})

test('rollback helpers preserve original content and reject fake restoration', () => {
  const buildRollbackScript = smokeHelpers.buildRollbackScript
  const isRollbackRestored = smokeHelpers.isRollbackRestored
  assert.equal(typeof buildRollbackScript, 'function')
  assert.equal(typeof isRollbackRestored, 'function')

  const original = Buffer.from("original value with 'quotes' and Unicode \u4e2d\u6587\n")
  const modified = Buffer.from('modified value\n')
  const script = buildRollbackScript(original)

  assert.match(script, /base64 -d/)
  assert.ok(script.includes(original.toString('base64')))
  assert.match(script, /"\$state_file"/)
  assert.equal(isRollbackRestored(original, modified, original), true)
  assert.equal(isRollbackRestored(original, modified, modified), false)
  assert.equal(isRollbackRestored(original, original, original), false)
})

test('generated rollback shell script restores original bytes in a local temp directory', () => {
  const shell = findPosixShell()
  assert.ok(shell, 'a local POSIX shell is required for rollback behavior verification')

  const original = Buffer.concat([
    Buffer.from([0, 1, 2, 3, 255]),
    Buffer.from(' original Unicode \u4e2d\u6587\n')
  ])
  const modified = Buffer.from('modified bytes\n')
  const generatedScript = smokeHelpers.buildRollbackScript(original)
  const scriptBase64 = Buffer.from(generatedScript).toString('base64')
  const originalBase64 = original.toString('base64')
  const modifiedBase64 = modified.toString('base64')
  const harness = [
    'set -eu',
    'tmp_dir=$(mktemp -d ./shellpilot-rollback-test.XXXXXX)',
    'trap \'rm -rf "$tmp_dir"\' EXIT',
    `printf '%s' '${scriptBase64}' | base64 -d > "$tmp_dir/rollback.sh"`,
    `printf '%s' '${originalBase64}' | base64 -d > "$tmp_dir/state.bin"`,
    `printf '%s' '${modifiedBase64}' | base64 -d > "$tmp_dir/state.bin"`,
    'sh "$tmp_dir/rollback.sh" "$tmp_dir/state.bin"',
    'actual=$(base64 < "$tmp_dir/state.bin" | tr -d \'\\r\\n \')',
    `[ "$actual" = '${originalBase64}' ]`
  ].join('\n')
  const result = spawnSync(shell, ['-c', harness], {
    cwd: os.tmpdir(),
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('quick rollback flow saves original before modifying and verifies restored content', () => {
  assert.match(
    source,
    /writeFile', paths\.rollbackState, original[\s\S]*readFile', paths\.rollbackState[\s\S]*buildRollbackScript\(savedOriginal\)[\s\S]*writeFile', paths\.rollbackState, modified[\s\S]*sh \$\{shellQuote\(paths\.rollbackScript\)\}[\s\S]*isRollbackRestored\(savedOriginal, modifiedRead, restored\)/
  )
})

test('Ctrl+C probe cannot finish naturally before its timeout and requires interrupt evidence', () => {
  const createCtrlCProbe = smokeHelpers.createCtrlCProbe
  const isCtrlCInterruptSpecific = smokeHelpers.isCtrlCInterruptSpecific
  assert.equal(typeof createCtrlCProbe, 'function')
  assert.equal(typeof isCtrlCInterruptSpecific, 'function')

  for (const commandTimeoutMs of [1000, 20000, 120000]) {
    const probe = createCtrlCProbe(commandTimeoutMs)
    assert.equal(probe.totalTimeoutMs, commandTimeoutMs + 5000)
    assert.ok(probe.signalDelayMs < probe.markerDelayMs)
    assert.ok(probe.markerDelayMs < probe.totalTimeoutMs)
    assert.ok(
      probe.naturalCompletionEarliestMs >= probe.totalTimeoutMs + 30000,
      `sleep could finish naturally for timeout ${commandTimeoutMs}`
    )
    assert.equal(
      isCtrlCInterruptSpecific(
        probe,
        `__SHELL_READY__\n${probe.resultMarker}\n`,
        probe.markerDelayMs + 100
      ),
      true
    )
    assert.equal(
      isCtrlCInterruptSpecific(
        probe,
        `__SHELL_READY__\n${probe.resultMarker}\n`,
        probe.naturalCompletionEarliestMs
      ),
      false
    )
    assert.equal(
      isCtrlCInterruptSpecific(probe, '__SHELL_READY__\n', probe.markerDelayMs + 100),
      false
    )
  }

  assert.match(source, /sleep \$\{probe\.sleepSeconds\}/)
  assert.match(source, /interruptElapsedMs=/)
  assert.match(source, /naturalSleepMs=/)
})

test('Ctrl+C result parser ignores PTY command echo and accepts only a standalone result line', () => {
  const probe = smokeHelpers.createCtrlCProbe(20000)
  const hasStandaloneCtrlCResult = smokeHelpers.hasStandaloneCtrlCResult
  assert.equal(typeof hasStandaloneCtrlCResult, 'function')
  assert.equal(typeof probe.resultMarker, 'string')
  assert.equal(typeof probe.resultCommand, 'string')
  assert.equal(probe.resultCommand.includes(probe.resultMarker), false)

  const echoedOnly = [
    '__SHELL_READY__',
    `root@test:~$ ${probe.resultCommand}`,
    ''
  ].join('\r\n')
  assert.equal(hasStandaloneCtrlCResult(echoedOnly, probe.resultMarker), false)
  assert.equal(
    smokeHelpers.isCtrlCInterruptSpecific(
      probe,
      echoedOnly,
      probe.markerDelayMs + 100
    ),
    false
  )

  const executed = `${echoedOnly}${probe.resultMarker}\r\n`
  assert.equal(hasStandaloneCtrlCResult(executed, probe.resultMarker), true)
  assert.equal(
    smokeHelpers.isCtrlCInterruptSpecific(
      probe,
      executed,
      probe.markerDelayMs + 100
    ),
    true
  )
})

test('invalid roots and cleanup targets are rejected before connect or exec callbacks', async () => {
  const connectWithValidatedScope = smokeHelpers.connectWithValidatedScope
  const createValidatedRemoteScope = smokeHelpers.createValidatedRemoteScope
  const executeCleanupIfSafe = smokeHelpers.executeCleanupIfSafe
  assert.equal(typeof connectWithValidatedScope, 'function')
  assert.equal(typeof createValidatedRemoteScope, 'function')
  assert.equal(typeof executeCleanupIfSafe, 'function')

  let connectCalls = 0
  await assert.rejects(
    connectWithValidatedScope('relative/test-root', async () => {
      connectCalls += 1
      return {}
    }),
    /unsafe test root/
  )
  assert.equal(connectCalls, 0)

  for (const unsafeRoot of [
    '/etc',
    '/tmp/space root',
    '/tmp/unsafe;name',
    '/tmp/$(touch-pwned)',
    '/tmp/../etc',
    '/var/tmp/safe/../escape'
  ]) {
    await assert.rejects(
      connectWithValidatedScope(unsafeRoot, async () => {
        connectCalls += 1
        return {}
      }),
      /unsafe test root|temporary test root/i,
      unsafeRoot
    )
  }
  assert.equal(connectCalls, 0)

  let execCalls = 0
  await assert.rejects(
    executeCleanupIfSafe('/tmp/smoke-root', '/', async () => {
      execCalls += 1
    }),
    /unsafe cleanup target/
  )
  assert.equal(execCalls, 0)
  await assert.rejects(
    executeCleanupIfSafe('/', '/shellpilot-smoke-abc-123', async () => {
      execCalls += 1
    }),
    /unsafe test root/
  )
  assert.equal(execCalls, 0)

  const scope = createValidatedRemoteScope('/tmp/smoke-root/./')
  assert.equal(scope.testRoot, '/tmp/smoke-root')
  assert.ok(scope.remoteTestDir.startsWith('/tmp/smoke-root/shellpilot-smoke-'))
  assert.ok(Object.values(scope.paths).every(value => value.startsWith(`${scope.remoteTestDir}/`)))

  const varTmpScope = createValidatedRemoteScope('/var/tmp/smoke-root')
  assert.equal(varTmpScope.testRoot, '/var/tmp/smoke-root')
})

test('cleanup absence condition does not treat a dangling symlink as absent', () => {
  const buildCleanupAbsenceCondition = smokeHelpers.buildCleanupAbsenceCondition
  const isCleanupPathAbsent = smokeHelpers.isCleanupPathAbsent
  assert.equal(typeof buildCleanupAbsenceCondition, 'function')
  assert.equal(typeof isCleanupPathAbsent, 'function')
  assert.equal(
    isCleanupPathAbsent({ exists: false, isSymbolicLink: true, isHardLinkAlias: false }),
    false
  )
  assert.equal(
    isCleanupPathAbsent({ exists: false, isSymbolicLink: false, isHardLinkAlias: true }),
    false
  )
  assert.equal(
    isCleanupPathAbsent({ exists: false, isSymbolicLink: false, isHardLinkAlias: false }),
    true
  )
  assert.match(buildCleanupAbsenceCondition('/tmp/shellpilot-smoke-abc-123'), /-L/)
  assert.match(buildCleanupAbsenceCondition('/tmp/shellpilot-smoke-abc-123'), /-h/)
})

test('sftpExists returns false only for explicit no-such-file errors', async () => {
  const isSftpNoSuchFileError = smokeHelpers.isSftpNoSuchFileError
  const sftpExists = smokeHelpers.sftpExists
  assert.equal(typeof isSftpNoSuchFileError, 'function')
  assert.equal(typeof sftpExists, 'function')

  for (const err of [
    Object.assign(new Error('missing by status'), { code: 2 }),
    Object.assign(new Error('missing by errno'), { code: 'ENOENT' }),
    Object.assign(new Error('missing by statusCode'), { statusCode: 2 }),
    new Error('No such file or directory'),
    new Error('Remote path does not exist')
  ]) {
    assert.equal(isSftpNoSuchFileError(err), true, err.message)
    const sftp = {
      stat: (remotePath, callback) => callback(err)
    }
    assert.equal(await sftpExists(sftp, '/tmp/missing'), false)
  }

  for (const err of [
    Object.assign(new Error('Permission denied'), { code: 3 }),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    new Error('SFTP protocol failure'),
    new Error('Channel not found')
  ]) {
    assert.equal(isSftpNoSuchFileError(err), false, err.message)
    const sftp = {
      stat: (remotePath, callback) => callback(err)
    }
    await assert.rejects(
      sftpExists(sftp, '/tmp/unknown'),
      received => received === err
    )
  }
})

test('SFTP connect timeout closes SSH connection and rejects late callbacks', async () => {
  const sftpClient = smokeHelpers.sftpClient
  assert.equal(typeof sftpClient, 'function')

  let connectCallback
  let connectionCloseCalls = 0
  let lateSftpCloseCalls = 0
  const conn = {
    sftp: callback => {
      connectCallback = callback
    },
    end: () => {
      connectionCloseCalls += 1
    }
  }
  const startedAt = Date.now()
  const pending = sftpClient(conn, 25)

  await assert.rejects(
    pending,
    /SFTP connect timeout after 25ms/
  )
  assert.ok(Date.now() - startedAt < 1000)
  assert.equal(connectionCloseCalls, 1)

  connectCallback(null, {
    end: () => {
      lateSftpCloseCalls += 1
    }
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lateSftpCloseCalls, 1)
  assert.equal(connectionCloseCalls, 1)
})

test('SFTP operation timeout closes SFTP and SSH resources with a clear method error', async () => {
  const sftpOpWithTimeout = smokeHelpers.sftpOpWithTimeout
  assert.equal(typeof sftpOpWithTimeout, 'function')

  let operationCallback
  let sftpCloseCalls = 0
  let connectionCloseCalls = 0
  const sftp = {
    readFile: (remotePath, callback) => {
      operationCallback = callback
    },
    end: () => {
      sftpCloseCalls += 1
    }
  }
  const conn = {
    end: () => {
      connectionCloseCalls += 1
    }
  }
  const startedAt = Date.now()
  const pending = sftpOpWithTimeout({
    args: ['/tmp/stalled.bin'],
    conn,
    method: 'readFile',
    operationTimeoutMs: 25,
    sftp
  })

  await assert.rejects(
    pending,
    /SFTP readFile timeout after 25ms/
  )
  assert.ok(Date.now() - startedAt < 1000)
  assert.equal(sftpCloseCalls, 1)
  assert.equal(connectionCloseCalls, 1)

  operationCallback(null, Buffer.from('late result'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sftpCloseCalls, 1)
  assert.equal(connectionCloseCalls, 1)
})

test('real-server smoke flow covers SSH, SFTP, Unicode, large binary, and safety recovery', () => {
  assert.match(source, /if \(require\.main === module\)/)
  assert.match(source, /module\.exports\s*=/)
  assert.match(source, /SHELLPILOT_SSH_TEST_DIR\s*\|\|\s*defaultTestDir/)
  assert.match(source, /connectWithValidatedScope\([\s\S]{0,100}config\.testDir,[\s\S]{0,100}\(\) => connect\(config/)
  assert.match(source, /createRemotePaths\(remoteTestDir\)/)
  assert.match(source, /shellTest\(conn, remoteTestDir, config\.timeoutMs\)/)
  assert.match(source, /mkdir -p -- \$\{shellQuote\(remoteTestDir\)\}/)
  assert.doesNotMatch(source, /user=root/)

  for (const method of ['mkdir', 'rmdir', 'writeFile', 'readFile', 'stat', 'rename', 'unlink']) {
    assert.match(source, new RegExp(`sftpOp\\(sftp, '${method}'`), `missing SFTP ${method}`)
  }
  assert.match(source, /1024 \* 1024/)
  assert.match(source, /createHash\('sha256'\)/)
  assert.match(source, /\\u4e2d\\u6587/)
  assert.match(source, /\.shellpilot-backups/)
  assert.match(source, /\.shellpilot-trash/)
  assert.match(source, /rollbackScript/)
  assert.match(source, /sh \$\{shellQuote\(paths\.rollbackScript\)\} \$\{shellQuote\(paths\.rollbackState\)\}/)

  for (const name of [
    'SSH password login',
    'remote command execution',
    'interactive shell Ctrl+C',
    'SFTP directory operations',
    'SFTP file write/read',
    'SFTP rename/delete',
    'SFTP Unicode filename',
    'SFTP 1MB binary integrity',
    'file backup modify restore',
    'safe delete restore',
    'quick rollback script',
    'remote test directory cleanup'
  ]) {
    assert.ok(source.includes(`'${name}'`), `missing PASS/FAIL result: ${name}`)
  }
})

test('real-server smoke flow verifies the server status scan is read-only', () => {
  assert.match(source, /read-only server status scan/)
  assert.match(source, /createServerStatusProbeCommands/)
  assert.match(source, /captureServerStatusFingerprint/)
  assert.match(source, /systemctl list-unit-files --type=service/)
  assert.match(source, /ip route show/)
  assert.match(source, /nft -s list ruleset/)
  assert.match(source, /Generated\|Completed/)
  assert.match(source, /fingerprintBefore === fingerprintAfter/)
  assert.match(source, /probeResults\.length === 7/)
  assert.match(source, /result\.id === 'services'/)
  assert.doesNotMatch(source, /serverStatus[^\n]*(?:sudo|rm\s+-|mv\s+|cp\s+|mkdir|touch|sed\s+-i)/i)
})

test('critical failures set a nonzero exit code and finally verifies remote cleanup', () => {
  assert.match(source, /function record[\s\S]*process\.exitCode = 1/)
  assert.match(source, /finally\s*{/)
  assert.match(
    source,
    /executeCleanupIfSafe\(config\.testDir, remoteTestDir,[\s\S]{0,300}rm -rf -- \$\{shellQuote\(cleanupTarget\)\}/
  )
  assert.match(source, /\[ ! -e \$\{shellQuote\(cleanupTarget\)\} \]/)
  assert.match(source, /\[ ! -L \$\{shellQuote\(cleanupTarget\)\} \]/)
  assert.match(source, /\[ ! -h \$\{shellQuote\(cleanupTarget\)\} \]/)
  assert.match(source, /__CLEANUP_OK__/)
  assert.match(source, /\$\{ok \? '\[PASS\]' : '\[FAIL\]'\}/)
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*password/)
  assert.doesNotMatch(source, /execCommand\(conn, `[^`]*\$\{testDir/)
})
