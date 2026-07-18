const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const specPath = path.join(root, 'test/e2e/030.real-server-regression.spec.js')
const specExists = fs.existsSync(specPath)
const agentSpecPath = path.join(root, 'test/e2e/031.agent-readonly-real-server.spec.js')
const agentSpecExists = fs.existsSync(agentSpecPath)
const requiredEnvironmentVariables = [
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD',
  'SHELLPILOT_E2E_REMOTE_ROOT'
]
const approvedAgentEnvironmentVariables = [
  'SHELLPILOT_E2E_HOST',
  'SHELLPILOT_E2E_PORT',
  'SHELLPILOT_E2E_USERNAME',
  'SHELLPILOT_E2E_PASSWORD'
]
const approvedAgentReadonlyCommands = [
  'ip -brief address',
  'ip addr',
  'ip route show',
  'uname -s',
  'cat /proc/loadavg'
]

function parseFrozenStringArray (source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(
    `const\\s+${escaped}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`
  ))
  assert.ok(match, `${name} must be a frozen literal array`)
  const values = []
  const literalPattern = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g
  const residue = match[1].replace(literalPattern, (_, quote, raw) => {
    values.push(JSON.parse(`"${raw.replace(/"/g, '\\"')}"`))
    return ''
  }).replace(/[\s,]/g, '')
  assert.equal(residue, '', `${name} may contain only string literals`)
  return values
}

function collectStaticStringBodies (source) {
  const bodies = []
  const pattern = /(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/g
  for (const match of source.matchAll(pattern)) bodies.push(match[2])
  return bodies
}

function assertNoForbiddenReadonlyFixtureSource (source) {
  assert.doesNotMatch(
    source,
    /(?:^|[\s'"`])(?:sudo|su|rm|mv|cp|touch|mkdir|chmod|chown|tee|firewall-cmd|ufw|iptables|nft|nmcli|useradd|userdel|passwd|reboot|shutdown|poweroff|kill|pkill)\b/i
  )
  assert.doesNotMatch(source, /\bsed\s+-i\b/i)
  assert.doesNotMatch(
    source,
    /\bip(?:\s+(?!route\b|link\b|addr(?:ess)?\b)[^\s'"`]+)*\s+(?:route\s+(?:add|del|delete|replace|flush|append|change)|link\s+(?:add|del|delete|set|change|replace)|addr(?:ess)?\s+(?:add|del|delete|replace|flush|change))\b/i
  )
  assert.doesNotMatch(source, /\bifconfig\s+\S+\s+(?:up|down|[-\d]|netmask|broadcast|mtu|hw)\b/i)
  assert.doesNotMatch(source, /\b(?:systemctl|service)\s+(?:restart|reload|stop|start|enable|disable|mask|unmask)\b/i)
  assert.doesNotMatch(source, /\b(?:apt(?:-get)?|yum|dnf|apk|zypper|pacman)\s+(?:install|remove|purge|upgrade|update)\b/i)
  assert.doesNotMatch(source, /['"`]\s*(?:ip|ifconfig|uname|cat)\b[^'"`\r\n]*(?:>>?|\|\||&&|[|;])[^'"`\r\n]*['"`]/i)
  assert.doesNotMatch(source, /(?:exec|execFile|spawn|fork)\s*\(/)
  assert.doesNotMatch(source, /\bargv\b/)
  assert.doesNotMatch(source, /['"](?:node:)?process['"]\s*\)?/)
  assert.doesNotMatch(
    source.replace(/\bprocess\.env\b/g, ''),
    /\bprocess\b/,
    'the fixture may use process only for the exact process.env credential boundary'
  )
  for (const body of collectStaticStringBodies(source)) {
    assert.doesNotMatch(
      body,
      />>?/,
      'shell write redirection is forbidden in real-server test literals'
    )
    assert.doesNotMatch(
      body,
      /<<<?/,
      'here-doc and here-string input are forbidden in real-server test literals'
    )
  }
}

function readSpec () {
  return fs.readFileSync(specPath, 'utf8')
}

function readAgentSpec () {
  return fs.readFileSync(agentSpecPath, 'utf8')
}

test('real-server E2E regression spec exists', () => {
  assert.ok(specExists, 'test/e2e/030.real-server-regression.spec.js must be implemented')
})

test('real-server E2E reads credentials only from the approved environment variables', { skip: !specExists }, () => {
  const source = readSpec()

  for (const variable of requiredEnvironmentVariables) {
    assert.match(source, new RegExp(`['"]${variable}['"]`))
  }
  const directEnvironmentReads = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)]
    .map(match => match[1])
  assert.deepEqual(
    directEnvironmentReads.filter(name => !requiredEnvironmentVariables.includes(name)),
    []
  )
  assert.doesNotMatch(source, /(?:password|username|host|apiKey)\s*[:=]\s*['"][^'"]+['"]/i)
  assert.doesNotMatch(source, /\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{12,}\b/)
  assert.doesNotMatch(source, /console\.(?:log|info|debug|warn|error)\s*\(/)
})

test('real-server E2E skips explicitly when any required environment variable is missing', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /missingEnvironmentVariables/)
  assert.match(source, /test\.skip\(\s*missingEnvironmentVariables\.length > 0/)
  assert.match(source, /\u7f3a\u5c11\u771f\u5b9e\u670d\u52a1\u5668\u6d4b\u8bd5\u73af\u5883\u53d8\u91cf/)
})

test('real-server E2E limits SSH commands to a declared read-only allowlist', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /const readOnlyCommands = Object\.freeze\(\[/)
  assert.match(source, /'uname -s'/)
  assert.match(source, /'id -un'/)
  assert.match(source, /'pwd'/)
  assert.doesNotMatch(
    source,
    /\b(?:systemctl|service|firewall-cmd|ufw|iptables|nft|nmcli|useradd|userdel|passwd|reboot|shutdown|poweroff|kill|pkill|apt|yum|dnf|apk|chmod|chown)\b|sed\s+-i|ip\s+(?:address|addr|route)\s+(?:add|del|replace)/i
  )
  assert.doesNotMatch(source, /(?:exec|execFile|spawn|fork)\s*\(/)
})

test('real-server E2E confines SFTP changes to a random directory below REMOTE_ROOT and always cleans it', { skip: !specExists }, () => {
  const source = readSpec()

  assert.match(source, /crypto\.randomBytes/)
  assert.match(source, /path\.posix\.join\(config\.remoteRoot, sandboxName\)/)
  assert.match(source, /assertSafeRemoteRoot/)
  assert.match(source, /assertPathInsideSandbox/)
  assert.match(source, /\.mkdir\(/)
  assert.match(source, /\.writeFile\(/)
  assert.match(source, /\.readFile\(/)
  assert.match(source, /\.rename\(/)
  assert.ok(
    (source.match(/renameRemotePath\(run\.page,/g) || []).length >= 2,
    'rename and restore must both be exercised through the guarded helper'
  )
  assert.match(source, /finally\s*{/)
  assert.match(source, /cleanupRemoteSandbox/)
  assert.match(source, /\.unlink\(/)
  assert.match(source, /\.rmdir\(/)
})

test('Agent readonly real-server E2E spec exists', () => {
  assert.ok(
    agentSpecExists,
    'test/e2e/031.agent-readonly-real-server.spec.js must be implemented'
  )
})

test('Agent readonly real-server E2E reads only the four approved credentials', { skip: !agentSpecExists }, () => {
  const source = readAgentSpec()
  assert.deepEqual(
    parseFrozenStringArray(source, 'requiredEnvironmentVariables'),
    approvedAgentEnvironmentVariables
  )
  assert.doesNotMatch(source, /SHELLPILOT_E2E_REMOTE_ROOT/)
  const directEnvironmentReads = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)]
    .map(match => match[1])
  assert.deepEqual(
    directEnvironmentReads.filter(name => !approvedAgentEnvironmentVariables.includes(name)),
    []
  )
  assert.doesNotMatch(source, /(?:password|username|host|apiKey)\s*[:=]\s*['"][^'"]+['"]/i)
  assert.doesNotMatch(source, /\b(?:\d{1,3}\.){3}\d{1,3}\b/)
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{12,}\b/)
})

test('Agent readonly real-server E2E fixes the complete command allowlist in source', { skip: !agentSpecExists }, () => {
  const source = readAgentSpec()

  assert.deepEqual(
    parseFrozenStringArray(source, 'readonlyCommands'),
    approvedAgentReadonlyCommands
  )
  assert.match(source, /for \(let repeat = 0; repeat < 5; repeat\+\+\)/)
  assertNoForbiddenReadonlyFixtureSource(source)
})

test('Agent readonly hygiene rejects extra allowlist entries and indirect argv access', () => {
  const synthetic = "const readonlyCommands = Object.freeze(['ip addr', 'touch /tmp/nope'])"
  assert.notDeepEqual(
    parseFrozenStringArray(synthetic, 'readonlyCommands'),
    approvedAgentReadonlyCommands
  )
  for (const source of [
    "const value = process['argv']",
    'const value = globalThis.process.argv',
    "const value = global['process']['argv']",
    "import process from 'node:process'",
    'const { argv: values } = process',
    'const proc = require(\'process\')',
    'const proc = process; const value = proc.argv'
  ]) {
    assert.throws(() => assertNoForbiddenReadonlyFixtureSource(source))
  }
})

test('Agent readonly hygiene rejects network mutation and shell write bypasses', () => {
  for (const source of [
    "const command = 'ip route add default via 192.0.2.1'",
    "const command = 'ip -4 route del default'",
    "const command = 'ip -family inet route delete default'",
    "const command = 'ip -brief route replace default via 192.0.2.1'",
    "const command = 'ip route flush table main'",
    "const command = 'ip route append 192.0.2.0/24 dev eth0'",
    "const command = 'ip route change default via 192.0.2.1'",
    "const command = 'ip link add dummy0 type dummy'",
    "const command = 'ip -details link delete dummy0'",
    "const command = 'ip addr flush dev eth0'",
    "const command = 'echo unsafe > /tmp/output'",
    "const command = 'printf unsafe >> /tmp/output'",
    'const command = `cat <<EOF > /tmp/output\nunsafe\nEOF`',
    "const command = 'cat <<< unsafe'",
    "const operator = '>'; const command = 'echo unsafe ' + operator + ' /tmp/output'",
    "const operator = '<<'; const command = 'cat ' + operator + 'EOF'"
  ]) {
    assert.throws(() => assertNoForbiddenReadonlyFixtureSource(source), source)
  }
})

test('Agent readonly real-server E2E uses one five-call batch and observes no PTY sends', { skip: !agentSpecExists }, () => {
  const source = readAgentSpec()

  assert.match(source, /tool_calls:\s*readonlyCommands\.map\(/)
  assert.match(source, /toolResults\.length\s*===\s*readonlyCommands\.length/)
  assert.match(source, /runReadonlyBatch/)
  assert.match(source, /toolCalls\.map\(/)
  assert.match(source, /agent-readonly-real-warmup-0/)
  assert.match(source, /agent-readonly-real-sample-\$\{repeat\}/)
  assert.match(source, /__shellpilotAgentReadonlyPtyMonitor/)
  assert.match(source, /attachAddon\._sendData/)
  assert.match(source, /ptySendCount/)
  assert.match(source, /toBe\(0\)/)
  assert.doesNotMatch(source, /agent-readonly-real-(?:warmup|sample)-\$?\{?commandIndex/)
})

test('local takeover E2E drives manual input only through the xterm textarea and keyboard', () => {
  const source = fs.readFileSync(path.join(root, 'test/e2e/026.ai-takeover.spec.js'), 'utf8')

  assert.match(source, /\.xterm-helper-textarea/)
  assert.match(source, /client\.keyboard\.type\(command\)/)
  assert.match(source, /client\.keyboard\.press\('Enter'\)/)
  assert.doesNotMatch(source, /attachAddon(?:\?\.)?\.sendToServer/)
  assert.match(source, /agent-readonly-fill-reason/)
  assert.match(source, /mcpSwitchTab/)
  assert.match(source, /terminal-command-safety-modal/)
  assert.match(source, /hostKeyFingerprint/)
})

test('Agent readonly real-server E2E exercises the client takeover path without leaking server data', { skip: !agentSpecExists }, () => {
  const source = readAgentSpec()

  assert.match(source, /run_readonly_command/)
  assert.match(source, /agent-takeover-switch/)
  assert.match(source, /agent-readonly-real-statistics\.json/)
  assert.match(source, /p95Ms/)
  assert.match(source, /toBeLessThanOrEqual\(3000\)/)
  assert.match(source, /exitCode\)\.toBe\(0\)/)
  assert.match(source, /truncated\)\.toBe\(false\)/)
  assert.match(source, /outputBytes\)\.toBeGreaterThan\(0\)/)
  assert.doesNotMatch(source, /console\.(?:log|info|debug|warn|error)\s*\(/)
  assert.doesNotMatch(source, /presentation\.output[^\n]*(?:attach|body|write|log)/)
})

test('unit fixture uses an RFC 5737 address for the sanitized VPS example', () => {
  const source = fs.readFileSync(
    path.join(root, 'test/unit-ci/server-maintenance-quick-commands.spec.js'),
    'utf8'
  )
  const documentationAddressUses = source.match(/\b192\.0\.2\.44\b/g) || []
  assert.ok(
    documentationAddressUses.length >= 5,
    'the repeated VPS fixture must use an RFC 5737 documentation address'
  )
})
