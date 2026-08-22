const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { importModule } = require('./helpers/import-esm')

const capabilities = {
  interfaces: [{ name: 'eth0' }, { name: 'ens192' }]
}

function resolvePosixShell () {
  const candidates = process.platform === 'win32'
    ? [
        path.join(
          process.env.ProgramFiles || 'C:\\Program Files',
          'Git',
          'usr',
          'bin',
          'dash.exe'
        ),
        path.join(
          process.env.ProgramFiles || 'C:\\Program Files',
          'Git',
          'bin',
          'sh.exe'
        )
      ]
    : ['/bin/dash', '/bin/sh', '/usr/bin/sh']
  return candidates.find(candidate => {
    const probe = spawnSync(candidate, ['-c', 'exit 0'], {
      encoding: 'utf8',
      timeout: 2000
    })
    return !probe.error && probe.status === 0
  })
}

function toPosixPath (value) {
  const normalized = value.replaceAll('\\', '/')
  if (process.platform !== 'win32') return normalized
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
}

function shellQuote (value) {
  const quote = String.fromCharCode(39)
  return quote + String(value).split(quote)
    .join(quote + '\\' + quote + quote) + quote
}

function writeFixtureCommand (directory, name, source) {
  const target = path.join(directory, name)
  fs.writeFileSync(target, `#!/bin/sh\n${source}\n`)
  fs.chmodSync(target, 0o755)
}

function createPacketCaptureFixture (t, { uid, username }, outputPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-capture-'))
  const commandDirectory = path.join(root, 'bin')
  const callLog = path.join(root, 'calls.log')
  fs.mkdirSync(commandDirectory)
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))

  writeFixtureCommand(commandDirectory, 'id', `
if [ "\${1:-}" = "-u" ]; then
  printf '%s\\n' ${shellQuote(uid)}
else
  printf '%s\\n' ${shellQuote(username)}
fi`)
  writeFixtureCommand(commandDirectory, 'sudo', `
printf 'sudo %s\\n' "$*" >> "$CALL_LOG"
[ "\${1:-}" = "-n" ] && shift
"$@"`)
  writeFixtureCommand(commandDirectory, 'tcpdump', `
printf 'tcpdump %s\\n' "$*" >> "$CALL_LOG"
[ "\${1:-}" = "--version" ] && exit 0
target=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-w" ]; then
    shift
    target="\${1:-}"
  fi
  shift || true
done
if [ -n "$target" ]; then
  printf 'fixture-packet\\n' > "$target"
else
  printf 'fixture packet summary\\n'
fi`)
  writeFixtureCommand(commandDirectory, 'timeout', `
printf 'timeout %s\\n' "$*" >> "$CALL_LOG"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signal=*|--kill-after=*) shift ;;
    [0-9]*) shift; break ;;
    *) break ;;
  esac
done
"$@"`)
  writeFixtureCommand(commandDirectory, 'mktemp', `
target="\${1%XXXXXX.pcap}fixture.pcap"
: > "$target"
printf '%s\\n' "$target"`)
  writeFixtureCommand(commandDirectory, 'stat', `
case "$*" in
  *%d:%i*) printf '1:2\\n' ;;
  *) printf 'capture_size=15 capture_mode=600 capture_owner=${username}\\n' ;;
esac`)
  writeFixtureCommand(commandDirectory, 'ln', 'exec /usr/bin/ln "$@"')
  writeFixtureCommand(commandDirectory, 'rm', 'exec /usr/bin/rm "$@"')
  writeFixtureCommand(commandDirectory, 'ip', 'exit 0')
  writeFixtureCommand(commandDirectory, 'dirname', `
[ "\${1:-}" = "--" ] && shift
case "\${1:-}" in
  */*) printf '%s\\n' "\${1%/*}" ;;
  *) printf '.\\n' ;;
esac`)
  writeFixtureCommand(commandDirectory, 'head', 'exec /usr/bin/head "$@"')

  return {
    callLog,
    commandDirectory: toPosixPath(commandDirectory),
    outputPath
  }
}

async function runPacketCaptureFixture (t, identity) {
  const shell = resolvePosixShell()
  assert.ok(shell, 'a POSIX shell is required for packet capture tests')
  const outputPath = [
    '/tmp/shellpilot-capture',
    process.pid,
    Date.now(),
    identity.uid
  ].join('-') + '.pcap'
  spawnSync(shell, ['-c', `/usr/bin/rm -f -- ${shellQuote(outputPath)}`])
  t.after(() => {
    spawnSync(shell, ['-c', `/usr/bin/rm -f -- ${shellQuote(outputPath)}`])
  })
  const fixture = createPacketCaptureFixture(t, identity, outputPath)
  const { buildPacketCaptureCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const commands = buildPacketCaptureCommands({
    interfaceName: 'eth0',
    protocol: 'tcp',
    packetCount: 10,
    duration: 5,
    outputPath: fixture.outputPath
  }, capabilities)
  const result = spawnSync(shell, ['-s'], {
    encoding: 'utf8',
    input: [
      `PATH=${shellQuote(fixture.commandDirectory)}:/usr/bin:/bin`,
      `CALL_LOG=${shellQuote(toPosixPath(fixture.callLog))}`,
      'export PATH CALL_LOG',
      commands[1]
    ].join('\n'),
    timeout: 10000
  })
  return {
    ...result,
    calls: fs.existsSync(fixture.callLog)
      ? fs.readFileSync(fixture.callLog, 'utf8').trim().split(/\r?\n/)
      : []
  }
}

test('packet capture parameters are typed bounded and discovery-backed', async () => {
  const { normalizePacketCaptureParameters } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const value = normalizePacketCaptureParameters({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 1000,
    duration: 300,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  assert.equal(value.port, 443)
  assert.equal(value.packetCount, 1000)
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'unknown0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /网卡/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'icmp',
      port: 53,
      outputPath: '/tmp/capture.pcap'
    }, capabilities),
    /端口/
  )
  assert.throws(
    () => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap;id'
    }, capabilities),
    /抓包文件/
  )
  for (const unsafe of [
    { host: 'example.com;id' },
    { protocol: 'tcp\nid' },
    { packetCount: 0 },
    { packetCount: 1001 },
    { duration: 0 },
    { duration: 301 },
    { outputPath: '/tmp/$(id).pcap' }
  ]) {
    assert.throws(() => normalizePacketCaptureParameters({
      interfaceName: 'eth0',
      protocol: 'tcp',
      outputPath: '/tmp/capture.pcap',
      ...unsafe
    }, capabilities))
  }
})

test('packet filter is constructed from validated fields', async () => {
  const { buildPacketCaptureFilter } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(buildPacketCaptureFilter({
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443
  }), 'tcp and host 10.0.0.8 and port 443')
  assert.equal(buildPacketCaptureFilter({
    protocol: 'any',
    host: '',
    port: ''
  }), '')
  assert.throws(() => buildPacketCaptureFilter({
    protocol: 'tcp',
    host: '10.0.0.8;id',
    port: 443
  }), /主机/)
})

test('capture command is bounded private and no-overwrite', async () => {
  const { buildPacketCaptureCommands } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  const commands = buildPacketCaptureCommands({
    interfaceName: 'eth0',
    protocol: 'tcp',
    host: '10.0.0.8',
    port: 443,
    packetCount: 100,
    duration: 30,
    outputPath: '/tmp/capture.pcap'
  }, capabilities)
  const source = commands.join('\n')
  assert.match(source, /umask 077/)
  assert.match(source, /timeout --signal=INT --kill-after=5 30/)
  assert.match(source, /tcpdump -nn -i 'eth0' -c 100/)
  assert.match(source, /ln -- "\$TEMP" "\$TARGET"/)
  assert.match(source, /sudo -n/)
  assert.match(source, /sudo -n tcpdump --version/)
  assert.doesNotMatch(source, /sudo -n true/)
  assert.match(source, /TEMP_INODE/)
  assert.match(source, /abort_capture \(\).*exit 130/s)
  assert.match(source, /trap abort_capture HUP INT TERM/)
  assert.match(source, /\[ ! -e "\$TARGET" \].*\[ ! -L "\$TARGET" \]/)
  assert.match(source, /\[ -w "\$PARENT" \]/)
  assert.match(source, /head -n 100/)
  assert.doesNotMatch(source, /\beval\b|\bsource\b|tcpdump .+ -[XxAa]/)
})

test('capture definition is resource-sensitive', async () => {
  const { packetCaptureTools } = await importModule(
    'src/client/components/operations-toolkit/catalog/diagnostics/packet-capture.js'
  )
  assert.equal(packetCaptureTools.length, 1)
  assert.equal(packetCaptureTools[0].id, 'network.packet-capture')
  assert.equal(packetCaptureTools[0].risk, 'resource-sensitive')
  assert.equal(packetCaptureTools[0].requiresConfirmation, true)
  const port = packetCaptureTools[0].parameters.find(item => item.id === 'port')
  assert.equal(Object.isFrozen(port.enabledWhen), true)
  assert.equal(Object.isFrozen(port.enabledWhen.values), true)
  assert.deepEqual(
    packetCaptureTools[0].steps.map(step => step.id),
    ['preflight', 'capture', 'summary']
  )
})

test('packet capture uses current root shell without invoking sudo', async t => {
  const result = await runPacketCaptureFixture(t, {
    uid: 0,
    username: 'root'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.calls.some(call => call.startsWith('sudo ')), false)
  assert.equal(
    result.calls.some(call => call.includes('tcpdump -nn')),
    true
  )
})

test('packet capture still requires noninteractive sudo for an unprivileged shell', async t => {
  const result = await runPacketCaptureFixture(t, {
    uid: 1000,
    username: 'hik'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(
    result.calls.some(call => call.startsWith('sudo -n tcpdump')),
    true
  )
})
