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

const bashExecutable = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash'

function runBash (script, options = {}) {
  const result = spawnSync(
    bashExecutable,
    ['--noprofile', '--norc', '-c', script],
    {
      encoding: 'utf8',
      timeout: options.timeout || 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.signal, null, String(result.signal) + ': ' + result.stderr)
  assert.equal(result.status, 0, result.stderr)
  return result
}

const diskIoDiagnosticCommand = `iostat -xz 1 3 2>/dev/null | head -n 200
IOSTAT_STATUS=\${PIPESTATUS[0]}
if [ "$IOSTAT_STATUS" -eq 0 ] || [ "$IOSTAT_STATUS" -eq 141 ]; then
  true
else
  vmstat 1 4 2>/dev/null | head -n 20 || true
  head -n 200 /proc/diskstats 2>/dev/null || true
fi
unset IOSTAT_STATUS
true`

const inodeMountDiagnosticCommand = `findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null | head -n 200
FINDMNT_STATUS=\${PIPESTATUS[0]}
if [ "$FINDMNT_STATUS" -eq 0 ] || [ "$FINDMNT_STATUS" -eq 141 ]; then
  true
else
  head -n 200 /proc/mounts 2>/dev/null || true
fi
unset FINDMNT_STATUS
true`

const deletedOpenFilesDiagnosticCommand = `lsof +L1 2>/dev/null | head -n 200
LSOF_STATUS=\${PIPESTATUS[0]}
if [ "$LSOF_STATUS" -eq 0 ] || [ "$LSOF_STATUS" -eq 141 ]; then
  true
else
  find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true
fi
unset LSOF_STATUS
true`

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

test('storage readonly fallbacks follow bounded primary pipeline status', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const commands = getServerMaintenanceQuickCommands()
  const byId = new Map(commands.map(command => [command.id, command]))
  const cases = [
    {
      id: 'builtin-server-disk-io',
      primary: 'iostat -xz 1 3',
      status: 'IOSTAT_STATUS',
      fallbacks: ['vmstat 1 4', '/proc/diskstats']
    },
    {
      id: 'builtin-server-inode-mount',
      primary: 'findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS',
      status: 'FINDMNT_STATUS',
      fallbacks: ['/proc/mounts']
    },
    {
      id: 'builtin-server-deleted-open-files',
      primary: 'lsof +L1',
      status: 'LSOF_STATUS',
      fallbacks: ['/proc/[0-9]*/fd']
    }
  ]

  for (const item of cases) {
    const conditional = byId.get(item.id).commands.at(-1).command
    const pipeline = `${item.primary} 2>/dev/null | head -n 200`
    const statusCapture = `${item.status}=\${PIPESTATUS[0]}`
    const branches = conditional.split('\nelse\n')
    assert.equal(branches.length, 2, `${item.id} should use an if/else fallback`)
    const [successBranch, failedRemainder] = branches
    const failedParts = failedRemainder.split('\nfi\n')
    assert.equal(failedParts.length, 2, `${item.id} should close its fallback branch`)
    const [failureBranch, cleanup] = failedParts

    assert.ok(successBranch.startsWith(pipeline + '\n' + statusCapture + '\n'))
    assert.ok(
      successBranch.endsWith(
        `if [ "$${item.status}" -eq 0 ] || [ "$${item.status}" -eq 141 ]; then\n  true`
      )
    )
    assert.ok(
      conditional.indexOf(pipeline) < conditional.indexOf(statusCapture),
      `${item.id} must truncate before capturing pipeline status`
    )
    assert.doesNotMatch(conditional, /[A-Z_]+_OUTPUT=|="\$\(/)
    for (const fallback of item.fallbacks) {
      assert.equal(successBranch.includes(fallback), false, `${fallback} leaked into success branch`)
      assert.ok(failureBranch.includes(fallback), `${fallback} missing from failure branch`)
    }
    assert.equal(cleanup, `unset ${item.status}\ntrue`)
  }
})

test('storage readonly Bash execution selects fallback only for real primary failures', async () => {
  const { getServerMaintenanceQuickCommands } = await import(registryUrl)
  const byId = new Map(
    getServerMaintenanceQuickCommands().map(command => [command.id, command])
  )
  const cases = [
    {
      id: 'builtin-server-disk-io',
      primary: '__PRIMARY_IOSTAT__',
      fallback: '__VMSTAT_FALLBACK__',
      failureStatus: 127
    },
    {
      id: 'builtin-server-inode-mount',
      primary: '__PRIMARY_FINDMNT__',
      fallback: '__MOUNTS_FALLBACK__',
      failureStatus: 7
    },
    {
      id: 'builtin-server-deleted-open-files',
      primary: '__PRIMARY_LSOF__',
      fallback: '__FIND_FALLBACK__',
      failureStatus: 7
    }
  ]
  const fakeTools = status => [
    `PRIMARY_STATUS=${status}`,
    "iostat () { printf '__PRIMARY_IOSTAT__\\n'; return \"$PRIMARY_STATUS\"; }",
    "findmnt () { printf '__PRIMARY_FINDMNT__\\n'; return \"$PRIMARY_STATUS\"; }",
    "lsof () { printf '__PRIMARY_LSOF__\\n'; return \"$PRIMARY_STATUS\"; }",
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
    const success = runBash(`${fakeTools(0)}\n${command}`)
    assert.match(success.stdout, new RegExp(item.primary), item.id)
    assert.doesNotMatch(success.stdout, new RegExp(item.fallback), item.id)

    const failure = runBash(`${fakeTools(item.failureStatus)}\n${command}`)
    assert.match(failure.stdout, new RegExp(item.primary), item.id)
    assert.match(failure.stdout, new RegExp(item.fallback), item.id)

    const sigpipe = runBash(`${fakeTools(141)}\n${command}`)
    assert.match(sigpipe.stdout, new RegExp(item.primary), item.id)
    assert.doesNotMatch(sigpipe.stdout, new RegExp(item.fallback), item.id)
  }
})

test('storage readonly lsof pipeline stops a large producer at the output boundary', async () => {
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
  const result = runBash(`${prelude}\n${command}`, { timeout: 2000 })
  const outputLines = result.stdout.trimEnd().split('\n')

  assert.equal(outputLines.length, 200)
  assert.match(outputLines.at(-1), /^row-/)
  assert.doesNotMatch(result.stdout, /__FIND_FALLBACK__/)
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
