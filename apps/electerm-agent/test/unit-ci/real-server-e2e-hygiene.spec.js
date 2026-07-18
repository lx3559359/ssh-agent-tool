const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

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

const unknownStaticValue = Symbol('unknown-static-value')

function evaluateStaticExpression (expressionPath, visiting = new Set()) {
  if (!expressionPath?.node) return unknownStaticValue
  if (expressionPath.isStringLiteral()) return expressionPath.node.value
  if (expressionPath.isNumericLiteral()) return expressionPath.node.value
  if (expressionPath.isBooleanLiteral()) return expressionPath.node.value
  if (expressionPath.isNullLiteral()) return null
  if (expressionPath.isTemplateLiteral()) {
    const expressionPaths = expressionPath.get('expressions')
    const quasis = expressionPath.node.quasis
    let value = quasis[0]?.value?.cooked ?? ''
    for (let index = 0; index < expressionPaths.length; index++) {
      const evaluated = evaluateStaticExpression(expressionPaths[index], visiting)
      if (evaluated === unknownStaticValue || typeof evaluated === 'object') {
        return unknownStaticValue
      }
      value += String(evaluated) + (quasis[index + 1]?.value?.cooked ?? '')
    }
    return value
  }
  if (expressionPath.isBinaryExpression({ operator: '+' })) {
    const left = evaluateStaticExpression(expressionPath.get('left'), visiting)
    const right = evaluateStaticExpression(expressionPath.get('right'), visiting)
    if (left === unknownStaticValue || right === unknownStaticValue ||
      typeof left === 'object' || typeof right === 'object') {
      return unknownStaticValue
    }
    return left + right
  }
  if (expressionPath.isArrayExpression()) {
    const values = []
    for (const elementPath of expressionPath.get('elements')) {
      if (!elementPath?.node || elementPath.isSpreadElement()) return unknownStaticValue
      const value = evaluateStaticExpression(elementPath, visiting)
      if (value === unknownStaticValue || typeof value === 'object') {
        return unknownStaticValue
      }
      values.push(value)
    }
    return values
  }
  if (expressionPath.isIdentifier()) {
    const binding = expressionPath.scope.getBinding(expressionPath.node.name)
    if (!binding || binding.kind !== 'const' ||
      !binding.path.isVariableDeclarator()) return unknownStaticValue
    if (visiting.has(binding.path.node)) return unknownStaticValue
    const initPath = binding.path.get('init')
    if (!initPath?.node) return unknownStaticValue
    const nextVisiting = new Set(visiting)
    nextVisiting.add(binding.path.node)
    return evaluateStaticExpression(initPath, nextVisiting)
  }
  if (!expressionPath.isCallExpression()) return unknownStaticValue
  const calleePath = expressionPath.get('callee')
  const argumentPaths = expressionPath.get('arguments')
  if (calleePath.isMemberExpression()) {
    const objectPath = calleePath.get('object')
    const propertyPath = calleePath.get('property')
    const propertyName = calleePath.node.computed
      ? evaluateStaticExpression(propertyPath, visiting)
      : propertyPath.node.name
    if (objectPath.isIdentifier({ name: 'Object' }) &&
      propertyName === 'freeze' && argumentPaths.length === 1) {
      return evaluateStaticExpression(argumentPaths[0], visiting)
    }
    if (propertyName === 'join' && argumentPaths.length <= 1) {
      const values = evaluateStaticExpression(objectPath, visiting)
      const separator = argumentPaths.length === 0
        ? ','
        : evaluateStaticExpression(argumentPaths[0], visiting)
      if (!Array.isArray(values) || separator === unknownStaticValue ||
        typeof separator === 'object') return unknownStaticValue
      return values.join(String(separator))
    }
  }
  return unknownStaticValue
}

function staticObjectPropertyName (propertyPath) {
  if (!propertyPath.isObjectProperty()) return undefined
  const keyPath = propertyPath.get('key')
  if (!propertyPath.node.computed && keyPath.isIdentifier()) {
    return keyPath.node.name
  }
  return evaluateStaticExpression(keyPath)
}

function findStaticObjectProperty (objectPath, name) {
  return objectPath.get('properties').find(propertyPath => (
    staticObjectPropertyName(propertyPath) === name
  ))
}

function assertStaticCommandTextSafe (text) {
  assert.doesNotMatch(
    text,
    /(?:^|[\s;|&])(?:sudo|su|rm|mv|cp|install|touch|mkdir|chmod|chown|tee|firewall-cmd|ufw|iptables|nft|nmcli|useradd|userdel|passwd|reboot|shutdown|poweroff|kill|pkill)\b/i
  )
  assert.doesNotMatch(text, /\bsed\s+-i\b/i)
  assert.doesNotMatch(
    text,
    /\bip(?:\s+(?!route\b|link\b|addr(?:ess)?\b)[^\s'"`]+)*\s+(?:route\s+(?:add|del|delete|replace|flush|append|change)|link\s+(?:add|del|delete|set|change|replace)|addr(?:ess)?\s+(?:add|del|delete|replace|flush|change))\b/i
  )
  assert.doesNotMatch(text, /\bdd\b[^\r\n]*\bof\s*=/i)
  assert.doesNotMatch(text, />>?/, 'shell write redirection is forbidden')
  assert.doesNotMatch(text, /<<<?/, 'here-doc and here-string input are forbidden')
}

function commandExpressionFromReadonlyDescriptor (objectPath) {
  const argumentsProperty = findStaticObjectProperty(objectPath, 'arguments')
  const argumentsPath = argumentsProperty?.get('value')
  if (!argumentsPath?.isCallExpression()) return undefined
  const calleePath = argumentsPath.get('callee')
  if (!calleePath.isMemberExpression()) return undefined
  const objectPathForCall = calleePath.get('object')
  const propertyPath = calleePath.get('property')
  if (!objectPathForCall.isIdentifier({ name: 'JSON' }) ||
    (!calleePath.node.computed && propertyPath.node.name !== 'stringify')) {
    return undefined
  }
  const payloadPath = argumentsPath.get('arguments')[0]
  if (!payloadPath?.isObjectExpression()) return undefined
  return findStaticObjectProperty(payloadPath, 'command')?.get('value')
}

function isReadonlyCommandsMapArgument (callPath, commandPath) {
  if (!commandPath.isIdentifier()) return false
  const callbackPath = callPath.findParent(path => path.isArrowFunctionExpression())
  if (!callbackPath) return false
  const commandParameterPath = callbackPath.get('params')[0]
  if (!commandParameterPath?.isIdentifier({ name: commandPath.node.name }) ||
    commandPath.scope.getBinding(commandPath.node.name) !==
      callbackPath.scope.getBinding(commandParameterPath.node.name)) return false
  const mapCallPath = callbackPath.parentPath
  if (!mapCallPath?.isCallExpression()) return false
  const mapCalleePath = mapCallPath.get('callee')
  if (!mapCalleePath.isMemberExpression() ||
    !mapCalleePath.get('object').isIdentifier({ name: 'readonlyCommands' }) ||
    mapCalleePath.get('property').node.name !== 'map') return false
  const commands = evaluateStaticExpression(mapCalleePath.get('object'))
  if (!Array.isArray(commands) || commands.length === 0 ||
    commands.some(command => typeof command !== 'string')) return false
  for (const command of commands) assertStaticCommandTextSafe(command)
  return true
}

function staticMemberPathKey (memberPath) {
  const parts = []
  let currentPath = memberPath
  while (currentPath?.isMemberExpression()) {
    const propertyPath = currentPath.get('property')
    const property = currentPath.node.computed
      ? evaluateStaticExpression(propertyPath)
      : propertyPath.node.name
    if (typeof property !== 'string' && typeof property !== 'number') return undefined
    parts.unshift(String(property))
    currentPath = currentPath.get('object')
  }
  if (!currentPath?.isIdentifier()) return undefined
  parts.unshift(currentPath.node.name)
  return parts.join('.')
}

function isApprovedMonitorAssignment (assignmentPath) {
  const leftPath = assignmentPath.get('left')
  const rightPath = assignmentPath.get('right')
  const key = staticMemberPathKey(leftPath)
  if (assignmentPath.node.operator === '=' &&
    key === 'window.__shellpilotAgentReadonlyPtyMonitor.count') {
    return rightPath.isNumericLiteral({ value: 0 })
  }
  if (assignmentPath.node.operator === '=' && key === 'attachAddon._sendData') {
    return rightPath.isFunctionExpression()
  }
  if (assignmentPath.node.operator === '+=' && key === 'monitor.count') {
    return rightPath.isNumericLiteral({ value: 1 })
  }
  if (assignmentPath.node.operator === '=' &&
    key === 'window.__shellpilotAgentReadonlyPtyMonitor') {
    return rightPath.isIdentifier({ name: 'monitor' })
  }
  return assignmentPath.node.operator === '=' &&
    key === 'monitor.attachAddon._sendData' &&
    rightPath.isMemberExpression() &&
    staticMemberPathKey(rightPath) === 'monitor.original'
}

function isForbiddenMutationHelper (memberPath) {
  const objectPath = memberPath.get('object')
  const propertyPath = memberPath.get('property')
  const property = memberPath.node.computed
    ? evaluateStaticExpression(propertyPath)
    : propertyPath.node.name
  if (objectPath.isIdentifier({ name: 'Object' })) {
    return ['assign', 'defineProperty', 'defineProperties'].includes(property)
  }
  return objectPath.isIdentifier({ name: 'Reflect' }) && property === 'set'
}

function isDirectReadonlyToolCallMap (callPath, commandPath) {
  if (!isReadonlyCommandsMapArgument(callPath, commandPath)) return false
  const callbackPath = callPath.parentPath
  if (!callbackPath?.isArrowFunctionExpression() ||
    callbackPath.get('body').node !== callPath.node) return false
  const mapCallPath = callbackPath.parentPath
  if (!mapCallPath?.isCallExpression() ||
    mapCallPath.get('arguments')[0]?.node !== callbackPath.node) return false
  const toolCallsPropertyPath = mapCallPath.parentPath
  return toolCallsPropertyPath?.isObjectProperty() &&
    staticObjectPropertyName(toolCallsPropertyPath) === 'tool_calls' &&
    toolCallsPropertyPath.get('value').node === mapCallPath.node
}

function assertStaticCommandExpressionsSafe (source) {
  const ast = parser.parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx']
  })
  const descriptorObjects = new Set()
  const dynamicSinkFunctions = new Map()
  traverse(ast, {
    enter (expressionPath) {
      if (!expressionPath.isExpression()) return
      const value = evaluateStaticExpression(expressionPath)
      if (typeof value === 'string') assertStaticCommandTextSafe(value)
    },
    ObjectProperty (propertyPath) {
      if (staticObjectPropertyName(propertyPath) !== 'name' ||
        evaluateStaticExpression(propertyPath.get('value')) !==
          'run_readonly_command') return
      const descriptorPath = propertyPath.parentPath
      if (!descriptorPath.isObjectExpression()) {
        throw new Error('readonly command descriptor must be a static object')
      }
      descriptorObjects.add(descriptorPath.node)
      const functionPropertyPath = descriptorPath.parentPath
      const returnedObjectPath = functionPropertyPath?.parentPath
      const returnPath = returnedObjectPath?.parentPath
      if (!functionPropertyPath?.isObjectProperty() ||
        staticObjectPropertyName(functionPropertyPath) !== 'function' ||
        functionPropertyPath.get('value').node !== descriptorPath.node ||
        !returnedObjectPath?.isObjectExpression() ||
        !returnPath?.isReturnStatement() ||
        returnPath.get('argument').node !== returnedObjectPath.node) {
        throw new Error('readonly command descriptor must be returned directly by its sink')
      }
      const commandPath = commandExpressionFromReadonlyDescriptor(descriptorPath)
      if (!commandPath) {
        throw new Error('readonly command descriptor must bind one static command field')
      }
      const functionPath = returnPath.findParent(path => path.isFunction())
      if (!functionPath?.isFunctionDeclaration() ||
        functionPath.node.id?.name !== 'toolCall' ||
        !functionPath.parentPath.isProgram() || !commandPath.isIdentifier()) {
        throw new Error('dynamic readonly command sink is forbidden')
      }
      const parameterIndex = functionPath.get('params').findIndex(parameterPath => (
        parameterPath.isIdentifier({ name: commandPath.node.name }) &&
        parameterPath.scope.getBinding(parameterPath.node.name) ===
          commandPath.scope.getBinding(commandPath.node.name)
      ))
      if (parameterIndex < 0) throw new Error('dynamic readonly command sink is forbidden')
      const functionBinding = functionPath.scope.getBinding(functionPath.node.id.name)
      if (!functionBinding || functionBinding.path.node !== functionPath.node) {
        throw new Error('readonly command sink must have one auditable function binding')
      }
      dynamicSinkFunctions.set(functionBinding, parameterIndex)
    },
    AssignmentExpression (assignmentPath) {
      if (assignmentPath.get('left').isMemberExpression() &&
        !isApprovedMonitorAssignment(assignmentPath)) {
        throw new Error('member mutation is forbidden in the readonly fixture')
      }
    },
    UpdateExpression (updatePath) {
      if (updatePath.get('argument').isMemberExpression()) {
        throw new Error('member update is forbidden in the readonly fixture')
      }
    },
    UnaryExpression (unaryPath) {
      if (unaryPath.node.operator !== 'delete' ||
        !unaryPath.get('argument').isMemberExpression()) return
      if (staticMemberPathKey(unaryPath.get('argument')) !==
        'window.__shellpilotAgentReadonlyPtyMonitor') {
        throw new Error('member deletion is forbidden in the readonly fixture')
      }
    },
    MemberExpression (memberPath) {
      if (isForbiddenMutationHelper(memberPath)) {
        throw new Error('generic object mutation helpers are forbidden')
      }
    }
  })
  if (descriptorObjects.size !== 1 || dynamicSinkFunctions.size !== 1) {
    throw new Error('the readonly fixture must register exactly one descriptor sink')
  }
  for (const [functionBinding, parameterIndex] of dynamicSinkFunctions) {
    if (functionBinding.referencePaths.length !== 1) {
      throw new Error('readonly command descriptor must have one auditable map call site')
    }
    for (const referencePath of functionBinding.referencePaths) {
      const callPath = referencePath.parentPath
      if (!callPath?.isCallExpression() || referencePath.key !== 'callee' ||
        callPath.get('callee').node !== referencePath.node) {
        throw new Error('indirect readonly command sink use is forbidden')
      }
      const commandPath = callPath.get('arguments')[parameterIndex]
      if (!isDirectReadonlyToolCallMap(callPath, commandPath)) {
        throw new Error('readonly command construction is not statically auditable')
      }
    }
  }
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
  assertStaticCommandExpressionsSafe(source)
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

test('Agent readonly hygiene evaluates composed command expressions before approval', () => {
  for (const source of [
    "const command = 'dd if=/dev/zero of=/tmp/file count=1'",
    "const command = ['ip', 'route', 'add', 'default'].join(' ')",
    "const section = 'rou' + 'te'; const action = 'a' + 'dd'; const command = 'ip ' + section + ' ' + action",
    "const command = ['ip', 'link', 'delete', 'dummy0'].join(' ')"
  ]) {
    assert.throws(() => assertNoForbiddenReadonlyFixtureSource(source), source)
  }
})

test('Agent readonly hygiene fails closed on a dynamic readonly command sink', () => {
  const source = `
    const command = getDynamicCommand()
    const call = {
      name: 'run_readonly_command',
      arguments: JSON.stringify({ command })
    }
  `
  assert.throws(() => assertNoForbiddenReadonlyFixtureSource(source))
})

function readonlySinkFixture (indirectUse) {
  return `
    const readonlyCommands = Object.freeze(['ip addr'])
    function toolCall (id, command) {
      return {
        function: {
          name: 'run_readonly_command',
          arguments: JSON.stringify({ command })
        }
      }
    }
    const response = {
      tool_calls: readonlyCommands.map((command, index) => (
        toolCall(\`readonly-real-\${index}\`, command)
      ))
    }
    ${indirectUse}
  `
}

test('Agent readonly hygiene rejects aliasing a sink despite one safe direct call', () => {
  const source = readonlySinkFixture(`
    const alias = toolCall
    alias('unsafe', getDynamicCommand())
  `)
  assert.throws(() => assertNoForbiddenReadonlyFixtureSource(source))
})

test('Agent readonly hygiene rejects member and callback uses of a sink', () => {
  for (const indirectUse of [
    "toolCall.call(null, 'unsafe', getDynamicCommand())",
    "toolCall.apply(null, ['unsafe', getDynamicCommand()])",
    "toolCall.bind(null, 'unsafe', getDynamicCommand())",
    'consume(toolCall)'
  ]) {
    assert.throws(
      () => assertNoForbiddenReadonlyFixtureSource(readonlySinkFixture(indirectUse)),
      indirectUse
    )
  }
})

test('Agent readonly hygiene rejects descriptor member mutation after construction', () => {
  for (const mutation of [
    `
      const call = response.tool_calls[0]
      call.function.arguments = JSON.stringify({ command: prompt })
    `,
    `
      const call = response.tool_calls[0]
      call.function['arg' + 'uments'] = JSON.stringify({ command: prompt })
    `
  ]) {
    assert.throws(
      () => assertNoForbiddenReadonlyFixtureSource(readonlySinkFixture(mutation)),
      mutation
    )
  }
})

test('Agent readonly hygiene rejects generic descriptor mutation helpers', () => {
  for (const mutation of [
    'Object.assign(response.tool_calls[0].function, { arguments: JSON.stringify({ command: prompt }) })',
    "Object.defineProperty(response.tool_calls[0].function, 'arguments', { value: JSON.stringify({ command: prompt }) })",
    'Object.defineProperties(response.tool_calls[0].function, { arguments: { value: JSON.stringify({ command: prompt }) } })',
    "Reflect.set(response.tool_calls[0].function, 'arguments', JSON.stringify({ command: prompt }))"
  ]) {
    assert.throws(
      () => assertNoForbiddenReadonlyFixtureSource(readonlySinkFixture(mutation)),
      mutation
    )
  }
})

test('Agent readonly hygiene rejects an extra directly declared descriptor', () => {
  const extraDescriptor = `
    const call = {
      function: {
        name: 'run_readonly_command',
        arguments: JSON.stringify({ command: 'ip addr' })
      }
    }
  `
  assert.throws(() => (
    assertNoForbiddenReadonlyFixtureSource(readonlySinkFixture(extraDescriptor))
  ))
})

test('Agent readonly hygiene rejects saving a descriptor map before mutation', () => {
  const mutation = `
    const calls = readonlyCommands.map((command, index) => (
      toolCall(\`readonly-saved-\${index}\`, command)
    ))
    calls[0].function.arguments = JSON.stringify({ command: prompt })
  `
  assert.throws(() => (
    assertNoForbiddenReadonlyFixtureSource(readonlySinkFixture(mutation))
  ))
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
