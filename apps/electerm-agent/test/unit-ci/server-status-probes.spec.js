const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const probesUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/server-status/server-status-probes.js')
).href
const parsersUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/server-status/server-status-parsers.js')
).href

test('probe registry contains only fixed bounded read-only commands', async () => {
  const { serverStatusProbes } = await import(probesUrl)
  const forbidden = /\b(?:sudo|su|rm|mv|cp|touch|mkdir|chmod|chown|tee|sed\s+-i|systemctl\s+(?:start|stop|restart|enable|disable)|service\s+\S+\s+(?:start|stop|restart)|firewall-cmd\s+--(?:add|remove)|ufw\s+(?:allow|deny|delete)|iptables\s+-[AIFDX]|nft\s+(?:add|delete|flush))\b/i

  assert.ok(serverStatusProbes.length >= 7)
  assert.equal(new Set(serverStatusProbes.map(probe => probe.id)).size, serverStatusProbes.length)
  for (const probe of serverStatusProbes) {
    assert.equal(typeof probe.command, 'string')
    assert.ok(probe.command.length > 0)
    assert.equal(probe.command.includes('${'), false)
    assert.equal(forbidden.test(probe.command), false, `${probe.id} must remain read-only`)
    assert.ok(probe.timeoutMs >= 1000 && probe.timeoutMs <= 30000)
    assert.ok(probe.maxOutputBytes >= 1024 && probe.maxOutputBytes <= 128 * 1024)
    assert.equal(typeof probe.parse, 'function')
  }
  const servicesProbe = serverStatusProbes.find(probe => probe.id === 'services')
  const systemProbe = serverStatusProbes.find(probe => probe.id === 'system')
  assert.equal(systemProbe.command.includes('\\n'), true)
  assert.equal(systemProbe.command.includes('\\\\n'), false)
  assert.match(servicesProbe.command, /systemctl list-units --type=service --all/)
  assert.match(servicesProbe.command, /systemctl show "\$unit"/)
})

test('system parser handles Ubuntu and Rocky os-release output', async () => {
  const { parseSystemProbe } = await import(parsersUrl)
  const ubuntu = parseSystemProbe(`__OS_RELEASE__
NAME="Ubuntu"
VERSION_ID="24.04"
PRETTY_NAME="Ubuntu 24.04.2 LTS"
ID=ubuntu
ID_LIKE=debian
__HOSTNAME__
ubuntu-web
__KERNEL__
6.8.0-57-generic
__CPU_CORES__
4
__UPTIME_SECONDS__
12345.67
__INIT__
systemd
`)
  const rocky = parseSystemProbe(`__OS_RELEASE__
NAME="Rocky Linux"
VERSION_ID="9.5"
PRETTY_NAME="Rocky Linux 9.5 (Blue Onyx)"
ID="rocky"
ID_LIKE="rhel centos fedora"
__HOSTNAME__
rocky-app
__KERNEL__
5.14.0-503.el9.x86_64
__CPU_CORES__
8
__UPTIME_SECONDS__
86400.25
__INIT__
systemd
`)

  assert.deepEqual(ubuntu, {
    hostname: 'ubuntu-web',
    osName: 'Ubuntu',
    osVersion: '24.04',
    prettyName: 'Ubuntu 24.04.2 LTS',
    osId: 'ubuntu',
    osFamily: ['debian'],
    kernel: '6.8.0-57-generic',
    cpuCores: 4,
    uptimeSeconds: 12345.67,
    initSystem: 'systemd'
  })
  assert.equal(rocky.osId, 'rocky')
  assert.deepEqual(rocky.osFamily, ['rhel', 'centos', 'fedora'])
  assert.equal(rocky.cpuCores, 8)
})

test('resource parser handles Linux meminfo, load, disk and inode tables', async () => {
  const { parseResourcesProbe } = await import(parsersUrl)
  const resources = parseResourcesProbe(`__LOAD__
0.42 0.35 0.28 2/201 1234
__MEMINFO__
MemTotal:       8032000 kB
MemAvailable:   4016000 kB
SwapTotal:      2097148 kB
SwapFree:       1048574 kB
__FILESYSTEMS__
Filesystem 1-blocks Used Available Capacity Mounted on
/dev/vda1 53687091200 10737418240 42949672960 20% /
__INODES__
Filesystem Inodes IUsed IFree IUse% Mounted on
/dev/vda1 3276800 32768 3244032 1% /
`)

  assert.deepEqual(resources.load, { one: 0.42, five: 0.35, fifteen: 0.28 })
  assert.equal(resources.memory.totalBytes, 8032000 * 1024)
  assert.equal(resources.memory.availableBytes, 4016000 * 1024)
  assert.equal(resources.swap.freeBytes, 1048574 * 1024)
  assert.equal(resources.filesystems[0].mount, '/')
  assert.equal(resources.filesystems[0].usedPercent, 20)
  assert.equal(resources.filesystems[0].inodeUsedPercent, 1)
})

test('service, network, firewall and container parsers normalize common Linux output', async () => {
  const {
    parseServicesProbe,
    parseNetworkProbe,
    parseFirewallProbe,
    parseContainersProbe
  } = await import(parsersUrl)

  const services = parseServicesProbe(`Id=nginx.service
Description=A high performance web server
LoadState=loaded
ActiveState=active
SubState=running
FragmentPath=/usr/lib/systemd/system/nginx.service
ExecStart={ path=/usr/sbin/nginx ; argv[]=/usr/sbin/nginx -g daemon on; ; }
WorkingDirectory=/var/www

Id=failed-app.service
Description=Platform worker
LoadState=loaded
ActiveState=failed
SubState=failed
FragmentPath=/etc/systemd/system/failed-app.service
`)
  const networks = parseNetworkProbe(`__LINKS__
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP mode DEFAULT
__ADDRESSES__
2: eth0    inet 10.0.0.8/24 brd 10.0.0.255 scope global eth0
2: eth0    inet6 fe80::1/64 scope link
__ROUTES__
default via 10.0.0.1 dev eth0 proto dhcp src 10.0.0.8 metric 100
__DNS__
nameserver 223.5.5.5
nameserver 8.8.8.8
__PORTS__
tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=100,fd=6))
`)
  const firewall = parseFirewallProbe(`__FIREWALLD__
running
__UFW__
Status: inactive
__SELINUX__
Enforcing
`)
  const containers = parseContainersProbe(`__DOCKER__
api-1\tapi\tUp 2 hours\t0.0.0.0:8080->8080/tcp\tcompany/app:1.2\tprod
__PODMAN__
`)

  assert.equal(services.length, 2)
  assert.equal(services[0].name, 'nginx.service')
  assert.equal(services[1].activeState, 'failed')
  assert.equal(networks.interfaces[0].name, 'eth0')
  assert.deepEqual(networks.interfaces[0].addresses, ['10.0.0.8/24', 'fe80::1/64'])
  assert.equal(networks.defaultRoute.gateway, '10.0.0.1')
  assert.equal(networks.listeningPorts[0].port, 80)
  assert.deepEqual(networks.dnsServers, ['223.5.5.5', '8.8.8.8'])
  assert.equal(firewall.provider, 'firewalld')
  assert.equal(firewall.enabled, true)
  assert.equal(firewall.selinux, 'enforcing')
  assert.equal(containers[0].engine, 'docker')
  assert.equal(containers[0].composeProject, 'prod')
})

test('firewall parser does not treat inactive providers or empty rule sets as enabled', async () => {
  const { parseFirewallProbe } = await import(parsersUrl)
  const inactive = parseFirewallProbe(`__FIREWALLD__
not running
__UFW__
Status: inactive
__NFTABLES__
__IPTABLES__
-P INPUT ACCEPT
-P FORWARD ACCEPT
-P OUTPUT ACCEPT
`)
  const nftables = parseFirewallProbe(`__FIREWALLD__
not running
__NFTABLES__
table inet filter {
  chain input { type filter hook input priority filter; policy drop; }
}
__IPTABLES__
`)

  assert.equal(inactive.enabled, false)
  assert.equal(inactive.provider, 'firewalld')
  assert.equal(nftables.enabled, true)
  assert.equal(nftables.provider, 'nftables')
})

test('runner caps concurrency at three and truncates output before parsing', async () => {
  const { runServerStatusProbes } = await import(probesUrl)
  let active = 0
  let maxActive = 0
  const probes = Array.from({ length: 7 }, (_, index) => ({
    id: `probe-${index}`,
    label: `Probe ${index}`,
    command: `fixed-command-${index}`,
    timeoutMs: 1000,
    maxOutputBytes: 12,
    parse: output => ({ output })
  }))
  const runCmd = async command => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 10))
    active -= 1
    return { stdout: `${command}-abcdefghijklmnopqrstuvwxyz`, code: 0 }
  }

  const results = await runServerStatusProbes(runCmd, { probes, concurrency: 99 })

  assert.equal(maxActive, 3)
  assert.equal(results.length, 7)
  assert.ok(results.every(result => result.status === 'success'))
  assert.ok(results.every(result => Buffer.byteLength(result.rawOutput) <= 12))
  assert.ok(results.every(result => Buffer.byteLength(result.data.output) <= 12))
})

test('runner classifies unsupported, permission, timeout and generic errors independently', async () => {
  const { runServerStatusProbes } = await import(probesUrl)
  const probes = [
    { id: 'unsupported', command: 'fixed-a', timeoutMs: 100, maxOutputBytes: 1024, parse: () => ({}) },
    { id: 'permission', command: 'fixed-b', timeoutMs: 100, maxOutputBytes: 1024, parse: () => ({}) },
    { id: 'timeout', command: 'fixed-c', timeoutMs: 20, maxOutputBytes: 1024, parse: () => ({}) },
    { id: 'error', command: 'fixed-d', timeoutMs: 100, maxOutputBytes: 1024, parse: () => ({}) },
    { id: 'success', command: 'fixed-e', timeoutMs: 100, maxOutputBytes: 1024, parse: output => ({ output }) },
    { id: 'success-with-timeout-field', command: 'fixed-f', timeoutMs: 100, maxOutputBytes: 1024, parse: output => ({ output }) }
  ]
  const runCmd = command => {
    if (command === 'fixed-a') return Promise.resolve({ code: 127, stderr: 'systemctl: command not found' })
    if (command === 'fixed-b') return Promise.resolve({ code: 1, stderr: 'Permission denied' })
    if (command === 'fixed-c') return new Promise(() => {})
    if (command === 'fixed-d') return Promise.reject(new Error('connection reset'))
    if (command === 'fixed-f') return Promise.resolve('TimeoutStartUSec=1min 30s')
    return Promise.resolve('ok')
  }

  const results = await runServerStatusProbes(runCmd, { probes })
  const statuses = Object.fromEntries(results.map(result => [result.id, result.status]))

  assert.deepEqual(statuses, {
    unsupported: 'unsupported',
    permission: 'permission',
    timeout: 'timeout',
    error: 'error',
    success: 'success',
    'success-with-timeout-field': 'success'
  })
  assert.equal(results.find(result => result.id === 'success').data.output, 'ok')
})
