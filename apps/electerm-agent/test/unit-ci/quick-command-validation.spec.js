const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
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
    assert.match(validateValue('port', value), /换行|NUL/)
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
      /换行|NUL/
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
  const context = buildQuickCommandContext({ host: 'server.example.com', port: '22' })
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
