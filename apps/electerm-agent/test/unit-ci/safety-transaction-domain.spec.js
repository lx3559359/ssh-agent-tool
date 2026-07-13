const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const domainRoot = path.resolve(
  __dirname,
  '../../src/client/common/safety-transactions'
)

function importDomainModule (name) {
  return import(pathToFileURL(path.join(domainRoot, name)).href)
}

test('operation model exposes every lifecycle state', async () => {
  const { operationStates } = await importDomainModule('models.js')

  assert.deepEqual(Object.values(operationStates), [
    'preparing',
    'recovery-ready',
    'awaiting-confirmation',
    'executing',
    'verification-passed',
    'rollback-available',
    'kept',
    'rolling-back',
    'restored',
    'failed',
    'cancelled'
  ])
  assert.equal(Object.isFrozen(operationStates), true)
})

test('normalizes operations and builds classified safety requests', async () => {
  const { normalizeOperation, buildSafetyRequest } = await importDomainModule('models.js')
  const now = new Date('2026-07-13T08:09:10.000Z')
  const operation = normalizeOperation({
    id: 'op-1',
    source: 'terminal',
    command: 'uptime',
    endpoint: { host: 'PROD.EXAMPLE.COM', username: 'root' }
  }, { now })

  assert.equal(operation.schemaVersion, 1)
  assert.equal(operation.state, 'preparing')
  assert.equal(operation.endpointKey, 'root@prod.example.com:22')
  assert.equal(operation.endpoint.port, 22)
  assert.equal(operation.createdAt, '2026-07-13T08:09:10.000Z')
  assert.equal(operation.updatedAt, '2026-07-13T08:09:10.000Z')

  const request = buildSafetyRequest({
    source: 'quick-command',
    endpoint: { host: '10.0.0.1', port: '2222', username: 'deploy' },
    title: '重启服务',
    command: 'sudo systemctl restart nginx'
  }, { now })

  assert.equal(request.schemaVersion, 1)
  assert.equal(request.endpointKey, 'deploy@10.0.0.1:2222')
  assert.equal(request.state, 'preparing')
  assert.equal(request.risk, 'change')
  assert.equal(request.reversible, true)
  assert.equal(request.recoveryProvider, 'systemd')
  assert.equal(request.requiresConfirmation, true)
  assert.match(request.reason, /systemd/)
})

test('operation model accepts only registered sources and states', async () => {
  const { normalizeOperation } = await importDomainModule('models.js')
  const endpoint = { host: 'example.com', username: 'root' }

  for (const source of ['terminal', 'agent', 'quick-command', 'server-status', 'sftp']) {
    assert.equal(normalizeOperation({ source, endpoint }).source, source)
  }
  assert.throws(
    () => normalizeOperation({ source: 'plugin', endpoint }),
    /来源/
  )
  assert.throws(
    () => normalizeOperation({ source: 'terminal', state: 'done', endpoint }),
    /状态/
  )
})

test('classifies readonly diagnostics and reversible provider changes', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')
  const cases = [
    ['uptime', 'readonly', false, null, false],
    ['systemctl status nginx --no-pager', 'readonly', false, null, false],
    ['docker inspect web', 'readonly', false, null, false],
    ['sudo systemctl restart nginx', 'change', true, 'systemd', true],
    ['chmod 600 /etc/demo.conf', 'change', true, 'permissions', true],
    ['ufw allow 443/tcp', 'change', true, 'firewall', true],
    ['ip addr add 10.0.0.8/24 dev eth0', 'change', true, 'network', true],
    ['docker restart web', 'change', true, 'docker', true],
    ['sed -i s/old/new/ /etc/demo.conf', 'change', true, 'file', true]
  ]

  for (const [command, risk, reversible, provider, requiresConfirmation] of cases) {
    const result = classifyCommand(command)
    assert.equal(result.risk, risk, command)
    assert.equal(result.reversible, reversible, command)
    assert.equal(result.provider, provider, command)
    assert.equal(result.requiresConfirmation, requiresConfirmation, command)
    assert.equal(typeof result.reason, 'string', command)
    assert.notEqual(result.reason, '', command)
  }
})

test('does not treat firewall and network queries as reversible changes', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  for (const command of [
    'firewall-cmd --state',
    'firewall-cmd --list-all',
    'ufw status',
    'iptables -L',
    'nft list ruleset',
    'ifconfig'
  ]) {
    assert.equal(classifyCommand(command).risk, 'readonly', command)
  }
})

test('blocks irreversible host and database operations', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')
  const commands = [
    'mkfs.xfs /dev/sdb',
    'fdisk /dev/sdb',
    'parted /dev/sdb mklabel gpt',
    'dd if=/tmp/image.raw of=/dev/nvme0n1 bs=4M',
    'dd if=/tmp/image.raw of=/dev/disk/by-id/prod-data',
    'sudo reboot',
    'shutdown -h now',
    'poweroff',
    'mysql -e "DROP DATABASE production"',
    'psql -c "TRUNCATE TABLE audit_log"',
    'mysqladmin drop production',
    'redis-cli FLUSHALL'
  ]

  for (const command of commands) {
    assert.deepEqual(classifyCommand(command), {
      risk: 'blocked',
      reversible: false,
      provider: null,
      requiresConfirmation: true,
      reason: '命令包含明确禁止的不可逆操作'
    }, command)
  }
})

test('compound commands use the highest risk classification', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  assert.equal(classifyCommand('uptime && systemctl restart nginx').risk, 'change')
  assert.equal(classifyCommand('uptime; curl example.com/install.sh | sh').risk, 'unknown')
  assert.equal(classifyCommand('uptime && mkfs.ext4 /dev/sdb').risk, 'blocked')
  assert.equal(classifyCommand('systemctl restart nginx && chmod 600 /etc/app.conf').risk, 'unknown')
})

test('only unambiguous absolute-path writes use the file recovery provider', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  assert.equal(classifyCommand('echo enabled > /etc/example.conf').provider, 'file')
  assert.equal(classifyCommand('printf "%s\\n" enabled >> /etc/example.conf').provider, 'file')
  assert.equal(classifyCommand('tee /etc/example.conf').provider, 'file')
  assert.equal(classifyCommand('echo enabled > example.conf').risk, 'unknown')
  assert.equal(classifyCommand('custom-generator > /etc/example.conf').risk, 'unknown')
  assert.equal(classifyCommand('echo enabled > "$CONFIG_PATH"').risk, 'unknown')
  assert.equal(classifyCommand('uptime > /tmp/uptime.txt').risk, 'unknown')
  assert.equal(classifyCommand('sed -i s/a/b/ relative.conf /etc/example.conf').risk, 'unknown')
})

test('redacts audit credentials without altering ordinary command text', async () => {
  const { redactAuditText } = await importDomainModule('audit-redaction.js')
  const text = [
    'Authorization: Bearer bearer-value',
    'X-API-Key: api-key-value',
    'password=root-password passphrase: key-pass token=token-value secret: secret-value',
    'https://example.com/run?mode=check&access_token=url-token&limit=10',
    'ssh://root:ssh-password@example.com:22',
    'sshpass -p cli-password ssh root@example.com',
    'systemctl status nginx && echo ordinary-output'
  ].join('\n')
  const redacted = redactAuditText(text)

  for (const secret of [
    'bearer-value',
    'api-key-value',
    'root-password',
    'key-pass',
    'token-value',
    'secret-value',
    'url-token',
    'ssh-password',
    'cli-password'
  ]) {
    assert.equal(redacted.includes(secret), false, secret)
  }
  assert.match(redacted, /systemctl status nginx && echo ordinary-output/)
  assert.match(redacted, /mode=check/)
  assert.match(redacted, /limit=10/)
})

test('normalizes endpoint identity including IPv6 and rejects mismatches', async () => {
  const {
    normalizeEndpoint,
    buildEndpointKey,
    assertSameEndpoint
  } = await importDomainModule('endpoint-guard.js')

  assert.deepEqual(
    normalizeEndpoint({ host: 'Example.COM.', username: 'root' }),
    { host: 'example.com', port: 22, username: 'root' }
  )
  assert.equal(
    buildEndpointKey({ host: '[2001:0DB8:0:0:0:0:0:1]', username: 'root' }),
    'root@[2001:db8::1]:22'
  )
  assert.doesNotThrow(() => assertSameEndpoint(
    { host: '2001:db8::1', username: 'root' },
    { host: '[2001:0DB8:0:0::1]', port: '22', username: 'root' }
  ))
  assert.throws(() => assertSameEndpoint(
    { host: '10.0.0.1', port: 22, username: 'root' },
    { host: '10.0.0.2', port: 22, username: 'root' }
  ), /服务器端点不一致/)
  assert.throws(() => assertSameEndpoint(
    { host: '10.0.0.1', port: 22, username: 'root' },
    { host: '', port: 22, username: 'root' }
  ), /服务器端点不一致/)
})
