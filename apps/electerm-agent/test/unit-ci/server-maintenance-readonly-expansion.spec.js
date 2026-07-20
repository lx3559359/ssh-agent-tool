const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/index.js')
).href
const classifierUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/common/safety-transactions/command-classifier.js')
).href

function commandText (command) {
  return command.commands.map(item => item.command).join('\n')
}

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
  assert.match(disk.commands[0].command, /^iostat -xz 1 3 \| head -n 200 \|\| true$/)
  assert.match(disk.commands[1].command, /^vmstat 1 4 \| head -n 20 \|\| true$/)
  assert.match(disk.commands[2].command, /^head -n 200 \/proc\/diskstats \|\| true$/)

  const inode = byId.get('builtin-server-inode-mount')
  assert.match(inode.commands[0].command, /^df -iP \| head -n 200 \|\| true$/)
  assert.match(inode.commands[1].command, /^findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS \| head -n 200 \|\| true$/)
  assert.match(inode.commands[2].command, /^head -n 200 \/proc\/mounts \|\| true$/)

  const deleted = byId.get('builtin-server-deleted-open-files')
  assert.match(deleted.commands[0].command, /^lsof \+L1 \| head -n 200 \|\| true$/)
  assert.equal(
    deleted.commands[1].command,
    "find /proc/[0-9]*/fd -lname '* (deleted)' -ls 2>/dev/null | head -n 200 || true"
  )
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
      assert.match(item.command, /\|\| true$/)
      assert.doesNotMatch(item.command, /\b(?:less|more|watch)\b|--follow/)
    }
  }
})
