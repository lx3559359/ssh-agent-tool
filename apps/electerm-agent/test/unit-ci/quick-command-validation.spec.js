const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const sharedDirectory = path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/server-maintenance/shared'
)
const validationUrl = pathToFileURL(path.join(sharedDirectory, 'validation.js')).href
const buildersUrl = pathToFileURL(path.join(sharedDirectory, 'command-builders.js')).href
const discoveryUrl = pathToFileURL(path.join(sharedDirectory, 'discovery.js')).href
const safetyMetadataUrl = pathToFileURL(path.join(sharedDirectory, 'safety-metadata.js')).href
const definitionUrl = pathToFileURL(path.join(sharedDirectory, 'definition.js')).href
const contextUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/quick-command-context.js'
)).href
const commandsUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/server-maintenance/index.js'
)).href
const networkUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/quick-command-network.js'
)).href
const quickCommandsBoxPath = path.resolve(
  __dirname,
  '../../src/client/components/quick-commands/quick-commands-box.jsx'
)

test('quick command validators accept supported maintenance value types', async () => {
  const { validateValue } = await import(validationUrl)

  const validValues = [
    ['hostname', 'web-01.example.com'],
    ['service', 'nginx@blue.service'],
    ['interface', 'ens18.100'],
    ['path', '/var/log/nginx/access.log'],
    ['cron', '*/5 0-23 * * 1-5'],
    ['port', '65535'],
    ['ipv4', '192.0.2.10'],
    ['cidr', '10.20.30.0/24'],
    ['cidr', '2001:db8::/64'],
    ['cidr', '::ffff:192.0.2.1/128'],
    ['packet-filter', 'tcp and dst port 443']
  ]

  for (const [type, value] of validValues) {
    assert.equal(validateValue(type, value), '', `${type} should accept ${value}`)
  }
})

test('quick command validators reject invalid formats and command injection', async () => {
  const { validateValue } = await import(validationUrl)

  const invalidValues = [
    ['hostname', '-web.example.com'],
    ['hostname', 'web; reboot'],
    ['service', 'nginx/../../bin/sh'],
    ['service', 'nginx$(id)'],
    ['interface', 'eth0 && id'],
    ['path', 'var/log/messages'],
    ['path', '/tmp/result;id'],
    ['cron', '60 * * * *'],
    ['cron', '* * * * *; reboot'],
    ['port', '0'],
    ['port', '65536'],
    ['ipv4', '192.0.2.999'],
    ['ipv4', '192.0.002.1'],
    ['hostname-or-ip', '192.0.002.1'],
    ['cidr', '192.0.2.1::/64'],
    ['cidr', '192.0.2.1::1/64'],
    ['cidr', '::ffff:192.0.002.1/128'],
    ['cidr', '10.0.0.999/24'],
    ['cidr', '10.0.0.0/33'],
    ['cidr', '2001:db8::/129'],
    ['cidr', '2001:::1/64'],
    ['packet-filter', 'tcp; id'],
    ['packet-filter', "tcp and 'dst port 443"]
  ]

  for (const [type, value] of invalidValues) {
    assert.notEqual(validateValue(type, value), '', `${type} should reject ${value}`)
  }

  for (const value of ['safe\nreboot', 'safe\rreboot', 'safe\0reboot', '$(id)', '`id`']) {
    assert.notEqual(validateValue('text', value), '', `unsafe text should reject ${JSON.stringify(value)}`)
  }
})

test('rollback path validation reserves NAME_MAX for every derived asset', async () => {
  const { validateValue } = await import(validationUrl)
  const maxRollbackBasename = 255 - '.running.lock'.length
  const acceptedFilename =
    'r'.repeat(maxRollbackBasename - '.sh'.length) + '.sh'
  const rejectedFilename =
    'r'.repeat(maxRollbackBasename - '.sh'.length + 1) + '.sh'
  const prefix = '/tmp/shellpilot-rollback/'
  const derivedBasenames = [
    acceptedFilename,
    acceptedFilename.slice(0, -3) + '.verify.sh',
    acceptedFilename + '.running',
    acceptedFilename + '.running.lock',
    acceptedFilename + '.consumed'
  ]

  assert.equal(validateValue('rollback-path', prefix + acceptedFilename), '')
  assert.notEqual(validateValue('rollback-path', prefix + rejectedFilename), '')
  assert.equal(Math.max(...derivedBasenames.map(name => name.length)), 255)
  assert.equal(derivedBasenames.every(name => name.length <= 255), true)
})

test('ordinary default rollback paths remain compatible', async () => {
  const {
    buildQuickCommandContext,
    buildQuickCommandRollbackContext
  } = await import(contextUrl)
  const originalNow = Date.now
  Date.now = () => 1700000000000
  try {
    const context = buildQuickCommandContext({ host: 'server.example.com' })
    assert.equal(
      context.rollbackPath,
      '/tmp/shellpilot-rollback/network-server-example-com-1700000000000.sh'
    )
    assert.equal(
      buildQuickCommandRollbackContext({
        id: 'builtin-server-hostname-change',
        mutatesServer: true
      }, context).rollbackPath,
      '/tmp/shellpilot-rollback/hostname-change-server-example-com-1700000000000.sh'
    )
  } finally {
    Date.now = originalNow
  }
})

test('long legal hosts produce bounded distinct rollback asset names', async () => {
  const { validateValue } = await import(validationUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandRollbackContext
  } = await import(contextUrl)
  const prefixLabels = [
    'a'.repeat(63),
    'b'.repeat(63),
    'c'.repeat(63)
  ]
  const hostA = [...prefixLabels, 'd'.repeat(61)].join('.')
  const hostB = [...prefixLabels, 'd'.repeat(60) + 'e'].join('.')
  const originalNow = Date.now
  Date.now = () => 1700000000000
  try {
    const item = {
      id: 'builtin-server-hostname-change',
      mutatesServer: true
    }
    const contextA = buildQuickCommandContext({ host: hostA })
    const contextB = buildQuickCommandContext({ host: hostB })
    const rollbackA = buildQuickCommandRollbackContext(
      item,
      contextA
    ).rollbackPath
    const rollbackB = buildQuickCommandRollbackContext(
      item,
      contextB
    ).rollbackPath
    const rollbackBasename = path.posix.basename(rollbackA)
    const assetBasenames = [
      rollbackBasename,
      rollbackBasename.slice(0, -3) + '.verify.sh',
      rollbackBasename + '.running',
      rollbackBasename + '.running.lock',
      rollbackBasename + '.consumed'
    ]

    assert.equal(hostA.length, 253)
    assert.equal(validateValue('hostname', hostA), '')
    assert.equal(path.posix.basename(contextA.rollbackPath).length <= 242, true)
    assert.equal(validateValue('rollback-path', contextA.rollbackPath), '')
    assert.equal(validateValue('rollback-path', rollbackA), '')
    assert.equal(assetBasenames.every(name => name.length <= 255), true)
    assert.match(rollbackBasename, /-[a-f0-9]{8}-1700000000000\.sh$/)
    assert.notEqual(contextA.rollbackPath, contextB.rollbackPath)
    assert.notEqual(rollbackA, rollbackB)
  } finally {
    Date.now = originalNow
  }
})

test('quick command validators reject boundary controls before trimming spaces', async () => {
  const { validateValue } = await import(validationUrl)
  const unsafePorts = [
    '443\n',
    '\n443',
    '443\r',
    '\r443',
    '443\0',
    '\0' + '443'
  ]

  for (const value of unsafePorts) {
    assert.match(validateValue('port', value), /控制字符|换行|NUL/)
  }
  assert.equal(validateValue('port', ' 443 '), '')
})

test('quick command validation reports required errors by field and quotes shell values', async () => {
  const {
    quoteShellValue,
    validateQuickCommandParams
  } = await import(validationUrl)
  const item = {
    params: [
      { name: '主机', label: '主机', validationType: 'hostname', required: true },
      { name: '端口', label: '端口', validationType: 'port', required: true },
      { name: '可选路径', label: '可选路径', validationType: 'path' }
    ]
  }

  assert.equal(quoteShellValue("a'b"), "'a'\\''b'")
  assert.deepEqual(validateQuickCommandParams(item, {
    主机: 'web-01.example.com',
    端口: '443',
    可选路径: ''
  }), {})

  const errors = validateQuickCommandParams(item, {
    主机: 'web;id',
    端口: '',
    可选路径: 'relative/path'
  })
  assert.deepEqual(Object.keys(errors), ['主机', '端口', '可选路径'])
  assert.match(errors.主机, /主机/)
  assert.match(errors.端口, /不能为空/)
  assert.match(errors.可选路径, /路径|格式/)
})

test('legacy params without validationType remain compatible', async () => {
  const { validateQuickCommandParams } = await import(validationUrl)
  const legacyItem = {
    params: [
      { name: '关键词', label: '关键词', type: 'input' },
      { name: '请求地址', label: '请求地址', type: 'input' },
      { name: '服务名', label: '服务名', type: 'service-target', multiple: true }
    ]
  }

  assert.deepEqual(validateQuickCommandParams(legacyItem, {
    关键词: 'error|timeout',
    请求地址: 'https://example.com/health?full=true&format=text',
    服务名: ['nginx.service', 'docker.service']
  }), {})
})

test('shell assignment builders only emit explicitly validated and quoted fields', async () => {
  const {
    buildShellAssignment,
    buildShellAssignments
  } = await import(buildersUrl)
  const fields = [
    {
      name: '服务名',
      label: '服务名',
      shellName: 'SERVICE',
      validationType: 'service',
      required: true
    },
    {
      name: '过滤器',
      label: '抓包过滤器',
      shellName: 'CAPTURE_FILTER',
      validationType: 'packet-filter',
      required: true
    }
  ]

  assert.equal(
    buildShellAssignments(fields, {
      服务名: 'nginx.service',
      过滤器: 'tcp and dst port 443'
    }),
    "SERVICE='nginx.service'\nCAPTURE_FILTER='tcp and dst port 443'"
  )
  assert.equal(
    buildShellAssignment('TARGET_PORT', '443', 'port', { label: '目标端口' }),
    "TARGET_PORT='443'"
  )
  assert.equal(
    buildShellAssignment('TARGET_PORT', ' 443 ', 'port', { label: '目标端口' }),
    "TARGET_PORT='443'"
  )
  for (const value of ['443\n', '\n443', '443\r', '\r443', '443\0', '\0' + '443']) {
    assert.throws(
      () => buildShellAssignment('TARGET_PORT', value, 'port', { label: '目标端口' }),
      /控制字符|换行|NUL/
    )
  }
  assert.throws(
    () => buildShellAssignments(fields, {
      服务名: 'nginx;id',
      过滤器: 'tcp'
    }),
    /服务名/
  )
  assert.throws(
    () => buildShellAssignments([{ name: '值', shellName: 'VALUE' }], { 值: 'unchecked' }),
    /校验类型/
  )
  assert.throws(
    () => buildShellAssignment('VALUE', 'unchecked', 'unknown-validator'),
    /校验类型/
  )
  assert.throws(
    () => buildShellAssignment('BAD-NAME', '443', 'port'),
    /Shell 变量名/
  )
})

test('maintenance discovery command and parser use complete capability boundaries', async () => {
  const {
    buildMaintenanceDiscoveryCommand,
    parseMaintenanceDiscoveryOutput
  } = await import(discoveryUrl)
  const nonce = 'fixtureNonce123456789'
  const begin = `__SHELLPILOT_CAP_BEGIN__:${nonce}`
  const end = `__SHELLPILOT_CAP_END__:${nonce}`
  const command = buildMaintenanceDiscoveryCommand(nonce)

  assert.match(command, /__SHELLPILOT_CAP_BEGIN__/)
  assert.match(command, /__SHELLPILOT_CAP_END__/)
  assert.match(command, /\/etc\/os-release/)
  for (const tool of [
    'iostat',
    'mpstat',
    'lsof',
    'ethtool',
    'ss',
    'netstat',
    'journalctl',
    'docker',
    'timedatectl'
  ]) {
    assert.match(command, new RegExp(`\\b${tool}\\b`))
  }

  const output = [
    'login banner',
    begin,
    'os=ubuntu',
    'init=systemd',
    'tool=ss',
    'tool=journalctl',
    'tool=docker',
    end,
    'prompt'
  ].join('\n')
  assert.deepEqual(parseMaintenanceDiscoveryOutput(output, nonce), {
    os: 'ubuntu',
    init: 'systemd',
    tools: ['ss', 'journalctl', 'docker']
  })
})

test('maintenance discovery fails closed for incomplete or missing required output', async () => {
  const { parseMaintenanceDiscoveryOutput } = await import(discoveryUrl)
  const nonce = 'fixtureNonce123456789'
  const begin = `__SHELLPILOT_CAP_BEGIN__:${nonce}`
  const end = `__SHELLPILOT_CAP_END__:${nonce}`

  for (const output of [
    `${begin}\nos=ubuntu\ninit=systemd`,
    `os=ubuntu\ninit=systemd\n${end}`,
    `${begin}\ninit=systemd\n${end}`,
    `${begin}\nos=ubuntu\n${end}`
  ]) {
    assert.throws(
      () => parseMaintenanceDiscoveryOutput(output, nonce),
      /未获取到完整的服务器能力探测结果|能力探测结果缺少/
    )
  }
})

test('mutation safety metadata requires verification and builds fail-closed preflight', async () => {
  const {
    createMutationSafetyMetadata,
    buildMutationPreflight
  } = await import(safetyMetadataUrl)
  const backupTargets = ['/etc/nginx/nginx.conf']
  const verifyCommands = ['nginx -t']
  const metadata = createMutationSafetyMetadata({
    title: '更新 Nginx 配置',
    backupTargets,
    verifyCommands
  })

  assert.deepEqual(metadata, {
    title: '更新 Nginx 配置',
    minFreeKb: 10240,
    maxBackupKb: 8192,
    backupTargets: ['/etc/nginx/nginx.conf'],
    verifyCommands: ['nginx -t'],
    rollbackDirectory: '/tmp/shellpilot-rollback',
    requireConfirmation: true
  })
  backupTargets.push('/etc/hosts')
  verifyCommands.push('systemctl status nginx')
  assert.deepEqual(metadata.backupTargets, ['/etc/nginx/nginx.conf'])
  assert.deepEqual(metadata.verifyCommands, ['nginx -t'])

  assert.throws(
    () => createMutationSafetyMetadata({ title: '无验证命令', verifyCommands: [] }),
    /至少一个验证命令/
  )

  const preflight = buildMutationPreflight(metadata)
  assert.match(preflight, /df -Pk \/tmp/)
  assert.match(preflight, /10240/)
  assert.match(preflight, /\/tmp\/shellpilot-rollback/)
  assert.match(preflight, /mkdir -p/)
  assert.match(preflight, /exit 1/)
  assert.ok(preflight.indexOf('df -Pk /tmp') < preflight.indexOf('mkdir -p'))
})

test('parameter factories opt into validation without changing legacy factory output', async () => {
  const { inputParam, numberParam, selectParam } = await import(definitionUrl)

  assert.deepEqual(
    inputParam('路径', '路径', '/tmp/app', '帮助', '例如 /tmp/app'),
    {
      name: '路径',
      label: '路径',
      type: 'input',
      defaultValue: '/tmp/app',
      help: '帮助',
      placeholder: '例如 /tmp/app'
    }
  )
  assert.equal(
    inputParam('路径', '路径', '/tmp/app', '帮助', '', { validationType: 'path', required: true }).validationType,
    'path'
  )
  assert.equal(
    numberParam('次数', '次数', '3', '帮助', 1, 5, { required: true }).required,
    true
  )
  assert.equal(
    selectParam('模式', '模式', 'safe', '帮助', [{ label: '安全', value: 'safe' }], { required: true }).required,
    true
  )
})

test('quick command confirmation uses unified field validation and visible error rows', async () => {
  const context = await import(contextUrl)
  const errors = context.validateQuickCommandParams({
    params: [
      { name: '端口', label: '端口', validationType: 'port', required: true }
    ]
  }, { 端口: '70000' })
  assert.match(errors.端口, /端口/)

  const previousErrors = {
    端口: '端口必须是 1-65535',
    主机: '主机格式不正确'
  }
  const nextErrors = context.clearQuickCommandParamError(previousErrors, '端口')
  assert.deepEqual(nextErrors, { 主机: '主机格式不正确' })
  assert.deepEqual(previousErrors, {
    端口: '端口必须是 1-65535',
    主机: '主机格式不正确'
  })

  const source = fs.readFileSync(quickCommandsBoxPath, 'utf8')
  assert.match(source, /submitValidatedQuickCommand\(/)
  assert.match(source, /paramErrors/)
  assert.match(source, /status=\{error \? 'error' : undefined\}/)
  assert.match(source, /qm-command-param-error/)
  assert.match(source, /role='alert'/)
  assert.match(source, /updatePendingQuickCommandParams\(/)
  assert.match(source, /shellpilotQuickFinalCommandPreview/)
})

test('maintenance params infer validation without changing legacy custom commands', async () => {
  const {
    inferQuickCommandParamValidation,
    validateAndNormalizeQuickCommandParams
  } = await import(validationUrl)
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues
  } = await import(contextUrl)
  const commands = getServerMaintenanceQuickCommands()
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })

  for (const item of commands) {
    for (const param of item.params || []) {
      assert.ok(
        inferQuickCommandParamValidation(item, param),
        `${item.id}:${param.name} should have an inferred validation policy`
      )
    }
  }

  const logSearch = commands.find(item => item.id === 'builtin-server-log-search')
  const logValues = {
    ...buildQuickCommandParamValues(logSearch, context),
    关键词: 'error|timeout'
  }
  assert.deepEqual(validateAndNormalizeQuickCommandParams(logSearch, logValues), {
    errors: {},
    values: logValues
  })

  const httpCheck = commands.find(item => item.id === 'builtin-server-http-check')
  const httpValues = {
    ...buildQuickCommandParamValues(httpCheck, context),
    请求地址: 'https://example.com/health?full=true&format=text'
  }
  assert.deepEqual(validateAndNormalizeQuickCommandParams(httpCheck, httpValues), {
    errors: {},
    values: httpValues
  })

  const serviceStatus = commands.find(item => item.id === 'builtin-server-service-status')
  const serviceValues = {
    ...buildQuickCommandParamValues(serviceStatus, context),
    服务名: ['nginx.service', 'docker.service']
  }
  assert.deepEqual(validateAndNormalizeQuickCommandParams(serviceStatus, serviceValues), {
    errors: {},
    values: serviceValues
  })

  const custom = {
    id: 'custom-command',
    params: [{ name: 'freeform', type: 'input' }]
  }
  assert.deepEqual(validateAndNormalizeQuickCommandParams(custom, {
    freeform: '  $(kept-for-legacy-custom-command)  '
  }), {
    errors: {},
    values: { freeform: '  $(kept-for-legacy-custom-command)  ' }
  })

  const unknownMutation = {
    id: 'builtin-server-review-fixture',
    mutatesServer: true,
    params: [{ name: '未知字段', label: '未知字段', type: 'input' }]
  }
  assert.match(
    validateAndNormalizeQuickCommandParams(unknownMutation, { 未知字段: 'value' }).errors.未知字段,
    /无法识别|校验策略/
  )
})

test('validated submission rebuilds command text and never submits unsafe maintenance values', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const commands = getServerMaintenanceQuickCommands()
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const logSearch = commands.find(item => item.id === 'builtin-server-log-search')

  for (const dangerousKeyword of [
    'ok"; id',
    '$(id)',
    '`id`',
    'safe\\$(id)',
    'safe\nreboot',
    'safe\rreboot',
    'safe\0reboot'
  ]) {
    const submissions = []
    const result = submitValidatedQuickCommand({
      id: logSearch.id,
      item: logSearch,
      context,
      inputOnly: false,
      text: 'echo stale-and-unsafe',
      paramValues: {
        ...buildQuickCommandParamValues(logSearch, context),
        关键词: dangerousKeyword
      }
    }, (...args) => submissions.push(args))
    assert.equal(result.submitted, false, JSON.stringify(dangerousKeyword))
    assert.equal(submissions.length, 0, JSON.stringify(dangerousKeyword))
    assert.ok(result.errors.关键词, JSON.stringify(dangerousKeyword))
  }

  const firewall = commands.find(item => item.id === 'builtin-server-firewall-open-port')
  const submissions = []
  const result = submitValidatedQuickCommand({
    id: firewall.id,
    item: firewall,
    context,
    inputOnly: false,
    text: 'echo stale-and-unsafe',
    paramValues: {
      ...buildQuickCommandParamValues(firewall, context),
      端口: ' 443 '
    }
  }, (...args) => submissions.push(args))

  assert.equal(result.submitted, true)
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0][0], firewall.id)
  assert.match(submissions[0][1].commandText, /PORT="443"/)
  assert.doesNotMatch(submissions[0][1].commandText, /PORT=" 443 "/)
  assert.doesNotMatch(submissions[0][1].commandText, /stale-and-unsafe/)
  assert.equal(result.paramValues.端口, '443')

  const undeclaredValueSubmissions = []
  const extraValueItem = {
    id: 'builtin-server-extra-value-fixture',
    params: [{ name: '端口', label: '端口', type: 'input' }],
    command: [
      'PORT="{{端口}}"',
      'HOST="{{服务器IP}}"'
    ].join('\n')
  }
  const extraValueResult = submitValidatedQuickCommand({
    id: extraValueItem.id,
    item: extraValueItem,
    context,
    inputOnly: false,
    text: 'echo stale-and-unsafe',
    paramValues: {
      端口: '443',
      服务器IP: 'safe"; id; echo "'
    }
  }, (...args) => undeclaredValueSubmissions.push(args))

  assert.equal(extraValueResult.submitted, true)
  assert.equal(undeclaredValueSubmissions.length, 1)
  assert.deepEqual(extraValueResult.paramValues, { 端口: '443' })
  assert.match(
    undeclaredValueSubmissions[0][1].commandText,
    /HOST="server\.example\.com"/
  )
  assert.doesNotMatch(undeclaredValueSubmissions[0][1].commandText, /; id;/)
})

test('maintenance discovery binds a unique nonce and rejects ambiguous capability blocks', async () => {
  const {
    buildMaintenanceDiscoveryCommand,
    parseMaintenanceDiscoveryOutput
  } = await import(discoveryUrl)
  const nonce = 'reviewNonce123456789'
  const command = buildMaintenanceDiscoveryCommand(nonce)
  const begin = `__SHELLPILOT_CAP_BEGIN__:${nonce}`
  const end = `__SHELLPILOT_CAP_END__:${nonce}`

  assert.match(command, new RegExp(begin))
  assert.match(command, new RegExp(end))
  assert.notEqual(buildMaintenanceDiscoveryCommand(), buildMaintenanceDiscoveryCommand())

  const output = [
    '__SHELLPILOT_CAP_BEGIN__',
    'os=attacker',
    'init=other',
    '__SHELLPILOT_CAP_END__',
    begin,
    'os=ubuntu',
    'init=systemd',
    'tool=ss',
    'tool=docker',
    end
  ].join('\n')
  assert.deepEqual(parseMaintenanceDiscoveryOutput(output, nonce), {
    os: 'ubuntu',
    init: 'systemd',
    tools: ['ss', 'docker']
  })

  for (const invalidBody of [
    [begin, 'os=ubuntu', 'init=systemd'].join('\n'),
    [begin, 'os=ubuntu', 'os=debian', 'init=systemd', end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', 'init=other', end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', 'tool=ss', 'tool=ss', end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', 'tool=curl', end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', 'unexpected=value', end].join('\n'),
    [begin, begin, 'os=ubuntu', 'init=systemd', end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', end, end].join('\n'),
    [begin, 'os=ubuntu', 'init=systemd', '__SHELLPILOT_CAP_END__:otherNonce123456', end].join('\n')
  ]) {
    assert.throws(() => parseMaintenanceDiscoveryOutput(invalidBody, nonce), /能力探测|完整|重复|未知|无效/)
  }
})

test('mutation preflight validates the full schema and creates a private rollback directory', async () => {
  const {
    createMutationSafetyMetadata,
    buildMutationPreflight
  } = await import(safetyMetadataUrl)
  const metadata = createMutationSafetyMetadata({
    title: '安全修改',
    backupTargets: ['/etc/hosts'],
    verifyCommands: ['test -s /etc/hosts']
  })
  const preflight = buildMutationPreflight(metadata)

  assert.match(preflight, /umask 077/)
  assert.match(preflight, /\[ -L "\$ROLLBACK_DIR" \]/)
  assert.match(preflight, /stat -c %u/)
  assert.match(preflight, /stat -c %a/)
  assert.match(preflight, /mktemp -d "\$ROLLBACK_DIR\/operation\.XXXXXX"/)
  assert.match(preflight, /OPERATION_ROLLBACK_DIR/)

  const invalidMetadata = [
    {},
    { ...metadata, requireConfirmation: false },
    { ...metadata, rollbackDirectory: '/tmp/other' },
    { ...metadata, minFreeKb: '10240' },
    { ...metadata, minFreeKb: 0 },
    { ...metadata, verifyCommands: [] },
    { ...metadata, verifyCommands: [true] },
    { ...metadata, verifyCommands: [null] },
    { ...metadata, verifyCommands: [''] },
    { ...metadata, verifyCommands: ['true\nid'] },
    { ...metadata, verifyCommands: new Array(1) },
    { ...metadata, backupTargets: new Array(1) },
    { ...metadata, backupTargets: [true] },
    { ...metadata, backupTargets: ['/etc/hosts\r/tmp/x'] }
  ]
  for (const invalid of invalidMetadata) {
    assert.throws(() => buildMutationPreflight(invalid), /确认|回滚|空间|验证命令|备份目标|不能为空|换行|NUL/)
  }

  for (const input of [
    { title: 'bad', verifyCommands: [true] },
    { title: 'bad', verifyCommands: [null] },
    { title: 'bad', verifyCommands: [''] },
    { title: 'bad', verifyCommands: ['ok\0bad'] },
    { title: 'bad', verifyCommands: new Array(1) },
    { title: 'bad', verifyCommands: ['ok'], backupTargets: [true] }
  ]) {
    assert.throws(() => createMutationSafetyMetadata(input), /验证命令|备份目标|不能为空|换行|NUL/)
  }
})

test('mutation preflight cannot lower the shared minimum free space', async () => {
  const {
    createMutationSafetyMetadata,
    buildMutationPreflight
  } = await import(safetyMetadataUrl)
  const metadata = createMutationSafetyMetadata({
    title: '固定空间下限',
    verifyCommands: ['test -d /tmp']
  })

  assert.throws(
    () => buildMutationPreflight({ ...metadata, minFreeKb: 1 }),
    /10240|最低可用空间/
  )
})

test('every confirmed mutation submits preflight backup mutation and verification in order', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const commands = getServerMaintenanceQuickCommands()
  const mutationCases = [
    {
      id: 'builtin-server-network-change-ip',
      values: {
        网卡: 'eth0',
        '新IP/CIDR': '192.0.2.20/24',
        网关: '192.0.2.1',
        DNS: '223.5.5.5,8.8.8.8',
        配置方式: 'temporary',
        确认执行: 'yes'
      }
    },
    {
      id: 'builtin-server-firewall-open-port',
      values: { 端口: '443', 生效方式: 'runtime', 确认执行: 'yes' }
    },
    {
      id: 'builtin-server-service-action',
      values: { 服务名称: 'nginx.service', 操作: 'restart', 确认执行: 'yes' }
    },
    {
      id: 'builtin-server-docker-action',
      values: { 容器名称: 'web-1', 操作: 'restart', 确认执行: 'yes' }
    },
    {
      id: 'builtin-server-file-permission',
      values: { 目标路径: '/var/www/app', 操作: 'apply', 确认执行: 'yes' }
    }
  ]

  for (const testCase of mutationCases) {
    const item = commands.find(command => command.id === testCase.id)
    assert.ok(item, `missing ${testCase.id}`)
    assert.equal(item.safetyMetadata?.requireConfirmation, true)
    assert.ok(item.safetyMetadata.verifyCommands.length >= 1)

    const submissions = []
    const result = submitValidatedQuickCommand({
      id: item.id,
      item,
      context,
      boundTabId: 'tab-maintenance-test',
      inputOnly: false,
      text: 'stale command text',
      paramValues: {
        ...buildQuickCommandParamValues(item, context),
        ...testCase.values
      }
    }, (...args) => submissions.push(args))

    assert.equal(result.submitted, true, testCase.id)
    assert.equal(submissions.length, 1, testCase.id)
    assert.equal(submissions[0][1].commandText, result.commandText)
    const text = result.commandText
    const preflightIndex = text.indexOf('# __SHELLPILOT_MUTATION_PREFLIGHT__')
    const backupIndex = text.indexOf('# __SHELLPILOT_MUTATION_BACKUP__')
    const mutationIndex = text.indexOf('# __SHELLPILOT_MUTATION_EXECUTE__')
    const verifyIndex = text.indexOf('# __SHELLPILOT_MUTATION_VERIFY__')

    assert.ok(preflightIndex >= 0, `${testCase.id} missing preflight`)
    assert.ok(preflightIndex < backupIndex, `${testCase.id} preflight must precede backup`)
    assert.ok(backupIndex < mutationIndex, `${testCase.id} backup must precede mutation`)
    assert.ok(mutationIndex < verifyIndex, `${testCase.id} mutation must precede verify`)
    assert.match(text, /MIN_FREE_KB=10240/)
    const backupText = text.slice(backupIndex, mutationIndex)
    assert.match(backupText, /BACKUP_COMPLETE/)
    assert.match(backupText, /if ![\s\S]+exit 1/)
    assert.match(text.slice(verifyIndex), /if ! \([\s\S]+exit 1/)
  }
})

test('network discovery merge recalculates errors for every changed field', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const { mergeDetectedNetworkParams } = await import(networkUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    updatePendingQuickCommandParams
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-network-change-ip')
  const context = buildQuickCommandContext({ host: 'server.example.com' })
  const oldValues = {
    ...buildQuickCommandParamValues(item, context),
    网卡: 'bad;id',
    网关: '999.0.0.1',
    DNS: '999.0.0.2',
    '新IP/CIDR': 'bad-cidr'
  }
  const pending = {
    item,
    context,
    paramValues: oldValues,
    paramErrors: {
      网卡: '旧网卡错误',
      网关: '旧网关错误',
      DNS: '旧 DNS 错误',
      '新IP/CIDR': '仍需用户修复'
    },
    text: 'stale'
  }
  const merged = mergeDetectedNetworkParams(oldValues, {
    interface: 'eth0',
    gateway: '192.0.2.1',
    dns: '223.5.5.5,8.8.8.8'
  })
  const next = updatePendingQuickCommandParams(pending, merged)

  assert.equal(next.paramErrors.网卡, undefined)
  assert.equal(next.paramErrors.网关, undefined)
  assert.equal(next.paramErrors.DNS, undefined)
  assert.equal(next.paramErrors['新IP/CIDR'], '仍需用户修复')
  assert.match(next.text, /IFACE="eth0"/)
  assert.match(next.text, /GATEWAY="192\.0\.2\.1"/)
})

test('maintenance scalar params reject arrays before command construction', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand,
    validateAndNormalizeQuickCommandParams
  } = await import(contextUrl)
  const commands = getServerMaintenanceQuickCommands()
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const firewall = commands.find(item => item.id === 'builtin-server-firewall-open-port')
  const defaults = buildQuickCommandParamValues(firewall, context)

  for (const param of firewall.params.filter(param => param.multiple !== true)) {
    const validation = validateAndNormalizeQuickCommandParams(firewall, {
      ...defaults,
      [param.name]: [defaults[param.name]]
    })
    assert.match(
      validation.errors[param.name],
      /单个值|多个值|数组/,
      `${param.name} must reject array input`
    )
  }

  const serviceStatus = commands.find(item => item.id === 'builtin-server-service-status')
  const serviceValidation = validateAndNormalizeQuickCommandParams(serviceStatus, {
    ...buildQuickCommandParamValues(serviceStatus, context),
    服务名: ['nginx.service', 'docker.service']
  })
  assert.equal(serviceValidation.errors.服务名, undefined)

  const submissions = []
  const result = submitValidatedQuickCommand({
    id: firewall.id,
    item: firewall,
    context,
    inputOnly: false,
    text: 'stale command text',
    paramValues: {
      ...defaults,
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      确认执行: ['yes']
    }
  }, (...args) => submissions.push(args))

  assert.equal(result.submitted, false)
  assert.equal(submissions.length, 0)
  assert.match(result.errors.确认执行, /单个值|多个值|数组/)
  assert.equal(result.commandText, '')
})

test('update and submit report structural errors before building mutation text', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand,
    updatePendingQuickCommandParams
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const baseValues = {
    ...buildQuickCommandParamValues(item, context),
    防火墙类型: 'ufw',
    生效方式: 'runtime',
    确认执行: 'yes'
  }

  for (const invalidPort of ['443\n', '443\r', '443\0']) {
    const nextValues = { ...baseValues, 端口: invalidPort }
    let updated
    assert.doesNotThrow(() => {
      updated = updatePendingQuickCommandParams({
        item,
        context,
        paramValues: baseValues,
        paramErrors: {},
        text: 'last-valid-preview'
      }, nextValues)
    }, JSON.stringify(invalidPort))
    assert.ok(updated.paramErrors.端口, JSON.stringify(invalidPort))
    assert.equal(updated.text, 'last-valid-preview')

    const submissions = []
    let result
    assert.doesNotThrow(() => {
      result = submitValidatedQuickCommand({
        id: item.id,
        item,
        context,
        inputOnly: false,
        text: 'stale command text',
        paramValues: nextValues
      }, (...args) => submissions.push(args))
    }, JSON.stringify(invalidPort))
    assert.equal(result.submitted, false)
    assert.equal(result.commandText, '')
    assert.ok(result.errors.端口, JSON.stringify(invalidPort))
    assert.equal(submissions.length, 0)
  }
})

test('confirmed mutations guard and associate the user rollback entrypoint', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const commands = getServerMaintenanceQuickCommands()
  const cases = [
    ['builtin-server-network-change-ip', { 网卡: 'eth0', '新IP/CIDR': '192.0.2.20/24', 配置方式: 'temporary', 确认执行: 'yes' }, '$RUN_AS ip addr add "$NEW_CIDR" dev "$IFACE"'],
    ['builtin-server-firewall-open-port', { 端口: '443', 防火墙类型: 'ufw', 生效方式: 'runtime', 确认执行: 'yes' }, '$RUN_AS ufw allow $PORT/$PROTO'],
    ['builtin-server-service-action', { 服务名称: 'nginx.service', 操作: 'restart', 确认执行: 'yes' }, '$RUN_AS systemctl "$ACTION" "$SERVICE"'],
    ['builtin-server-docker-action', { 容器名称: 'web-1', 操作: 'restart', 确认执行: 'yes' }, 'docker "$ACTION" "$CONTAINER"'],
    ['builtin-server-file-permission', { 目标路径: '/var/www/app', 操作: 'apply', 确认执行: 'yes' }, '$RUN_AS chmod "$MODE" "$TARGET"']
  ]

  for (const [id, overrides, mutationToken] of cases) {
    const item = commands.find(command => command.id === id)
    const result = submitValidatedQuickCommand({
      id,
      item,
      context,
      boundTabId: 'tab-maintenance-test',
      inputOnly: false,
      text: 'stale',
      paramValues: {
        ...buildQuickCommandParamValues(item, context),
        ...overrides
      }
    }, () => {})
    assert.equal(result.submitted, true, id)
    const text = result.commandText
    const backupIndex = text.indexOf('# __SHELLPILOT_MUTATION_BACKUP__')
    const mutationIndex = text.indexOf('# __SHELLPILOT_MUTATION_EXECUTE__')
    const backupText = text.slice(backupIndex, mutationIndex)
    const mutationText = text.slice(mutationIndex)

    assert.match(backupText, /SHELLPILOT_ROLLBACK_SCRIPT='/, id)
    assert.match(backupText, /rollback-script\\t%s\\n/, id)
    assert.match(mutationText, /\(\nset -e\n/, id)
    assert.ok(mutationText.indexOf('set -e') < mutationText.indexOf('TMP_ROLLBACK='), id)
    assert.ok(mutationText.indexOf('TMP_ROLLBACK=') < mutationText.indexOf('chmod 700'), id)
    if (id === 'builtin-server-firewall-open-port') {
      const branchStart = mutationText.indexOf('  ufw)')
      const branchEnd = mutationText.indexOf('    ;;', branchStart)
      const branchText = mutationText.slice(branchStart, branchEnd)
      assert.ok(branchStart >= 0, id)
      assert.ok(branchEnd > branchStart, id)
      assert.ok(branchText.indexOf('chmod 700') >= 0, id)
      assert.ok(branchText.indexOf('chmod 700') < branchText.indexOf(mutationToken), id)
    } else {
      assert.ok(mutationText.lastIndexOf('chmod 700') < mutationText.lastIndexOf(mutationToken), id)
    }

    if (id === 'builtin-server-service-action') {
      assert.match(mutationText, /OLD_ACTIVE=/)
      assert.match(mutationText, /OLD_ENABLED=/)
    }
    if (id === 'builtin-server-docker-action') {
      assert.match(mutationText, /OLD_RUNNING=/)
      assert.match(mutationText, /docker (?:start|stop)/)
    }
  }
})

test('firewall rollback and verification stay bound to the selected backend', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })

  for (const firewallKind of ['firewalld', 'ufw']) {
    const result = submitValidatedQuickCommand({
      id: item.id,
      item,
      context,
      boundTabId: 'tab-maintenance-test',
      inputOnly: false,
      paramValues: {
        ...buildQuickCommandParamValues(item, context),
        端口: '443',
        防火墙类型: firewallKind,
        生效方式: 'runtime',
        确认执行: 'yes'
      }
    }, () => {})
    assert.equal(result.submitted, true)
    const verifyText = result.commandText.slice(
      result.commandText.indexOf('# __SHELLPILOT_MUTATION_VERIFY__')
    )
    assert.match(result.commandText, /RULE_WAS_PRESENT=/)
    assert.match(result.commandText, /if \[ "\$RULE_WAS_PRESENT" = "yes" \]/)
    assert.match(verifyText, new RegExp(`VERIFY_FIREWALL_KIND="${firewallKind}"`))
    assert.match(verifyText, /case "\$VERIFY_FIREWALL_KIND" in/)
    assert.match(verifyText, /firewalld\)[\s\S]*firewall-cmd[\s\S]*;;/)
    assert.match(verifyText, /ufw\)[\s\S]*ufw status[\s\S]*;;/)
  }
})

test('auto firewall verification reads the persisted backend without probing again', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '443',
      防火墙类型: 'auto',
      生效方式: 'runtime',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  const verifyText = result.commandText.slice(
    result.commandText.indexOf('# __SHELLPILOT_MUTATION_VERIFY__')
  )
  assert.match(result.commandText, /FIREWALL_BACKEND_FILE="\$OPERATION_ROLLBACK_DIR\/firewall\.backend"/)
  assert.match(result.commandText, /firewalld\|ufw\|iptables\|nftables/)
  assert.match(result.commandText, /printf '%s\\n' "\$FIREWALL_KIND" > "\$FIREWALL_BACKEND_FILE"/)
  assert.match(verifyText, /VERIFY_BACKEND_FILE="\$OPERATION_ROLLBACK_DIR\/firewall\.backend"/)
  assert.match(verifyText, /\[ -L "\$VERIFY_BACKEND_FILE" \]/)
  assert.match(verifyText, /IFS= read -r VERIFY_FIREWALL_KIND < "\$VERIFY_BACKEND_FILE"/)
  assert.match(verifyText, /case "\$VERIFY_FIREWALL_KIND" in firewalld\|ufw\|iptables\|nftables\)/)
  assert.doesNotMatch(verifyText, /auto\) if command -v/)
})

test('nftables verification marker binds action source port and protocol', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      操作: 'deny',
      来源CIDR: '192.0.2.0/24',
      端口: '443',
      协议: 'tcp',
      防火墙类型: 'nftables',
      生效方式: 'runtime',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  const verifyText = result.commandText.slice(
    result.commandText.indexOf('# __SHELLPILOT_MUTATION_VERIFY__')
  )
  const expectedMarker = 'shellpilot-deny-192.0.2.0/24-443-tcp'
  const staleSourceMarker = 'shellpilot-deny-198.51.100.0/24-443-tcp'
  assert.notEqual(expectedMarker, staleSourceMarker)
  assert.match(result.commandText, /RULE_MARKER="shellpilot-\$ACTION-\$SOURCE_CIDR-\$PORT-\$PROTO"/)
  assert.ok(verifyText.includes(`VERIFY_MARKER="${expectedMarker}"`))
  assert.equal(verifyText.includes(staleSourceMarker), false)
})

test('firewalld permanent rollback restores independent runtime and permanent state', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '443',
      防火墙类型: 'firewalld',
      生效方式: 'permanent',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  assert.match(result.commandText, /FIREWALL_RUNTIME_WAS_PRESENT="no"/)
  assert.match(result.commandText, /FIREWALL_PERMANENT_WAS_PRESENT="no"/)
  assert.match(result.commandText, /firewall-cmd --query-rich-rule="\$RICH_RULE"/)
  assert.match(result.commandText, /firewall-cmd --permanent --query-rich-rule="\$RICH_RULE"/)
  assert.match(result.commandText, /if \[ "\$FIREWALL_PERMANENT_WAS_PRESENT" != "yes" \]/)
  assert.match(result.commandText, /firewall-cmd --permanent --remove-rich-rule=/)
  assert.match(result.commandText, /if \[ "\$FIREWALL_RUNTIME_WAS_PRESENT" = "yes" \]/)
  assert.match(result.commandText, /firewall-cmd --add-rich-rule=/)
  assert.match(result.commandText, /firewall-cmd --remove-rich-rule=/)
})

test('firewalld query errors stop mutation and rollback without deleting rules', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '443',
      防火墙类型: 'firewalld',
      生效方式: 'permanent',
      确认执行: 'yes'
    }
  }, () => {})
  assert.equal(result.submitted, true)

  const shell = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\bin\\bash.exe'
    : '/bin/sh'
  const runShell = (script, args = []) => spawnSync(
    shell,
    ['-c', script, 'firewalld-query-harness', ...args],
    { encoding: 'utf8' }
  )
  const stateStart = result.commandText.indexOf('RULE_WAS_PRESENT="no"')
  const stateEnd = result.commandText.indexOf('case "$FIREWALL_KIND" in', stateStart)
  assert.ok(stateStart >= 0 && stateEnd > stateStart)
  const stateCapture = result.commandText
    .slice(stateStart, stateEnd)
    .replaceAll('firewall-cmd', 'firewall_cmd')
  const mutationHarness = runShell(`
set -e
firewall_cmd () { printf 'QUERY\\n'; return 2; }
RUN_AS=""
FIREWALL_KIND=firewalld
ACTION=allow
SOURCE_CIDR=192.0.2.0/24
PORT=443
PROTO=tcp
APPLY_MODE=permanent
${stateCapture}
printf 'MUTATED\\n'
`)
  assert.notEqual(mutationHarness.status, 0)
  assert.doesNotMatch(mutationHarness.stdout, /MUTATED/)

  const executeStart = result.commandText.indexOf('# __SHELLPILOT_MUTATION_EXECUTE__')
  const branchStart = result.commandText.indexOf('  firewalld)', executeStart)
  const rollbackStart = result.commandText.indexOf("  {\n    echo '#!/bin/sh'", branchStart)
  const rollbackTerminator = '  } > "$TMP_ROLLBACK"'
  const rollbackEnd = result.commandText.indexOf(rollbackTerminator, rollbackStart)
  assert.ok(rollbackStart >= 0 && rollbackEnd > rollbackStart)
  const rollbackBuilder = result.commandText
    .slice(rollbackStart, rollbackEnd + rollbackTerminator.length)
    .replaceAll('firewall-cmd', 'firewall_cmd')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shellpilot-firewalld-query-'))
  const rollbackPath = path.join(directory, 'rollback.sh').replaceAll('\\', '/')
  try {
    const buildRollback = runShell(`
set -e
TMP_ROLLBACK="$1"
OPERATION_ROLLBACK_DIR="$(dirname "$1")"
RUN_AS=""
RICH_RULE='rule family=ipv4 source address=192.0.2.0/24 port port=443 protocol=tcp accept'
RULE_WAS_PRESENT=yes
FIREWALL_RUNTIME_WAS_PRESENT=no
FIREWALL_PERMANENT_WAS_PRESENT=yes
APPLY_MODE=permanent
${rollbackBuilder}
`, [rollbackPath])
    assert.equal(buildRollback.status, 0, buildRollback.stderr)
    const rollbackHarness = runShell(`
firewall_cmd () {
  printf 'QUERY\\n'
  case "$*" in *--query-rich-rule*) return 2;; esac
  printf 'MUTATED\\n'
  return 0
}
. "$1"
`, [rollbackPath])
    assert.notEqual(rollbackHarness.status, 0)
    assert.doesNotMatch(rollbackHarness.stdout, /MUTATED/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('UFW rollback stops before reload when either rules file restore fails', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '443',
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  const firstRestore = result.commandText.indexOf("target-1' '/etc/ufw/user.rules'")
  const secondRestore = result.commandText.indexOf("target-2' '/etc/ufw/user6.rules'")
  const reload = result.commandText.indexOf('echo "$RUN_AS ufw reload"', secondRestore)
  const setE = result.commandText.lastIndexOf("echo 'set -e'", firstRestore)
  assert.ok(setE >= 0)
  assert.ok(setE < firstRestore)
  assert.ok(firstRestore < secondRestore)
  assert.ok(secondRestore < reload)
})

test('rollback scripts stay inside the fixed direct-child directory', async t => {
  const { validateValue } = await import(validationUrl)
  const {
    buildMutationBackup,
    createMutationSafetyMetadata
  } = await import(safetyMetadataUrl)
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const rollbackScript = '\u56de\u6eda\u811a\u672c'
  const confirmation = '\u786e\u8ba4\u6267\u884c'
  const operation = '\u64cd\u4f5c'
  const validPath = '/tmp/shellpilot-rollback/network-current.sh'
  const forgedPath = '/etc/profile.d/x.sh'

  assert.equal(validateValue('rollback-path', validPath), '')
  for (const invalidPath of [
    '',
    '   ',
    '/tmp/shellpilot-rollback',
    '/tmp/shellpilot-rollback/',
    '/tmp/shellpilot-rollback/../x.sh',
    '/tmp/shellpilot-rollback/sub/x.sh',
    '/tmp//shellpilot-rollback/x.sh',
    '/tmp/shellpilot-rollback/x?.sh',
    '/tmp/shellpilot-rollback/x\n.sh',
    forgedPath
  ]) {
    assert.notEqual(
      validateValue('rollback-path', invalidPath),
      '',
      `must reject ${JSON.stringify(invalidPath)}`
    )
  }

  const metadata = createMutationSafetyMetadata({
    title: 'test mutation',
    rollbackScript: validPath,
    verifyCommands: ['true']
  })
  assert.throws(() => createMutationSafetyMetadata({
    title: 'test mutation',
    rollbackScript: forgedPath,
    verifyCommands: ['true']
  }), /\u56de\u6eda\u811a\u672c|rollback/i)
  assert.throws(() => buildMutationBackup({
    ...metadata,
    rollbackScript: forgedPath
  }), /\u56de\u6eda\u811a\u672c|rollback/i)

  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const commands = getServerMaintenanceQuickCommands()
  const mutationCases = [
    ['builtin-server-network-change-ip', {
      网卡: 'eth0',
      '\u65b0IP/CIDR': '192.0.2.20/24',
      配置方式: 'temporary',
      [confirmation]: 'yes'
    }],
    ['builtin-server-firewall-open-port', {
      端口: '443',
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      [confirmation]: 'yes'
    }],
    ['builtin-server-service-action', {
      服务名称: 'nginx.service',
      [operation]: 'restart',
      [confirmation]: 'yes'
    }],
    ['builtin-server-docker-action', {
      容器名称: 'web-1',
      [operation]: 'restart',
      [confirmation]: 'yes'
    }],
    ['builtin-server-file-permission', {
      目标路径: '/var/www/app',
      [operation]: 'apply',
      [confirmation]: 'yes'
    }]
  ]

  for (const [id, overrides] of mutationCases) {
    await t.test(id, () => {
      const item = commands.find(command => command.id === id)
      const submissions = []
      const result = submitValidatedQuickCommand({
        id,
        item,
        context,
        inputOnly: false,
        text: 'stale command text',
        paramValues: {
          ...buildQuickCommandParamValues(item, context),
          ...overrides,
          [rollbackScript]: forgedPath
        }
      }, (...args) => submissions.push(args))

      assert.equal(result.submitted, false)
      assert.equal(result.commandText, '')
      assert.ok(result.errors[rollbackScript])
      assert.equal(submissions.length, 0)
    })
  }
})

test('network IP mutation rejects IPv6 CIDR at the field boundary', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-network-change-ip')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const newCidr = '\u65b0IP/CIDR'
  const submissions = []
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    inputOnly: false,
    text: 'stale command text',
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      网卡: 'eth0',
      [newCidr]: '2001:db8::20/64',
      配置方式: 'temporary',
      确认执行: 'yes'
    }
  }, (...args) => submissions.push(args))

  assert.equal(result.submitted, false)
  assert.equal(result.commandText, '')
  assert.ok(result.errors[newCidr])
  assert.equal(submissions.length, 0)
})

test('ufw state and verification checks match the complete rule column', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const statusOutput = [
    'Status: active',
    '',
    'To                         Action      From',
    '--                         ------      ----',
    '443/tcp                    ALLOW       Anywhere',
    '443/tcp (v6)               ALLOW       Anywhere (v6)'
  ].join('\n')
  const statusRuleColumns = statusOutput
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/)[0])
  assert.equal(statusRuleColumns.includes('43/tcp'), false)

  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '43',
      协议: 'tcp',
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  assert.ok(result.commandText.includes(
    'ufw status | awk -v rule="$PORT/$PROTO" \'($1 == rule && $2 == "ALLOW"'
  ))
  const verifyText = result.commandText.slice(
    result.commandText.indexOf('# __SHELLPILOT_MUTATION_VERIFY__')
  )
  assert.ok(verifyText.includes(
    'ufw status | awk -v rule="43/tcp" \'($1 == rule && $2 == "ALLOW"'
  ))
  assert.doesNotMatch(verifyText, /ufw status \| grep -F/)
})

test('maintenance submission rejects unresolved template tokens before store expansion', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-log-search')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const submissions = []
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    inputOnly: false,
    text: 'stale command text',
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      关键词: '{{clipboard}}'
    }
  }, (...args) => submissions.push(args))

  assert.equal(result.submitted, false)
  assert.equal(result.commandText, '')
  assert.ok(result.errors.关键词)
  assert.equal(submissions.length, 0)
})

test('maintenance validation rejects every C0 and C1 control character', async () => {
  const { validateValue } = await import(validationUrl)
  const controls = [
    ...Array.from({ length: 0x20 }, (_, code) => code),
    ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset)
  ]

  for (const code of controls) {
    const value = `safe${String.fromCharCode(code)}value`
    assert.notEqual(
      validateValue('template-text', value),
      '',
      `must reject control U+${code.toString(16).padStart(4, '0')}`
    )
  }
})

test('PTY control characters become field errors and submit nothing', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-log-search')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })

  for (const code of [0x03, 0x04, 0x09, 0x1b, 0x7f, 0x85]) {
    const submissions = []
    const result = submitValidatedQuickCommand({
      id: item.id,
      item,
      context,
      inputOnly: false,
      text: 'stale command text',
      paramValues: {
        ...buildQuickCommandParamValues(item, context),
        关键词: `safe${String.fromCharCode(code)}value`
      }
    }, (...args) => submissions.push(args))

    assert.equal(result.submitted, false, `U+${code.toString(16)}`)
    assert.equal(result.commandText, '')
    assert.ok(result.errors.关键词)
    assert.equal(submissions.length, 0)
  }
})

test('custom packet filters reject quoted option injection on the real submit path', async () => {
  const { validateValue } = await import(validationUrl)
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const maliciousFilter = "tcp and port 443 '-w' '/tmp/owned.pcap'"
  const legitimateFilter = 'tcp and (dst port 443 or src host 192.0.2.10)'
  assert.equal(validateValue('packet-filter', legitimateFilter), '')
  assert.notEqual(validateValue('packet-filter', maliciousFilter), '')

  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-packet-capture')
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
  const submissions = []
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    inputOnly: false,
    text: 'stale command text',
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      网卡: 'any',
      过滤类型: 'custom',
      自定义过滤: maliciousFilter,
      数量: '10',
      抓包文件: '/tmp/safe.pcap'
    }
  }, (...args) => submissions.push(args))

  assert.equal(result.submitted, false)
  assert.equal(result.commandText, '')
  assert.ok(result.errors.自定义过滤)
  assert.equal(submissions.length, 0)

  const safeResult = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      网卡: 'any',
      过滤类型: 'custom',
      自定义过滤: legitimateFilter,
      数量: '10',
      抓包文件: '/tmp/safe.pcap'
    }
  }, () => {})
  assert.equal(safeResult.submitted, true)
  assert.match(
    safeResult.commandText,
    /tcpdump -nn -i any 'tcp' 'and' '\(' 'dst' 'port' '443' 'or' 'src' 'host' '192\.0\.2\.10' '\)'/
  )
})

test('all mutation rollback scripts use private unpredictable temporary files', async t => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const commands = getServerMaintenanceQuickCommands()
  const cases = [
    ['builtin-server-network-change-ip', {
      网卡: 'eth0',
      '新IP/CIDR': '192.0.2.20/24',
      配置方式: 'temporary',
      确认执行: 'yes'
    }],
    ['builtin-server-firewall-open-port', {
      端口: '443',
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      确认执行: 'yes'
    }],
    ['builtin-server-service-action', {
      服务名称: 'nginx.service',
      操作: 'restart',
      确认执行: 'yes'
    }],
    ['builtin-server-docker-action', {
      容器名称: 'web-1',
      操作: 'restart',
      确认执行: 'yes'
    }],
    ['builtin-server-file-permission', {
      目标路径: '/var/www/app',
      操作: 'apply',
      确认执行: 'yes'
    }]
  ]

  for (const [id, overrides] of cases) {
    await t.test(id, () => {
      const item = commands.find(command => command.id === id)
      const result = submitValidatedQuickCommand({
        id,
        item,
        context,
        boundTabId: 'tab-maintenance-test',
        inputOnly: false,
        paramValues: {
          ...buildQuickCommandParamValues(item, context),
          ...overrides
        }
      }, () => {})
      assert.equal(result.submitted, true)
      assert.doesNotMatch(result.commandText, /TMP_ROLLBACK="\/tmp\/[^"\n]*\$\$\.sh"/)
      assert.match(
        result.commandText,
        /TMP_ROLLBACK="\$\(mktemp "\$OPERATION_ROLLBACK_DIR\/rollback\.XXXXXX"\)" \|\|/
      )
      assert.match(result.commandText, /\[ -L "\$TMP_ROLLBACK" \] \|\| \[ ! -f "\$TMP_ROLLBACK" \]/)
      assert.match(result.commandText, /case "\$ROLLBACK_SCRIPT" in "\$ROLLBACK_DIR"\/\*\)/)
      assert.match(result.commandText, /\[ -L "\$ROLLBACK_SCRIPT" \] \|\| \[ ! -f "\$ROLLBACK_SCRIPT" \]/)
    })
  }
})

test('UFW detection verifies a global ALLOW and rollback restores exact rules files', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const isGlobalAllow = (line, rule) => {
    const columns = line.trim().split(/\s+/)
    return (columns[0] === rule && columns[1] === 'ALLOW' && columns[2] === 'Anywhere') ||
      (columns[0] === rule && columns[1] === '(v6)' && columns[2] === 'ALLOW' &&
        columns[3] === 'Anywhere' && columns[4] === '(v6)')
  }
  assert.equal(isGlobalAllow('443/tcp DENY Anywhere', '443/tcp'), false)
  assert.equal(isGlobalAllow('443/tcp ALLOW 192.0.2.0/24', '443/tcp'), false)
  assert.equal(isGlobalAllow('443/tcp ALLOW Anywhere', '443/tcp'), true)
  assert.equal(isGlobalAllow('443/tcp (v6) ALLOW Anywhere (v6)', '443/tcp'), true)

  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-firewall-open-port')
  assert.deepEqual(item.safetyMetadata.backupTargets, [
    '/etc/ufw/user.rules',
    '/etc/ufw/user6.rules',
    '/etc/firewalld/zones'
  ])
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22', username: 'root' })
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-maintenance-test',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      端口: '443',
      协议: 'tcp',
      防火墙类型: 'ufw',
      生效方式: 'runtime',
      确认执行: 'yes'
    }
  }, () => {})

  assert.equal(result.submitted, true)
  assert.match(result.commandText, /\$1 == rule && \$2 == "ALLOW" && \$3 == "Anywhere"/)
  assert.match(result.commandText, /\$1 == rule && \$2 == "\(v6\)" && \$3 == "ALLOW"/)
  assert.match(result.commandText, /OPERATION_ROLLBACK_DIR\/target-1[\s\S]*\/etc\/ufw\/user\.rules/)
  assert.match(result.commandText, /OPERATION_ROLLBACK_DIR\/target-2[\s\S]*\/etc\/ufw\/user6\.rules/)
  assert.doesNotMatch(result.commandText, /\$1 == rule \{ found=1 \}/)
})

test('mutation safety metadata locks and enforces a bounded backup budget', async () => {
  const {
    buildMutationBackup,
    buildMutationPreflight,
    createMutationSafetyMetadata
  } = await import(safetyMetadataUrl)
  const metadata = createMutationSafetyMetadata({
    title: 'bounded backup',
    backupTargets: ['/etc/hosts'],
    verifyCommands: ['test -s /etc/hosts']
  })

  assert.equal(metadata.maxBackupKb, 8192)
  assert.throws(
    () => buildMutationPreflight({ ...metadata, maxBackupKb: 8193 }),
    /备份.*上限/
  )
  assert.throws(
    () => buildMutationBackup({ ...metadata, maxBackupKb: 1 }),
    /备份.*上限/
  )

  const preflight = buildMutationPreflight(metadata)
  assert.match(preflight, /BACKUP_AS="sudo"/)
  assert.match(preflight, /sudo -v/)
  const backup = buildMutationBackup(metadata)
  assert.match(backup, /MAX_BACKUP_KB=8192/)
  assert.match(backup, /du -sk --/)
  assert.match(backup, /SHELLPILOT_BACKUP_TOTAL_KB/)
  assert.match(backup, /\$BACKUP_AS cp -a --/)
  assert.ok(backup.indexOf('du -sk --') < backup.indexOf('$BACKUP_AS cp -a --'))
})

test('network probe request gate rejects a cancelled A result after B opens', async () => {
  const { createNetworkProbeRequestGate } = await import(networkUrl)
  assert.equal(typeof createNetworkProbeRequestGate, 'function')

  const gate = createNetworkProbeRequestGate()
  let pending = { probeSessionId: 'session-a', detectedNetwork: null }
  const requestA = gate.begin(pending.probeSessionId)
  gate.cancel()
  pending = { probeSessionId: 'session-b', detectedNetwork: null }
  const requestB = gate.begin(pending.probeSessionId)

  if (gate.isCurrent(requestA, pending.probeSessionId)) {
    pending = { ...pending, detectedNetwork: { interface: 'late-a' } }
  }
  assert.equal(pending.detectedNetwork, null)
  assert.equal(gate.isCurrent(requestA, pending.probeSessionId), false)
  assert.equal(gate.isCurrent(requestB, pending.probeSessionId), true)

  if (gate.isCurrent(requestB, pending.probeSessionId)) {
    pending = { ...pending, detectedNetwork: { interface: 'eth-b' } }
  }
  assert.equal(pending.detectedNetwork.interface, 'eth-b')

  gate.cancel()
  assert.equal(gate.isCurrent(requestB, pending.probeSessionId), false)

  const boxSource = fs.readFileSync(quickCommandsBoxPath, 'utf8')
  assert.match(boxSource, /createNetworkProbeRequestGate/)
  assert.match(
    boxSource,
    /function handlePendingCancel \(\) \{\s+resetTargetDiscovery\(\)\s+cancelNetworkProbe\(\)\s+setPendingCommand\(null\)/
  )
  assert.match(boxSource, /probeSessionId/)
  assert.match(boxSource, /networkProbeRequestGateRef\.current\.isCurrent/)
  assert.match(boxSource, /networkProbeRequestGateRef\.current\.cancel\(\)/)
})

test('network probe gate binds token command tab and context identity', async () => {
  const { createNetworkProbeRequestGate } = await import(networkUrl)
  const gate = createNetworkProbeRequestGate()
  const identityA = {
    sessionId: 'probe-a',
    commandId: 'builtin-server-network-change-ip',
    tabId: 'tab-a',
    contextIdentity: 'root@server-a.example.com:22'
  }
  const requestA = gate.begin(identityA)

  assert.equal(gate.isCurrent(requestA, identityA), true)
  for (const changedIdentity of [
    { ...identityA, sessionId: 'probe-b' },
    { ...identityA, commandId: 'builtin-server-log-search' },
    { ...identityA, tabId: 'tab-b' },
    { ...identityA, contextIdentity: 'root@server-b.example.com:22' }
  ]) {
    assert.equal(gate.isCurrent(requestA, changedIdentity), false)
  }

  let pendingB = { detectedNetwork: null }
  const identityB = {
    ...identityA,
    sessionId: 'probe-b',
    tabId: 'tab-b',
    contextIdentity: 'root@server-b.example.com:22'
  }
  if (gate.isCurrent(requestA, identityB)) {
    pendingB = { detectedNetwork: { interface: 'late-a' } }
  }
  assert.equal(pendingB.detectedNetwork, null)
})

test('pending maintenance command cannot submit after the active tab changes', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-network-change-ip')
  const context = buildQuickCommandContext({
    host: 'server-a.example.com',
    port: '22',
    username: 'root'
  })
  const submissions = []
  const result = submitValidatedQuickCommand({
    id: item.id,
    item,
    context,
    boundTabId: 'tab-a',
    contextIdentity: 'root@server-a.example.com:22',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      网卡: 'eth0',
      '新IP/CIDR': '192.0.2.20/24',
      配置方式: 'temporary',
      确认执行: 'yes'
    }
  }, (...args) => submissions.push(args), {
    tabId: 'tab-b',
    contextIdentity: 'root@server-b.example.com:22'
  })

  assert.equal(result.submitted, false)
  assert.equal(result.commandText, '')
  assert.match(result.sessionError, /当前服务器已切换/)
  assert.equal(submissions.length, 0)
})

test('quick command modal wires active tab identity into probe and submit', () => {
  const boxSource = fs.readFileSync(quickCommandsBoxPath, 'utf8')
  assert.match(
    boxSource,
    /buildQuickCommandContextIdentity/
  )
  assert.match(boxSource, /boundTabId: commandSession\.tabId/)
  assert.match(boxSource, /activeNetworkProbeIdentityRef/)
  const submitStart = boxSource.indexOf('function handlePendingOk () {')
  const submitEnd = boxSource.indexOf('function handleClose () {', submitStart)
  assert.ok(submitStart >= 0 && submitEnd > submitStart)
  const submitHandler = boxSource.slice(submitStart, submitEnd)
  assert.match(submitHandler, /submitValidatedQuickCommand\(/)
  assert.match(submitHandler, /getCurrentQuickCommandSession\(pendingCommand\?\.id\)/)
  assert.match(submitHandler, /message\.warning\(result\.sessionError\)/)
})

test('successful submission keeps the bound tab through delayed execution', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    submitValidatedQuickCommand
  } = await import(contextUrl)
  const item = getServerMaintenanceQuickCommands()
    .find(command => command.id === 'builtin-server-network-change-ip')
  const context = buildQuickCommandContext({
    host: 'server-a.example.com',
    port: '22',
    username: 'root'
  })
  const pendingCommand = {
    id: item.id,
    item,
    context,
    boundTabId: 'tab-a',
    contextIdentity: 'root@server-a.example.com:22',
    inputOnly: false,
    paramValues: {
      ...buildQuickCommandParamValues(item, context),
      网卡: 'eth0',
      '新IP/CIDR': '192.0.2.20/24',
      配置方式: 'temporary',
      确认执行: 'yes'
    }
  }
  let activeTabId = 'tab-a'
  let submittedOptions
  let resolveExecution
  const execution = new Promise(resolve => {
    resolveExecution = resolve
  })

  const result = submitValidatedQuickCommand(
    pendingCommand,
    (id, options) => {
      submittedOptions = options
      setTimeout(() => {
        resolveExecution(options.tabId || activeTabId)
      }, 5)
    },
    {
      commandId: item.id,
      tabId: 'tab-a',
      contextIdentity: 'root@server-a.example.com:22'
    }
  )

  assert.equal(result.submitted, true)
  activeTabId = 'tab-b'
  const executionTabId = await execution
  assert.equal(submittedOptions.tabId, 'tab-a')
  assert.equal(executionTabId, 'tab-a')
})
