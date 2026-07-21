const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/index.js')
).href
const safetyMetadataUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/shared/safety-metadata.js')
).href
const contextUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/quick-command-context.js')
).href
const validationUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/shared/validation.js')
).href
const maintenanceRecoveryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/safety-transactions/maintenance-recovery-delegation.js')
).href

const commandCases = [
  {
    id: 'builtin-server-hostname-change',
    domain: '系统',
    fields: [
      ['新主机名', 'hostname'],
      ['同步Hosts', 'enum']
    ]
  },
  {
    id: 'builtin-server-hosts-manage',
    domain: '网络',
    fields: [
      ['IP地址', 'ip'],
      ['主机名', 'hostname'],
      ['动作', 'enum']
    ]
  },
  {
    id: 'builtin-server-timezone-change',
    domain: '时间',
    fields: [
      ['新时区', 'timezone']
    ]
  }
]

test('Task 6 forms expose locked rollback metadata and strictly typed params', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )

  for (const testCase of commandCases) {
    const item = byId.get(testCase.id)
    assert.ok(item, `missing ${testCase.id}`)
    assert.match(item.name, /[\u4e00-\u9fff]/)
    assert.match(item.description, /[\u4e00-\u9fff]/)
    assert.match(item.usage, /[\u4e00-\u9fff]/)
    assert.ok(item.labels.includes('需编辑'))
    assert.ok(item.labels.includes(testCase.domain))
    assert.ok(item.labels.includes('高风险'))
    assert.equal(item.editBeforeRun, true)
    assert.equal(item.mutatesServer, true)
    assert.equal(item.confirmRequired, true)
    assert.deepEqual(item.rollback, {
      title: item.name,
      pathParam: '回滚脚本',
      actionParam: item.rollback.actionParam,
      mutatingValues: item.rollback.mutatingValues,
      confirmParam: '确认执行',
      confirmValue: 'yes'
    })
    assert.ok(item.rollback.mutatingValues.length >= 1)
    assert.ok(Array.isArray(item.verification))
    assert.ok(item.verification.length >= 1)
    assert.deepEqual(item.safetyMetadata.verifyCommands, item.verification)
    assert.equal(item.safetyMetadata.requireConfirmation, true)
    assert.equal(item.safetyMetadata.rollbackDirectory, '/tmp/shellpilot-rollback')

    for (const [name, validationType] of testCase.fields) {
      const param = item.params.find(candidate => candidate.name === name)
      assert.ok(param, `${testCase.id} missing ${name}`)
      assert.equal(param.validationType, validationType)
      assert.equal(param.required, true)
    }

    const confirmation = item.params.find(param => param.name === '确认执行')
    assert.equal(confirmation.type, 'select')
    assert.equal(confirmation.validationType, 'enum')
    assert.equal(confirmation.required, true)
    assert.equal(confirmation.defaultValue, 'no')
    assert.deepEqual(confirmation.options.map(option => option.value), ['no', 'yes'])

    const rollbackPath = item.params.find(param => param.name === '回滚脚本')
    assert.equal(rollbackPath.type, 'hidden')
    assert.equal(rollbackPath.validationType, 'rollback-path')
    assert.equal(rollbackPath.required, true)
    assert.equal(rollbackPath.defaultValue, '{{回滚脚本}}')

    const text = item.commands.map(command => command.command).join('\n')
    assert.match(text, /\/tmp\/shellpilot-rollback/)
  }
})

test('withRollback ignores forged critical fields and owns immutable safety metadata', async () => {
  const { withRollback } = await import(safetyMetadataUrl)
  const forgedConfirmation = {
    name: '确认执行',
    type: 'select',
    defaultValue: 'yes',
    options: [{ label: '绕过', value: 'yes' }]
  }
  const forgedRollbackPath = {
    name: '回滚脚本',
    type: 'input',
    defaultValue: '/tmp/elsewhere.sh'
  }
  const item = withRollback({
    id: 'builtin-server-forged-mutation',
    name: '安全修改',
    editBeforeRun: false,
    mutatesServer: false,
    confirmRequired: false,
    params: [forgedConfirmation, forgedRollbackPath],
    rollback: {
      pathParam: '任意路径',
      confirmParam: '跳过确认',
      confirmValue: 'no'
    },
    mutationSafety: {
      rollbackDirectory: '/tmp/attacker',
      requireConfirmation: false,
      verifyCommands: []
    },
    safetyMetadata: {
      rollbackDirectory: '/tmp/attacker',
      requireConfirmation: false
    },
    verification: []
  }, {
    title: '安全修改',
    actionParam: '动作',
    mutatingValues: ['apply'],
    backupTargets: ['/etc/hosts'],
    verifyCommands: ['test -s /etc/hosts'],
    pathParam: '伪造路径',
    confirmParam: '伪造确认',
    confirmValue: 'no',
    rollbackDirectory: '/tmp/attacker',
    requireConfirmation: false
  })

  assert.equal(item.editBeforeRun, true)
  assert.equal(item.mutatesServer, true)
  assert.equal(item.confirmRequired, true)
  assert.deepEqual(item.rollback, {
    title: '安全修改',
    pathParam: '回滚脚本',
    actionParam: '动作',
    mutatingValues: ['apply'],
    confirmParam: '确认执行',
    confirmValue: 'yes'
  })
  assert.deepEqual(item.mutationSafety, {
    title: '安全修改',
    backupTargets: ['/etc/hosts'],
    verifyCommands: ['test -s /etc/hosts']
  })
  assert.deepEqual(item.verification, ['test -s /etc/hosts'])
  assert.equal(item.safetyMetadata, undefined)
  assert.equal(item.params.filter(param => param.name === '确认执行').length, 1)
  assert.equal(item.params.find(param => param.name === '确认执行').defaultValue, 'no')
  assert.equal(item.params.filter(param => param.name === '回滚脚本').length, 1)
  assert.equal(item.params.find(param => param.name === '回滚脚本').type, 'hidden')
  assert.equal(Object.isFrozen(item.rollback), true)
  assert.equal(Object.isFrozen(item.rollback.mutatingValues), true)
  assert.equal(Object.isFrozen(item.mutationSafety), true)
  assert.equal(Object.isFrozen(item.mutationSafety.backupTargets), true)
  assert.equal(Object.isFrozen(item.mutationSafety.verifyCommands), true)
  assert.equal(Object.isFrozen(item.verification), true)
})

test('defined Task 6 safety metadata is deeply immutable and rejected when detached or forged', async () => {
  const [
    { getServerMaintenanceQuickCommands },
    { buildQuickCommandParamValues, buildQuickCommandText }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl)
  ])
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-hosts-manage')

  assert.equal(Object.isFrozen(item.safetyMetadata), true)
  assert.equal(Object.isFrozen(item.safetyMetadata.backupTargets), true)
  assert.equal(Object.isFrozen(item.safetyMetadata.verifyCommands), true)
  assert.equal(Reflect.set(item.safetyMetadata, 'minFreeKb', 1), false)
  assert.equal(Reflect.set(item.safetyMetadata.backupTargets, 0, '/etc/shadow'), false)
  assert.throws(
    () => item.safetyMetadata.verifyCommands.push('true'),
    TypeError
  )
  assert.deepEqual(item.safetyMetadata.backupTargets, ['/etc/hosts'])
  assert.deepEqual(item.safetyMetadata.verifyCommands, item.verification)

  const context = {
    host: 'prod.example.com',
    port: '22',
    username: 'root',
    rollbackPath: '/tmp/shellpilot-rollback/task6-metadata-1700000000000.sh'
  }
  const values = {
    ...buildQuickCommandParamValues(item, context),
    IP地址: '192.0.2.20',
    主机名: 'target.example.com',
    动作: 'update',
    确认执行: 'yes'
  }
  const detached = { ...item }
  Object.defineProperty(detached, 'safetyMetadata', {
    value: {
      ...item.safetyMetadata,
      backupTargets: ['/etc/shadow'],
      verifyCommands: ['true']
    }
  })
  assert.throws(
    () => buildQuickCommandText(detached, context, values),
    /安全元数据|权威|完整/
  )
})

test('confirmed Task 6 submissions carry one-time validated recovery intents', async () => {
  const [
    { getServerMaintenanceQuickCommands },
    {
      buildQuickCommandContextIdentity,
      buildQuickCommandParamValues,
      submitValidatedQuickCommand
    },
    { consumeInternalMaintenanceRecoveryIntent }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl),
    import(maintenanceRecoveryUrl)
  ])
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const context = {
    host: 'prod.example.com',
    port: '22',
    username: 'root',
    title: 'Production',
    rollbackPath: '/tmp/shellpilot-rollback/task6-recovery-1700000000000.sh'
  }
  const cases = [
    {
      id: 'builtin-server-hostname-change',
      values: { 新主机名: 'new-host.example.com', 同步Hosts: 'yes' }
    },
    {
      id: 'builtin-server-hosts-manage',
      values: { IP地址: '192.0.2.20', 主机名: 'target.example.com', 动作: 'update' }
    },
    {
      id: 'builtin-server-timezone-change',
      values: { 新时区: 'Asia/Shanghai' }
    }
  ]

  for (const testCase of cases) {
    const item = byId.get(testCase.id)
    const paramValues = {
      ...buildQuickCommandParamValues(item, context),
      ...testCase.values,
      确认执行: 'yes'
    }
    let submitted
    const result = submitValidatedQuickCommand({
      id: item.id,
      item,
      boundTabId: 'tab-prod',
      contextIdentity: buildQuickCommandContextIdentity(context),
      context,
      paramValues
    }, (id, options) => {
      submitted = { id, options }
    }, {
      commandId: item.id,
      tabId: 'tab-prod',
      contextIdentity: buildQuickCommandContextIdentity(context)
    })

    assert.equal(result.submitted, true)
    assert.equal(submitted.id, item.id)
    const intent = consumeInternalMaintenanceRecoveryIntent(
      submitted.options.maintenanceRecoveryIntent
    )
    assert.equal(intent.quickCommandId, item.id)
    assert.equal(intent.command, result.commandText)
    assert.equal(intent.title, item.name)
    assert.equal(intent.rollbackPath, context.rollbackPath)
    assert.deepEqual(intent.endpoint, {
      tabId: 'tab-prod',
      host: context.host,
      port: 22,
      username: context.username
    })
    assert.ok(intent.verification.length >= 1)
    assert.equal(
      consumeInternalMaintenanceRecoveryIntent(
        submitted.options.maintenanceRecoveryIntent
      ),
      undefined
    )
  }
})

function commandText (item) {
  return item.commands.map(command => command.command).join('\n')
}

function resolvePosixShell () {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'dash.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'sh.exe')
      ]
    : ['dash', 'sh']
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'exit 0'], {
      encoding: 'utf8',
      timeout: 2000
    })
    if (!probe.error && probe.status === 0) return candidate
  }
  throw new Error('No POSIX sh implementation is available for Task 6 tests')
}

const posixShellExecutable = resolvePosixShell()
const posixShellEnv = { ...process.env }
const posixPathKey = Object.keys(posixShellEnv)
  .find(key => key.toLowerCase() === 'path') || 'PATH'
posixShellEnv[posixPathKey] = [
  path.dirname(posixShellExecutable),
  posixShellEnv[posixPathKey]
].filter(Boolean).join(path.delimiter)

function runPosixShell (script, expectedStatus) {
  const statusToAssert = arguments.length < 2 ? 0 : expectedStatus
  const result = spawnSync(posixShellExecutable, ['-s'], {
    encoding: 'utf8',
    env: posixShellEnv,
    input: script,
    timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const failureLine = Number(/: (\d+):/.exec(result.stderr)?.[1] || 0)
  const shellLines = script.split('\n')
  const contextStart = Math.max(0, failureLine - 8)
  const shellContext = failureLine
    ? shellLines.slice(contextStart, failureLine + 6)
      .map((line, index) => `${contextStart + index + 1}: ${line}`).join('\n')
    : ''
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, String(result.signal) + ': ' + result.stderr)
  if (statusToAssert !== undefined) {
    assert.equal(result.status, statusToAssert, [result.stderr || result.stdout, shellContext].filter(Boolean).join('\n'))
  }
  return result
}

function runPosixShellAsync (script) {
  const child = spawn(posixShellExecutable, ['-s'], {
    env: posixShellEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
  child.stdin.end(script)
  return { child, completion }
}

async function waitForPath (target, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${target}`)
}

function toPosixPath (value) {
  return value.replaceAll('\\', '/')
}

function toPosixSearchPath (value) {
  if (process.platform !== 'win32') return value
  return value.replace(/^([A-Za-z]):/, (match, drive) => '/' + drive.toLowerCase())
}

function shellLiteral (value) {
  const quote = String.fromCharCode(39)
  return quote + String(value).split(quote).join(quote + '\\' + quote + quote) + quote
}

function createShellSandbox (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-task6-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const result = {
    root: toPosixPath(root),
    hosts: toPosixPath(path.join(root, 'etc-hosts')),
    hostname: toPosixPath(path.join(root, 'hostname-state')),
    timezone: toPosixPath(path.join(root, 'timezone-state')),
    mutationLog: toPosixPath(path.join(root, 'mutation.log')),
    recoveryLog: toPosixPath(path.join(root, 'recovery.log')),
    sudoLog: toPosixPath(path.join(root, 'sudo.log')),
    flockState: toPosixPath(path.join(root, 'flock-held')),
    recoveryReady: toPosixPath(path.join(root, 'recovery-ready')),
    recoveryRelease: toPosixPath(path.join(root, 'recovery-release')),
    setupReady: toPosixPath(path.join(root, 'setup-ready')),
    setupRelease: toPosixPath(path.join(root, 'setup-release')),
    cleanupReady: toPosixPath(path.join(root, 'cleanup-ready')),
    cleanupRelease: toPosixPath(path.join(root, 'cleanup-release')),
    rollbackDirectory: toPosixPath(path.join(root, 'rollback')),
    commandDirectory: toPosixPath(path.join(root, 'bin'))
  }
  result.rollbackScript = result.rollbackDirectory + '/task6-test-1700000000000.sh'
  result.verifierScript = result.rollbackDirectory + '/task6-test-1700000000000.verify.sh'
  result.consumedMarker = result.rollbackScript + '.consumed'
  result.runningMarker = result.rollbackScript + '.running'
  result.runningLock = result.rollbackScript + '.running.lock'
  fs.writeFileSync(result.hosts, '127.0.0.1 localhost\n192.0.2.10 old.example.com\n')
  fs.writeFileSync(result.hostname, 'old-host.example.com\n')
  fs.writeFileSync(result.timezone, 'UTC\n')
  fs.mkdirSync(result.commandDirectory)
  const commands = {
    hostnamectl: `#!/bin/sh
case "$1" in
  --static) cat "$HOSTNAME_STATE" ;;
  set-hostname)
    if [ "$PAUSE_RECOVERY" = "yes" ]; then
      : > "$RECOVERY_READY"
      while [ ! -e "$RECOVERY_RELEASE" ]; do sleep 0.02; done
    fi
    [ "$FAIL_RECOVERY" != "yes" ] || exit 1
    [ "$FAIL_RECOVERY_STEP" != "hostname" ] || exit 1
    printf "hostname:%s\\n" "$2" >> "$MUTATION_LOG"
    printf "%s\\n" "$2" > "$HOSTNAME_STATE"
    ;;
  *) exit 2 ;;
esac
`,
    timedatectl: `#!/bin/sh
case "$1" in
  show) cat "$TIMEZONE_STATE" ;;
  list-timezones) printf "UTC\\nAsia/Shanghai\\nEurope/London\\n" ;;
  set-timezone)
    [ "$FAIL_RECOVERY" != "yes" ] || exit 1
    [ "$FAIL_RECOVERY_STEP" != "timezone" ] || exit 1
    printf "timezone:%s\\n" "$2" >> "$MUTATION_LOG"
    printf "%s\\n" "$2" > "$TIMEZONE_STATE"
    ;;
  *) exit 2 ;;
esac
`,
    id: '#!/bin/sh\n[ "$1" = "-u" ] && { printf "0\\n"; exit 0; }\nexec /usr/bin/id "$@"\n',
    stat: `#!/bin/sh
format=""
dereference=""
if [ "$1" = "-c" ]; then format="$2"; shift 2; fi
if [ "$1" = "-Lc" ]; then dereference="-L"; format="$2"; shift 2; fi
[ "$1" != "--" ] || shift
case "$format" in
  %u) [ -n "$HOSTS_UID_OVERRIDE" ] && printf "%s\\n" "$HOSTS_UID_OVERRIDE" || id -u ;;
  %g) [ -n "$HOSTS_GID_OVERRIDE" ] && printf "%s\\n" "$HOSTS_GID_OVERRIDE" || printf "0\\n" ;;
  %a)
    if [ -n "$HOSTS_MODE_OVERRIDE" ]; then
      printf "%s\\n" "$HOSTS_MODE_OVERRIDE"
    else
      case "$1" in
        "$ROLLBACK_ROOT"/*.running.lock) printf "600\\n" ;;
        "$ROLLBACK_ROOT"/*.sh.consumed) printf "700\\n" ;;
        "$ROLLBACK_ROOT"/operation.*/timezone.state) printf "600\\n" ;;
        "$ROLLBACK_ROOT"/operation.*/timezone-state.*) printf "600\\n" ;;
        "$ROLLBACK_ROOT"/operation.*/timezone-rollback.*) printf "700\\n" ;;
        "$ROLLBACK_ROOT"/operation.*/timezone-verify.*) printf "700\\n" ;;
        "$ROLLBACK_ROOT"/operation.*/*) printf "644\\n" ;;
        "$ROLLBACK_ROOT"|"$ROLLBACK_ROOT"/operation.*) printf "700\\n" ;;
        "$ROLLBACK_ROOT"/*.sh) printf "700\\n" ;;
        *) printf "644\\n" ;;
      esac
    fi
    ;;
  *) exec /usr/bin/stat $dereference -c "$format" -- "$1" ;;
esac
`,
    cp: `#!/bin/sh
destination=""
for argument in "$@"; do destination="$argument"; done
if [ "$destination" = "$HOSTS_FIXTURE" ]; then
  printf "cp" >> "$RECOVERY_LOG"
  for argument in "$@"; do printf "\\t%s" "$argument" >> "$RECOVERY_LOG"; done
  printf "\\n" >> "$RECOVERY_LOG"
  [ "$FAIL_RECOVERY_STEP" != "cp" ] || exit 1
fi
exec /usr/bin/cp "$@"
`,
    chown: `#!/bin/sh
destination=""
for argument in "$@"; do destination="$argument"; done
if [ "$destination" = "$HOSTS_FIXTURE" ]; then
  printf "chown" >> "$RECOVERY_LOG"
  for argument in "$@"; do printf "\\t%s" "$argument" >> "$RECOVERY_LOG"; done
  printf "\\n" >> "$RECOVERY_LOG"
  [ "$FAIL_RECOVERY_STEP" != "chown" ] || exit 1
fi
exit 0
`,
    chmod: `#!/bin/sh
destination=""
for argument in "$@"; do destination="$argument"; done
if [ "$destination" = "$HOSTS_FIXTURE" ]; then
  printf "chmod" >> "$RECOVERY_LOG"
  for argument in "$@"; do printf "\\t%s" "$argument" >> "$RECOVERY_LOG"; done
  printf "\\n" >> "$RECOVERY_LOG"
  [ "$FAIL_RECOVERY_STEP" != "chmod" ] || exit 1
fi
exec /usr/bin/chmod "$@"
`,
    flock: `#!/bin/sh
if [ "$1" = "-n" ] && [ "$2" = "9" ]; then
  mkdir -- "$FLOCK_STATE" 2>/dev/null
  exit $?
fi
if [ "$1" = "-u" ] && [ "$2" = "9" ]; then
  rmdir -- "$FLOCK_STATE" 2>/dev/null || true
  exit 0
fi
exit 2
`,
    mkdir: `#!/bin/sh
destination=""
for argument in "$@"; do destination="$argument"; done
if [ "$FAIL_CONSUMED" = "yes" ] &&
  [ "$destination" = "$CONSUMED_MARKER_FIXTURE" ]; then
  exit 1
fi
exec /usr/bin/mkdir "$@"
`,
    ps: `#!/bin/sh
pid=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then pid="$2"; shift 2; else shift; fi
done
[ -n "$pid" ] || exit 1
printf "fixture-start-%s\\n" "$pid"
`,
    install: `#!/bin/sh
mode=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -m) mode="$2"; shift 2 ;;
    -o|-g) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ "$#" -eq 2 ] || exit 2
command cp -- "$1" "$2" || exit 1
[ -z "$mode" ] || command chmod "$mode" -- "$2"
`
  }
  for (const [name, contents] of Object.entries(commands)) {
    const commandPath = path.join(root, 'bin', name)
    fs.writeFileSync(commandPath, contents)
    fs.chmodSync(commandPath, 0o755)
  }
  return result
}

function writeSandboxCommand (sandbox, name, contents) {
  const commandPath = path.join(
    sandbox.commandDirectory.replaceAll('/', path.sep),
    name
  )
  fs.writeFileSync(commandPath, contents)
  fs.chmodSync(commandPath, 0o755)
}

function setSandboxUid (sandbox, uid) {
  writeSandboxCommand(sandbox, 'id', `#!/bin/sh
if [ "$1" = "-u" ]; then printf "${uid}\\n"; exit 0; fi
exec /usr/bin/id "$@"
`)
}

function installSandboxSudo (sandbox, { failAuthorization = false } = {}) {
  writeSandboxCommand(sandbox, 'sudo', `#!/bin/sh
printf "sudo" >> "$SUDO_LOG"
for argument in "$@"; do printf "\\t%s" "$argument" >> "$SUDO_LOG"; done
printf "\\n" >> "$SUDO_LOG"
if [ "$1" = "-v" ]; then exit ${failAuthorization ? 1 : 0}; fi
exec "$@"
`)
}

function configureRecoveryProcFixture (sandbox, {
  exists = true,
  pid = '4242',
  start = '777',
  state = 'S',
  current = false,
  bootId = true,
  psState = 'S'
} = {}) {
  const root = path.join(sandbox.root.replaceAll('/', path.sep), 'proc-fixture')
  fs.mkdirSync(path.join(root, 'sys', 'kernel', 'random'), { recursive: true })
  if (bootId) {
    fs.writeFileSync(path.join(root, 'sys', 'kernel', 'random', 'boot_id'), 'fixture-boot\n')
  }
  if (exists) {
    fs.mkdirSync(path.join(root, pid), { recursive: true })
    fs.writeFileSync(path.join(root, pid, 'stat'), [
      pid,
      '(fixture)',
      state,
      ...Array(18).fill('1'),
      start
    ].join(' ') + '\n')
  }

  writeSandboxCommand(sandbox, 'ps', `#!/bin/sh
format=""
pid=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) format="$2"; shift 2 ;;
    -p) pid="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$pid" ] || exit 1
case "$format" in
  stat=) printf "${psState}\\n" ;;
  lstart=) printf "fixture-start-%s\\n" "$pid" ;;
  *) exit 1 ;;
esac
`)

  const procRoot = toPosixPath(root)
  const rollbackPath = sandbox.rollbackScript.replaceAll('/', path.sep)
  let rollback = fs.readFileSync(rollbackPath, 'utf8')
  if (rollback.includes('PROC_ROOT="/proc"')) {
    rollback = rollback.replace('PROC_ROOT="/proc"', 'PROC_ROOT=' + shellLiteral(procRoot))
  } else {
    rollback = rollback.replace('umask 077\n', 'umask 077\nPROC_ROOT=' + shellLiteral(procRoot) + '\n')
    rollback = rollback
      .replaceAll('"/proc/$PROCESS_PID/stat"', '"$PROC_ROOT/$PROCESS_PID/stat"')
      .replaceAll('/proc/sys/kernel/random/boot_id', '"$PROC_ROOT/sys/kernel/random/boot_id"')
  }
  rollback = rollback.replace(
    '  kill -0 "$OWNER_PID" 2>/dev/null || return 1',
    '  : # fixture PID is observable'
  )
  if (current) {
    const ownerClaim = 'claim_running_owner || exit 1\n'
    assert.equal(rollback.includes(ownerClaim), true)
    rollback = rollback.replace(ownerClaim, () => [
      'mkdir -p -- "$PROC_ROOT/$$"',
      `printf '%s\\n' "$$ (fixture) S ${Array(18).fill('1').join(' ')} ${start}" > "$PROC_ROOT/$$/stat"`,
      ownerClaim.trimEnd()
    ].join('\n') + '\n')
  }
  fs.writeFileSync(rollbackPath, rollback)
  return {
    pid,
    procIdentity: `proc:fixture-boot:${start}`,
    psIdentity: `ps:fixture-start-${pid}`
  }
}

function injectRecoveryPauseAfter (sandbox, anchor) {
  const rollbackPath = sandbox.rollbackScript.replaceAll('/', path.sep)
  const rollback = fs.readFileSync(rollbackPath, 'utf8')
  assert.equal(rollback.includes(anchor), true)
  fs.writeFileSync(rollbackPath, rollback.replace(anchor, anchor + [
    'if [ "$PAUSE_RECOVERY" = "yes" ]; then',
    '  : > "$RECOVERY_READY"',
    '  while [ ! -e "$RECOVERY_RELEASE" ]; do sleep 0.02; done',
    'fi'
  ].join('\n') + '\n'))
}

function snapshotTree (root) {
  const entries = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute).replaceAll('\\', '/')
      const metadata = fs.lstatSync(absolute)
      const attributes = [metadata.mode & 0o7777, metadata.uid, metadata.gid]
      if (entry.isDirectory()) {
        entries.push([relative, 'directory', ...attributes])
        visit(absolute)
      } else {
        entries.push([
          relative,
          'file',
          ...attributes,
          fs.readFileSync(absolute).toString('base64')
        ])
      }
    }
  }
  visit(root)
  return entries
}

function buildShellPrelude (sandbox) {
  return [
    'HOSTNAME_STATE=' + shellLiteral(sandbox.hostname),
    'TIMEZONE_STATE=' + shellLiteral(sandbox.timezone),
    'MUTATION_LOG=' + shellLiteral(sandbox.mutationLog),
    'hostnamectl () {',
    '  case "$1" in',
    '    --static) cat "$HOSTNAME_STATE" ;;',
    '    set-hostname) printf "%s\\n" "$2" > "$HOSTNAME_STATE"; printf "hostname:%s\\n" "$2" >> "$MUTATION_LOG" ;;',
    '    *) return 2 ;;',
    '  esac',
    '}',
    'hostname () { cat "$HOSTNAME_STATE"; }',
    'timedatectl () {',
    '  case "$1" in',
    '    show) cat "$TIMEZONE_STATE" ;;',
    '    list-timezones) printf "UTC\\nAsia/Shanghai\\nEurope/London\\n" ;;',
    '    set-timezone) printf "%s\\n" "$2" > "$TIMEZONE_STATE"; printf "timezone:%s\\n" "$2" >> "$MUTATION_LOG" ;;',
    '    *) return 2 ;;',
    '  esac',
    '}',
    'df () { printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 100000 1 99999 1%% /tmp\\n"; }',
    'id () { if [ "$1" = "-u" ]; then printf "0\\n"; else command id "$@"; fi; }'
  ].join('\n')
}

function rewriteSandboxPaths (text, sandbox) {
  return text
    .replaceAll('/tmp/shellpilot-rollback', sandbox.rollbackDirectory)
    .replaceAll('/etc/hosts', sandbox.hosts)
}

test('Task 6 validation rejects unsafe host IP timezone action and rollback values', async () => {
  const [
    { getServerMaintenanceQuickCommands },
    { buildQuickCommandParamValues },
    { validateAndNormalizeQuickCommandParams }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl),
    import(validationUrl)
  ])
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const context = { rollbackPath: '/tmp/shellpilot-rollback/task6-validation-1.sh' }
  const cases = [
    {
      id: 'builtin-server-hostname-change',
      safe: { \u65b0\u4e3b\u673a\u540d: 'web-01.example.com', \u540c\u6b65Hosts: 'yes' },
      invalid: [
        ['\u65b0\u4e3b\u673a\u540d', 'web;reboot'],
        ['\u65b0\u4e3b\u673a\u540d', 'bad\nname'],
        ['\u540c\u6b65Hosts', 'maybe']
      ]
    },
    {
      id: 'builtin-server-hosts-manage',
      safe: { IP\u5730\u5740: '192.0.2.20', \u4e3b\u673a\u540d: 'web-01.example.com', \u52a8\u4f5c: 'add' },
      invalid: [
        ['IP\u5730\u5740', '999.0.2.20'],
        ['IP\u5730\u5740', '192.0.2.20;id'],
        ['\u4e3b\u673a\u540d', 'web_01.example.com'],
        ['\u52a8\u4f5c', 'replace-all']
      ]
    },
    {
      id: 'builtin-server-timezone-change',
      safe: { \u65b0\u65f6\u533a: 'Asia/Shanghai' },
      invalid: [
        ['\u65b0\u65f6\u533a', '../etc/passwd'],
        ['\u65b0\u65f6\u533a', 'Asia/\nShanghai'],
        ['\u65b0\u65f6\u533a', 'Asia/$(id)']
      ]
    }
  ]

  for (const testCase of cases) {
    const item = byId.get(testCase.id)
    const defaults = buildQuickCommandParamValues(item, context)
    for (const [name, value] of testCase.invalid) {
      const result = validateAndNormalizeQuickCommandParams(item, {
        ...defaults,
        ...testCase.safe,
        [name]: value
      })
      assert.ok(result.errors[name], testCase.id + ' must reject ' + JSON.stringify(value))
    }
    for (const rollbackPath of [
      '/tmp/shellpilot-rollback/../escape.sh',
      '/tmp/shellpilot-rollback/nested/escape.sh',
      '/tmp/other.sh',
      '/tmp/shellpilot-rollback/bad\nname.sh'
    ]) {
      const result = validateAndNormalizeQuickCommandParams(item, {
        ...defaults,
        ...testCase.safe,
        \u56de\u6eda\u811a\u672c: rollbackPath
      })
      assert.ok(result.errors.\u56de\u6eda\u811a\u672c, testCase.id + ' must reject ' + JSON.stringify(rollbackPath))
    }
  }

  const hosts = byId.get('builtin-server-hosts-manage')
  const validIpv6 = validateAndNormalizeQuickCommandParams(hosts, {
    ...buildQuickCommandParamValues(hosts, context),
    IP\u5730\u5740: '2001:db8::10',
    \u4e3b\u673a\u540d: 'web-01.example.com',
    \u52a8\u4f5c: 'add'
  })
  assert.deepEqual(validIpv6.errors, {})

  const validMappedIpv6 = validateAndNormalizeQuickCommandParams(hosts, {
    ...buildQuickCommandParamValues(hosts, context),
    IP\u5730\u5740: '::ffff:192.0.2.1',
    \u4e3b\u673a\u540d: 'mapped.example.com',
    \u52a8\u4f5c: 'add'
  })
  assert.deepEqual(validMappedIpv6.errors, {})

  const timezone = byId.get('builtin-server-timezone-change')
  const validUtc = validateAndNormalizeQuickCommandParams(timezone, {
    ...buildQuickCommandParamValues(timezone, context),
    \u65b0\u65f6\u533a: 'UTC'
  })
  assert.deepEqual(validUtc.errors, {})
})

test('hostname shell preflight reserves room for its longest recovery suffix', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases
    .find(testCase => testCase.state === 'hostname')
  const item = runtime.byId.get(testCase.id)
  const maxRollbackBasename = 255 - '.running.lock'.length
  const prefix = '/tmp/shellpilot-rollback/'
  const acceptedFilename =
    'r'.repeat(maxRollbackBasename - '.sh'.length) + '.sh'
  const rejectedFilename =
    'r'.repeat(maxRollbackBasename - '.sh'.length + 1) + '.sh'

  for (const [name, filename, expectedStatus] of [
    ['exact boundary', acceptedFilename, 0],
    ['one character over', rejectedFilename, 1]
  ]) {
    await t.test(name, child => {
      const sandbox = createShellSandbox(child)
      const context = { rollbackPath: prefix + filename }
      const values = {
        ...runtime.buildQuickCommandParamValues(item, context),
        ...testCase.values,
        确认执行: 'no'
      }
      const command = rewriteSandboxPaths(
        runtime.buildQuickCommandText(item, context, values),
        sandbox
      )
      const result = runPosixShell([
        buildShellPrelude(sandbox),
        command
      ].join('\n'), undefined)

      assert.equal(result.status, expectedStatus, result.stderr || result.stdout)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      assert.equal(fs.existsSync(sandbox.rollbackDirectory), false)
    })
  }
})

test('Task 6 command workflows read state and preflight before creating rollback artifacts', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const cases = [
    ['builtin-server-hostname-change', 'OLD_HOSTNAME'],
    ['builtin-server-hosts-manage', 'OLD_HOSTS_MODE'],
    ['builtin-server-timezone-change', 'OLD_TIMEZONE']
  ]

  for (const [id, stateMarker] of cases) {
    const text = commandText(byId.get(id))
    const stateIndex = text.indexOf(stateMarker)
    const previewIndex = text.indexOf('if [ "$APPLY_CHANGE" != "yes" ]')
    const rollbackIndex = text.indexOf('ln -- "$TMP_ROLLBACK" "$ROLLBACK_SCRIPT"')
    assert.ok(stateIndex >= 0, id + ' must read original state')
    assert.ok(stateIndex < previewIndex, id + ' must read state before preview')
    assert.match(text, /command -v/)
    assert.match(text, /df -Pk \/tmp/)
    assert.match(text, /umask 077/)
    assert.match(text, /case "\$ROLLBACK_SCRIPT"/)
    assert.match(text, /\[ -L "\$ROLLBACK_SCRIPT" \]/)
    assert.ok(rollbackIndex > previewIndex, id + ' must create rollback only after confirmation')
  }

  const hostname = commandText(byId.get('builtin-server-hostname-change'))
  assert.match(hostname, /hostnamectl set-hostname "\$NEW_HOSTNAME"/)
  assert.match(hostname, /SYNC_HOSTS/)
  assert.match(hostname, /tolower\(\$field\) == tolower\(oldHost\)/)

  const hosts = commandText(byId.get('builtin-server-hosts-manage'))
  assert.match(hosts, /awk/)
  assert.match(hosts, /tolower\(\$1\) == tolower\(ip\)/)
  assert.match(hosts, /tolower\(\$field\) == tolower\(host\)/)
  assert.doesNotMatch(hosts, /\bsed\b/)

  const timezone = commandText(byId.get('builtin-server-timezone-change'))
  assert.match(timezone, /timedatectl list-timezones/)
  assert.match(timezone, /grep -Fqx -- "\$NEW_TIMEZONE"/)
  assert.match(timezone, /timedatectl set-timezone "\$NEW_TIMEZONE"/)
  assert.doesNotMatch(timezone, /\/etc\/localtime|zoneinfo|ln -s/)
})

test('Task 6 preview reads current state and leaves the sandbox byte-for-byte unchanged', async t => {
  const [
    { getServerMaintenanceQuickCommands },
    { buildQuickCommandParamValues, buildQuickCommandText }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl)
  ])
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const cases = [
    {
      id: 'builtin-server-hostname-change',
      values: { \u65b0\u4e3b\u673a\u540d: 'new-host.example.com', \u540c\u6b65Hosts: 'yes' },
      expected: /old-host\.example\.com/
    },
    {
      id: 'builtin-server-hosts-manage',
      values: { IP\u5730\u5740: '192.0.2.20', \u4e3b\u673a\u540d: 'new-host.example.com', \u52a8\u4f5c: 'add' },
      expected: /127\.0\.0\.1 localhost/
    },
    {
      id: 'builtin-server-timezone-change',
      values: { \u65b0\u65f6\u533a: 'Asia/Shanghai' },
      expected: /\bUTC\b/
    }
  ]

  for (const testCase of cases) {
    await t.test(testCase.id, () => {
      const sandbox = createShellSandbox(t)
      const item = byId.get(testCase.id)
      const context = { rollbackPath: '/tmp/shellpilot-rollback/task6-test-1700000000000.sh' }
      const values = {
        ...buildQuickCommandParamValues(item, context),
        ...testCase.values,
        \u786e\u8ba4\u6267\u884c: 'no'
      }
      const before = snapshotTree(sandbox.root.replaceAll('/', path.sep))
      const script = rewriteSandboxPaths(
        buildQuickCommandText(item, context, values),
        sandbox
      )
      const result = runPosixShell(buildShellPrelude(sandbox) + '\n' + script)
      const after = snapshotTree(sandbox.root.replaceAll('/', path.sep))

      assert.match(result.stdout, /\u9884\u6f14/)
      assert.match(result.stdout, testCase.expected)
      assert.deepEqual(after, before)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      assert.equal(fs.existsSync(sandbox.rollbackDirectory), false)
      if (testCase.id === 'builtin-server-hostname-change' ||
          testCase.id === 'builtin-server-timezone-change') {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
        assert.equal(fs.existsSync(sandbox.rollbackScript), false)
      }
      assert.equal(fs.existsSync(sandbox.consumedMarker), false)
    })
  }
})

test('confirmed Task 6 commands bind verification to normalized final values', async () => {
  const [
    { getServerMaintenanceQuickCommands },
    { buildQuickCommandParamValues, buildQuickCommandText }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl)
  ])
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const context = { rollbackPath: '/tmp/shellpilot-rollback/task6-bind-1700000000000.sh' }
  const cases = [
    {
      id: 'builtin-server-hostname-change',
      values: { \u65b0\u4e3b\u673a\u540d: 'final-host.example.com', \u540c\u6b65Hosts: 'yes' },
      expected: 'final-host.example.com'
    },
    {
      id: 'builtin-server-hosts-manage',
      values: { IP\u5730\u5740: '2001:db8::20', \u4e3b\u673a\u540d: 'final-host.example.com', \u52a8\u4f5c: 'update' },
      expected: '2001:db8::20'
    },
    {
      id: 'builtin-server-timezone-change',
      values: { \u65b0\u65f6\u533a: 'Europe/London' },
      expected: 'Europe/London'
    }
  ]

  for (const testCase of cases) {
    const item = byId.get(testCase.id)
    const values = {
      ...buildQuickCommandParamValues(item, context),
      ...testCase.values,
      \u786e\u8ba4\u6267\u884c: 'yes'
    }
    const text = buildQuickCommandText(item, context, values)
    const verification = text.slice(text.indexOf('# __SHELLPILOT_MUTATION_VERIFY__'))
    assert.match(text, /# __SHELLPILOT_MUTATION_PREFLIGHT__/)
    assert.match(text, /# __SHELLPILOT_MUTATION_BACKUP__/)
    assert.match(text, /# __SHELLPILOT_MUTATION_EXECUTE__/)
    assert.match(verification, /if ! \(/)
    assert.ok(verification.includes(testCase.expected), testCase.id)
    assert.doesNotMatch(text, /\{\{.+?\}\}/)
  }
})

const originalHostsFixture = '127.0.0.1 localhost\n192.0.2.10 old.example.com\n'

const confirmedCommandCases = [
  {
    id: 'builtin-server-hostname-change',
    state: 'hostname',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  },
  {
    id: 'builtin-server-hosts-manage',
    state: 'hosts',
    values: {
      IP地址: '192.0.2.20',
      主机名: 'new-host.example.com',
      动作: 'add'
    }
  },
  {
    id: 'builtin-server-timezone-change',
    state: 'timezone',
    values: {
      新时区: 'Asia/Shanghai'
    }
  }
]

async function loadConfirmedTask6Runtime () {
  const [
    { getServerMaintenanceQuickCommands },
    { buildQuickCommandParamValues, buildQuickCommandText }
  ] = await Promise.all([
    import(registryUrl),
    import(contextUrl)
  ])
  return {
    byId: new Map(
      getServerMaintenanceQuickCommands().map(command => [command.id, command])
    ),
    buildQuickCommandParamValues,
    buildQuickCommandText
  }
}

function renderConfirmedTask6Command (runtime, testCase, sandbox) {
  const item = runtime.byId.get(testCase.id)
  const context = {
    rollbackPath: '/tmp/shellpilot-rollback/task6-test-1700000000000.sh'
  }
  const values = {
    ...runtime.buildQuickCommandParamValues(item, context),
    ...testCase.values,
    确认执行: 'yes'
  }
  return rewriteSandboxPaths(
    runtime.buildQuickCommandText(item, context, values),
    sandbox
  )
}

function buildConfirmedShellPrelude (sandbox, options = {}) {
  const verifyFailure = options.verifyFailure || ''
  const expectedIp = options.expectedIp || '192.0.2.20'
  const expectedHost = options.expectedHost || 'new-host.example.com'
  return [
    buildShellPrelude(sandbox),
    'PATH=' + shellLiteral(toPosixSearchPath(sandbox.commandDirectory)) + ':$PATH',
    'ROLLBACK_ROOT=' + shellLiteral(sandbox.rollbackDirectory),
    'HOSTS_FIXTURE=' + shellLiteral(sandbox.hosts),
    'FAIL_BACKUP=' + shellLiteral(options.failBackup ? 'yes' : 'no'),
    'FAIL_STATE=' + shellLiteral(options.failState ? 'yes' : 'no'),
    'FAIL_ROLLBACK=' + shellLiteral(options.failRollback ? 'yes' : 'no'),
    'FAIL_VERIFIER=' + shellLiteral(options.failVerifier ? 'yes' : 'no'),
    'FAIL_CONSUMED=' + shellLiteral(options.failConsumed ? 'yes' : 'no'),
    'FAIL_RECOVERY=' + shellLiteral(options.failRecovery ? 'yes' : 'no'),
    'FAIL_RECOVERY_STEP=' + shellLiteral(options.failRecoveryStep || ''),
    'PAUSE_RECOVERY=' + shellLiteral(options.pauseRecovery ? 'yes' : 'no'),
    'PAUSE_SETUP=' + shellLiteral(options.pauseSetup ? 'yes' : 'no'),
    'PAUSE_CLEANUP_STAT=' + shellLiteral(options.pauseCleanupStat ? 'yes' : 'no'),
    'RECOVERY_LOG=' + shellLiteral(sandbox.recoveryLog),
    'RECOVERY_READY=' + shellLiteral(sandbox.recoveryReady),
    'RECOVERY_RELEASE=' + shellLiteral(sandbox.recoveryRelease),
    'FLOCK_STATE=' + shellLiteral(sandbox.flockState),
    'ROLLBACK_SCRIPT_FIXTURE=' + shellLiteral(sandbox.rollbackScript),
    'VERIFIER_SCRIPT_FIXTURE=' + shellLiteral(sandbox.verifierScript),
    'SETUP_READY=' + shellLiteral(sandbox.setupReady),
    'SETUP_RELEASE=' + shellLiteral(sandbox.setupRelease),
    'CLEANUP_READY=' + shellLiteral(sandbox.cleanupReady),
    'CLEANUP_RELEASE=' + shellLiteral(sandbox.cleanupRelease),
    'CONSUMED_MARKER_FIXTURE=' + shellLiteral(sandbox.consumedMarker),
    'SUDO_LOG=' + shellLiteral(sandbox.sudoLog),
    'CONCURRENT_PAIR_ON_ROLLBACK_LINK=' + shellLiteral(options.concurrentPair ? 'yes' : 'no'),
    'REPLACE_ROLLBACK_ON_VERIFIER_LINK=' + shellLiteral(options.replaceRollback ? 'yes' : 'no'),
    'PUBLISH_ROLLBACK_THEN_FAIL=' + shellLiteral(options.publishThenFail ? 'yes' : 'no'),
    'VERIFY_FAILURE=' + shellLiteral(verifyFailure),
    'EXPECTED_IP=' + shellLiteral(expectedIp),
    'EXPECTED_HOST=' + shellLiteral(expectedHost),
    'export PATH HOSTNAME_STATE TIMEZONE_STATE MUTATION_LOG HOSTS_FIXTURE',
    'export ROLLBACK_ROOT',
    'export FAIL_RECOVERY FAIL_RECOVERY_STEP PAUSE_RECOVERY RECOVERY_LOG',
    'export RECOVERY_READY RECOVERY_RELEASE FLOCK_STATE FAIL_CONSUMED',
    'export CONSUMED_MARKER_FIXTURE SUDO_LOG',
    'COMMENT_ONLY_HOSTS_AFTER_INSTALL=' + shellLiteral(options.commentOnlyHostsAfterInstall ? 'yes' : 'no'),
    'CASE_FOLD_HOSTS_AFTER_INSTALL=' + shellLiteral(options.caseFoldHostsAfterInstall ? 'yes' : 'no'),
    'CLEANUP_STAT_ARMED=no',
    'stat () {',
    '  format=""',
    '  dereference=""',
    '  if [ "$1" = "-c" ]; then format="$2"; shift 2; fi',
    '  if [ "$1" = "-Lc" ]; then dereference="-L"; format="$2"; shift 2; fi',
    '  if [ "$1" = "--" ]; then shift; fi',
    '  target="$1"',
    '  if [ "$PAUSE_CLEANUP_STAT" = "yes" ] &&',
    '    [ "$CLEANUP_STAT_ARMED" = "yes" ] &&',
    '    [ "$format" = "%d:%i" ] &&',
    '    [ "$target" = "$ROLLBACK_SCRIPT_FIXTURE" ]; then',
    '    cleanup_inode="$(command stat -c "$format" -- "$target")" || return 1',
    '    printf "%s\\n" "$cleanup_inode"',
    '    : > "$CLEANUP_READY"',
    '    while [ ! -e "$CLEANUP_RELEASE" ]; do sleep 0.02; done',
    '    return 0',
    '  fi',
    '  case "$format" in',
    '    %u) id -u ;;',
    '    %g) printf "0\\n" ;;',
    '    %a)',
    '      case "$target" in',
    '        "$ROLLBACK_ROOT"/*.running.lock) printf "600\\n" ;;',
    '        "$ROLLBACK_ROOT"/operation.*/timezone.state) printf "600\\n" ;;',
    '        "$ROLLBACK_ROOT"/operation.*/timezone-state.*) printf "600\\n" ;;',
    '        "$ROLLBACK_ROOT"/operation.*/*) printf "644\\n" ;;',
    '        "$ROLLBACK_ROOT"|"$ROLLBACK_ROOT"/operation.*|"$ROLLBACK_ROOT"/*.sh) printf "700\\n" ;;',
    '        *) printf "644\\n" ;;',
    '      esac',
    '      ;;',
    '    *)',
    '      if [ -n "$dereference" ]; then',
    '        command stat -L -c "$format" -- "$target"',
    '      else command stat -c "$format" -- "$target"',
    '      fi',
    '      ;;',
    '  esac',
    '}',
    'cp () {',
    '  destination=""',
    '  for argument in "$@"; do destination="$argument"; done',
    '  if [ "$FAIL_BACKUP" = "yes" ]; then',
    '    case "$destination" in */target-1) return 1 ;; esac',
    '  fi',
    '  command cp "$@"',
    '}',
    'chmod () {',
    '  destination=""',
    '  for argument in "$@"; do destination="$argument"; done',
    '  if [ "$FAIL_STATE" = "yes" ]; then',
    '    case "$destination" in *.state|*/timezone-state.*) return 1 ;; esac',
    '  fi',
    '  command chmod "$@"',
    '}',
    'chown () { :; }',
    'ln () {',
    '  destination=""',
    '  for argument in "$@"; do destination="$argument"; done',
    '  if [ "$CONCURRENT_PAIR_ON_ROLLBACK_LINK" = "yes" ] &&',
    '    [ "$destination" = "$ROLLBACK_SCRIPT_FIXTURE" ]; then',
    '    printf "foreign rollback\\n" > "$ROLLBACK_SCRIPT_FIXTURE"',
    '    printf "foreign verifier\\n" > "$VERIFIER_SCRIPT_FIXTURE"',
    '    return 1',
    '  fi',
    '  if [ "$REPLACE_ROLLBACK_ON_VERIFIER_LINK" = "yes" ] &&',
    '    [ "$destination" = "$VERIFIER_SCRIPT_FIXTURE" ]; then',
    '    command rm -f -- "$ROLLBACK_SCRIPT_FIXTURE"',
    '    printf "foreign replacement\\n" > "$ROLLBACK_SCRIPT_FIXTURE"',
    '    return 1',
    '  fi',
    '  if [ "$PUBLISH_ROLLBACK_THEN_FAIL" = "yes" ] &&',
    '    [ "$destination" = "$ROLLBACK_SCRIPT_FIXTURE" ]; then',
    '    command ln "$@" || return 1',
    '    CLEANUP_STAT_ARMED=yes',
    '    return 1',
    '  fi',
    '  if [ "$FAIL_ROLLBACK" = "yes" ] &&',
    '    [ "$destination" = "$ROLLBACK_SCRIPT_FIXTURE" ]; then return 1; fi',
    '  if [ "$FAIL_VERIFIER" = "yes" ]; then',
    '    case "$destination" in *.verify.sh) return 1 ;; esac',
    '  fi',
    '  command ln "$@"',
    '}',
    'install () {',
    '  while [ "$#" -gt 0 ]; do',
    '    case "$1" in',
    '      -o|-g|-m) shift 2 ;;',
    '      --) shift; break ;;',
    '      *) break ;;',
    '    esac',
    '  done',
    '  [ "$#" -eq 2 ] || return 2',
    '  command cp -- "$1" "$2" || return 1',
    '  if [ "$2" = "$HOSTS_FIXTURE" ]; then',
    '    printf "hosts:%s\\n" "$2" >> "$MUTATION_LOG"',
    '    if [ "$COMMENT_ONLY_HOSTS_AFTER_INSTALL" = "yes" ]; then',
    '      printf "127.0.0.1 localhost# %s\\n" "$EXPECTED_HOST" > "$2"',
    '    fi',
    '    if [ "$CASE_FOLD_HOSTS_AFTER_INSTALL" = "yes" ]; then',
    '      case_tmp="$2.case-fold"',
    '      tr "[:lower:]" "[:upper:]" < "$2" > "$case_tmp" || return 1',
    '      command mv -- "$case_tmp" "$2" || return 1',
    '    fi',
    '    if [ "$VERIFY_FAILURE" = "hosts" ]; then',
    '      printf "%s %s\\n" "$EXPECTED_IP" "$EXPECTED_HOST" >> "$2"',
    '    fi',
    '  fi',
    '}',
    'hostnamectl () {',
    '  case "$1" in',
    '    --static) cat "$HOSTNAME_STATE" ;;',
    '    set-hostname)',
    '      printf "hostname:%s\\n" "$2" >> "$MUTATION_LOG"',
    '      if [ "$VERIFY_FAILURE" = "hostname" ]; then',
    '        printf "verification-mismatch\\n" > "$HOSTNAME_STATE"',
    '      else',
    '        printf "%s\\n" "$2" > "$HOSTNAME_STATE"',
    '      fi',
    '      ;;',
    '    *) return 2 ;;',
    '  esac',
    '}',
    'timedatectl () {',
    '  case "$1" in',
    '    show) cat "$TIMEZONE_STATE" ;;',
    '    list-timezones) printf "UTC\\nAsia/Shanghai\\nEurope/London\\n" ;;',
    '    set-timezone)',
    '      if [ "$PAUSE_RECOVERY" = "yes" ]; then',
    '        : > "$RECOVERY_READY"',
    '        while [ ! -e "$RECOVERY_RELEASE" ]; do sleep 0.02; done',
    '      fi',
    '      if [ "$PAUSE_SETUP" = "yes" ]; then',
    '        printf "%s\\n" "$$" > "$SETUP_READY"',
    '        while [ ! -e "$SETUP_RELEASE" ]; do :; done',
    '      fi',
    '      printf "timezone:%s\\n" "$2" >> "$MUTATION_LOG"',
    '      if [ "$VERIFY_FAILURE" = "timezone" ]; then',
    '        printf "Verification/Mismatch\\n" > "$TIMEZONE_STATE"',
    '      else',
    '        printf "%s\\n" "$2" > "$TIMEZONE_STATE"',
    '      fi',
    '      ;;',
    '    *) return 2 ;;',
    '  esac',
    '}'
  ].join('\n')
}

function assertOriginalTask6State (sandbox) {
  assert.equal(fs.readFileSync(sandbox.hostname, 'utf8'), 'old-host.example.com\n')
  assert.equal(fs.readFileSync(sandbox.timezone, 'utf8'), 'UTC\n')
  assert.equal(fs.readFileSync(sandbox.hosts, 'utf8'), originalHostsFixture)
}

function listOneShotRecoveryAssets (sandbox, state) {
  const root = sandbox.rollbackDirectory.replaceAll('/', path.sep)
  if (!fs.existsSync(root)) return []
  const temporaryPattern = new RegExp(state + '-(?:state|rollback|verify)\\.')
  return snapshotTree(root)
    .map(entry => entry[0])
    .filter(relative => {
      return temporaryPattern.test(relative) ||
        /task6-test-1700000000000(?:\.verify)?\.sh$/.test(relative) ||
        (state === 'timezone' &&
          /(?:^|\/)operation\.[^/]+\/timezone\.state$/.test(relative))
    })
}

function assertConfirmedTask6Mutation (sandbox, testCase) {
  if (testCase.state === 'hostname') {
    assert.equal(
      fs.readFileSync(sandbox.hostname, 'utf8'),
      testCase.values['\u65b0\u4e3b\u673a\u540d'] + '\n'
    )
  } else if (testCase.state === 'timezone') {
    assert.equal(
      fs.readFileSync(sandbox.timezone, 'utf8'),
      testCase.values['\u65b0\u65f6\u533a'] + '\n'
    )
  } else {
    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /192\.0\.2\.20 new-host\.example\.com/)
  }
}

function runTask6RollbackTwice (sandbox) {
  const rollback = shellLiteral(sandbox.rollbackScript)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    '. ' + rollback,
    '. ' + rollback
  ].join('\n'))
}

function runOneShotVerifierReadOnly (sandbox) {
  const root = sandbox.root.replaceAll('/', path.sep)
  const before = snapshotTree(root)
  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.verifierScript)
  ].join('\n'), undefined)
  const after = snapshotTree(root)
  assert.deepEqual(after, before)
  return result
}

function runHostnameOneShotRecovery (sandbox) {
  const rollback = shellLiteral(sandbox.rollbackScript)
  const verifier = shellLiteral(sandbox.verifierScript)
  const beforeRollback = runOneShotVerifierReadOnly(sandbox)
  assert.notEqual(beforeRollback.status, 0)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assert.equal(fs.existsSync(sandbox.rollbackScript + '.consumed'), true)

  const consumed = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.notEqual(consumed.status, 0)

  assert.equal(runOneShotVerifierReadOnly(sandbox).status, 0)

  fs.writeFileSync(sandbox.hostname, 'OLD-HOST.EXAMPLE.COM\n')
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'))

  fs.writeFileSync(sandbox.hostname, 'tampered.example.com\n')
  const hostnameMismatch = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'), undefined)
  assert.notEqual(hostnameMismatch.status, 0)
  fs.writeFileSync(sandbox.hostname, 'old-host.example.com\n')

  fs.writeFileSync(sandbox.hosts, originalHostsFixture + '# tampered\n')
  const hostsMismatch = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'), undefined)
  assert.notEqual(hostsMismatch.status, 0)
  fs.writeFileSync(sandbox.hosts, originalHostsFixture)

  for (const [variable, value] of [
    ['HOSTS_MODE_OVERRIDE', '600'],
    ['HOSTS_UID_OVERRIDE', '1000'],
    ['HOSTS_GID_OVERRIDE', '1000']
  ]) {
    const metadataMismatch = runPosixShell([
      buildConfirmedShellPrelude(sandbox),
      variable + '=' + shellLiteral(value) + ' sh -- ' + verifier
    ].join('\n'), undefined)
    assert.notEqual(metadataMismatch.status, 0, variable)
  }
}

function runTimezoneOneShotRecovery (sandbox) {
  const rollback = shellLiteral(sandbox.rollbackScript)
  assert.notEqual(runOneShotVerifierReadOnly(sandbox).status, 0)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)

  const consumed = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.equal(consumed.status, 0, consumed.stderr || consumed.stdout)
  assert.match(consumed.stdout + consumed.stderr, /\u5df2.*\u6062.*\u590d.*\u5df2.*\u8c03.*\u548c/)

  assert.equal(runOneShotVerifierReadOnly(sandbox).status, 0)
}

test('hosts update and delete preserve aliases and comments while deduplicating the target', async t => {
  const runtime = await loadConfirmedTask6Runtime()

  await t.test('update rejects a target that exists only after a glued hash boundary', child => {
    const sandbox = createShellSandbox(child)
    const originalHosts = [
      '127.0.0.1 localhost',
      '192.0.2.10 alias# target.example.com',
      ''
    ].join('\n')
    fs.writeFileSync(sandbox.hosts, originalHosts)
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'update'
      }
    }, sandbox)

    const result = runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'), undefined)

    assert.notEqual(result.status, 0)
    assert.equal(fs.readFileSync(sandbox.hosts, 'utf8'), originalHosts)
  })

  await t.test('update preserves a glued comment after moving the exact target token', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 target.example.com alias# target.example.com keep-comment',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'update'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /^192\.0\.2\.10 alias# target\.example\.com keep-comment$/m)
    assert.match(hosts, /^203\.0\.113\.9 target\.example\.com$/m)
  })

  await t.test('delete preserves a glued comment after removing the exact target token', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 target.example.com alias# target.example.com keep-comment',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '192.0.2.10',
        主机名: 'target.example.com',
        动作: 'delete'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '192.0.2.10',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    assert.match(
      fs.readFileSync(sandbox.hosts, 'utf8'),
      /^192\.0\.2\.10 alias# target\.example\.com keep-comment$/m
    )
  })

  await t.test('update moves only the target hostname to the new IP', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 target.example.com alias-a # first',
      '198.51.100.5 alias-b target.example.com # second',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'update'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /^192\.0\.2\.10 alias-a # first$/m)
    assert.match(hosts, /^198\.51\.100\.5 alias-b # second$/m)
    assert.match(hosts, /^203\.0\.113\.9 target\.example\.com$/m)
    assert.equal(
      hosts.split(/\s+/).filter(token => token === 'target.example.com').length,
      1
    )
  })

  await t.test('delete removes only exact target tokens', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 target.example.com alias-a target.example.com # keep',
      '198.51.100.5 target.example.com alias-b # other-ip',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '192.0.2.10',
        主机名: 'target.example.com',
        动作: 'delete'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '192.0.2.10',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /^192\.0\.2\.10 alias-a # keep$/m)
    assert.match(hosts, /^198\.51\.100\.5 target\.example\.com alias-b # other-ip$/m)
    assert.equal(
      hosts.split('\n')[1].split(/\s+/).includes('target.example.com'),
      false
    )
  })

  await t.test('add rejects a hostname that differs only by case', child => {
    const sandbox = createShellSandbox(child)
    const originalHosts = [
      '127.0.0.1 localhost',
      '192.0.2.10 TARGET.Example.COM Alias-One # Keep Case',
      ''
    ].join('\n')
    fs.writeFileSync(sandbox.hosts, originalHosts)
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'add'
      }
    }, sandbox)

    const result = runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'), undefined)

    assert.notEqual(result.status, 0)
    assert.equal(fs.readFileSync(sandbox.hosts, 'utf8'), originalHosts)
  })

  await t.test('update matches case-insensitively and preserves alias and comment text', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 TARGET.Example.COM Alias-One # Keep Case',
      '198.51.100.5 Alias-Two target.EXAMPLE.com# Keep Glued',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'update'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /^192\.0\.2\.10 Alias-One # Keep Case$/m)
    assert.match(hosts, /^198\.51\.100\.5 Alias-Two# Keep Glued$/m)
    assert.match(hosts, /^203\.0\.113\.9 target\.example\.com$/m)
    assert.equal(
      hosts.split(/\s+/).filter(token => {
        return token.toLowerCase() === 'target.example.com'
      }).length,
      1
    )
  })

  await t.test('delete removes case-insensitive target tokens only on the exact IP', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 TARGET.Example.COM Alias-One target.EXAMPLE.com # Keep Case',
      '198.51.100.5 Target.Example.Com Alias-Two # Other IP',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '192.0.2.10',
        主机名: 'target.example.com',
        动作: 'delete'
      }
    }, sandbox)

    runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '192.0.2.10',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'))

    const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
    assert.match(hosts, /^192\.0\.2\.10 Alias-One # Keep Case$/m)
    assert.match(hosts, /^198\.51\.100\.5 Target\.Example\.Com Alias-Two # Other IP$/m)
  })

  await t.test('post verification accepts only a case-different effective hostname', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, [
      '127.0.0.1 localhost',
      '192.0.2.10 TARGET.Example.COM Alias-One # Keep Case',
      ''
    ].join('\n'))
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP地址: '203.0.113.9',
        主机名: 'target.example.com',
        动作: 'update'
      }
    }, sandbox)

    const result = runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '203.0.113.9',
        expectedHost: 'target.example.com',
        caseFoldHostsAfterInstall: true
      }),
      command
    ].join('\n'), undefined)

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(
      fs.readFileSync(sandbox.hosts, 'utf8'),
      /^203\.0\.113\.9 TARGET\.EXAMPLE\.COM$/m
    )
  })
})

test('hostname hosts synchronization ignores old hostname tokens in comments', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  fs.writeFileSync(sandbox.hosts, [
    '127.0.0.1 localhost # old-host.example.com',
    '192.0.2.10 alias-a # old-host.example.com',
    ''
  ].join('\n'))
  const command = renderConfirmedTask6Command(runtime, {
    id: 'builtin-server-hostname-change',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  }, sandbox)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox, {
      expectedHost: 'new-host.example.com'
    }),
    command
  ].join('\n'))

  const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
  assert.match(hosts, /^127\.0\.0\.1 localhost # old-host\.example\.com$/m)
  assert.match(hosts, /^192\.0\.2\.10 alias-a # old-host\.example\.com$/m)
  assert.match(hosts, /^127\.0\.1\.1[ \t]+new-host\.example\.com$/m)
  assert.equal(
    hosts.split('\n').filter(line => /^[^#]*\bnew-host\.example\.com\b/.test(line)).length,
    1
  )
})

test('hostname synchronization and verification ignore tokens after a glued hash boundary', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  fs.writeFileSync(sandbox.hosts, [
    '127.0.0.1 localhost# old-host.example.com',
    ''
  ].join('\n'))
  const command = renderConfirmedTask6Command(runtime, {
    id: 'builtin-server-hostname-change',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  }, sandbox)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox, {
      expectedHost: 'new-host.example.com'
    }),
    command
  ].join('\n'))

  const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
  const effectiveLines = hosts.split('\n').map(line => line.split('#', 1)[0])
  assert.match(hosts, /^127\.0\.0\.1 localhost# old-host\.example\.com$/m)
  assert.match(hosts, /^127\.0\.1\.1[ \t]+new-host\.example\.com$/m)
  assert.equal(
    effectiveLines.filter(line => /\bnew-host\.example\.com\b/.test(line)).length,
    1
  )
})

test('hostname post-verification rejects a new hostname found only in a glued comment', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, {
    id: 'builtin-server-hostname-change',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  }, sandbox)

  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox, {
      expectedHost: 'new-host.example.com',
      commentOnlyHostsAfterInstall: true
    }),
    command
  ].join('\n'), undefined)

  assert.notEqual(result.status, 0)
  assert.equal(
    fs.readFileSync(sandbox.hosts, 'utf8'),
    '127.0.0.1 localhost# new-host.example.com\n'
  )
  assert.equal(fs.existsSync(sandbox.rollbackScript), true)
  assert.ok(result.stdout.includes(sandbox.rollbackScript))
})

test('hostname synchronization matches old host case-insensitively and preserves text', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  fs.writeFileSync(sandbox.hosts, [
    '127.0.0.1 localhost',
    '127.0.1.1 OLD-HOST.Example.COM Alias-One# Keep Original Case',
    ''
  ].join('\n'))
  const command = renderConfirmedTask6Command(runtime, {
    id: 'builtin-server-hostname-change',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  }, sandbox)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox, {
      expectedHost: 'new-host.example.com'
    }),
    command
  ].join('\n'))

  const hosts = fs.readFileSync(sandbox.hosts, 'utf8')
  assert.match(
    hosts,
    /^127\.0\.1\.1 new-host\.example\.com Alias-One# Keep Original Case$/m
  )
  assert.equal(
    hosts.split(/\s+/).some(token => {
      return token.toLowerCase() === 'old-host.example.com'
    }),
    false
  )
})

test('hostname hosts verification accepts an effective hostname with different case', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  fs.writeFileSync(sandbox.hosts, [
    '127.0.0.1 localhost',
    '127.0.1.1 OLD-HOST.EXAMPLE.COM Alias-One # Keep',
    ''
  ].join('\n'))
  const command = renderConfirmedTask6Command(runtime, {
    id: 'builtin-server-hostname-change',
    values: {
      新主机名: 'new-host.example.com',
      同步Hosts: 'yes'
    }
  }, sandbox)

  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox, {
      expectedHost: 'new-host.example.com',
      caseFoldHostsAfterInstall: true
    }),
    command
  ].join('\n'), undefined)

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(
    fs.readFileSync(sandbox.hosts, 'utf8'),
    /^127\.0\.1\.1 NEW-HOST\.EXAMPLE\.COM ALIAS-ONE # KEEP$/m
  )
})

test('hosts shell accepts mapped IPv6, matches IPv6 case-insensitively, and accepts empty backups', async t => {
  const runtime = await loadConfirmedTask6Runtime()

  await t.test('IPv4-mapped IPv6 with an empty hosts file', child => {
    const sandbox = createShellSandbox(child)
    fs.writeFileSync(sandbox.hosts, '')
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP\u5730\u5740: '::ffff:192.0.2.1',
        \u4e3b\u673a\u540d: 'mapped.example.com',
        \u52a8\u4f5c: 'add'
      }
    }, sandbox)

    const result = runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '::ffff:192.0.2.1',
        expectedHost: 'mapped.example.com',
        caseFoldHostsAfterInstall: true
      }),
      command
    ].join('\n'), undefined)

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(fs.readFileSync(sandbox.hosts, 'utf8'), '::FFFF:192.0.2.1 MAPPED.EXAMPLE.COM\n')
  })

  await t.test('delete matches an IPv6 address with different casing', child => {
    const sandbox = createShellSandbox(child)
    const original = '2001:DB8::10 target.example.com alias.example.com # Keep\n'
    fs.writeFileSync(sandbox.hosts, original)
    const command = renderConfirmedTask6Command(runtime, {
      id: 'builtin-server-hosts-manage',
      values: {
        IP\u5730\u5740: '2001:db8::10',
        \u4e3b\u673a\u540d: 'target.example.com',
        \u52a8\u4f5c: 'delete'
      }
    }, sandbox)

    const result = runPosixShell([
      buildConfirmedShellPrelude(sandbox, {
        expectedIp: '2001:db8::10',
        expectedHost: 'target.example.com'
      }),
      command
    ].join('\n'), undefined)

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(
      fs.readFileSync(sandbox.hosts, 'utf8'),
      '2001:DB8::10 alias.example.com # Keep\n'
    )
  })
})

test('confirmed Task 6 commands create usable recovery assets before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  for (const testCase of confirmedCommandCases) {
    await t.test(testCase.id, child => {
      const sandbox = createShellSandbox(child)
      const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox, {
          expectedIp: testCase.values['IP\u5730\u5740'],
          expectedHost: testCase.values['\u4e3b\u673a\u540d']
        }),
        command
      ].join('\n'))

      assertConfirmedTask6Mutation(sandbox, testCase)
      assert.equal(fs.existsSync(sandbox.rollbackScript), true)
      assert.match(fs.readFileSync(sandbox.rollbackScript, 'utf8'), /^#!\/bin\/sh/)
      assert.ok(result.stdout.includes(sandbox.rollbackScript))
      assert.equal(fs.existsSync(sandbox.mutationLog), true)

      if (testCase.state === 'hostname') {
        assert.equal(fs.existsSync(sandbox.verifierScript), true)
        assert.equal(fs.lstatSync(sandbox.rollbackScript).isSymbolicLink(), false)
        assert.equal(fs.lstatSync(sandbox.verifierScript).isSymbolicLink(), false)
        assert.match(command, /chmod 700 "\$TMP_ROLLBACK" "\$TMP_VERIFIER"/)

        const rollbackText = fs.readFileSync(sandbox.rollbackScript, 'utf8')
        const verifierText = fs.readFileSync(sandbox.verifierScript, 'utf8')
        assert.match(verifierText, /^#!\/bin\/sh/)
        assert.doesNotMatch(rollbackText, /hostnamectl --static|\bcmp\b/)
        const restoreChownIndex = rollbackText.indexOf('$RUN_AS chown ')
        const restoreChmodIndex = rollbackText.indexOf('$RUN_AS chmod ')
        assert.ok(restoreChownIndex >= 0, 'rollback must restore hosts ownership')
        assert.ok(
          restoreChmodIndex > restoreChownIndex,
          'rollback must restore hosts mode after ownership'
        )
        assert.doesNotMatch(
          verifierText,
          /set-hostname|\binstall\b|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\brmdir\b|\bchmod\b|\bchown\b/
        )
        assert.doesNotMatch(verifierText, /CONSUMED_DIR|\.consumed/)
        assert.match(verifierText, /\bcmp\b/)
        assert.match(verifierText, /stat -c %a/)
        assert.match(verifierText, /stat -c %u/)
        assert.match(verifierText, /stat -c %g/)
        runHostnameOneShotRecovery(sandbox)
      } else if (testCase.state === 'timezone') {
        assert.equal(fs.existsSync(sandbox.verifierScript), true)
        assert.equal(fs.lstatSync(sandbox.rollbackScript).isSymbolicLink(), false)
        assert.equal(fs.lstatSync(sandbox.verifierScript).isSymbolicLink(), false)
        assert.match(command, /chmod 700 "\$TMP_ROLLBACK" "\$TMP_VERIFIER"/)

        const rollbackText = fs.readFileSync(sandbox.rollbackScript, 'utf8')
        const verifierText = fs.readFileSync(sandbox.verifierScript, 'utf8')
        assert.match(verifierText, /^#!\/bin\/sh/)
        assert.match(rollbackText, /timedatectl set-timezone "\$OLD_TIMEZONE"/)
        assert.doesNotMatch(
          verifierText,
          /set-timezone|\binstall\b|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\brmdir\b|\bchmod\b|\bchown\b/
        )
        assert.match(verifierText, /timedatectl show/)
        runTimezoneOneShotRecovery(sandbox)
      } else {
        runTask6RollbackTwice(sandbox)
      }
      assertOriginalTask6State(sandbox)
    })
  }
})

test('backup failures stop every Task 6 command before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  for (const testCase of confirmedCommandCases) {
    await t.test(testCase.id, child => {
      const sandbox = createShellSandbox(child)
      const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox, {
          failBackup: testCase.state !== 'timezone',
          failState: testCase.state === 'timezone'
        }),
        command
      ].join('\n'), undefined)

      assert.notEqual(result.status, 0)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      assert.equal(fs.existsSync(sandbox.rollbackScript), false)
      if (testCase.state === 'timezone') {
        assert.deepEqual(listOneShotRecoveryAssets(sandbox, 'timezone'), [])
      }
    })
  }
})

test('rollback script creation failures stop every Task 6 command before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  for (const testCase of confirmedCommandCases) {
    await t.test(testCase.id, child => {
      const sandbox = createShellSandbox(child)
      const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox, { failRollback: true }),
        command
      ].join('\n'), undefined)

      assert.notEqual(result.status, 0)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      assert.equal(fs.existsSync(sandbox.rollbackScript), false)
      if (testCase.state === 'hostname' ||
          testCase.state === 'timezone') {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
        assert.deepEqual(listOneShotRecoveryAssets(sandbox, testCase.state), [])
      }
    })
  }
})

test('hostname verifier creation failures remove every recovery asset before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failVerifier: true }),
    command
  ].join('\n'), undefined)

  assert.notEqual(result.status, 0)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.mutationLog), false)
  assert.equal(fs.existsSync(sandbox.rollbackScript), false)
  assert.equal(fs.existsSync(sandbox.verifierScript), false)
  assert.deepEqual(listOneShotRecoveryAssets(sandbox, 'hostname'), [])
})

test('timezone verifier creation failure removes the recovery pair before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failVerifier: true }),
    command
  ].join('\n'), undefined)

  assert.notEqual(result.status, 0)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.mutationLog), false)
  assert.equal(fs.existsSync(sandbox.rollbackScript), false)
  assert.equal(fs.existsSync(sandbox.verifierScript), false)
  assert.deepEqual(listOneShotRecoveryAssets(sandbox, 'timezone'), [])
})

test('timezone rollback remains retryable after restore failure', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))

  const rollback = shellLiteral(sandbox.rollbackScript)
  const failed = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failRecovery: true }),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.notEqual(failed.status, 0)
  assert.match(failed.stdout + failed.stderr, /UTC/)
  assert.equal(
    fs.readFileSync(sandbox.timezone, 'utf8'),
    testCase.values['\u65b0\u65f6\u533a'] + '\n'
  )
  assert.equal(fs.existsSync(sandbox.consumedMarker), false)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
})

test('timezone setup excludes rollback until mutation verification completes', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  const setup = runPosixShellAsync([
    buildConfirmedShellPrelude(sandbox, { pauseSetup: true }),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  let setupResult

  try {
    await waitForPath(sandbox.setupReady)
    assert.equal(fs.existsSync(sandbox.rollbackScript), true)
    assert.equal(fs.existsSync(sandbox.verifierScript), true)
    const rollback = runPosixShell([
      buildConfirmedShellPrelude(sandbox),
      'sh -- ' + shellLiteral(sandbox.rollbackScript)
    ].join('\n'), undefined)
    assert.notEqual(rollback.status, 0)
    assert.notEqual((rollback.stdout + rollback.stderr).trim(), '')
    assert.equal(fs.existsSync(sandbox.consumedMarker), false)
    assert.equal(fs.readFileSync(sandbox.timezone, 'utf8'), 'UTC\n')
    assert.equal(fs.existsSync(sandbox.mutationLog), false)
  } finally {
    fs.writeFileSync(sandbox.setupRelease, '')
    setupResult = await setup.completion
  }

  assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout)
  assert.equal(setupResult.signal, null)
  assert.equal(
    fs.readFileSync(sandbox.timezone, 'utf8'),
    testCase.values['\u65b0\u65f6\u533a'] + '\n'
  )
})

test('timezone cleanup keeps the mutex across the inode-check unlink window', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  const setup = runPosixShellAsync([
    buildConfirmedShellPrelude(sandbox, {
      pauseCleanupStat: true,
      publishThenFail: true
    }),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  let setupResult

  try {
    await waitForPath(sandbox.cleanupReady)
    const replacement = runPosixShell([
      buildConfirmedShellPrelude(sandbox),
      '[ ! -L "$ROLLBACK_SCRIPT_FIXTURE.running.lock" ] || exit 72',
      'exec 9>> "$ROLLBACK_SCRIPT_FIXTURE.running.lock" || exit 72',
      'flock -n 9 || exit 73',
      'rm -f -- "$ROLLBACK_SCRIPT_FIXTURE"',
      'printf "foreign replacement\\n" > "$ROLLBACK_SCRIPT_FIXTURE"',
      'flock -u 9'
    ].join('\n'), undefined)
    assert.notEqual(replacement.status, 0)
    assert.equal(
      fs.readFileSync(sandbox.rollbackScript, 'utf8') === 'foreign replacement\n',
      false
    )
  } finally {
    fs.writeFileSync(sandbox.cleanupRelease, '')
    setupResult = await setup.completion
  }

  assert.notEqual(setupResult.status, 0)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.mutationLog), false)
  assert.deepEqual(listOneShotRecoveryAssets(sandbox, 'timezone'), [])
})

test('timezone rollback classifies live stale zombie and missing owners', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const cases = [
    {
      name: 'live owner',
      state: 'S',
      identity: 'proc',
      rejected: true
    },
    {
      name: 'reused pid identity',
      state: 'S',
      identity: 'stale',
      rejected: false
    },
    {
      name: 'zombie owner',
      state: 'Z',
      identity: 'proc',
      rejected: false
    },
    {
      name: 'zombie owner without boot id',
      state: 'Z',
      bootId: false,
      identity: 'ps',
      rejected: false
    },
    {
      name: 'dead owner',
      state: 'X',
      identity: 'proc',
      rejected: false
    },
    {
      name: 'dead owner without boot id',
      state: 'X',
      bootId: false,
      identity: 'ps',
      rejected: false
    },
    {
      name: 'missing owner',
      exists: false,
      identity: 'ps',
      rejected: false
    },
    {
      name: 'ps zombie owner without proc',
      exists: false,
      bootId: false,
      psState: 'Z',
      identity: 'ps',
      rejected: false
    },
    {
      name: 'live owner without proc uses ps identity',
      exists: false,
      bootId: false,
      identity: 'ps',
      rejected: true
    },
    {
      name: 'reused owner without proc uses ps identity',
      exists: false,
      bootId: false,
      identity: 'stale',
      rejected: false
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, child => {
      const sandbox = createShellSandbox(child)
      runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        renderConfirmedTask6Command(runtime, testCase, sandbox)
      ].join('\n'))
      const owner = configureRecoveryProcFixture(sandbox, fixture)
      const identity = fixture.identity === 'proc'
        ? owner.procIdentity
        : fixture.identity === 'ps'
          ? owner.psIdentity
          : 'proc:fixture-boot:stale-start'
      fs.writeFileSync(sandbox.runningMarker, owner.pid + '\n' + identity + '\n')

      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        'sh -- ' + shellLiteral(sandbox.rollbackScript)
      ].join('\n'), undefined)
      if (fixture.rejected) {
        assert.notEqual(result.status, 0)
        assert.equal(fs.existsSync(sandbox.consumedMarker), false)
        assert.equal(fs.existsSync(sandbox.runningMarker), true)
        assert.equal(
          fs.readFileSync(sandbox.timezone, 'utf8'),
          testCase.values['\u65b0\u65f6\u533a'] + '\n'
        )
      } else {
        assert.equal(result.status, 0, result.stderr || result.stdout)
        assertOriginalTask6State(sandbox)
        assert.equal(fs.existsSync(sandbox.consumedMarker), true)
        assert.equal(fs.existsSync(sandbox.runningMarker), false)
      }
    })
  }
})

test('timezone rollback signal trap releases its owner and mutex', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  injectRecoveryPauseAfter(sandbox, 'claim_running_owner || exit 1\n')
  const rollback = runPosixShellAsync([
    buildConfirmedShellPrelude(sandbox, { pauseRecovery: true }),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'))
  t.after(() => {
    if (fs.existsSync(sandbox.root) &&
      !fs.existsSync(sandbox.recoveryRelease)) {
      fs.writeFileSync(sandbox.recoveryRelease, '')
    }
    rollback.child.kill('SIGTERM')
  })

  await waitForPath(sandbox.recoveryReady, 15000)
  const rollbackPid = fs.readFileSync(sandbox.runningMarker, 'utf8')
    .split('\n')[0]
  assert.match(rollbackPid, /^[0-9]+$/)
  runPosixShell('kill -TERM ' + rollbackPid)
  fs.writeFileSync(sandbox.recoveryRelease, '')
  const result = await rollback.completion
  assert.notEqual(result.status, 0)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.flockState), false)
  assert.equal(fs.existsSync(sandbox.consumedMarker), false)
  assert.equal(
    fs.readFileSync(sandbox.timezone, 'utf8'),
    testCase.values['\u65b0\u65f6\u533a'] + '\n'
  )

  const retry = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'), undefined)
  assert.equal(retry.status, 0, retry.stderr || retry.stdout)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
})

test('timezone rollback reconciles a consumed restore after response loss', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  injectRecoveryPauseAfter(sandbox, 'create_consumed_marker || exit 1\n')

  const first = runPosixShellAsync([
    buildConfirmedShellPrelude(sandbox, { pauseRecovery: true }),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'))
  t.after(() => {
    if (fs.existsSync(sandbox.root) &&
      !fs.existsSync(sandbox.recoveryRelease)) {
      fs.writeFileSync(sandbox.recoveryRelease, '')
    }
    first.child.kill('SIGTERM')
  })

  await waitForPath(sandbox.recoveryReady, 15000)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
  const rollbackPid = fs.readFileSync(sandbox.runningMarker, 'utf8')
    .split('\n')[0]
  runPosixShell('kill -TERM ' + rollbackPid)
  fs.writeFileSync(sandbox.recoveryRelease, '')
  const interrupted = await first.completion
  assert.notEqual(interrupted.status, 0)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.flockState), false)

  const mutations = fs.readFileSync(sandbox.mutationLog, 'utf8')
  assert.equal(mutations.split('\n').filter(line => line === 'timezone:UTC').length, 1)
  for (const attempt of ['second retry', 'third retry']) {
    const reconciled = runPosixShell([
      buildConfirmedShellPrelude(sandbox),
      'sh -- ' + shellLiteral(sandbox.rollbackScript)
    ].join('\n'), undefined)
    assert.equal(reconciled.status, 0, attempt + ': ' + (reconciled.stderr || reconciled.stdout))
    assert.match(reconciled.stdout + reconciled.stderr, /\u5df2.*\u6062.*\u590d.*\u5df2.*\u8c03.*\u548c/)
    assert.equal(fs.readFileSync(sandbox.mutationLog, 'utf8'), mutations)
  }

  fs.writeFileSync(sandbox.timezone, testCase.values['\u65b0\u65f6\u533a'] + '\n')
  const unknown = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'), undefined)
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stdout + unknown.stderr, /\u9a8c.*\u8bc1.*\u5931.*\u8d25|\u65e0.*\u6cd5.*\u8c03.*\u548c/)
  assert.equal(fs.readFileSync(sandbox.mutationLog, 'utf8'), mutations)
})

test('timezone rollback releases its mutex when consumed publication fails', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  const rollback = 'sh -- ' + shellLiteral(sandbox.rollbackScript)
  const failed = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failConsumed: true }),
    rollback
  ].join('\n'), undefined)
  assert.notEqual(failed.status, 0)
  assert.equal(fs.existsSync(sandbox.consumedMarker), false)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.flockState), false)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    rollback
  ].join('\n'))
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
})

test('timezone rollback resolves sudo from its current execution identity', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'timezone')
  const cases = [
    { name: 'sudo missing', install: false, authorizationFails: false, succeeds: false },
    { name: 'sudo authorization fails', install: true, authorizationFails: true, succeeds: false },
    { name: 'sudo succeeds', install: true, authorizationFails: false, succeeds: true }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, child => {
      const sandbox = createShellSandbox(child)
      runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        renderConfirmedTask6Command(runtime, testCase, sandbox)
      ].join('\n'))
      setSandboxUid(sandbox, 1000)
      if (fixture.install) {
        installSandboxSudo(sandbox, {
          failAuthorization: fixture.authorizationFails
        })
      }

      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        'sh -- ' + shellLiteral(sandbox.rollbackScript)
      ].join('\n'), undefined)
      if (fixture.succeeds) {
        assert.equal(result.status, 0, result.stderr || result.stdout)
        assertOriginalTask6State(sandbox)
        const sudoLog = fs.readFileSync(sandbox.sudoLog, 'utf8')
        assert.match(sudoLog, /sudo\t-v/)
        assert.match(sudoLog, /sudo\ttimedatectl\tset-timezone\tUTC/)
      } else {
        assert.notEqual(result.status, 0)
        assert.match(result.stdout + result.stderr, /sudo/)
        assert.equal(fs.existsSync(sandbox.consumedMarker), false)
        assert.equal(fs.existsSync(sandbox.runningMarker), false)
        assert.equal(
          fs.readFileSync(sandbox.timezone, 'utf8'),
          testCase.values['\u65b0\u65f6\u533a'] + '\n'
        )
      }
    })
  }
})

test('hostname asset cleanup preserves files owned by a concurrent publisher', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const cases = [
    {
      name: 'another publisher wins the first link',
      options: { concurrentPair: true },
      expectedRollback: 'foreign rollback\n',
      expectedVerifier: 'foreign verifier\n'
    },
    {
      name: 'the published rollback is replaced before verifier failure',
      options: { replaceRollback: true },
      expectedRollback: 'foreign replacement\n',
      expectedVerifier: null
    },
    {
      name: 'the first link succeeds but reports failure',
      options: { publishThenFail: true },
      expectedRollback: null,
      expectedVerifier: null
    }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, child => {
      const sandbox = createShellSandbox(child)
      const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox, fixture.options),
        command
      ].join('\n'), undefined)

      assert.notEqual(result.status, 0)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      if (fixture.expectedRollback === null) {
        assert.equal(fs.existsSync(sandbox.rollbackScript), false)
      } else {
        assert.equal(
          fs.readFileSync(sandbox.rollbackScript, 'utf8'),
          fixture.expectedRollback
        )
      }
      if (fixture.expectedVerifier === null) {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
      } else {
        assert.equal(
          fs.readFileSync(sandbox.verifierScript, 'utf8'),
          fixture.expectedVerifier
        )
      }
    })
  }
})

test('hostname mutation rejects every pre-existing recovery marker', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const markers = [
    ['consumed marker', 'consumedMarker', 'directory'],
    ['running owner', 'runningMarker', 'file'],
    ['running lock', 'runningLock', 'file']
  ]

  for (const [name, property, type] of markers) {
    await t.test(name, child => {
      const sandbox = createShellSandbox(child)
      fs.mkdirSync(sandbox.rollbackDirectory)
      if (type === 'directory') {
        fs.mkdirSync(sandbox[property])
      } else {
        fs.writeFileSync(sandbox[property], 'pre-existing\n')
      }
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        renderConfirmedTask6Command(runtime, testCase, sandbox)
      ].join('\n'), undefined)

      assert.notEqual(result.status, 0)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.mutationLog), false)
      assert.equal(fs.existsSync(sandbox[property]), true)
      assert.equal(fs.existsSync(sandbox.rollbackScript), false)
      assert.equal(fs.existsSync(sandbox.verifierScript), false)
    })
  }
})

test('hostname rollback reclaims a stale running owner and lock', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  fs.writeFileSync(sandbox.runningLock, 'stale lock inode\n')
  fs.writeFileSync(sandbox.runningMarker, '999999\nstale-start\n')

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'))

  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.runningLock), false)
})

test('hostname rollback uses proc identity before optional ps fallback', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const cases = [
    { name: 'readable proc without ps', current: true, withoutPs: true },
    { name: 'missing proc with ps fallback', current: false, withoutPs: false }
  ]

  for (const fixture of cases) {
    await t.test(fixture.name, child => {
      const sandbox = createShellSandbox(child)
      runPosixShell([
        buildConfirmedShellPrelude(sandbox),
        renderConfirmedTask6Command(runtime, testCase, sandbox)
      ].join('\n'))
      configureRecoveryProcFixture(sandbox, {
        exists: false,
        current: fixture.current
      })
      const recoveryPrelude = [buildConfirmedShellPrelude(sandbox)]
      if (fixture.withoutPs) {
        fs.rmSync(path.join(
          sandbox.commandDirectory.replaceAll('/', path.sep),
          'ps'
        ))
        for (const [name, target] of [
          ['awk', '/usr/bin/awk'],
          ['cat', '/usr/bin/cat'],
          ['cmp', '/usr/bin/cmp'],
          ['rm', '/usr/bin/rm'],
          ['rmdir', '/usr/bin/rmdir'],
          ['sh', '/bin/sh']
        ]) {
          writeSandboxCommand(sandbox, name, `#!/bin/sh\nexec ${target} "$@"\n`)
        }
        recoveryPrelude.push(
          'PATH=' + shellLiteral(toPosixSearchPath(sandbox.commandDirectory)),
          'export PATH'
        )
      }
      recoveryPrelude.push(
        (fixture.withoutPs ? '/bin/sh' : 'sh') +
          ' -- ' + shellLiteral(sandbox.rollbackScript)
      )

      const result = runPosixShell(recoveryPrelude.join('\n'), undefined)
      assert.equal(result.status, 0, result.stderr || result.stdout)
      assertOriginalTask6State(sandbox)
      assert.equal(fs.existsSync(sandbox.consumedMarker), true)
    })
  }
})

test('hostname rollback rejects a live concurrent recovery', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  const mutationBeforeRecovery = fs.readFileSync(sandbox.mutationLog, 'utf8')
  const first = runPosixShellAsync([
    buildConfirmedShellPrelude(sandbox, { pauseRecovery: true }),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'))
  let firstResult

  try {
    await waitForPath(sandbox.recoveryReady)
    assert.equal(fs.existsSync(sandbox.runningMarker), true)
    assert.equal(fs.existsSync(sandbox.consumedMarker), false)
    const concurrent = runPosixShell([
      buildConfirmedShellPrelude(sandbox),
      'sh -- ' + shellLiteral(sandbox.rollbackScript)
    ].join('\n'), undefined)
    assert.notEqual(concurrent.status, 0)
    assert.equal(
      fs.readFileSync(sandbox.mutationLog, 'utf8'),
      mutationBeforeRecovery
    )
  } finally {
    fs.writeFileSync(sandbox.recoveryRelease, '')
    firstResult = await first.completion
  }

  assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout)
  assert.equal(firstResult.signal, null)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.runningLock), false)
})

test('hostname rollback retries idempotently after a partial restore failure', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    command
  ].join('\n'))

  const rollback = shellLiteral(sandbox.rollbackScript)
  const operationName = fs.readdirSync(sandbox.rollbackDirectory)
    .find(name => name.startsWith('operation.'))
  assert.ok(operationName)
  const hostsBackup = toPosixPath(path.join(
    sandbox.rollbackDirectory,
    operationName,
    'target-1'
  ))
  fs.writeFileSync(sandbox.recoveryLog, '')
  const failed = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failRecoveryStep: 'chmod' }),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.notEqual(failed.status, 0)
  assert.equal(fs.existsSync(sandbox.consumedMarker), false)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.runningLock), false)
  assert.deepEqual(
    fs.readFileSync(sandbox.recoveryLog, 'utf8').trimEnd().split('\n'),
    [
      ['cp', '--', hostsBackup, sandbox.hosts].join('\t'),
      ['chown', '0:0', '--', sandbox.hosts].join('\t'),
      ['chmod', '644', '--', sandbox.hosts].join('\t')
    ]
  )

  fs.writeFileSync(sandbox.recoveryLog, '')
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
  const recoveryCalls = fs.readFileSync(sandbox.recoveryLog, 'utf8')
    .trimEnd()
    .split('\n')
  assert.deepEqual(recoveryCalls.map(line => line.split('\t')[0]), [
    'cp',
    'chown',
    'chmod'
  ])
  assert.deepEqual(recoveryCalls.map(line => line.split('\t').slice(1)), [
    ['--', hostsBackup, sandbox.hosts],
    ['0:0', '--', sandbox.hosts],
    ['644', '--', sandbox.hosts]
  ])
  assertOriginalTask6State(sandbox)
})

test('hostname rollback consumes only after its verifier succeeds', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'))
  const rollback = shellLiteral(sandbox.rollbackScript)
  const failed = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'HOSTS_MODE_OVERRIDE=600 sh -- ' + rollback
  ].join('\n'), undefined)

  assert.notEqual(failed.status, 0)
  assert.equal(fs.existsSync(sandbox.consumedMarker), false)
  assert.equal(fs.existsSync(sandbox.runningMarker), false)
  assert.equal(fs.existsSync(sandbox.runningLock), false)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assert.equal(fs.existsSync(sandbox.consumedMarker), true)
  const consumed = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.notEqual(consumed.status, 0)
  assertOriginalTask6State(sandbox)
})

test('hostname verifier ignores hosts when no hosts backup was requested', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const baseCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const testCase = {
    ...baseCase,
    values: { ...baseCase.values, \u540c\u6b65Hosts: 'no' }
  }
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    command
  ].join('\n'))

  const verifier = shellLiteral(sandbox.verifierScript)
  const beforeRollback = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'), undefined)
  assert.notEqual(beforeRollback.status, 0)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.rollbackScript)
  ].join('\n'))
  fs.writeFileSync(sandbox.hosts, originalHostsFixture + '# ignored tamper\n')
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'))
  fs.writeFileSync(sandbox.hosts, originalHostsFixture)
  assertOriginalTask6State(sandbox)
})

test('Task 6 rejects a symlink rollback directory before mutation', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const sandbox = createShellSandbox(t)
  const target = sandbox.rollbackDirectory + '-target'
  fs.mkdirSync(target)
  fs.symlinkSync(
    target,
    sandbox.rollbackDirectory,
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  assert.equal(fs.lstatSync(sandbox.rollbackDirectory).isSymbolicLink(), true)

  const testCase = confirmedCommandCases[0]
  const result = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    renderConfirmedTask6Command(runtime, testCase, sandbox)
  ].join('\n'), undefined)

  assert.notEqual(result.status, 0)
  assertOriginalTask6State(sandbox)
  assert.equal(fs.existsSync(sandbox.mutationLog), false)
  assert.equal(fs.existsSync(sandbox.rollbackScript), false)
})

test('verification failures retain a usable rollback path for every Task 6 command', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  for (const testCase of confirmedCommandCases) {
    await t.test(testCase.id, child => {
      const sandbox = createShellSandbox(child)
      const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
      const result = runPosixShell([
        buildConfirmedShellPrelude(sandbox, {
          verifyFailure: testCase.state,
          expectedIp: testCase.values['IP\u5730\u5740'],
          expectedHost: testCase.values['\u4e3b\u673a\u540d']
        }),
        command
      ].join('\n'), undefined)

      assert.notEqual(result.status, 0)
      assert.equal(fs.existsSync(sandbox.rollbackScript), true)
      assert.ok(result.stdout.includes(sandbox.rollbackScript))
      assert.equal(fs.existsSync(sandbox.mutationLog), true)

      if (testCase.state === 'hostname') {
        runHostnameOneShotRecovery(sandbox)
      } else if (testCase.state === 'timezone') {
        runTimezoneOneShotRecovery(sandbox)
      } else {
        runTask6RollbackTwice(sandbox)
      }
      assertOriginalTask6State(sandbox)
    })
  }
})
