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

test('operation models retain endpoint identity without authentication material', async () => {
  const { normalizeOperation, buildSafetyRequest } = await importDomainModule('models.js')
  const endpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    title: '生产服务器',
    pid: 'terminal-1',
    password: 'root-password',
    privateKey: 'private-key-material',
    passphrase: 'key-passphrase',
    token: 'agent-token',
    agent: '/run/user/1000/ssh-agent.sock',
    customCredential: 'must-not-survive'
  }
  const expectedEndpoint = {
    tabId: 'tab-1',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    title: '生产服务器',
    pid: 'terminal-1'
  }

  const operation = normalizeOperation({ source: 'terminal', endpoint })
  const request = buildSafetyRequest({ source: 'agent', endpoint, command: 'uptime' })

  assert.deepEqual(operation.endpoint, expectedEndpoint)
  assert.deepEqual(request.endpoint, expectedEndpoint)
  for (const secret of [
    'root-password',
    'private-key-material',
    'key-passphrase',
    'agent-token',
    'ssh-agent.sock',
    'must-not-survive'
  ]) {
    assert.doesNotMatch(JSON.stringify([operation, request]), new RegExp(secret))
  }
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
  assert.equal(classifyCommand('uptime & reboot').risk, 'blocked')
  assert.equal(classifyCommand('uptime & mkfs.ext4 /dev/sdb').risk, 'blocked')

  const multiProvider = classifyCommand('systemctl restart nginx && chmod 600 /etc/app.conf')
  assert.equal(multiProvider.risk, 'change')
  assert.equal(multiProvider.reversible, true)
  assert.equal(multiProvider.provider, null)
  assert.match(multiProvider.reason, /逐项恢复/)
})

test('normalizes sudo options and absolute executable paths before blocking', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  assert.equal(classifyCommand('sudo -n -u root reboot').risk, 'blocked')
  assert.equal(classifyCommand('/sbin/poweroff').risk, 'blocked')
})

test('blocks dd writes to device nodes except explicit character-device sinks', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  assert.equal(classifyCommand('dd if=/tmp/image.raw of=/dev/rbd0').risk, 'blocked')
  for (const device of ['null', 'zero', 'random', 'urandom', 'stdout', 'stderr']) {
    assert.notEqual(
      classifyCommand(`dd if=/tmp/image.raw of=/dev/${device}`).risk,
      'blocked',
      device
    )
  }
})

test('blocks destructive database operations across pipelines and eval arguments', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  for (const command of [
    'echo "DROP DATABASE production" | mysql',
    'echo "DROP TABLE users" | psql production',
    'printf "TRUNCATE TABLE audit_log" | mysql production',
    'mongosh --eval "db.users.drop()"'
  ]) {
    assert.equal(classifyCommand(command).risk, 'blocked', command)
  }
})

test('process substitution cannot be classified as a recoverable outer file write', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  const classification = classifyCommand('cat <(reboot) > /etc/example.conf')
  assert.equal(classification.risk, 'unknown')
  assert.equal(classification.reversible, false)
  assert.equal(classification.provider, null)
  assert.match(classification.reason, /动态执行|进程替换/)
  assert.equal(classifyCommand('cat >(poweroff)').risk, 'unknown')
})

test('find output actions require an unambiguous absolute file target', async () => {
  const { classifyCommand } = await importDomainModule('command-classifier.js')

  for (const command of [
    'find /tmp -fprint /var/log/find-paths.txt',
    'find /tmp -fprintf /var/log/find-paths.txt "%p\\n"',
    'find /tmp -fls /var/log/find-list.txt'
  ]) {
    const classification = classifyCommand(command)
    assert.equal(classification.risk, 'change', command)
    assert.equal(classification.reversible, true, command)
    assert.equal(classification.provider, 'file', command)
  }
  for (const command of [
    'find /tmp -fprint find-paths.txt',
    'find /tmp -fprintf "$OUTPUT_FILE" "%p\\n"',
    'find /tmp -fls ../find-list.txt'
  ]) {
    assert.equal(classifyCommand(command).risk, 'unknown', command)
  }
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

test('audit redaction preserves shell quotes and separators for additional credential forms', async () => {
  const { redactAuditText } = await importDomainModule('audit-redaction.js')
  const redacted = redactAuditText([
    'token="quoted-token"; passphrase=\'quoted-passphrase\';',
    'Bearer bare-bearer;',
    'sshpass --password "ssh-password"; ssh root@example.com',
    'SSHPASS=\'env-password\'; sshpass -e ssh root@example.com'
  ].join('\n'))

  assert.match(redacted, /token="\[REDACTED\]";/)
  assert.match(redacted, /passphrase='\[REDACTED\]';/)
  assert.match(redacted, /Bearer \[REDACTED\];/)
  assert.match(redacted, /sshpass --password "\[REDACTED\]";/)
  assert.match(redacted, /SSHPASS='\[REDACTED\]'; sshpass -e/)
  assert.doesNotMatch(redacted, /quoted-token|quoted-passphrase|bare-bearer|ssh-password|env-password/)
})

test('audit redaction covers sensitive JSON keys while preserving valid JSON', async () => {
  const { redactAuditText } = await importDomainModule('audit-redaction.js')
  const payload = {
    password: 'json-password',
    token: 'json-token',
    apiKey: 'json-api-key',
    api_key: 'json-api-key-snake',
    secret: 'json-secret',
    passphrase: 'json-passphrase',
    privateKey: 'json-private-key',
    command: 'systemctl status nginx'
  }

  const parsed = JSON.parse(redactAuditText(JSON.stringify(payload)))
  for (const key of [
    'password', 'token', 'apiKey', 'api_key', 'secret', 'passphrase', 'privateKey'
  ]) {
    assert.equal(parsed[key], '[REDACTED]', key)
  }
  assert.equal(parsed.command, 'systemctl status nginx')
})

test('audit redaction handles compact sshpass password syntax', async () => {
  const { redactAuditText } = await importDomainModule('audit-redaction.js')
  const redacted = redactAuditText('sshpass -pcompact-password ssh root@example.com; echo done')

  assert.equal(redacted, 'sshpass -p[REDACTED] ssh root@example.com; echo done')
  assert.doesNotMatch(redacted, /compact-password/)
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
  assert.equal(
    buildEndpointKey({ host: '::ffff:192.0.2.1', username: 'root' }),
    'root@[::ffff:c000:201]:22'
  )
  assert.doesNotThrow(() => assertSameEndpoint(
    { host: '::ffff:192.0.2.1', username: 'root' },
    { host: '::ffff:c000:201', port: 22, username: 'root' }
  ))
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
