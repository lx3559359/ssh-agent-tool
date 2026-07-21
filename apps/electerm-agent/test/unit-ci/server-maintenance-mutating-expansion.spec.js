const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
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
    rollbackDirectory: toPosixPath(path.join(root, 'rollback')),
    commandDirectory: toPosixPath(path.join(root, 'bin'))
  }
  result.rollbackScript = result.rollbackDirectory + '/task6-test-1700000000000.sh'
  result.verifierScript = result.rollbackDirectory + '/task6-test-1700000000000.verify.sh'
  fs.writeFileSync(result.hosts, '127.0.0.1 localhost\n192.0.2.10 old.example.com\n')
  fs.writeFileSync(result.hostname, 'old-host.example.com\n')
  fs.writeFileSync(result.timezone, 'UTC\n')
  fs.mkdirSync(result.commandDirectory)
  const commands = {
    hostnamectl: `#!/bin/sh
case "$1" in
  --static) cat "$HOSTNAME_STATE" ;;
  set-hostname)
    [ "$FAIL_RECOVERY" != "yes" ] || exit 1
    printf "hostname:%s\\n" "$2" >> "$MUTATION_LOG"
    printf "%s\\n" "$2" > "$HOSTNAME_STATE"
    ;;
  *) exit 2 ;;
esac
`,
    id: '#!/bin/sh\n[ "$1" = "-u" ] && { printf "0\\n"; exit 0; }\nexec /usr/bin/id "$@"\n',
    stat: `#!/bin/sh
format=""
if [ "$1" = "-c" ]; then format="$2"; shift 2; fi
[ "$1" != "--" ] || shift
case "$format" in
  %u) [ -n "$HOSTS_UID_OVERRIDE" ] && printf "%s\\n" "$HOSTS_UID_OVERRIDE" || printf "0\\n" ;;
  %g) [ -n "$HOSTS_GID_OVERRIDE" ] && printf "%s\\n" "$HOSTS_GID_OVERRIDE" || printf "0\\n" ;;
  %a) [ -n "$HOSTS_MODE_OVERRIDE" ] && printf "%s\\n" "$HOSTS_MODE_OVERRIDE" || printf "644\\n" ;;
  *) exec /usr/bin/stat -c "$format" -- "$1" ;;
esac
`,
    chown: '#!/bin/sh\nexit 0\n',
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

function snapshotTree (root) {
  const entries = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        entries.push([relative, 'directory'])
        visit(absolute)
      } else {
        entries.push([relative, 'file', fs.readFileSync(absolute).toString('base64')])
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
      if (testCase.id === 'builtin-server-hostname-change') {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
      }
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
    'FAIL_RECOVERY=' + shellLiteral(options.failRecovery ? 'yes' : 'no'),
    'VERIFY_FAILURE=' + shellLiteral(verifyFailure),
    'EXPECTED_IP=' + shellLiteral(expectedIp),
    'EXPECTED_HOST=' + shellLiteral(expectedHost),
    'export PATH HOSTNAME_STATE TIMEZONE_STATE MUTATION_LOG FAIL_RECOVERY',
    'COMMENT_ONLY_HOSTS_AFTER_INSTALL=' + shellLiteral(options.commentOnlyHostsAfterInstall ? 'yes' : 'no'),
    'CASE_FOLD_HOSTS_AFTER_INSTALL=' + shellLiteral(options.caseFoldHostsAfterInstall ? 'yes' : 'no'),
    'stat () {',
    '  format=""',
    '  if [ "$1" = "-c" ]; then format="$2"; shift 2; fi',
    '  if [ "$1" = "--" ]; then shift; fi',
    '  target="$1"',
    '  case "$format" in',
    '    %u|%g) printf "0\\n" ;;',
    '    %a)',
    '      case "$target" in',
    '        "$ROLLBACK_ROOT"/operation.*/*) printf "644\\n" ;;',
    '        "$ROLLBACK_ROOT"|"$ROLLBACK_ROOT"/operation.*|"$ROLLBACK_ROOT"/*.sh) printf "700\\n" ;;',
    '        *) printf "644\\n" ;;',
    '      esac',
    '      ;;',
    '    *) command stat -c "$format" -- "$target" ;;',
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
    '    case "$destination" in *.state) return 1 ;; esac',
    '  fi',
    '  command chmod "$@"',
    '}',
    'chown () { :; }',
    'ln () {',
    '  destination=""',
    '  for argument in "$@"; do destination="$argument"; done',
    '  if [ "$FAIL_ROLLBACK" = "yes" ]; then return 1; fi',
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

function listHostnameRecoveryAssets (sandbox) {
  const root = sandbox.rollbackDirectory.replaceAll('/', path.sep)
  if (!fs.existsSync(root)) return []
  return snapshotTree(root)
    .map(entry => entry[0])
    .filter(relative => {
      return /hostname-(?:rollback|verify)\./.test(relative) ||
        /task6-test-1700000000000(?:\.verify)?\.sh$/.test(relative)
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

function runHostnameOneShotRecovery (sandbox) {
  const rollback = shellLiteral(sandbox.rollbackScript)
  const verifier = shellLiteral(sandbox.verifierScript)
  const beforeRollback = runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'), undefined)
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

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + verifier
  ].join('\n'))

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
      } else {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
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
      if (testCase.state === 'hostname') {
        assert.equal(fs.existsSync(sandbox.verifierScript), false)
        assert.deepEqual(listHostnameRecoveryAssets(sandbox), [])
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
  assert.deepEqual(listHostnameRecoveryAssets(sandbox), [])
})
test('hostname rollback releases its consumed lock after failure and can retry', async t => {
  const runtime = await loadConfirmedTask6Runtime()
  const testCase = confirmedCommandCases.find(testCase => testCase.state === 'hostname')
  const sandbox = createShellSandbox(t)
  const command = renderConfirmedTask6Command(runtime, testCase, sandbox)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    command
  ].join('\n'))

  const rollback = shellLiteral(sandbox.rollbackScript)
  const failed = runPosixShell([
    buildConfirmedShellPrelude(sandbox, { failRecovery: true }),
    'sh -- ' + rollback
  ].join('\n'), undefined)
  assert.notEqual(failed.status, 0)
  assert.equal(fs.existsSync(sandbox.rollbackScript + '.consumed'), false)
  assertConfirmedTask6Mutation(sandbox, testCase)

  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + rollback
  ].join('\n'))
  assert.equal(fs.existsSync(sandbox.rollbackScript + '.consumed'), true)
  runPosixShell([
    buildConfirmedShellPrelude(sandbox),
    'sh -- ' + shellLiteral(sandbox.verifierScript)
  ].join('\n'))
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
      } else {
        runTask6RollbackTwice(sandbox)
      }
      assertOriginalTask6State(sandbox)
    })
  }
})
