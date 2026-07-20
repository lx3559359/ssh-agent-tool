const test = require('node:test')
const assert = require('node:assert/strict')
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

const diskIoDiagnosticCommand = `if IOSTAT_OUTPUT="$(iostat -xz 1 3 2>/dev/null)"; then
  printf '%s' "$IOSTAT_OUTPUT" | head -n 200
else
  vmstat 1 4 2>/dev/null | head -n 20 || true
  head -n 200 /proc/diskstats 2>/dev/null || true
fi
unset IOSTAT_OUTPUT
true`

const inodeMountDiagnosticCommand = `if FINDMNT_OUTPUT="$(findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS 2>/dev/null)"; then
  printf '%s' "$FINDMNT_OUTPUT" | head -n 200
else
  head -n 200 /proc/mounts 2>/dev/null || true
fi
unset FINDMNT_OUTPUT
true`

const deletedOpenFilesDiagnosticCommand = `if LSOF_OUTPUT="$(lsof +L1 2>/dev/null)"; then
  printf '%s' "$LSOF_OUTPUT" | head -n 200
else
  find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true
fi
unset LSOF_OUTPUT
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

test('storage readonly fallbacks run only after primary command failure', async () => {
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
    const branches = conditional.split('\nelse\n')
    assert.equal(branches.length, 2, `${item.id} should use an if/else fallback`)
    const [successBranch, failedRemainder] = branches
    const failedParts = failedRemainder.split('\nfi\n')
    assert.equal(failedParts.length, 2, `${item.id} should close its fallback branch`)
    const [failureBranch, cleanup] = failedParts

    assert.ok(successBranch.includes(item.primary), `${item.id} should run its primary first`)
    assert.match(successBranch, /^if [A-Z_]+_OUTPUT="\$\(.+\)"; then\n/)
    for (const fallback of item.fallbacks) {
      assert.equal(successBranch.includes(fallback), false, `${fallback} leaked into success branch`)
      assert.ok(failureBranch.includes(fallback), `${fallback} missing from failure branch`)
    }
    assert.match(cleanup, /^unset [A-Z_]+_OUTPUT\ntrue$/)
  }
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
