const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/index.js')
).href
const classifierUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/safety-transactions/command-classifier.js')
).href

function loadQuickCommandInstaller (runSafetyCommandSequence) {
  const sourcePath = path.resolve(__dirname, '../../src/client/store/quick-command.js')
  const ast = parser.parse(fs.readFileSync(sourcePath, 'utf8'), {
    sourceType: 'module'
  })

  const importExpression = (source, property) => {
    const imported = t.callExpression(t.identifier('__import'), [
      t.stringLiteral(source)
    ])
    return property
      ? t.memberExpression(imported, t.identifier(property))
      : imported
  }

  traverse(ast, {
    ImportDeclaration (modulePath) {
      const source = modulePath.node.source.value
      const declarations = modulePath.node.specifiers.map(specifier => {
        let value
        if (t.isImportDefaultSpecifier(specifier)) {
          value = importExpression(source, 'default')
        } else if (t.isImportNamespaceSpecifier(specifier)) {
          value = importExpression(source)
        } else {
          value = importExpression(source, specifier.imported.name)
        }
        return t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(specifier.local.name), value)
        ])
      })
      modulePath.replaceWithMultiple(declarations)
    },
    ExportDefaultDeclaration (exportPath) {
      exportPath.replaceWith(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('module'), t.identifier('exports')),
            t.toExpression(exportPath.node.declaration)
          )
        )
      )
    }
  })

  const imports = {
    '../common/constants': {
      settingMap: { quickCommands: 'quickCommands' },
      qmSortByFrequencyKey: 'qmSortByFrequency',
      isWin: true
    },
    '../common/wait': { default: async () => {} },
    '../common/uid': { default: () => 'generated-id' },
    '../common/safe-local-storage': {},
    'lodash-es': { debounce: callback => callback },
    '../components/common/ref': { refs: { get: () => null } },
    '../components/quick-commands/templates': { default: [] },
    '../common/clipboard': { readClipboardAsync: async () => '' },
    '../common/safety-transactions/command-orchestration.js': {
      runSafetyCommandBatch: async () => [],
      runSafetyCommandSequence
    }
  }
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    __import: source => imports[source],
    window: {},
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(generate(ast).code, context, { filename: sourcePath })
  return { install: module.exports, window: context.window }
}

function commandText (command) {
  return command.commands.map(item => item.command).join('\n')
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
    if (!probe.error && probe.status === 0) {
      return candidate
    }
  }
  throw new Error('No POSIX sh implementation is available for storage command tests')
}

const posixShellExecutable = resolvePosixShell()
const posixShellEnv = { ...process.env }
const posixPathKey = Object.keys(posixShellEnv)
  .find(key => key.toLowerCase() === 'path') || 'PATH'
posixShellEnv[posixPathKey] = [
  path.dirname(posixShellExecutable),
  posixShellEnv[posixPathKey]
].filter(Boolean).join(path.delimiter)

function runPosixShell (script, options = {}) {
  const result = spawnSync(
    posixShellExecutable,
    ['-c', script],
    {
      encoding: 'utf8',
      env: posixShellEnv,
      timeout: options.timeout || 5000,
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, String(result.signal) + ': ' + result.stderr)
  assert.equal(result.status, 0, result.stderr)
  return result
}

function buildBoundedStorageDiagnosticCommand (primaryCommand, fallbackCommand) {
  return `(
  run_storage_primary () {
    "$@" &
    primary_pid=$!
    (
      sleep 15
      kill -KILL "$primary_pid" 2>/dev/null
    ) >/dev/null 2>&1 &
    timer_pid=$!
    wait "$primary_pid"
    primary_status=$?
    kill -KILL "$timer_pid" 2>/dev/null || true
    wait "$timer_pid" 2>/dev/null || true
    return "$primary_status"
  }

  if {
    run_storage_primary ${primaryCommand}
    printf '\\036SHELLPILOT_STORAGE_STATUS=%s\\n' "$?"
  } | awk '
    BEGIN {
      limit = 200
      marker = sprintf("%c", 30) "SHELLPILOT_STORAGE_STATUS="
    }
    {
      marker_position = index($0, marker)
      if (marker_position > 0) {
        prefix = substr($0, 1, marker_position - 1)
        if (length(prefix) > 0 && emitted < limit) {
          print prefix
          emitted++
        }
        primary_status = substr($0, marker_position + length(marker))
        status_seen = 1
        next
      }
      if (emitted < limit) {
        print
        emitted++
        next
      }
      truncated = 1
      exit
    }
    END {
      if (truncated || (status_seen && primary_status == 0)) {
        exit 0
      }
      exit 1
    }
  '; then
    true
  else
${fallbackCommand}
  fi
)
true`
}

const diskIoDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'iostat -xz 1 3 2>/dev/null',
  '    vmstat 1 4 2>/dev/null | head -n 20 || true\n' +
    '    head -n 200 /proc/diskstats 2>/dev/null || true'
)

const inodeMountDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null',
  '    head -n 200 /proc/mounts 2>/dev/null || true'
)

const deletedOpenFilesDiagnosticCommand = buildBoundedStorageDiagnosticCommand(
  'lsof +L1 2>/dev/null',
  "    find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true"
)

test('system readonly commands cover CPU, kernel, boot and scheduled task diagnostics', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const commands = getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const ids = [
    'builtin-server-cpu-pressure',
    'builtin-server-kernel-errors',
    'builtin-server-boot-history',
    'builtin-server-scheduled-tasks'
  ]

  for (const id of ids) {
    const command = byId.get(id)
    assert.ok(command, `missing ${id}`)
    assert.ok(command.labels.includes('只读'), `${id} should be readonly`)
    assert.equal(command.mutatesServer, undefined, `${id} must not mutate the server`)
    assert.match(command.name, /[\u4e00-\u9fff]/, `${id} name should be Chinese`)
    assert.match(command.description, /[\u4e00-\u9fff]/, `${id} description should be Chinese`)
    assert.match(command.usage, /[\u4e00-\u9fff]/, `${id} usage should be Chinese`)
  }

  const cpuText = commandText(byId.get('builtin-server-cpu-pressure'))
  assert.match(cpuText, /uptime/)
  assert.match(cpuText, /mpstat -P ALL 1 3/)
  assert.match(cpuText, /vmstat 1 4/)
  assert.match(cpuText, /\/proc\/pressure\/cpu/)
  assert.match(cpuText, /\/proc\/pressure\/io/)
  assert.match(cpuText, /\/proc\/pressure\/memory/)

  const kernelText = commandText(byId.get('builtin-server-kernel-errors'))
  assert.match(kernelText, /journalctl -k -p warning\.\.alert --since '-24 hours'/)
  assert.match(kernelText, /dmesg -T/)

  const bootText = commandText(byId.get('builtin-server-boot-history'))
  assert.match(bootText, /last -x -n 30/)
  assert.match(bootText, /journalctl --list-boots/)

  const scheduledText = commandText(byId.get('builtin-server-scheduled-tasks'))
  assert.match(scheduledText, /systemctl list-timers --all --no-pager/)
  assert.match(scheduledText, /crontab -l/)
  assert.match(scheduledText, /\/etc\/cron\.\*/)
})

test('system readonly commands stay best-effort bounded and classifier-safe', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const commands = registry.getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const ids = [
    'builtin-server-cpu-pressure',
    'builtin-server-kernel-errors',
    'builtin-server-boot-history',
    'builtin-server-scheduled-tasks'
  ]

  for (const id of ids) {
    const command = byId.get(id)
    for (const item of command.commands) {
      const classification = classifier.classifyCommand(item.command)
      assert.equal(classification.risk, 'readonly', `${id}: ${item.command}`)
      assert.equal(classification.requiresConfirmation, false, `${id}: ${item.command}`)
      assert.doesNotMatch(item.command, /\b(?:less|more|watch)\b|--follow/)
    }
  }

  const cpu = byId.get('builtin-server-cpu-pressure')
  const cpuSampleIndex = cpu.commands.findIndex(item => item.command.includes('mpstat -P ALL 1 3'))
  const cpuPressureIndex = cpu.commands.findIndex(item => item.command.includes('/proc/pressure/cpu'))
  assert.ok(cpuSampleIndex >= 0 && cpuSampleIndex < cpuPressureIndex)
  assert.match(cpu.commands[cpuSampleIndex].command, /mpstat -P ALL 1 3 \|\| vmstat 1 4 \|\| true$/)
  for (const pressurePath of ['/proc/pressure/cpu', '/proc/pressure/io', '/proc/pressure/memory']) {
    const pressureStep = cpu.commands.find(item => item.command.includes(pressurePath))
    assert.match(pressureStep.command, /\|\| true$/)
  }

  const kernelText = commandText(byId.get('builtin-server-kernel-errors'))
  assert.match(kernelText, /journalctl[\s\S]*-n 200 --no-pager/)
  assert.match(kernelText, /dmesg -T \| (?:head|tail) -n 200/)
  assert.match(kernelText, /\|\| true$/)

  const boot = byId.get('builtin-server-boot-history')
  assert.match(boot.commands[0].command, /last -x -n 30 \|\| true$/)
  assert.match(boot.commands[1].command, /journalctl --list-boots --no-pager \| tail -n 30 \|\| true$/)

  const scheduled = byId.get('builtin-server-scheduled-tasks')
  for (const item of scheduled.commands) {
    assert.match(item.command, /\| head -n 200 \|\| true$/)
  }
})

test('storage readonly commands cover disk I/O, inode mounts and deleted open files', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const commands = getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const ids = [
    'builtin-server-disk-io',
    'builtin-server-inode-mount',
    'builtin-server-deleted-open-files'
  ]

  for (const id of ids) {
    const command = byId.get(id)
    assert.ok(command, `missing ${id}`)
    assert.ok(command.labels.includes('\u53ea\u8bfb'), `${id} should be readonly`)
    assert.equal(command.mutatesServer, undefined, `${id} must not mutate the server`)
    assert.match(command.name, /[\u4e00-\u9fff]/, `${id} name should be Chinese`)
    assert.match(command.description, /[\u4e00-\u9fff]/, `${id} description should be Chinese`)
    assert.match(command.usage, /[\u4e00-\u9fff]/, `${id} usage should be Chinese`)
  }

  const disk = byId.get('builtin-server-disk-io')
  assert.deepEqual(disk.commands.map(item => item.command), [diskIoDiagnosticCommand])

  const inode = byId.get('builtin-server-inode-mount')
  assert.deepEqual(inode.commands.map(item => item.command), [
    'df -iP | head -n 200 || true',
    inodeMountDiagnosticCommand
  ])

  const deleted = byId.get('builtin-server-deleted-open-files')
  assert.deepEqual(deleted.commands.map(item => item.command), [deletedOpenFilesDiagnosticCommand])
})

test('storage readonly commands stay best-effort bounded and classifier-safe', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const commands = registry.getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const ids = [
    'builtin-server-disk-io',
    'builtin-server-inode-mount',
    'builtin-server-deleted-open-files'
  ]

  for (const id of ids) {
    const command = byId.get(id)
    assert.ok(command, `missing ${id}`)
    for (const item of command.commands) {
      const classification = classifier.classifyCommand(item.command)
      assert.equal(classification.risk, 'readonly', `${id}: ${item.command}`)
      assert.equal(classification.requiresConfirmation, false, `${id}: ${item.command}`)
      assert.match(item.command, /\bhead -n (?:20|200)\b/)
      assert.ok(item.command.endsWith('|| true') || item.command.endsWith('\ntrue'))
      assert.doesNotMatch(item.command, /\b(?:less|more|watch)\b|--follow/)
    }
  }
})

test('storage readonly fallbacks follow bounded POSIX pipeline status', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const commands = getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const cases = [
    {
      id: 'builtin-server-disk-io',
      primary: 'iostat -xz 1 3',
      fallbacks: ['vmstat 1 4', '/proc/diskstats']
    },
    {
      id: 'builtin-server-inode-mount',
      primary: 'findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS',
      fallbacks: ['/proc/mounts']
    },
    {
      id: 'builtin-server-deleted-open-files',
      primary: 'lsof +L1',
      fallbacks: ['/proc/[0-9]*/fd']
    }
  ]

  for (const item of cases) {
    const conditional = byId.get(item.id).commands.at(-1).command
    const primaryInvocation = `run_storage_primary ${item.primary} 2>/dev/null`
    const branches = conditional.split('\n  else\n')
    assert.equal(branches.length, 2, `${item.id} should use an if/else fallback`)
    const [successBranch, failedRemainder] = branches
    const failedParts = failedRemainder.split('\n  fi\n')
    assert.equal(failedParts.length, 2, `${item.id} should close its fallback branch`)
    const [failureBranch, cleanup] = failedParts

    assert.ok(successBranch.startsWith('(\n  run_storage_primary () {'))
    assert.ok(successBranch.includes(primaryInvocation), item.id)
    assert.ok(
      conditional.indexOf(primaryInvocation) < conditional.indexOf("} | awk '"),
      `${item.id} must stream the primary output into awk`
    )
    assert.match(conditional, /sleep 15/)
    assert.match(conditional, /kill -KILL "\$primary_pid"/)
    assert.match(conditional, /kill -KILL "\$timer_pid"/)
    assert.match(conditional, /limit = 200/)
    assert.match(conditional, /SHELLPILOT_STORAGE_STATUS/)
    assert.doesNotMatch(conditional, /PIPESTATUS|\$\{|\$\(|<\(|\btrap\b/)
    const shellRedirections = conditional.match(/\d*>[^\s;]+/g) || []
    assert.ok(shellRedirections.length > 0)
    for (const redirection of shellRedirections) {
      assert.ok(
        ['2>/dev/null', '>/dev/null', '2>&1'].includes(redirection),
        `${item.id} has an unsafe redirection: ${redirection}`
      )
    }
    assert.doesNotMatch(conditional, /\/tmp\/|\bmktemp\b/)
    for (const fallback of item.fallbacks) {
      assert.equal(successBranch.includes(fallback), false, `${fallback} leaked into success branch`)
      assert.ok(failureBranch.includes(fallback), `${fallback} missing from failure branch`)
    }
    assert.equal(cleanup, ')\ntrue')
  }
})

test('storage readonly POSIX sh execution handles success unavailable and failure branches', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const cases = [
    {
      id: 'builtin-server-disk-io',
      primary: '__PRIMARY_IOSTAT__',
      fallback: '__VMSTAT_FALLBACK__'
    },
    {
      id: 'builtin-server-inode-mount',
      primary: '__PRIMARY_FINDMNT__',
      fallback: '__MOUNTS_FALLBACK__'
    },
    {
      id: 'builtin-server-deleted-open-files',
      primary: '__PRIMARY_LSOF__',
      fallback: '__FIND_FALLBACK__'
    }
  ]
  const fakeTools = mode => [
    `PRIMARY_MODE=${mode}`,
    'iostat () {',
    '  case "$PRIMARY_MODE" in',
    '    missing) command __missing_storage_iostat__ ;;',
    "    failure) printf '__PRIMARY_IOSTAT__\\n'; return 7 ;;",
    "    *) printf '__PRIMARY_IOSTAT__\\n' ;;",
    '  esac',
    '}',
    'findmnt () {',
    '  case "$PRIMARY_MODE" in',
    '    missing) command __missing_storage_findmnt__ ;;',
    "    failure) printf '__PRIMARY_FINDMNT__\\n'; return 7 ;;",
    "    *) printf '__PRIMARY_FINDMNT__\\n' ;;",
    '  esac',
    '}',
    'lsof () {',
    '  case "$PRIMARY_MODE" in',
    '    missing) command __missing_storage_lsof__ ;;',
    "    failure) printf '__PRIMARY_LSOF__\\n'; return 7 ;;",
    "    *) printf '__PRIMARY_LSOF__\\n' ;;",
    '  esac',
    '}',
    "vmstat () { printf '__VMSTAT_FALLBACK__\\n'; }",
    "find () { printf '__FIND_FALLBACK__\\n'; }",
    'head () {',
    '  case "$3" in',
    "    /proc/diskstats) printf '__DISKSTATS_FALLBACK__\\n'; return 0 ;;",
    "    /proc/mounts) printf '__MOUNTS_FALLBACK__\\n'; return 0 ;;",
    '  esac',
    '  command head "$@"',
    '}'
  ].join('\n')

  for (const item of cases) {
    const command = byId.get(item.id).commands.at(-1).command
    const success = runPosixShell(`${fakeTools('success')}\n${command}`)
    assert.match(success.stdout, new RegExp(item.primary), item.id)
    assert.doesNotMatch(success.stdout, new RegExp(item.fallback), item.id)
    assert.doesNotMatch(success.stdout + success.stderr, /Bad substitution|syntax error/i)

    const unavailable = runPosixShell(`${fakeTools('missing')}\n${command}`)
    assert.doesNotMatch(unavailable.stdout, new RegExp(item.primary), item.id)
    assert.match(unavailable.stdout, new RegExp(item.fallback), item.id)
    assert.doesNotMatch(unavailable.stdout + unavailable.stderr, /Bad substitution|syntax error/i)

    const failure = runPosixShell(`${fakeTools('failure')}\n${command}`)
    assert.match(failure.stdout, new RegExp(item.primary), item.id)
    assert.match(failure.stdout, new RegExp(item.fallback), item.id)
    assert.doesNotMatch(failure.stdout + failure.stderr, /Bad substitution|syntax error/i)
  }
})

test('storage readonly POSIX pipeline stops an unbounded producer at 200 lines', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-deleted-open-files')
    .commands.at(-1).command
  const payload = 'x'.repeat(256)
  const prelude = [
    'lsof () {',
    '  count=0',
    `  payload='${payload}'`,
    '  while :; do',
    '    count=$((count + 1))',
    "    printf 'row-%s-%s\\n' \"$count\" \"$payload\"",
    '  done',
    '}',
    "find () { printf '__FIND_FALLBACK__\\n'; }"
  ].join('\n')
  const result = runPosixShell(`${prelude}\n${command}`, { timeout: 3000 })
  const outputLines = result.stdout.trimEnd().split('\n')

  assert.equal(outputLines.length, 200)
  assert.match(outputLines.at(-1), /^row-/)
  assert.doesNotMatch(result.stdout, /__FIND_FALLBACK__/)
  assert.doesNotMatch(result.stdout + result.stderr, /Bad substitution|syntax error/i)
})

test('Windows quick-command path keeps storage step order and readonly classification', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const ids = [
    'builtin-server-disk-io',
    'builtin-server-inode-mount',
    'builtin-server-deleted-open-files'
  ]
  const commands = registry.getServerMaintenanceQuickCommands()
    .filter(command => ids.includes(command.id))
    .sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id))
  const queued = []
  const sent = []
  const runSafetyCommandSequence = async (steps, { runStep }) => {
    const results = []
    for (const step of steps) {
      queued.push(step.command)
      results.push(await runStep(step))
    }
    return results
  }
  const { install, window } = loadQuickCommandInstaller(runSafetyCommandSequence)
  class Store {}
  install(Store)
  const store = new Store()
  store.currentQuickCommands = commands
  store.runSafetyCommand = async command => {
    sent.push(command)
    return classifier.classifyCommand(command)
  }
  window.store = store

  for (const id of ids) {
    await store.runQuickCommandItem(id)
  }

  const originalSteps = commands.flatMap(command => (
    command.commands.map(step => step.command)
  ))
  const windowsSteps = originalSteps.map(command => command.replace(/\n/g, '\n\r'))
  assert.deepEqual(queued, originalSteps)
  assert.deepEqual(sent, windowsSteps)
  assert.ok(sent.some(command => command.includes('\n\r')))
  for (const command of sent) {
    const classification = classifier.classifyCommand(command)
    assert.equal(classification.risk, 'readonly', command)
    assert.equal(classification.requiresConfirmation, false, command)
  }
})

test('network readonly commands cover link errors TCP states and route MTU diagnostics', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const ids = [
    'builtin-server-network-errors',
    'builtin-server-tcp-states',
    'builtin-server-route-mtu'
  ]

  for (const id of ids) {
    const command = byId.get(id)
    assert.ok(command, `missing ${id}`)
    assert.ok(command.labels.includes('\u53ea\u8bfb'), `${id} should be readonly`)
    assert.equal(command.mutatesServer, undefined, `${id} must not mutate the server`)
    assert.match(command.name, /[\u4e00-\u9fff]/, `${id} name should be Chinese`)
    assert.match(command.description, /[\u4e00-\u9fff]/, `${id} description should be Chinese`)
    assert.match(command.usage, /[\u4e00-\u9fff]/, `${id} usage should be Chinese`)
    assert.equal(command.commands.length, 1, `${id} should execute as one fixed diagnostic step`)
  }

  const errorsText = commandText(byId.get('builtin-server-network-errors'))
  assert.match(errorsText, /ip -s link/)
  assert.match(errorsText, /\/sys\/class\/net\/\*/)
  assert.match(errorsText, /operstate/)
  assert.match(errorsText, /command -v ethtool/)
  assert.match(errorsText, /Speed\|Duplex\|Link detected/)

  const tcpText = commandText(byId.get('builtin-server-tcp-states'))
  assert.match(tcpText, /ss -s/)
  assert.match(tcpText, /ss -tan/)
  assert.match(tcpText, /netstat -ant/)
  assert.ok(tcpText.indexOf('ss -tan') < tcpText.indexOf('netstat -ant'))

  const routeText = commandText(byId.get('builtin-server-route-mtu'))
  assert.match(routeText, /ip route show table all/)
  assert.match(routeText, /ip rule/)
  assert.match(routeText, /ip -details link/)
})

test('security readonly command covers bounded SSH authentication events and log fallback', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-ssh-security-events')

  assert.ok(command, 'missing builtin-server-ssh-security-events')
  assert.ok(command.labels.includes('\u53ea\u8bfb'))
  assert.equal(command.mutatesServer, undefined)
  assert.match(command.name, /[\u4e00-\u9fff]/)
  assert.match(command.description, /[\u4e00-\u9fff]/)
  assert.match(command.usage, /[\u4e00-\u9fff]/)
  assert.equal(command.commands.length, 1)

  const text = commandText(command)
  assert.match(text, /journalctl -u ssh -u sshd --since "-24 hours" --no-pager/)
  assert.match(text, /failed\|invalid\|accepted\|disconnect/)
  assert.match(text, /\/var\/log\/auth\.log/)
  assert.match(text, /\/var\/log\/secure/)
  assert.match(text, /limit = 200/)
  assert.match(text, /\u672a\u627e\u5230\u53ef\u8bfb\u7684 SSH \u5b89\u5168\u65e5\u5fd7/)
})

test('container readonly command covers bounded Docker health and storage diagnostics', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-docker-health-storage')

  assert.ok(command, 'missing builtin-server-docker-health-storage')
  assert.ok(command.labels.includes('\u53ea\u8bfb'))
  assert.equal(command.mutatesServer, undefined)
  assert.match(command.name, /[\u4e00-\u9fff]/)
  assert.match(command.description, /[\u4e00-\u9fff]/)
  assert.match(command.usage, /[\u4e00-\u9fff]/)
  assert.equal(command.commands.length, 1)

  const text = commandText(command)
  assert.match(text, /command -v docker/)
  assert.match(text, /\u672a\u68c0\u6d4b\u5230 Docker/)
  assert.match(text, /docker ps -a --format/)
  assert.match(text, /docker inspect --format/)
  assert.match(text, /\.State\.Health\.Status/)
  assert.match(text, /\.RestartCount/)
  assert.match(text, /docker system df/)
  assert.doesNotMatch(text, /docker inspect\s+"?\$?\w+"?(?:\s|$)/)
})

const task5ReadonlyIds = [
  'builtin-server-network-errors',
  'builtin-server-tcp-states',
  'builtin-server-route-mtu',
  'builtin-server-ssh-security-events',
  'builtin-server-docker-health-storage'
]

function replaceToolProbe (script, tool) {
  return script.replaceAll(
    'command -v ' + tool,
    'command -v __missing_task5_' + tool + '__'
  )
}

function outputLineCount (output, prefix) {
  return output.split(/\r?\n/).filter(line => line.startsWith(prefix)).length
}

test('Task 5 readonly scripts are bounded side-effect-free and exact-classifier-safe', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const byId = new Map(
    registry.getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )

  for (const id of task5ReadonlyIds) {
    const command = byId.get(id)
    assert.ok(command, 'missing ' + id)
    for (const item of command.commands) {
      const script = item.command
      const classification = classifier.classifyCommand(script)
      assert.equal(classification.risk, 'readonly', id + ': ' + classification.reason)
      assert.equal(classification.requiresConfirmation, false, id)
      assert.ok(script.endsWith('\ntrue'), id)
      assert.doesNotMatch(script, /\b(?:less|more|watch)\b|--follow/, id)
      assert.doesNotMatch(
        script,
        /\/tmp\/|\bmktemp\b|\b(?:tee|touch|mkdir|chmod|chown|rm|mv)\b/,
        id
      )
    }
  }

  const networkErrors = byId.get('builtin-server-network-errors').commands[0].command
  assert.match(networkErrors, /limit = 100/)
  assert.match(networkErrors, /interface_count.*-le 20/)
  assert.match(networkErrors, /matched >= 3/)

  const tcp = byId.get('builtin-server-tcp-states').commands[0].command
  assert.match(tcp, /limit = 40/)
  assert.match(tcp, /input_limit = 10000/)
  assert.match(tcp, /output_limit = 32/)
  assert.ok(tcp.indexOf('command -v ss') < tcp.indexOf('command -v netstat'))
  assert.match(tcp, /status_seen && command_status == 0/)

  const route = byId.get('builtin-server-route-mtu').commands[0].command
  assert.match(route, /run_bounded_ip_section 80 ip route show table all/)
  assert.match(route, /run_bounded_ip_section 40 ip rule/)
  assert.match(route, /run_bounded_ip_section 80 ip -details link/)

  const security = byId.get('builtin-server-ssh-security-events').commands[0].command
  assert.match(security, /status_seen && command_status == 0/)
  assert.match(security, /NR <= 200/)
  assert.doesNotMatch(security, /\|\s*(?:head|tail)\b/)

  const docker = byId.get('builtin-server-docker-health-storage').commands[0].command
  assert.match(docker, /run_bounded_docker_output 100 docker ps -a --format/)
  assert.match(docker, /docker ps -a --format '\{\{\.ID\}\}'[\s\S]*NR <= 20/)
  assert.match(
    docker,
    /NR <= 20[\s\S]*while IFS= read -r container_id[\s\S]*docker inspect --format[\s\S]*"\$container_id"/
  )
  assert.match(docker, /run_bounded_docker_output 50 docker system df/)
  assert.equal((docker.match(/docker inspect --format/g) || []).length, 1)
})

test('Task 5 classifier accepts exact CRLF and LFCR steps but rejects tampering', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const byId = new Map(
    registry.getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )

  for (const id of task5ReadonlyIds) {
    const script = byId.get(id).commands[0].command
    for (const accepted of [
      script,
      script.replace(/\n/g, '\r\n'),
      script.replace(/\n/g, '\n\r')
    ]) {
      assert.equal(classifier.classifyCommand(accepted).risk, 'readonly', id)
    }

    const bareCarriageReturn = script.replace('\n', '\r')
    const appended = script + '\nprintf "tampered\\n"'
    const rewritten = script.replace('SHELLPILOT_', 'SHELLPILOT_TAMPERED_')
    assert.notEqual(rewritten, script)
    for (const rejected of [bareCarriageReturn, appended, rewritten]) {
      assert.equal(classifier.classifyCommand(rejected).risk, 'unknown', id)
    }
  }

  for (const genericScript of [
    'if command -v ip >/dev/null 2>&1; then ip -s link; fi',
    'for item in /sys/class/net/*; do cat "$item/operstate"; done'
  ]) {
    assert.equal(classifier.classifyCommand(genericScript).risk, 'unknown')
  }
})

test('Windows quick-command path keeps every Task 5 step readonly after LFCR conversion', async () => {
  const [registry, classifier] = await Promise.all([
    import(registryUrl),
    import(classifierUrl)
  ])
  const commands = registry.getServerMaintenanceQuickCommands()
    .filter(command => task5ReadonlyIds.includes(command.id))
    .sort((left, right) => (
      task5ReadonlyIds.indexOf(left.id) - task5ReadonlyIds.indexOf(right.id)
    ))
  const queued = []
  const sent = []
  const runSafetyCommandSequence = async (steps, { runStep }) => {
    const results = []
    for (const item of steps) {
      queued.push(item.command)
      results.push(await runStep(item))
    }
    return results
  }
  const { install, window } = loadQuickCommandInstaller(runSafetyCommandSequence)
  class Store {}
  install(Store)
  const store = new Store()
  store.currentQuickCommands = commands
  store.runSafetyCommand = async command => {
    sent.push(command)
    return classifier.classifyCommand(command)
  }
  window.store = store

  for (const id of task5ReadonlyIds) {
    await store.runQuickCommandItem(id)
  }

  const originals = commands.flatMap(command => (
    command.commands.map(item => item.command)
  ))
  assert.deepEqual(queued, originals)
  assert.deepEqual(sent, originals.map(command => command.replace(/\n/g, '\n\r')))
  for (const command of sent) {
    assert.equal(classifier.classifyCommand(command).risk, 'readonly', command)
  }
})

test('network diagnostics run in POSIX sh with bounded output and missing-tool messages', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const link = byId.get('builtin-server-network-errors').commands[0].command
  const instrumentedLink = link
    .replace(
      'for interface_path in /sys/class/net/*; do',
      'for interface_path in /sys/class/net/fixture; do'
    )
    .replace('[ -d "$interface_path" ] || continue', 'true')
  const linkPrelude = [
    'ip () {',
    '  count=0',
    '  while [ "$count" -lt 150 ]; do',
    '    count=$((count + 1))',
    "    printf '__LINK_ROW__%s\\n' \"$count\"",
    '  done',
    '}',
    'ethtool () {',
    "  printf 'Speed: 1000Mb/s\\nDuplex: Full\\nLink detected: yes\\nDriver: hidden\\n'",
    '}'
  ].join('\n')
  const linkResult = runPosixShell(linkPrelude + '\n' + instrumentedLink)
  assert.equal(outputLineCount(linkResult.stdout, '__LINK_ROW__'), 100)
  assert.match(linkResult.stdout, /Speed: 1000Mb\/s/)
  assert.match(linkResult.stdout, /Duplex: Full/)
  assert.match(linkResult.stdout, /Link detected: yes/)
  assert.doesNotMatch(linkResult.stdout, /Driver: hidden/)

  const route = byId.get('builtin-server-route-mtu').commands[0].command
  const routePrelude = [
    'emit_ip_rows () {',
    '  prefix="$1"',
    '  count=0',
    '  while [ "$count" -lt 120 ]; do',
    '    count=$((count + 1))',
    "    printf '%s%s\\n' \"$prefix\" \"$count\"",
    '  done',
    '}',
    'ip () {',
    '  if [ "$1" = "route" ]; then emit_ip_rows __ROUTE_ROW__; return; fi',
    '  if [ "$1" = "rule" ]; then emit_ip_rows __RULE_ROW__; return; fi',
    '  if [ "$1" = "-details" ]; then emit_ip_rows __MTU_ROW__; return; fi',
    '  return 7',
    '}'
  ].join('\n')
  const routeResult = runPosixShell(routePrelude + '\n' + route)
  assert.equal(outputLineCount(routeResult.stdout, '__ROUTE_ROW__'), 80)
  assert.equal(outputLineCount(routeResult.stdout, '__RULE_ROW__'), 40)
  assert.equal(outputLineCount(routeResult.stdout, '__MTU_ROW__'), 80)

  const missingLink = runPosixShell(replaceToolProbe(link, 'ip'))
  assert.match(missingLink.stdout, /未安装 ip，跳过链路统计/)
  const missingRoute = runPosixShell(replaceToolProbe(route, 'ip'))
  assert.match(missingRoute.stdout, /未安装 ip，无法读取路由策略与 MTU/)
})

test('TCP diagnostics use ss then real netstat fallback and keep output bounded in POSIX sh', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-tcp-states')
    .commands[0].command
  const successPrelude = [
    'ss () {',
    '  if [ "$1" = "-s" ]; then',
    "    printf '__SS_SUMMARY__\\n'",
    '  else',
    "    printf 'State Recv-Q Send-Q Local Peer\\nESTAB 0 0 a b\\nESTAB 0 0 c d\\nLISTEN 0 0 e f\\n'",
    '  fi',
    '}',
    "netstat () { printf '__NETSTAT_MUST_NOT_RUN__\\n'; }"
  ].join('\n')
  const success = runPosixShell(successPrelude + '\n' + command)
  assert.match(success.stdout, /__SS_SUMMARY__/)
  assert.match(success.stdout, /ESTAB 2/)
  assert.match(success.stdout, /LISTEN 1/)
  assert.doesNotMatch(success.stdout, /__NETSTAT_MUST_NOT_RUN__/)

  const fallbackPrelude = [
    "ss () { printf '__FAILED_SS__\\n'; return 7; }",
    'netstat () {',
    "  printf 'Proto Recv-Q Send-Q Local Foreign State\\n'",
    "  printf 'tcp 0 0 a b LISTEN\\ntcp6 0 0 c d ESTABLISHED\\n'",
    '}'
  ].join('\n')
  const fallback = runPosixShell(fallbackPrelude + '\n' + command)
  assert.match(fallback.stdout, /LISTEN 1/)
  assert.match(fallback.stdout, /ESTABLISHED 1/)

  const boundedPrelude = [
    'ss () {',
    '  if [ "$1" = "-s" ]; then',
    '    count=0',
    '    while [ "$count" -lt 100 ]; do',
    '      count=$((count + 1))',
    "      printf '__SS_BOUND_ROW__%s\\n' \"$count\"",
    '    done',
    '  else',
    "    printf 'State Recv-Q Send-Q Local Peer\\nESTAB 0 0 a b\\n'",
    '  fi',
    '}'
  ].join('\n')
  const bounded = runPosixShell(boundedPrelude + '\n' + command)
  assert.equal(outputLineCount(bounded.stdout, '__SS_BOUND_ROW__'), 40)

  const missing = runPosixShell(
    replaceToolProbe(replaceToolProbe(command, 'ss'), 'netstat')
  )
  assert.match(missing.stdout, /未检测到可用的 ss 或 netstat/)
})

test('SSH security diagnostics filter and bound journal or readable-log fallback in POSIX sh', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-ssh-security-events')
    .commands[0].command
  const journalPrelude = [
    'journalctl () {',
    "  printf 'noise\\nFailed password for root\\nAccepted publickey for ops\\ndisconnect from host\\n'",
    '}'
  ].join('\n')
  const journal = runPosixShell(journalPrelude + '\n' + command)
  assert.doesNotMatch(journal.stdout, /noise/)
  assert.match(journal.stdout, /Failed password/)
  assert.match(journal.stdout, /Accepted publickey/)
  assert.match(journal.stdout, /disconnect from host/)

  const fallbackCommand = command
    .replaceAll('/var/log/auth.log', '/dev/stdin')
    .replaceAll('/var/log/secure', '/__shellpilot_missing_secure__')
  const fallback = runPosixShell(
    'journalctl () { return 7; }\n' + fallbackCommand,
    {
      input: [
        'noise',
        'Invalid user guest',
        'Accepted password for ops',
        'unrelated'
      ].join('\n') + '\n'
    }
  )
  assert.doesNotMatch(fallback.stdout, /noise|unrelated/)
  assert.match(fallback.stdout, /Invalid user guest/)
  assert.match(fallback.stdout, /Accepted password for ops/)

  const limitPrelude = [
    'journalctl () {',
    '  count=0',
    '  while [ "$count" -lt 250 ]; do',
    '    count=$((count + 1))',
    "    printf 'Failed password row %s\\n' \"$count\"",
    '  done',
    '}'
  ].join('\n')
  const bounded = runPosixShell(limitPrelude + '\n' + command)
  assert.equal(outputLineCount(bounded.stdout, 'Failed password row '), 200)

  const noLogs = command
    .replaceAll('/var/log/auth.log', '/__shellpilot_missing_auth__')
    .replaceAll('/var/log/secure', '/__shellpilot_missing_secure__')
  const unavailable = runPosixShell('journalctl () { return 7; }\n' + noLogs)
  assert.match(unavailable.stdout, /未找到可读的 SSH 安全日志/)
})

test('Docker diagnostics succeed without Docker and cap lists inspect calls and storage output', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const command = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-docker-health-storage')
    .commands[0].command

  const unavailable = runPosixShell(replaceToolProbe(command, 'docker'))
  assert.match(unavailable.stdout, /未检测到 Docker，已跳过容器健康与存储诊断/)

  const dockerPrelude = [
    'docker () {',
    '  if [ "$1" = "ps" ]; then',
    '    if [ "$4" = "{{.ID}}" ]; then',
    '      count=0',
    '      while [ "$count" -lt 25 ]; do',
    '        count=$((count + 1))',
    "        printf 'container-%s\\n' \"$count\"",
    '      done',
    '    else',
    '      count=0',
    '      while [ "$count" -lt 150 ]; do',
    '        count=$((count + 1))',
    "        printf '__DOCKER_LIST__%s\\n' \"$count\"",
    '      done',
    '    fi',
    '    return 0',
    '  fi',
    '  if [ "$1" = "inspect" ]; then',
    '    for last_arg in "$@"; do :; done',
    "    printf '__DOCKER_INSPECT__%s\\n' \"$last_arg\"",
    '    return 0',
    '  fi',
    '  if [ "$1" = "system" ] && [ "$2" = "df" ]; then',
    '    count=0',
    '    while [ "$count" -lt 60 ]; do',
    '      count=$((count + 1))',
    "      printf '__DOCKER_DF__%s\\n' \"$count\"",
    '    done',
    '    return 0',
    '  fi',
    '  return 7',
    '}'
  ].join('\n')
  const result = runPosixShell(dockerPrelude + '\n' + command)
  assert.equal(outputLineCount(result.stdout, '__DOCKER_LIST__'), 100)
  assert.equal(outputLineCount(result.stdout, '__DOCKER_INSPECT__'), 20)
  assert.equal(outputLineCount(result.stdout, '__DOCKER_DF__'), 50)
  assert.match(result.stdout, /__DOCKER_INSPECT__container-20/)
  assert.doesNotMatch(result.stdout, /__DOCKER_INSPECT__container-21/)
})
