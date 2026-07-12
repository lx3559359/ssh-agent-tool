const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const commandsUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance-commands.js')
).href

test('server maintenance quick commands cover common troubleshooting categories', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const commands = getServerMaintenanceQuickCommands()
  const names = commands.map(item => item.name)
  const commandText = commands
    .flatMap(item => item.commands || [])
    .map(item => item.command)
    .join('\n')

  for (const expected of [
    '系统概览',
    '磁盘排查',
    '内存排查',
    '网络监听',
    '服务日志',
    'Nginx 排查',
    'Docker 排查',
    '抓包采样'
  ]) {
    assert.ok(names.includes(expected), `missing ${expected}`)
  }

  assert.match(commandText, /uptime/)
  assert.match(commandText, /df -hT/)
  assert.match(commandText, /free -h/)
  assert.match(commandText, /ss -tunlp/)
  assert.match(commandText, /journalctl/)
  assert.match(commandText, /nginx -t/)
  assert.match(commandText, /docker ps/)
  assert.match(commandText, /tcpdump -nn -i any -c 100/)
})

test('packet capture quick commands are bounded and marked as confirm-required', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const packet = getServerMaintenanceQuickCommands()
    .find(item => item.name === '抓包采样')

  assert.ok(packet)
  assert.equal(packet.confirmRequired, true)
  for (const step of packet.commands) {
    assert.match(step.command, /-c\s+\d+/)
    assert.doesNotMatch(step.command, /-w\s+/)
  }
})

test('server maintenance quick commands are included in current terminal quick commands', () => {
  const storeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/store.js'),
    'utf8'
  )
  const quickCommandSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/quick-command.js'),
    'utf8'
  )

  assert.match(storeSource, /getServerMaintenanceQuickCommands/)
  assert.match(storeSource, /serverMaintenanceQuickCommands/)
  assert.match(quickCommandSource, /confirmRequired/)
})
