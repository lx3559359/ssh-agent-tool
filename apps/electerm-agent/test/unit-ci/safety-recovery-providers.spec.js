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

async function buildChange (command, id = 'op-1') {
  const { buildSafetyRequest } = await importDomainModule('models.js')
  return buildSafetyRequest({
    id,
    source: 'terminal',
    endpoint: { host: 'prod.example.com', username: 'root' },
    command
  })
}

test('builds a strict permission recovery package from a safety request', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const change = await buildChange('chmod 600 "/etc/app config.conf"', 'permission-1')
  const plan = buildRecoveryPlan(change)

  assert.deepEqual(Object.keys(plan), [
    'provider',
    'operationDir',
    'prepareCommand',
    'executeCommand',
    'rollbackCommand',
    'verifyCommand',
    'allowUnsafeExecute',
    'summary',
    'artifacts'
  ])
  assert.equal(plan.provider, 'permissions')
  assert.equal(plan.operationDir, '~/.shellpilot/operations/permission-1/')
  assert.equal(plan.executeCommand, change.command)
  assert.equal(plan.allowUnsafeExecute, true)
  assert.match(plan.prepareCommand, /^umask 077;/)
  assert.match(plan.prepareCommand, /mkdir -p/)
  assert.match(plan.prepareCommand, /chmod 700/)
  assert.match(plan.prepareCommand, /chmod 600/)
  assert.match(plan.prepareCommand, /stat -c/)
  assert.match(plan.prepareCommand, /'\/etc\/app config\.conf'/)
  assert.match(plan.prepareCommand, /manifest\.json/)
  assert.match(plan.prepareCommand, /result\.json/)
  assert.match(plan.prepareCommand, /rollback\.sh/)
  assert.match(plan.prepareCommand, /verify\.sh/)
  assert.match(plan.rollbackCommand, /__SHELLPILOT_ROLLBACK_RC_permission-1/)
  assert.match(plan.verifyCommand, /__SHELLPILOT_VERIFY_RC_permission-1/)
  assert.deepEqual(plan.artifacts, {
    manifest: '~/.shellpilot/operations/permission-1/manifest.json',
    result: '~/.shellpilot/operations/permission-1/result.json',
    rollbackScript: '~/.shellpilot/operations/permission-1/rollback.sh',
    verifyScript: '~/.shellpilot/operations/permission-1/verify.sh',
    backupDir: '~/.shellpilot/operations/permission-1/backup/'
  })
  assert.doesNotMatch(JSON.stringify(plan), /\/tmp\/shellpilot/)
})

test('file provider supports one static ordinary target for first-release commands', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const commands = [
    'rm -f /etc/app.conf',
    'cp /opt/app.conf /etc/app.conf',
    'mv /etc/app.old /etc/app.conf',
    "sed -i 's/old/new/' /etc/app.conf",
    'truncate -s 0 /var/log/app.log',
    "printf '%s\\n' enabled > /etc/app.conf"
  ]

  for (const [index, command] of commands.entries()) {
    const plan = buildRecoveryPlan(await buildChange(command, `file-${index}`))
    assert.equal(plan.provider, 'file', command)
    assert.match(plan.prepareCommand, /cp -a/, command)
    assert.match(plan.prepareCommand, /backup\/existed/, command)
    assert.match(plan.prepareCommand, /backup\/metadata/, command)
    assert.match(plan.prepareCommand, /test ! -L/, command)
    assert.match(plan.prepareCommand, /if test -L .*拒绝.*exit 42.*if test -e/, command)
    assert.match(plan.summary, /文件/, command)
  }
})

test('systemd and docker providers capture and restore the previous state', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const systemd = buildRecoveryPlan(await buildChange(
    'sudo -n systemctl restart nginx.service',
    'systemd-1'
  ))
  assert.match(systemd.prepareCommand, /systemctl is-active/)
  assert.match(systemd.prepareCommand, /systemctl is-enabled/)
  assert.match(systemd.prepareCommand, /sudo -n systemctl/)
  assert.match(systemd.prepareCommand, /active=\$\(sudo -n systemctl is-active.*\|\| true\)/)
  assert.match(systemd.prepareCommand, /enabled=\$\(sudo -n systemctl is-enabled.*\|\| true\)/)
  assert.match(systemd.prepareCommand, /active=%s/)
  assert.match(systemd.prepareCommand, /enabled=%s/)

  const docker = buildRecoveryPlan(await buildChange('docker restart web-1', 'docker-1'))
  assert.match(docker.prepareCommand, /docker inspect/)
  assert.match(docker.prepareCommand, /\.State\.Running/)
  assert.match(docker.prepareCommand, /docker start/)
  assert.match(docker.prepareCommand, /docker stop/)
})

test('firewall providers restore only the changed static port rule', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const firewalld = buildRecoveryPlan(await buildChange(
    'firewall-cmd --permanent --zone=public --add-port=443/tcp',
    'firewall-1'
  ))
  assert.match(firewalld.prepareCommand, /--query-port=443\/tcp/)
  assert.match(firewalld.prepareCommand, /--add-port=443\/tcp/)
  assert.match(firewalld.prepareCommand, /--remove-port=443\/tcp/)

  const ufw = buildRecoveryPlan(await buildChange('ufw allow 8443/tcp', 'firewall-2'))
  assert.match(ufw.prepareCommand, /ufw show added/)
  assert.match(ufw.prepareCommand, /ufw allow/)
  assert.match(ufw.prepareCommand, /ufw --force delete allow/)
})

test('firewalld provider rejects multiple changes in one invocation', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const change = await buildChange(
    'firewall-cmd --add-port=443/tcp --remove-port=80/tcp',
    'firewall-multi'
  )

  assert.throws(() => buildRecoveryPlan(change), /单一|多个|拒绝|精确/)
})

test('network provider restores prior address existence and forbids unsafe bypass', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const plan = buildRecoveryPlan(await buildChange(
    'ip addr add 10.0.0.8/24 dev eth0',
    'network-1'
  ))

  assert.equal(plan.allowUnsafeExecute, false)
  assert.match(plan.prepareCommand, /ip -o addr show dev/)
  assert.match(plan.prepareCommand, /10\.0\.0\.8\/24/)
  assert.match(plan.prepareCommand, /ip addr add/)
  assert.match(plan.prepareCommand, /ip addr del/)
  assert.match(plan.prepareCommand, /scope global primary/)
})

test('network provider rejects structurally invalid static CIDR values', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const change = await buildChange(
    'ip addr add 1:2:3:4:5:6:7:8:9/64 dev eth0',
    'network-invalid-cidr'
  )

  assert.throws(() => buildRecoveryPlan(change), /CIDR|网络地址|拒绝/)
})

test('manifest command summary is audit-redacted while execution stays unchanged', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const command = 'API_KEY=super-secret chmod 600 /etc/app.conf'
  const plan = buildRecoveryPlan(await buildChange(command, 'redaction-1'))

  assert.equal(plan.executeCommand, command)
  assert.match(plan.prepareCommand, /\[REDACTED\]/)
  assert.doesNotMatch(plan.prepareCommand, /super-secret/)
})

test('rejects requests that are not classified reversible atomic changes', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const readonly = await buildChange('uptime', 'readonly-1')

  assert.throws(() => buildRecoveryPlan(readonly), /拒绝|不可恢复|可逆/)
  assert.throws(() => buildRecoveryPlan({
    ...readonly,
    risk: 'change',
    reversible: true,
    recoveryProvider: 'file',
    command: 'echo first > /etc/a; echo second > /etc/b'
  }), /拒绝|单一原子|自动回滚/)
  assert.throws(() => buildRecoveryPlan({
    ...readonly,
    risk: 'change',
    reversible: true,
    recoveryProvider: 'database'
  }), /提供器|支持/)
})

test('rejects unsafe ids and dynamic or ambiguous provider targets', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const cases = [
    ['bad/id', 'chmod 600 /etc/app.conf'],
    ['bad id', 'chmod 600 /etc/app.conf'],
    ['bad\nline', 'chmod 600 /etc/app.conf'],
    ['bad-id', 'chmod 600 /etc/*.conf'],
    ['multi-file', 'rm /etc/a.conf /etc/b.conf'],
    ['multi-service', 'systemctl restart nginx sshd'],
    ['multi-container', 'docker restart web worker']
  ]

  for (const [id, command] of cases) {
    const classified = await buildChange(command, id)
    const forged = classified.reversible
      ? classified
      : {
          ...classified,
          risk: 'change',
          reversible: true,
          recoveryProvider: classified.recoveryProvider || (
            command.startsWith('chmod') ? 'permissions' : 'file'
          )
        }
    assert.throws(() => buildRecoveryPlan(forged), /拒绝|标识|静态|单一|自动回滚/, command)
  }
})

test('first release refuses provider commands without a provable inverse', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const commands = [
    'tee /etc/app.conf',
    'chgrp staff /etc/app.conf',
    'iptables -A INPUT -p tcp --dport 443 -j ACCEPT',
    'nft add rule inet filter input tcp dport 443 accept',
    'nmcli con modify eth0 ipv4.addresses 10.0.0.2/24',
    'ip route add default via 10.0.0.1',
    'ip link set dev eth0 down',
    'ip addr flush dev eth0',
    'podman restart web'
  ]

  for (const [index, command] of commands.entries()) {
    const change = await buildChange(command, `refuse-${index}`)
    assert.equal(change.reversible, true, command)
    try {
      buildRecoveryPlan(change)
      assert.fail(`应拒绝首版不支持的自动回滚命令: ${command}`)
    } catch (error) {
      assert.match(error.message, /首版|拒绝|不支持|精确/)
      assert.equal(error.allowUnsafeExecute, command.startsWith('nmcli') || command.startsWith('ip ') ? false : undefined)
    }
  }
})

test('docker rm never receives a guessed rollback even for a forged provider claim', async () => {
  const { buildRecoveryPlan } = await importDomainModule('recovery-providers.js')
  const change = await buildChange('docker rm web', 'docker-rm-1')

  assert.throws(() => buildRecoveryPlan({
    ...change,
    risk: 'change',
    reversible: true,
    recoveryProvider: 'docker'
  }), /Docker|docker|拒绝|自动回滚/)
})

test('verified remote actions require a valid zero result marker', async () => {
  const {
    buildVerifiedRemoteAction,
    parseRemoteActionMarker
  } = await importDomainModule('remote-recovery.js')
  const rollback = buildVerifiedRemoteAction('true', 'rollback', 'op-1')
  const verify = buildVerifiedRemoteAction('true', 'verify', 'op-1')

  assert.match(rollback, /__SHELLPILOT_ROLLBACK_RC_op-1=%s/)
  assert.match(verify, /__SHELLPILOT_VERIFY_RC_op-1=%s/)
  assert.equal(parseRemoteActionMarker('done\n__SHELLPILOT_ROLLBACK_RC_op-1=0', 'rollback', 'op-1'), 0)
  assert.equal(parseRemoteActionMarker('done\n__SHELLPILOT_VERIFY_RC_op-1=0', 'verify', 'op-1'), 0)
  assert.throws(
    () => parseRemoteActionMarker('no marker', 'rollback', 'op-1'),
    /未返回|标记|状态/
  )
  assert.throws(
    () => parseRemoteActionMarker('__SHELLPILOT_VERIFY_RC_op-1=7', 'verify', 'op-1'),
    /失败|退出码 7/
  )
  assert.throws(() => buildVerifiedRemoteAction('true', 'rollback', 'bad/id'), /标识/)
})
