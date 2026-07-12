const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const commandsUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/server-maintenance-commands.js')
).href
const contextUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/quick-command-context.js')
).href
const networkUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/quick-commands/quick-command-network.js')
).href

test('server maintenance quick commands cover common troubleshooting categories', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const commands = getServerMaintenanceQuickCommands()
  const ids = commands.map(item => item.id)
  const commandText = commands
    .flatMap(item => item.commands || [])
    .map(item => item.command)
    .join('\n')

  for (const expected of [
    'builtin-server-overview',
    'builtin-server-disk',
    'builtin-server-memory',
    'builtin-server-network-listen',
    'builtin-server-service-logs',
    'builtin-server-nginx',
    'builtin-server-docker',
    'builtin-server-packet-capture'
  ]) {
    assert.ok(ids.includes(expected), `missing ${expected}`)
  }

  assert.match(commandText, /uptime/)
  assert.match(commandText, /df -hT/)
  assert.match(commandText, /free -h/)
  assert.match(commandText, /ss -tunlp/)
  assert.match(commandText, /journalctl/)
  assert.match(commandText, /nginx -t/)
  assert.match(commandText, /docker ps/)
  assert.match(commandText, /tcpdump -nn -i \{\{网卡\}\}/)
})

test('server maintenance quick commands are beginner-friendly and cover core maintenance tasks', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const commands = getServerMaintenanceQuickCommands()
  const ids = commands.map(item => item.id)

  assert.ok(commands.length >= 26, 'should provide enough common maintenance commands')
  for (const item of commands) {
    assert.equal(typeof item.description, 'string', `${item.id} missing description`)
    assert.ok(item.description.length >= 8, `${item.id} description is too short`)
    assert.equal(typeof item.usage, 'string', `${item.id} missing usage`)
    assert.ok(item.usage.length >= 8, `${item.id} usage is too short`)
    assert.ok(Array.isArray(item.labels), `${item.id} missing labels`)
    assert.ok(item.labels.length >= 2, `${item.id} should have useful labels`)
    assert.ok(Array.isArray(item.commands) && item.commands.length >= 1, `${item.id} missing commands`)
  }

  for (const expectedId of [
    'builtin-server-ip-query',
    'builtin-server-time-query',
    'builtin-server-firewall-status',
    'builtin-server-firewall-open-port',
    'builtin-server-port-process',
    'builtin-server-network-change-ip',
    'builtin-server-process-top',
    'builtin-server-dns-check',
    'builtin-server-packet-capture',
    'builtin-server-connectivity-check',
    'builtin-server-http-check',
    'builtin-server-tls-check',
    'builtin-server-directory-analysis',
    'builtin-server-process-detail',
    'builtin-server-service-action',
    'builtin-server-docker-action',
    'builtin-server-file-permission'
  ]) {
    assert.ok(ids.includes(expectedId), `missing ${expectedId}`)
  }

  const editable = commands.filter(item => item.editBeforeRun)
  assert.ok(editable.length >= 3, 'parameterized commands should be editable before sending to SSH')
  for (const item of editable) {
    assert.equal(item.confirmRequired, true, `${item.id} should require confirmation`)
    assert.ok(item.commands.some(step => /\{\{.+?\}\}/.test(step.command)), `${item.id} should expose placeholders`)
    assert.ok(Array.isArray(item.params), `${item.id} should expose editable form params`)
    assert.ok(item.params.length >= 1, `${item.id} should expose at least one form param`)
    for (const param of item.params) {
      assert.equal(typeof param.name, 'string', `${item.id} param missing name`)
      assert.equal(typeof param.label, 'string', `${item.id} param ${param.name} missing label`)
      assert.equal(typeof param.help, 'string', `${item.id} param ${param.name} missing help`)
    }
  }
})

test('packet capture quick commands are bounded and marked as confirm-required', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const packet = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-packet-capture')

  assert.ok(packet)
  assert.equal(packet.confirmRequired, true)
  assert.equal(packet.editBeforeRun, true)
  assert.ok(Array.isArray(packet.params), 'packet capture should expose editable form params')
  assert.deepEqual(
    packet.params.map(item => item.name),
    ['网卡', '过滤类型', '过滤端口', '过滤IP', '自定义过滤', '数量', '抓包文件']
  )
  assert.match(packet.description, /先检查 tcpdump/)
  assert.ok(Array.isArray(packet.advancedUsage))
  assert.ok(packet.advancedUsage.some(item => /保存/.test(item)))
  assert.ok(packet.advancedUsage.some(item => /端口/.test(item)))
  assert.ok(packet.advancedUsage.some(item => /IP/.test(item)))
  for (const step of packet.commands) {
    assert.match(step.command, /command -v tcpdump/)
    assert.match(step.command, /未安装 tcpdump/)
    assert.match(step.command, /-i\s+\{\{网卡\}\}/)
    assert.match(step.command, /-c\s+\{\{.+?\}\}/)
    assert.match(step.command, /-w\s+"\$CAP_FILE"/)
    assert.match(step.command, /抓包文件/)
  }
})

test('quick command context fills safe editable command defaults from the active server', async () => {
  const {
    buildQuickCommandContext,
    applyQuickCommandDefaults
  } = await import(contextUrl)

  const context = buildQuickCommandContext({
    host: '23.94.104.203',
    port: 2222,
    username: 'root',
    title: 'prod-web-01'
  })

  assert.equal(context.host, '23.94.104.203')
  assert.equal(context.port, '2222')
  assert.equal(context.username, 'root')
  assert.match(context.capturePath, /\/tmp\/shellpilot-capture-23-94-104-203-/)
  assert.equal(context.packetFilter, 'tcp')
  assert.equal(context.packetCount, '50')

  const text = applyQuickCommandDefaults(
    'sudo tcpdump -nn -i any {{过滤条件}} -c {{数量}} -w "{{抓包文件}}"',
    context
  )

  assert.equal(
    text,
    `sudo tcpdump -nn -i any tcp -c 50 -w "${context.capturePath}"`
  )
})

test('packet capture command preview does not pretend success when tcpdump is missing', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    applyQuickCommandDefaults
  } = await import(contextUrl)

  const packet = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-packet-capture')
  const context = buildQuickCommandContext({
    host: '23.94.104.203',
    port: 22,
    username: 'root'
  })
  const text = applyQuickCommandDefaults(packet.commands[0].command, context)

  assert.doesNotMatch(text, /host 23\.94\.104\.203 -c/)
  assert.match(text, /if ! command -v tcpdump/)
  assert.match(text, /未安装 tcpdump/)
  assert.match(text, /else[\s\S]*抓包文件/)
})

test('packet capture form params build a concrete tcpdump command', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    applyQuickCommandParamValues
  } = await import(contextUrl)

  const packet = getServerMaintenanceQuickCommands()
    .find(item => item.id === 'builtin-server-packet-capture')
  const context = buildQuickCommandContext({
    host: '23.94.104.203',
    port: 22,
    username: 'root'
  })
  const defaults = buildQuickCommandParamValues(packet, context)

  assert.equal(defaults.网卡, 'any')
  assert.equal(defaults.过滤类型, 'tcp')
  assert.equal(defaults.过滤端口, '')
  assert.equal(defaults.过滤IP, '')
  assert.equal(defaults.自定义过滤, '')
  assert.equal(defaults.数量, '50')
  assert.equal(defaults.抓包文件, context.capturePath)

  const byPort = applyQuickCommandParamValues(packet.commands[0].command, {
    ...defaults,
    过滤类型: 'port',
    过滤端口: '443',
    数量: '120'
  }, context)
  assert.match(byPort, /tcpdump -nn -i any port 443 -c 120/)
  assert.doesNotMatch(byPort, /\{\{.+?\}\}/)
  assert.doesNotMatch(byPort, /host 23\.94\.104\.203 -c/)

  const byIpAndPort = applyQuickCommandParamValues(packet.commands[0].command, {
    ...defaults,
    网卡: 'eth0',
    过滤类型: 'ip-port',
    过滤IP: '8.8.8.8',
    过滤端口: '53',
    抓包文件: '/tmp/dns-test.pcap'
  }, context)
  assert.match(byIpAndPort, /tcpdump -nn -i eth0 host 8\.8\.8\.8 and port 53 -c 50/)
  assert.match(byIpAndPort, /CAP_FILE="\/tmp\/dns-test\.pcap"/)

  const custom = applyQuickCommandParamValues(packet.commands[0].command, {
    ...defaults,
    过滤类型: 'custom',
    自定义过滤: 'tcp and dst port 443'
  }, context)
  assert.match(custom, /tcpdump -nn -i any tcp and dst port 443 -c 50/)
})

test('editable maintenance commands use form params instead of raw placeholders', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)
  const {
    buildQuickCommandContext,
    buildQuickCommandParamValues,
    applyQuickCommandParamValues
  } = await import(contextUrl)

  const commands = getServerMaintenanceQuickCommands()
  const context = buildQuickCommandContext({
    host: '23.94.104.203',
    port: 22,
    username: 'root'
  })

  const cases = [
    {
      id: 'builtin-server-port-process',
      values: { 端口: '8080' },
      expected: /lsof -i :8080/
    },
    {
      id: 'builtin-server-dns-check',
      values: { 域名: 'example.com', 记录类型: 'A', DNS服务器: '8.8.8.8' },
      expected: /DOMAIN="example\.com"[\s\S]*RECORD_TYPE="A"[\s\S]*DNS_SERVER="8\.8\.8\.8"/
    },
    {
      id: 'builtin-server-firewall-open-port',
      values: { 端口: '443', 协议: 'tcp', 防火墙类型: 'auto', 生效方式: 'permanent' },
      expected: /PORT="443"[\s\S]*PROTO="tcp"/
    },
    {
      id: 'builtin-server-network-change-ip',
      values: {
        网卡: 'eth0',
        '新IP/CIDR': '10.0.0.20/24',
        网关: '10.0.0.1',
        DNS: '223.5.5.5,8.8.8.8',
        配置方式: 'temporary',
        确认执行: 'yes'
      },
      expected: /IFACE="eth0"[\s\S]*NEW_CIDR="10\.0\.0\.20\/24"[\s\S]*APPLY_CHANGE="yes"/
    },
    {
      id: 'builtin-server-service-status',
      values: { 服务名: 'docker', 日志行数: '80', 查看日志: 'yes' },
      expected: /SERVICE="docker"[\s\S]*LOG_LINES="80"/
    },
    {
      id: 'builtin-server-log-search',
      values: { 日志路径: '/var/log/nginx', 关键词: 'timeout', 输出行数: '120', 包含压缩日志: 'yes' },
      expected: /LOG_PATH="\/var\/log\/nginx"[\s\S]*KEYWORD="timeout"[\s\S]*LIMIT="120"/
    }
  ]

  for (const testCase of cases) {
    const item = commands.find(command => command.id === testCase.id)
    assert.ok(item, `missing ${testCase.id}`)
    const defaults = buildQuickCommandParamValues(item, context)
    const text = applyQuickCommandParamValues(
      item.commands.map(step => step.command).join('\n'),
      {
        ...defaults,
        ...testCase.values
      },
      context
    )
    assert.doesNotMatch(text, /\{\{.+?\}\}/, `${testCase.id} should not keep placeholders`)
    assert.match(text, testCase.expected, `${testCase.id} should include form values`)
  }
})

test('high-risk maintenance commands include rollback guidance and safe defaults', async () => {
  const {
    getServerMaintenanceQuickCommands
  } = await import(commandsUrl)

  const commands = getServerMaintenanceQuickCommands()
  const networkChange = commands.find(command => command.id === 'builtin-server-network-change-ip')
  const firewallOpen = commands.find(command => command.id === 'builtin-server-firewall-open-port')

  assert.ok(networkChange)
  assert.ok(firewallOpen)
  assert.ok(networkChange.labels.includes('高风险'))
  assert.equal(networkChange.params.find(param => param.name === '配置方式').defaultValue, 'preview')
  assert.equal(networkChange.params.find(param => param.name === '确认执行').defaultValue, 'no')
  assert.equal(networkChange.params.find(param => param.name === '回滚保护').defaultValue, 'enabled')
  assert.equal(networkChange.params.find(param => param.name === '自动回滚秒数').defaultValue, '120')
  assert.equal(networkChange.params.find(param => param.name === '网卡').type, 'network-interface')

  const networkText = networkChange.commands.map(step => step.command).join('\n')
  const firewallText = firewallOpen.commands.map(step => step.command).join('\n')
  assert.match(networkText, /回滚参考/)
  assert.match(networkText, /预演模式/)
  assert.match(networkText, /shellpilot-rollback/)
  assert.match(networkText, /ROLLBACK_PROTECT/)
  assert.match(networkText, /ROLLBACK_SECONDS/)
  assert.match(networkText, /\.armed/)
  assert.match(firewallText, /回滚参考 firewalld/)
  assert.match(firewallText, /回滚参考 ufw/)
})

test('new parameterized maintenance actions use read-only or preview defaults', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const commands = getServerMaintenanceQuickCommands()
  const serviceAction = commands.find(command => command.id === 'builtin-server-service-action')
  const dockerAction = commands.find(command => command.id === 'builtin-server-docker-action')
  const filePermission = commands.find(command => command.id === 'builtin-server-file-permission')

  assert.equal(serviceAction.params.find(param => param.name === '操作').defaultValue, 'status')
  assert.equal(serviceAction.params.find(param => param.name === '确认执行').defaultValue, 'no')
  assert.equal(dockerAction.params.find(param => param.name === '操作').defaultValue, 'logs')
  assert.equal(dockerAction.params.find(param => param.name === '确认执行').defaultValue, 'no')
  assert.equal(filePermission.params.find(param => param.name === '操作').defaultValue, 'preview')
  assert.equal(filePermission.params.find(param => param.name === '确认执行').defaultValue, 'no')
})

test('every mutating maintenance command provides a reusable rollback action', async () => {
  const { getServerMaintenanceQuickCommands } = await import(commandsUrl)
  const commands = getServerMaintenanceQuickCommands()
  const mutatingIds = [
    'builtin-server-network-change-ip',
    'builtin-server-firewall-open-port',
    'builtin-server-service-action',
    'builtin-server-docker-action',
    'builtin-server-file-permission'
  ]

  for (const id of mutatingIds) {
    const item = commands.find(command => command.id === id)
    assert.ok(item, `missing ${id}`)
    assert.equal(item.mutatesServer, true, `${id} should be marked as mutating`)
    assert.equal(typeof item.rollback?.title, 'string', `${id} missing rollback title`)
    assert.equal(item.rollback?.pathParam, '回滚脚本', `${id} should expose rollback path metadata`)
    assert.ok(Array.isArray(item.rollback?.mutatingValues), `${id} missing mutating values`)
    assert.ok(item.rollback.mutatingValues.length >= 1, `${id} missing mutating values`)
    assert.ok(item.params.some(param => param.name === '回滚脚本'), `${id} missing rollback script param`)
    assert.ok(item.params.some(param => param.name === '确认执行'), `${id} missing execution confirmation`)
    const text = item.commands.map(step => step.command).join('\n')
    assert.match(text, /shellpilot-rollback/, `${id} should create a remote rollback script`)
    assert.match(text, /回滚脚本/, `${id} should report the rollback script`)
  }
})

test('network probe parses active interface and current network values', async () => {
  const {
    buildNetworkProbeCommand,
    parseNetworkProbeOutput,
    mergeDetectedNetworkParams
  } = await import(networkUrl)

  assert.match(buildNetworkProbeCommand(), /ip route show default/)
  assert.match(buildNetworkProbeCommand(), /ip -4 -o addr show/)

  const output = [
    '__SHELLPILOT_NETWORK_BEGIN__',
    'interface=ens18',
    'interfaces=lo,ens18,docker0',
    'interfaceData=lo|127.0.0.1/8|unknown;ens18|10.10.20.15/24|up;docker0|172.17.0.1/16|down;',
    'cidr=10.10.20.15/24',
    'gateway=10.10.20.1',
    'dns=223.5.5.5,119.29.29.29',
    '__SHELLPILOT_NETWORK_END__'
  ].join('\n')
  const detected = parseNetworkProbeOutput(output)

  assert.deepEqual(detected, {
    interface: 'ens18',
    interfaces: ['lo', 'ens18', 'docker0'],
    networkInterfaces: [
      { name: 'lo', cidr: '127.0.0.1/8', state: 'unknown' },
      { name: 'ens18', cidr: '10.10.20.15/24', state: 'up' },
      { name: 'docker0', cidr: '172.17.0.1/16', state: 'down' }
    ],
    cidr: '10.10.20.15/24',
    gateway: '10.10.20.1',
    dns: '223.5.5.5,119.29.29.29'
  })
  assert.deepEqual(
    mergeDetectedNetworkParams({ '新IP/CIDR': '' }, detected),
    {
      网卡: 'ens18',
      '新IP/CIDR': '',
      网关: '10.10.20.1',
      DNS: '223.5.5.5,119.29.29.29'
    }
  )
})

test('network probe rejects incomplete marker output instead of filling unsafe defaults', async () => {
  const { parseNetworkProbeOutput } = await import(networkUrl)

  assert.throws(
    () => parseNetworkProbeOutput('interface=eth0\ncidr=192.168.1.20/24'),
    /未获取到完整的网络探测结果/
  )
  assert.throws(
    () => parseNetworkProbeOutput('__SHELLPILOT_NETWORK_BEGIN__\ninterface=\n__SHELLPILOT_NETWORK_END__'),
    /未识别到活动网卡/
  )
})

test('server maintenance quick commands are included in current terminal quick commands', () => {
  const storeSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/store.js'),
    'utf8'
  )
  const quickCommandSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/store/quick-command.js'),
    'utf8'
  )

  assert.match(storeSource, /getServerMaintenanceQuickCommands/)
  assert.match(storeSource, /serverMaintenanceQuickCommands/)
  assert.match(quickCommandSource, /confirmRequired/)
})

test('quick command UI exposes descriptions and edit-before-run confirmation', () => {
  const boxSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/quick-commands/quick-commands-box.jsx'),
    'utf8'
  )
  const itemSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/quick-commands/quick-command-item.jsx'),
    'utf8'
  )
  const styleSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/quick-commands/qm.styl'),
    'utf8'
  )

  assert.match(boxSource, /Modal/)
  assert.match(boxSource, /editBeforeRun/)
  assert.match(boxSource, /pendingCommand/)
  assert.match(boxSource, /applyQuickCommandDefaults/)
  assert.match(boxSource, /buildQuickCommandParamValues/)
  assert.match(boxSource, /applyQuickCommandParamValues/)
  assert.match(boxSource, /InputNumber/)
  assert.match(boxSource, /renderPendingParams/)
  assert.match(boxSource, /showPendingPreview/)
  assert.match(boxSource, /按表单填写参数（推荐）/)
  assert.match(boxSource, /高级：查看\/微调命令/)
  assert.match(boxSource, /正在自动识别网卡和网络参数/)
  assert.match(boxSource, /识别到.*张网卡/)
  assert.match(boxSource, /network-interface/)
  assert.match(boxSource, /networkInterfaces/)
  assert.match(boxSource, /重新检测/)
  assert.match(boxSource, /立即回滚/)
  assert.match(boxSource, /立即回滚上一次修改/)
  assert.match(boxSource, /暂无可回滚修改/)
  assert.match(boxSource, /保留新配置/)
  assert.match(boxSource, /mcpRunQuickCommandNetworkProbe/)
  assert.match(boxSource, /shellpilot-network-rollback/)
  assert.match(boxSource, /currentTab/)
  assert.match(boxSource, /advancedUsage/)
  assert.match(itemSource, /description/)
  assert.match(itemSource, /usage/)
  assert.match(itemSource, /qm-item-content/)
  assert.match(itemSource, /qm-item-head/)
  assert.match(itemSource, /labels[\s\S]*\.filter/)
  assert.match(boxSource, /shouldTrackRollback/)
  assert.match(boxSource, /rollback\.title/)
  assert.match(boxSource, /快捷回滚/)
  assert.match(styleSource, /\.qm-panel-title/)
  assert.match(styleSource, /\.qm-item-desc/)
  assert.match(styleSource, /\.qm-item-content[\s\S]*width 100%/)
  assert.match(styleSource, /\.qm-item-head[\s\S]*justify-content space-between/)
  assert.match(styleSource, /-webkit-line-clamp 2/)
  assert.match(styleSource, /\.qm-list-wrap[\s\S]*display grid/)
  assert.match(styleSource, /\.qm-list-wrap[\s\S]*overflow-x auto/)
  assert.match(styleSource, /\.qm-wrap-tooltip[\s\S]*height 680px[\s\S]*max-height calc\(100vh - 88px\)/)
  assert.match(styleSource, /\.qm-wrap-tooltip[\s\S]*\.pd2[\s\S]*display flex/)
  assert.match(styleSource, /\.qm-list-wrap[\s\S]*flex 1/)
  assert.match(styleSource, /\.qm-wrap-tooltip[\s\S]*right var\(--quick-command-right-offset/)
  assert.match(styleSource, /\.qm-item[\s\S]*border-radius 12px/)
  assert.match(styleSource, /\.qm-command-modal-tips/)
  assert.match(styleSource, /\.qm-command-param-grid/)
  assert.match(styleSource, /\.qm-command-preview-toggle/)
  assert.match(styleSource, /\.qm-command-preview-label/)
  assert.match(styleSource, /\.qm-command-modal[\s\S]*max-height calc\(100vh - 48px\)/)
  assert.match(styleSource, /\.qm-command-modal[\s\S]*top 24px/)
  assert.match(styleSource, /\.qm-command-modal[\s\S]*\.ant-modal-body[\s\S]*overflow-y auto/)
})

test('top bar exposes a primary quick command entry', () => {
  const topbarSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/aigshell-topbar.jsx'),
    'utf8'
  )
  const topbarStyle = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/main/aigshell-topbar.styl'),
    'utf8'
  )
  const layoutSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/layout/layout.jsx'),
    'utf8'
  )

  assert.match(topbarSource, /key:\s*'quickCommands'/)
  assert.match(topbarSource, /label:\s*'快捷命令'/)
  assert.match(topbarSource, /openQuickCommandBar\s*=\s*true/)
  assert.match(topbarSource, /aigshell-topbar-action-primary/)
  assert.match(topbarStyle, /\.aigshell-topbar-action-primary/)
  assert.match(layoutSource, /currentTab/)
  assert.match(layoutSource, /rightPanelVisible/)
  assert.match(layoutSource, /rightPanelWidth/)
  assert.match(layoutSource, /<QuickCommandsFooterBox[\s\S]*currentTab/)
})
