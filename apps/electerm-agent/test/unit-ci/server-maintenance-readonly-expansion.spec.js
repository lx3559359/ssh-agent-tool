const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const registryUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance/index.js')
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
