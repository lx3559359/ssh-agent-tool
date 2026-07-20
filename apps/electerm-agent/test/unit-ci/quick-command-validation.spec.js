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
  const command = buildMaintenanceDiscoveryCommand()

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
    '__SHELLPILOT_CAP_BEGIN__',
    'os=ubuntu',
    'init=systemd',
    'tool=ss',
    'tool=journalctl',
    'tool=docker',
    '__SHELLPILOT_CAP_END__',
    'prompt'
  ].join('\n')
  assert.deepEqual(parseMaintenanceDiscoveryOutput(output), {
    os: 'ubuntu',
    init: 'systemd',
    tools: ['ss', 'journalctl', 'docker']
  })
})

test('maintenance discovery fails closed for incomplete or missing required output', async () => {
  const { parseMaintenanceDiscoveryOutput } = await import(discoveryUrl)

  for (const output of [
    '__SHELLPILOT_CAP_BEGIN__\nos=ubuntu\ninit=systemd',
    'os=ubuntu\ninit=systemd\n__SHELLPILOT_CAP_END__',
    '__SHELLPILOT_CAP_BEGIN__\ninit=systemd\n__SHELLPILOT_CAP_END__',
    '__SHELLPILOT_CAP_BEGIN__\nos=ubuntu\n__SHELLPILOT_CAP_END__'
  ]) {
    assert.throws(
      () => parseMaintenanceDiscoveryOutput(output),
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
  assert.match(source, /validateQuickCommandParams\(pendingCommand\.item, pendingCommand\.paramValues\)/)
  assert.match(source, /paramErrors/)
  assert.match(source, /status=\{error \? 'error' : undefined\}/)
  assert.match(source, /qm-command-param-error/)
  assert.match(source, /role='alert'/)
  assert.match(source, /clearQuickCommandParamError\(old\.paramErrors, name\)/)
  assert.match(source, /shellpilotQuickFinalCommandPreview/)
})
