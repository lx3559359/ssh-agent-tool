const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')
const { pathToFileURL } = require('node:url')
const parser = require('@babel/parser')
const generate = require('@babel/generator').default
const t = require('@babel/types')

const root = path.resolve(__dirname, '../..')

function source (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function parseJsx (relativePath) {
  return parser.parse(source(relativePath), {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining']
  })
}

function findFunction (relativePath, functionName) {
  const ast = parseJsx(relativePath)
  let found = null
  t.traverseFast(ast, node => {
    if (!found && t.isFunctionDeclaration(node) && node.id?.name === functionName) {
      found = node
    }
  })
  assert.ok(found, `${functionName} must exist in ${relativePath}`)
  return found
}

function loadModalFunction (functionName, context = {}) {
  const declaration = findFunction(
    'src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx',
    functionName
  )
  const assignment = parser.parse(`module.exports = ${functionName}`).program.body[0]
  const module = { exports: null }
  vm.runInNewContext(
    generate(t.file(t.program([declaration, assignment]))).code,
    { module, ...context },
    { filename: `ssh-tunnel-modal.${functionName}.js` }
  )
  return module.exports
}

async function loadTunnelCatalog () {
  const filename = path.join(root, 'src/client/common/shellpilot-i18n-overrides.js')
  return import(`${pathToFileURL(filename).href}?tunnel-ui=${Date.now()}-${Math.random()}`)
}

async function loadTunnelUsage () {
  const filename = path.join(root, 'src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
  return import(`${pathToFileURL(filename).href}?tunnel-usage=${Date.now()}-${Math.random()}`)
}

function referencedTunnelTranslationKeys () {
  const files = [
    'src/client/common/clipboard.js',
    'src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx',
    'src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx',
    'src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx',
    'src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js'
  ]
  const pattern = /['"]((?:shellpilotTunnel[A-Za-z0-9]+)|(?:sshTunnel\.diagnostic\.[A-Za-z0-9.]+))['"]/g
  const keys = new Set()
  for (const file of files) {
    for (const match of source(file).matchAll(pattern)) keys.add(match[1])
  }
  return [...keys].sort()
}

function loadRuntimeGuidanceLogic (context = {}) {
  const ast = parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const names = new Set([
    'failureStates',
    'availabilityFor',
    'currentFailureFor',
    'guideSectionFor',
    'guideRequestFor',
    'openGuide',
    'canOpenWebFor',
    'canCopyFor',
    'copyTextSafely',
    'copyableFlowFor',
    'diagnosticValueKeyByToken',
    'localizedDiagnosticValues'
  ])
  const body = []
  const foundExports = []

  for (const node of ast.program.body) {
    if (t.isVariableDeclaration(node) && node.declarations.some(declaration => (
      t.isIdentifier(declaration.id) && names.has(declaration.id.name)
    ))) {
      body.push(node)
    }
    if (
      t.isExportNamedDeclaration(node) &&
      t.isFunctionDeclaration(node.declaration) &&
      names.has(node.declaration.id.name)
    ) {
      body.push(node.declaration)
      foundExports.push(node.declaration.id.name)
    }
  }

  body.push(parser.parse(`module.exports = { ${foundExports.join(', ')} }`).program.body[0])
  const module = { exports: {} }
  vm.runInNewContext(generate(t.file(t.program(body))).code, { module, ...context }, {
    filename: 'ssh-tunnel-runtime-card.logic.js'
  })
  return module.exports
}

function loadGuideLogic () {
  const ast = parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const names = new Set([
    'guideSections',
    'sectionIds',
    'errorHelpSections',
    'errorFocusByHelpSection',
    'errorFocusByCode',
    'normalizeSection',
    'focusErrorFor',
    'currentTunnelTypeFor'
  ])
  const body = []
  const foundExports = []

  for (const node of ast.program.body) {
    if (t.isVariableDeclaration(node) && node.declarations.some(declaration => (
      t.isIdentifier(declaration.id) && names.has(declaration.id.name)
    ))) {
      body.push(node)
    }
    if (t.isExportNamedDeclaration(node)) {
      if (t.isVariableDeclaration(node.declaration)) {
        body.push(node.declaration)
        for (const declaration of node.declaration.declarations) {
          if (t.isIdentifier(declaration.id) && names.has(declaration.id.name)) {
            foundExports.push(declaration.id.name)
          }
        }
      }
      if (
        t.isFunctionDeclaration(node.declaration) &&
        names.has(node.declaration.id.name)
      ) {
        body.push(node.declaration)
        foundExports.push(node.declaration.id.name)
      }
    }
  }

  body.push(parser.parse(`module.exports = { ${foundExports.join(', ')} }`).program.body[0])
  const module = { exports: {} }
  vm.runInNewContext(generate(t.file(t.program(body))).code, { module }, {
    filename: 'ssh-tunnel-guide-modal.logic.js'
  })
  return module.exports
}

function loadFormatShellPilotTranslation () {
  const ast = parser.parse(
    source('src/client/common/shellpilot-i18n-overrides.js'),
    { sourceType: 'module' }
  )
  const exported = ast.program.body.find(node => (
    t.isExportNamedDeclaration(node) &&
    t.isFunctionDeclaration(node.declaration) &&
    node.declaration.id.name === 'formatShellPilotTranslation'
  ))
  assert.ok(exported, 'formatShellPilotTranslation export must exist')
  const assignment = parser.parse('module.exports = formatShellPilotTranslation').program.body[0]
  const module = { exports: null }
  vm.runInNewContext(
    generate(t.file(t.program([exported.declaration, assignment]))).code,
    {
      module,
      getShellPilotTranslation: () => '',
      isMeaningfulString: value => typeof value === 'string' && value.trim() !== ''
    },
    { filename: 'shellpilot-i18n-overrides.format.js' }
  )
  return module.exports
}

test('top bar exposes a lazy-loaded SSH tunnel manager', () => {
  const topbar = source('src/client/components/main/aigshell-topbar.jsx')

  assert.match(topbar, /lazy\(\(\) => import\('\.\.\/ssh-tunnel\/ssh-tunnel-modal'\)\)/)
  assert.match(topbar, /key: 'sshTunnel'/)
  assert.match(topbar, /label: e\('shellpilotTopbarSshTunnel'\)/)
  assert.match(topbar, /<SshTunnelModal/)
})

test('SSH tunnel manager covers three tunnel types and common templates', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const runtimeCard = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const definition = source('src/client/components/ssh-tunnel/ssh-tunnel-definition.js')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')
  const combined = `${modal}\n${runtimeCard}\n${definition}\n${translations}`

  for (const label of [
    '本地转发',
    '远程转发',
    'SOCKS5 动态代理',
    'HTTP',
    'HTTPS',
    'MySQL',
    'PostgreSQL',
    'Redis'
  ]) {
    assert.match(combined, new RegExp(label))
  }
  assert.match(modal, /shellpilotTunnelConnectToStart/)
  assert.match(runtimeCard, /shellpilotTunnelCopyAddress/)
  assert.match(runtimeCard, /shellpilotTunnelEditAndRestart/)
  assert.match(runtimeCard, /shellpilotTunnelStop/)
})

test('SSH tunnel manager calls the native session API without terminal command injection', () => {
  const api = source('src/client/components/ssh-tunnel/ssh-tunnel-api.js')
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const combined = `${api}\n${modal}`

  for (const apiName of [
    'startSshTunnel',
    'stopSshTunnel',
    'listSshTunnels',
    'testSshTunnel'
  ]) {
    assert.match(api, new RegExp(apiName))
  }
  assert.match(api, /refs\.get\('term-' \+ tab\.id\)/)
  assert.doesNotMatch(combined, /\bssh\s+-(?:L|R|D)\b/)
  assert.doesNotMatch(combined, /\.write\(|sendText|runCmd/)
})

test('SSH tunnel manager remains usable on narrow desktop windows', () => {
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')

  assert.match(styles, /@media \(max-width: 1100px\)/)
  assert.match(styles, /grid-template-columns 1fr/)
  assert.match(styles, /overflow-y auto/)
})

test('SSH tunnel manager persists profiles to the active server bookmark', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /findBookmarkForTab/)
  assert.match(modal, /upsertBookmarkTunnel/)
  assert.match(modal, /removeBookmarkTunnel/)
  assert.match(modal, /store\.editItem\(currentBookmark\.id/)
  assert.match(modal, /shellpilotTunnelSavedProfiles/)
  assert.match(modal, /shellpilotTunnelAutoStartNext/)
  assert.match(translations, /shellpilotTunnelSavedProfiles: '已保存的隧道配置'/)
  assert.match(translations, /shellpilotTunnelAutoStartNext: '下次连接自动启动'/)
})

test('SSH tunnel validation messages and flow previews are readable Chinese', () => {
  const definition = source('src/client/components/ssh-tunnel/ssh-tunnel-definition.js')

  assert.match(definition, /端口必须是 1 到 65535 之间的整数/)
  assert.match(definition, /不支持的 SSH 隧道类型/)
  assert.match(definition, /仅监听回环地址/)
  assert.match(definition, /本机 .*SSH 服务器/)
})

test('help center explains tunnel lifecycle, safety and common failures', () => {
  const help = source('src/client/components/main/help-center-modal.jsx')
  const guide = source('docs/USER_GUIDE_ZH.md')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  for (const text of [
    '本地转发',
    '远程转发',
    'SOCKS5',
    '自动启动',
    'SSH 断开',
    'EADDRINUSE',
    'administratively prohibited',
    '目标服务拒绝连接'
  ]) {
    assert.match(help, new RegExp(text))
  }
  const beginnerDocumentation = `${help}\n${guide}`
  for (const text of [
    '我想访问服务器上的网页或数据库',
    '直接在本机浏览器打开，不需要设置代理',
    'SOCKS5 需要在浏览器或应用中设置代理',
    '不会修改 Windows 全局代理',
    '远程目标地址相对于 SSH 服务器',
    'AllowTcpForwarding',
    'PermitOpen',
    'DisableForwarding',
    'no-port-forwarding',
    'GatewayPorts',
    'HTTPS 证书警告不等于隧道失败',
    'SSH_TUNNEL_FORWARDING_PROHIBITED',
    'SSH_TUNNEL_DESTINATION_REFUSED'
  ]) {
    assert.ok(beginnerDocumentation.includes(text), `missing beginner SSH tunnel guidance: ${text}`)
  }
  let previousHeadingIndex = -1
  for (const heading of [
    '### 14.1 三秒选择正确类型',
    '### 14.2 本地转发：访问服务器网页和数据库',
    '### 14.3 本地转发启动后怎么访问',
    '### 14.4 SOCKS5：让浏览器或应用流量经过服务器',
    '### 14.5 Firefox、Chrome 和 Edge 的 SOCKS5 设置',
    '### 14.6 远程转发：从服务器访问本机服务',
    '### 14.7 三层检测结果怎么看',
    '### 14.8 服务器禁止转发的安全检查',
    '### 14.9 目标拒绝、端口占用、超时和证书警告',
    '### 14.10 安全清单与术语'
  ]) {
    const headingIndex = guide.indexOf(heading)
    assert.ok(headingIndex > previousHeadingIndex, `missing or out-of-order SSH tunnel heading: ${heading}`)
    previousHeadingIndex = headingIndex
  }
  assert.match(translations, /shellpilotHelpForwarding: 'SSH 隧道'/)
})

test('SSH tunnel manager offers an explicit suggested port without auto-starting it', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /portConflict/)
  assert.match(modal, /SSH_TUNNEL_PORT_IN_USE/)
  assert.match(modal, /suggestedPort/)
  assert.match(modal, /shellpilotTunnelUseSuggestedPort/)
  assert.doesNotMatch(modal, /startSshTunnelRuntime\([^)]*suggestedPort/)
  assert.match(translations, /shellpilotTunnelPortConflict:/)
  assert.match(translations, /shellpilotTunnelUseSuggestedPort:/)
})

test('SSH tunnel manager shows health states and bounded disconnect history', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')

  assert.match(modal, /tunnelHealthPresentation/)
  assert.match(modal, /shellpilotTunnelDisconnectHistory/)
  assert.match(modal, /entry\.events/)
  assert.match(modal, /showDisconnectHistory/)
  assert.match(styles, /\.ssh-tunnel-history-list/)
  assert.match(translations, /shellpilotTunnelHealthHealthy: '健康'/)
  assert.match(translations, /shellpilotTunnelHealthReconnecting: '重连中'/)
  assert.match(translations, /shellpilotTunnelDisconnectHistory: '断线记录'/)
})

test('SSH tunnel runtime card surfaces the current actionable failure', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /currentFailureFor/)
  assert.match(card, /ssh-tunnel-diagnostic/)
  assert.match(card, /diagnostic\.summaryKey/)
})

test('runtime guidance card derives truthful availability and safe access actions', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /import \{ getTunnelUsage \} from '\.\/ssh-tunnel-usage\.js'/)
  assert.match(card, /import \{ getTunnelDiagnostic \} from '\.\/ssh-tunnel-diagnostics\.js'/)
  assert.match(card, /import \{ copy \} from '\.\.\/\.\.\/common\/clipboard'/)
  assert.match(card, /export default function SshTunnelRuntimeCard \(\{\s*entry,\s*busy,\s*onTest,\s*onEdit,\s*onEditAndRestart,\s*onStop,\s*onOpenGuide,\s*onShowHistory\s*\}\)/)
  assert.match(card, /const usage = getTunnelUsage\(entry\?\.definition \|\| \{\}\)/)
  assert.match(card, /const currentFailure = currentFailureFor\(entry\)/)
  assert.match(card, /const diagnostic = currentFailure\s*\? getTunnelDiagnostic\(currentFailure, entry\?\.definition\)\s*: null/)
  assert.match(card, /failureStates\.has\(entry\?\.state\)[\s\S]*?entry\?\.testState === 'checking'[\s\S]*?entry\?\.lastTest\?\.verdict \|\| 'unverified'/)
  assert.match(card, /canOpenWebFor\(usage, runtimeWindow\)/)
  assert.match(card, /runtimeWindow\.openLink\(usage\.url\)/)
  assert.match(card, /canCopyFor\(text, runtimeWindow\)/)
  assert.match(card, /const flowText = copyableFlowFor\(entry\?\.definition\)/)
  assert.match(card, /copyButton\(flowText, e\('shellpilotTunnelCopyFlow'\)\)/)
  assert.match(card, /data-stage=\{stage\.id\}/)
  for (const status of ['passed', 'limited', 'failed', 'unverified']) {
    assert.match(card, new RegExp(`${status}: \\{ icon:`))
  }
  assert.doesNotMatch(card, /lastTest\.stages\.map/)
})

test('runtime flow copy is validated and uses the guarded clipboard bridge', async () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const { copyableFlowFor, canCopyFor, copyTextSafely } = loadRuntimeGuidanceLogic()
  const validDefinition = {
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 16060,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060
  }
  assert.equal(
    copyableFlowFor(validDefinition, value => value, () => 'safe flow'),
    'safe flow'
  )
  assert.equal(
    copyableFlowFor({}, () => { throw new Error('invalid') }, () => 'must not copy'),
    ''
  )
  assert.equal(canCopyFor('safe flow', { pre: { writeClipboard () {} } }), true)
  assert.equal(canCopyFor('safe flow', { pre: {} }), false)
  assert.equal(await copyTextSafely('safe flow', { pre: {} }, () => { throw new Error('must not run') }), false)
  assert.match(card, /disabled=\{!canCopy\}/)
})

test('runtime guidance uses the planned public translation keys instead of aliases', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  for (const key of [
    'shellpilotTunnelHowToUse',
    'shellpilotTunnelNoBrowserProxy',
    'shellpilotTunnelNeedsSocksProxy',
    'shellpilotTunnelOpenBrowser',
    'shellpilotTunnelCopyAddress',
    'shellpilotTunnelCopyChecks',
    'shellpilotTunnelFullGuide'
  ]) {
    assert.match(`${card}\n${modal}`, new RegExp(key), key)
  }
  for (const alias of [
    'shellpilotTunnelAccessTitle',
    'shellpilotTunnelSocksRequiresAppProxy',
    'shellpilotTunnelOpenInBrowser',
    'shellpilotTunnelCopyEndpoint',
    'shellpilotTunnelCopyDiagnosticChecks',
    'shellpilotTunnelOpenFullGuide'
  ]) {
    assert.doesNotMatch(`${card}\n${modal}`, new RegExp(alias), alias)
  }
})

test('runtime guidance pure logic preserves every availability state', () => {
  const { availabilityFor } = loadRuntimeGuidanceLogic()

  assert.equal(typeof availabilityFor, 'function')
  assert.equal(availabilityFor({ state: 'failed' }), 'failed')
  assert.equal(availabilityFor({ state: 'port-conflict' }), 'failed')
  assert.equal(availabilityFor({ state: 'session-lost' }), 'failed')
  assert.equal(availabilityFor({ state: 'healthy', testState: 'checking' }), 'checking')
  assert.equal(availabilityFor({ state: 'healthy', lastTest: { verdict: 'passed' } }), 'passed')
  assert.equal(availabilityFor({ state: 'healthy', lastTest: { verdict: 'limited' } }), 'limited')
  assert.equal(availabilityFor({ state: 'healthy', lastTest: { verdict: 'unverified' } }), 'unverified')
  assert.equal(availabilityFor({ state: 'healthy' }), 'unverified')
})

test('current failure logic clears recovered history and derives active limited evidence', () => {
  const { currentFailureFor } = loadRuntimeGuidanceLogic()
  assert.equal(typeof currentFailureFor, 'function')
  const recovered = currentFailureFor({
    state: 'healthy',
    events: [
      { at: 1, state: 'failed', code: 'SSH_TUNNEL_FORWARDING_PROHIBITED', message: 'old failure' },
      { at: 2, state: 'healthy', code: 'SSH_TUNNEL_STARTED', message: 'recovered' }
    ],
    lastTest: {
      verdict: 'passed',
      stages: [{ id: 'ssh-forwarding', status: 'passed', code: 'SSH_TUNNEL_FORWARDING_READY', message: 'ready' }]
    }
  })
  assert.equal(recovered, null)

  const limited = currentFailureFor({
    state: 'healthy',
    lastTest: {
      verdict: 'limited',
      stages: [
        { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: 'ready' },
        { id: 'ssh-forwarding', status: 'limited', code: 'SSH_TUNNEL_FORWARDING_PROHIBITED', message: 'policy denied' },
        { id: 'target-service', status: 'unverified', code: 'SSH_TUNNEL_STAGE_NOT_REACHED', message: 'not reached' }
      ]
    }
  })
  assert.equal(limited.code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  assert.equal(limited.message, 'policy denied')
  assert.equal(limited.stage, 'ssh-forwarding')

  const failedWithLimitedEvidence = currentFailureFor({
    state: 'failed',
    lastTest: {
      verdict: 'limited',
      stages: [
        { id: 'local-listener', status: 'passed', code: 'SSH_TUNNEL_LOCAL_LISTENER_READY', message: 'ready' },
        { id: 'ssh-forwarding', status: 'limited', code: 'SSH_TUNNEL_FORWARDING_PROHIBITED', message: 'policy denied' }
      ]
    }
  })
  assert.equal(failedWithLimitedEvidence.code, 'SSH_TUNNEL_FORWARDING_PROHIBITED')
  assert.equal(failedWithLimitedEvidence.message, 'policy denied')
  assert.equal(failedWithLimitedEvidence.stage, 'ssh-forwarding')
})

test('diagnostic steps use the shared placeholder formatter with values', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const format = loadFormatShellPilotTranslation()

  assert.equal(
    format(
      () => 'Check {host}:{port} at {layer}',
      'sshTunnel.diagnostic.test',
      { host: '127.0.0.1', port: 16060, layer: 'ssh-forwarding' }
    ),
    'Check 127.0.0.1:16060 at ssh-forwarding'
  )
  assert.match(card, /import \{ formatShellPilotTranslation \} from '\.\.\/\.\.\/common\/shellpilot-i18n-overrides\.js'/)
  assert.match(card, /formatShellPilotTranslation\(e, step\.key, localizedDiagnosticValues\(step\.values\)\)/)
  assert.doesNotMatch(card, /dangerouslySetInnerHTML/)
})

test('overall availability uses labels independent from stage labels', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  for (const [status, key] of Object.entries({
    passed: 'shellpilotTunnelAvailabilityPassed',
    checking: 'shellpilotTunnelAvailabilityChecking',
    limited: 'shellpilotTunnelAvailabilityLimited',
    failed: 'shellpilotTunnelAvailabilityFailed',
    unverified: 'shellpilotTunnelAvailabilityUnverified'
  })) {
    assert.match(card, new RegExp(`${status}: \\{ icon:.*label: '${key}'`))
  }
  assert.match(card, /const stagePresentation = \{[\s\S]*shellpilotTunnelStagePassed/)
})

test('runtime guidance keeps diagnostics separate and callbacks defensive', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /className='ssh-tunnel-diagnostic-checks'/)
  assert.match(card, /className='ssh-tunnel-diagnostic-config'/)
  assert.match(card, /copyTextSafely\(diagnostic\.checksText, runtimeWindow, copy\)/)
  assert.match(card, /copyTextSafely\(diagnostic\.configExample, runtimeWindow, copy\)/)
  assert.doesNotMatch(card, /checksText\s*\+|configExample\s*\+/)
  assert.match(card, /openGuide\(onOpenGuide, guideRequestFor\([^)]*diagnostic[^)]*definition[^)]*\)\)/)
  for (const callback of [
    'onTest',
    'onEdit',
    'onEditAndRestart',
    'onStop',
    'onShowHistory'
  ]) {
    assert.match(card, new RegExp(`${callback}\\?\\.\\(`))
  }
  assert.doesNotMatch(card, /\.write\(|sendText|runCmd/)
})

test('every runtime card exposes a safe guide action with context mapping', () => {
  const { guideSectionFor, guideRequestFor, openGuide } = loadRuntimeGuidanceLogic()
  const { normalizeSection, focusErrorFor } = loadGuideLogic()
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.equal(typeof guideSectionFor, 'function')
  assert.equal(guideSectionFor({ kind: 'proxy' }), 'socks-browser')
  assert.equal(guideSectionFor({ kind: 'remote' }), 'remote-safety')
  assert.equal(guideSectionFor({ kind: 'web' }), 'how-to-access')
  assert.equal(guideSectionFor({ kind: 'tcp' }), 'how-to-access')
  assert.equal(
    guideSectionFor({ kind: 'web' }, { helpSection: 'forwarding-prohibited' }),
    'forwarding-prohibited'
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(guideRequestFor(
      { kind: 'web' },
      {
        code: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
        helpSection: 'forwarding-prohibited'
      },
      { sshTunnel: 'forwardLocalToRemote', remoteHost: '127.0.0.1' }
    ))),
    {
      section: 'forwarding-prohibited',
      context: {
        definition: { sshTunnel: 'forwardLocalToRemote', remoteHost: '127.0.0.1' },
        errorCode: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
        helpSection: 'forwarding-prohibited',
        tunnelType: 'forwardLocalToRemote'
      }
    }
  )
  let callbackArguments = null
  openGuide((...args) => { callbackArguments = args }, guideRequestFor(
    { kind: 'web' },
    {
      code: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
      helpSection: 'forwarding-prohibited'
    },
    { sshTunnel: 'forwardLocalToRemote' }
  ))
  assert.equal(callbackArguments.length, 2)
  assert.equal(callbackArguments[0], 'forwarding-prohibited')
  assert.equal(callbackArguments[1].helpSection, 'forwarding-prohibited')
  assert.equal(callbackArguments[1].tunnelType, 'forwardLocalToRemote')
  assert.equal(normalizeSection(callbackArguments[0]), 'errors')
  assert.equal(focusErrorFor(callbackArguments[0], callbackArguments[1]), 'forwarding-prohibited')
  assert.match(card, /className='ssh-tunnel-runtime-guide-button'/)
  assert.match(card, /openGuide\(onOpenGuide, guideRequestFor\(usage, diagnostic, entry\?\.definition\)\)/)
  assert.doesNotMatch(card, /onOpenGuide\?\.\(guideRequestFor/)
})

test('web and clipboard actions share defensive capability gates', async () => {
  const { canOpenWebFor, canCopyFor, copyTextSafely } = loadRuntimeGuidanceLogic()
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const clipboard = source('src/client/common/clipboard.js')

  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, undefined), false)
  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, {}), false)
  assert.equal(canOpenWebFor({ canOpen: false, url: 'http://127.0.0.1:16060' }, { openLink () {} }), false)
  assert.equal(canOpenWebFor({ canOpen: true }, { openLink () {} }), false)
  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, { openLink () {} }), true)
  const clipboardWindow = { pre: { writeClipboard () {} } }
  assert.equal(canCopyFor('127.0.0.1:16060', clipboardWindow), true)
  assert.equal(canCopyFor('', clipboardWindow), false)
  assert.equal(canCopyFor('127.0.0.1:16060', undefined), false)
  assert.equal(canCopyFor('127.0.0.1:16060', { pre: {} }), false)
  let copied = ''
  assert.equal(await copyTextSafely('127.0.0.1:16060', clipboardWindow, value => { copied = value }), true)
  assert.equal(copied, '127.0.0.1:16060')
  assert.equal(await copyTextSafely('blocked', { pre: {} }, () => { throw new Error('must not run') }), false)
  assert.equal(await copyTextSafely('sync failure', clipboardWindow, () => { throw new Error('failed') }), false)
  assert.equal(await copyTextSafely('async failure', clipboardWindow, () => Promise.reject(new Error('failed'))), false)
  assert.equal(await copyTextSafely('reported failure', clipboardWindow, () => false), false)
  assert.match(card, /disabled=\{!canOpenWeb\}[\s\S]*if \(canOpenWeb\)/)
  assert.match(card, /typeof runtimeWindow\?\.pre\?\.writeClipboard === 'function'/)
  assert.match(card, /disabled=\{!canCopy\}[\s\S]*await copyTextSafely\(text, runtimeWindow, copy\)/)
  assert.doesNotMatch(card, /message\.error\(e\('shellpilotTunnelCopyFailed'\)\)/)
  assert.match(clipboard, /window\.translate\('shellpilotTunnelCopyFailed'\)/)
})

test('beginner guide has seven synchronized sections and safe error mapping', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const { normalizeSection, focusErrorFor } = loadGuideLogic()

  assert.match(guide, /import \{ Modal \} from 'antd'/)
  assert.match(guide, /export default function SshTunnelGuideModal \(\{\s*open,\s*activeSection = 'choose-type',\s*context = \{\},\s*onClose\s*\}\)/)
  const sectionIds = [
    'choose-type',
    'local-forward',
    'how-to-access',
    'socks-browser',
    'remote-safety',
    'errors',
    'glossary'
  ]
  for (const id of sectionIds) {
    assert.match(guide, new RegExp(`id: '${id}'`))
  }
  assert.equal((guide.match(/id: '(?:choose-type|local-forward|how-to-access|socks-browser|remote-safety|errors|glossary)'/g) || []).length, 7)
  assert.equal(normalizeSection('forwarding-prohibited'), 'errors')
  assert.equal(focusErrorFor('forwarding-prohibited'), 'forwarding-prohibited')
  assert.equal(focusErrorFor('errors', { helpSection: 'destination-refused' }), 'destination-refused')
  assert.equal(focusErrorFor('errors', { errorCode: 'SSH_TUNNEL_PORT_IN_USE' }), 'port-conflict')
  assert.equal(focusErrorFor('errors', { errorCode: 'SSH_TUNNEL_TEST_TIMEOUT' }), 'timeout')
  assert.equal(focusErrorFor('unknown'), 'unknown')
  assert.equal(focusErrorFor('errors', { errorCode: 'SSH_TUNNEL_UNKNOWN' }), 'unknown')
  assert.match(guide, /const errorHelpSections = new Set\(\[/)
  assert.match(guide, /errorHelpSections\.has\(section\) \? 'errors' : 'choose-type'/)
  assert.match(guide, /const \[requestedSection, setRequestedSection\] = useState/)
  assert.match(guide, /const section = normalizeSection\(requestedSection\)/)
  assert.match(guide, /focusErrorFor\(requestedSection, context\)/)
  assert.match(guide, /aria-current=\{section === item\.id \? 'page' : undefined\}/)
  assert.match(guide, /data-error='forwarding-prohibited'/)
  assert.match(guide, /focusError === 'forwarding-prohibited' \? 'active' : ''/)
  assert.match(guide, /data-error='unknown'/)
  assert.match(guide, /focusError === 'unknown' \? 'active' : ''/)
  for (const key of [
    'shellpilotTunnelGuideErrorUnknown',
    'shellpilotTunnelGuideErrorUnknownCause',
    'shellpilotTunnelGuideErrorUnknownFix'
  ]) {
    assert.match(guide, new RegExp(`e\\('${key}'\\)`))
  }
  assert.match(guide, /127\.0\.0\.1:16060[\s\S]*SSH[\s\S]*server 127\.0\.0\.1:6060/)
  assert.doesNotMatch(guide, /\.write\(|sendText|runCmd|window\.openLink/)
})

test('guide section labels translate at render time', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const { guideSections } = loadGuideLogic()

  assert.equal(guideSections.length, 7)
  assert.equal(guideSections.every(section => typeof section.labelKey === 'string'), true)
  assert.equal(guideSections.some(section => Object.hasOwn(section, 'label')), false)
  assert.match(guide, /\{e\(item\.labelKey\)\}/)
  assert.doesNotMatch(guide, /label: e\(/)
})

test('guide derives the current type from explicit and definition context', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const { currentTunnelTypeFor } = loadGuideLogic()

  assert.equal(currentTunnelTypeFor({ tunnelType: 'explicit', definition: { sshTunnel: 'ignored' } }), 'explicit')
  assert.equal(currentTunnelTypeFor({ definition: { sshTunnel: 'dynamicForward', type: 'ignored' } }), 'dynamicForward')
  assert.equal(currentTunnelTypeFor({ definition: { type: 'remote' } }), 'remote')
  assert.equal(currentTunnelTypeFor({}), '')
  assert.match(guide, /const currentTunnelType = currentTunnelTypeFor\(context\)/)
  assert.match(guide, /currentTunnelType \? <p className='ssh-tunnel-guide-context'/)
})

test('beginner guide uses the planned localized content contract', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const requiredKeys = [
    'shellpilotTunnelGuideChooseType',
    'shellpilotTunnelGuideLocalScenario',
    'shellpilotTunnelGuideHowToAccess',
    'shellpilotTunnelGuideSocksBrowser',
    'shellpilotTunnelGuideRemoteSafety',
    'shellpilotTunnelGuideErrors',
    'shellpilotTunnelGuideGlossary'
  ]

  for (const key of requiredKeys) {
    assert.match(guide, new RegExp(`e\\('${key}'\\)`))
  }
  assert.match(guide, /shellpilotTunnelGuideNoBrowserProxy/)
  assert.match(guide, /shellpilotTunnelGuideSocksNoSystemProxy/)
  assert.match(guide, /shellpilotTunnelGuideGatewayPorts/)
})

test('forwarding-prohibited guidance states the server configuration boundary', async () => {
  const { getShellPilotTranslation } = await loadTunnelCatalog()
  const zh = getShellPilotTranslation('shellpilotTunnelGuideErrorProhibitedFix', 'zh_cn')
  const en = getShellPilotTranslation('shellpilotTunnelGuideErrorProhibitedFix', 'en_us')

  assert.match(zh, /AllowTcpForwarding/)
  assert.match(zh, /PermitOpen/)
  assert.match(zh, /ShellPilot 不会修改服务器配置/)
  assert.match(en, /AllowTcpForwarding/)
  assert.match(en, /PermitOpen/)
  assert.match(en, /ShellPilot does not change server configuration/i)
})

test('access guide distinguishes web schemes and database profiles', () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')

  assert.match(guide, /http:\/\/127\.0\.0\.1:16060/)
  assert.match(guide, /https:\/\/127\.0\.0\.1:16060/)
  for (const key of [
    'shellpilotTunnelGuideMySqlProfile',
    'shellpilotTunnelGuidePostgreSqlProfile',
    'shellpilotTunnelGuideRedisProfile'
  ]) {
    assert.match(guide, new RegExp(`e\\('${key}'\\)`))
  }
  assert.match(guide, /host: 127\.0\.0\.1, port: 16060/)
})

test('SOCKS and remote guides render every field, success boundary and first checks', async () => {
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const requiredKeys = [
    'shellpilotTunnelGuideSocksLocalHost',
    'shellpilotTunnelGuideSocksLocalPort',
    'shellpilotTunnelGuideSocksFlow',
    'shellpilotTunnelGuideSocksNoRemoteTarget',
    'shellpilotTunnelGuideSocksNoRemoteTargetValue',
    'shellpilotTunnelGuideSocksStartProof',
    'shellpilotTunnelGuideSocksConfigureApps',
    'shellpilotTunnelGuideSocksFirstFailure',
    'shellpilotTunnelGuideRemoteServerHost',
    'shellpilotTunnelGuideRemoteServerPort',
    'shellpilotTunnelGuideRemoteClientTargetHost',
    'shellpilotTunnelGuideRemoteClientTargetPort',
    'shellpilotTunnelGuideRemoteFlow',
    'shellpilotTunnelGuideRemoteStartProof',
    'shellpilotTunnelGuideRemoteExternalAccess',
    'shellpilotTunnelGuideRemoteFirstFailure'
  ]
  for (const key of requiredKeys) {
    assert.match(guide, new RegExp(`['"]${key}['"]`), key)
  }
  assert.match(guide, /const guideData = getTunnelGuideData\(context\)/)
  assert.match(guide, /shellpilotTunnelGuideSocksLocalHost[\s\S]*?<code>\{guideData\.socks\.bindHost\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideSocksLocalPort[\s\S]*?<code>\{guideData\.socks\.bindPort\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideSocksConnectAddress[\s\S]*?<code>\{guideData\.socks\.endpoint\}<\/code>/)
  assert.match(guide, /guideData\.socks\.usesWildcardBind[\s\S]*shellpilotTunnelSocksWildcardExposureHint/)
  assert.match(guide, /<code>\{guideData\.socks\.chromeCommand\}<\/code>/)
  assert.match(guide, /<code>\{guideData\.socks\.edgeCommand\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideRemoteServerHost[\s\S]*?<code>\{guideData\.remote\.bindHost\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideRemoteServerPort[\s\S]*?<code>\{guideData\.remote\.bindPort\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideRemoteClientTargetHost[\s\S]*?<code>\{guideData\.remote\.targetHost\}<\/code>/)
  assert.match(guide, /shellpilotTunnelGuideRemoteClientTargetPort[\s\S]*?<code>\{guideData\.remote\.targetPort\}<\/code>/)
  assert.match(guide, /guideData\.(?:socks|remote)\.isExample/)
  assert.doesNotMatch(guide, /\.write\(|sendText|runCmd/)

  const { getShellPilotTranslation } = await loadTunnelCatalog()
  const zhSocks = requiredKeys.slice(0, 8).map(key => getShellPilotTranslation(key, 'zh_cn')).join('\n')
  const enSocks = requiredKeys.slice(0, 8).map(key => getShellPilotTranslation(key, 'en_us')).join('\n')
  const zhRemote = requiredKeys.slice(8).map(key => getShellPilotTranslation(key, 'zh_cn')).join('\n')
  const enRemote = requiredKeys.slice(8).map(key => getShellPilotTranslation(key, 'en_us')).join('\n')
  assert.match(zhSocks, /\{endpoint\}|\{host\}.*\{port\}/s)
  assert.match(zhSocks, /没有固定的远端目标/)
  assert.match(zhSocks, /监听.*握手.*SSH 策略/s)
  assert.match(zhSocks, /启动成功只证明.*监听.*握手.*检测.*通过/s)
  assert.match(zhSocks, /proxy-traffic.*未验证.*总体.*未验证.*真实 SOCKS 请求.*SSH.*可用/is)
  assert.match(enSocks, /\{endpoint\}|\{host\}.*\{port\}/s)
  assert.match(enSocks, /no fixed remote target/i)
  assert.match(enSocks, /listener.*handshake.*SSH policy/is)
  assert.match(enSocks, /successful start proves only.*listener.*handshake.*check.*pass/is)
  assert.match(enSocks, /proxy-traffic.*not verified.*overall.*not verified.*real SOCKS request.*SSH.*Available/is)
  assert.match(zhRemote, /服务器监听地址.*服务器监听端口.*客户端本地目标地址.*客户端本地目标端口/s)
  assert.match(zhRemote, /GatewayPorts.*防火墙.*认证/s)
  assert.match(zhRemote, /启动成功只证明.*服务器监听.*本地目标.*检测.*通过/s)
  assert.match(zhRemote, /end-to-end.*未验证.*总体.*未验证.*真实.*服务器侧.*传入转发连接.*客户端目标.*可用/is)
  assert.match(enRemote, /server listen host.*server listen port.*client local target host.*client local target port/is)
  assert.match(enRemote, /GatewayPorts.*firewall.*authentication/is)
  assert.match(enRemote, /successful start proves only.*server listener.*local target.*check.*pass/is)
  assert.match(enRemote, /end-to-end.*not verified.*overall.*not verified.*real incoming forwarded connection.*client target.*Available/is)
})

test('remote access card separates the bind listener from a connectable server-local endpoint', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /shellpilotTunnelRemoteBindAddress[\s\S]*usage\.bindEndpoint/)
  assert.match(card, /shellpilotTunnelRemoteServerLocalAddress[\s\S]*usage\.endpoint/)
  assert.match(card, /usage\.requiresServerAddressForExternalAccess[\s\S]*shellpilotTunnelRemoteWildcardExternalHint/)
  assert.doesNotMatch(card, /copyButton\(usage\.bindEndpoint/)
  assert.match(card, /copyButton\(usage\.endpoint, e\('shellpilotTunnelCopyAddress'\)\)/)
})

test('SOCKS access card shows wildcard exposure separately from the loopback proxy endpoint', () => {
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.match(card, /shellpilotTunnelSocksBindAddress[\s\S]*usage\.bindEndpoint/)
  assert.match(card, /shellpilotTunnelSocksConnectAddress[\s\S]*usage\.endpoint/)
  assert.match(card, /usage\.usesWildcardBind[\s\S]*shellpilotTunnelSocksWildcardExposureHint/)
  assert.doesNotMatch(card, /copyButton\(usage\.bindEndpoint/)
  assert.match(card, /copyButton\(usage\.endpoint, e\('shellpilotTunnelCopyProxyAddress'\)\)/)
})

test('runtime guidance styles match the approved hierarchy responsively', () => {
  const styles = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.styl')

  assert.match(styles, /\.ssh-tunnel-access-panel[\s\S]*background rgba\(22, 119, 255, \.07\)[\s\S]*border 1px solid rgba\(22, 119, 255, \.24\)/)
  assert.match(styles, /\.ssh-tunnel-stage-grid[\s\S]*grid-template-columns repeat\(3, minmax\(0, 1fr\)\)/)
  for (const modifier of ['passed', 'limited', 'failed', 'unverified']) {
    assert.match(styles, new RegExp(`\\.ssh-tunnel-stage--${modifier}`))
  }
  assert.match(styles, /\.ssh-tunnel-diagnostic-split[\s\S]*grid-template-columns repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\.ssh-tunnel-guide-layout[\s\S]*grid-template-columns 220px minmax\(0, 1fr\)/)
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.ssh-tunnel-guide-layout[\s\S]*grid-template-columns 1fr/)
  assert.match(styles, /overflow-wrap anywhere/)
  assert.doesNotMatch(styles, /gradient\(/)
  assert.doesNotMatch(styles, /max-height min\(/)
  assert.match(styles, /\.ssh-tunnel-stage\s+[\s\S]*color var\(--sp-text\)[\s\S]*> span:last-child[\s\S]*color var\(--sp-text-muted\)/)
  assert.match(styles, /\.ssh-tunnel-stage--passed[\s\S]*border-color var\(--sp-success,/)
  assert.match(styles, /\.ssh-tunnel-stage--limited[\s\S]*border-color var\(--sp-warning,/)
  assert.match(styles, /\.ssh-tunnel-stage--failed[\s\S]*border-color var\(--sp-danger,/)
  assert.match(styles, /\.ssh-tunnel-stage--unverified[\s\S]*border-color var\(--sp-border,/)
  assert.doesNotMatch(styles, /\.ssh-tunnel-stage--(?:passed|limited|failed)\r?\n\s+color var\(--sp-(?:success|warning|danger),/)
  assert.doesNotMatch(styles, /&--(?:passed|limited|failed)\r?\n\s+color var\(--sp-(?:success|warning|danger),/)
  assert.doesNotMatch(styles, /color #(?:067647|b54708|b42318)/i)
  assert.match(styles, /\.ssh-tunnel-guide-nav[\s\S]*button[\s\S]*color var\(--sp-text\)/)
  assert.match(styles, /\.ssh-tunnel-guide-kicker[\s\S]*font-size 12px[\s\S]*color var\(--sp-text-muted\)/)
  assert.doesNotMatch(styles, /\.ssh-tunnel-guide-nav[\s\S]*?color #1677ff/)
  assert.doesNotMatch(styles, /\.ssh-tunnel-guide-kicker[\s\S]*?color #1677ff/)
})

test('both unconnected JSX components parse in the production syntax contract', () => {
  assert.doesNotThrow(() => parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx'))
  assert.doesNotThrow(() => parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx'))
})

test('SSH tunnel modal wires one layered runtime card and one stateful guide modal', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')

  assert.match(modal, /import SshTunnelRuntimeCard from '\.\/ssh-tunnel-runtime-card\.jsx'/)
  assert.match(modal, /import SshTunnelGuideModal from '\.\/ssh-tunnel-guide-modal\.jsx'/)
  assert.match(modal, /useState\(\{\s*open: false,\s*section: 'choose-type',\s*context: \{\}\s*\}\)/)
  assert.equal((modal.match(/<SshTunnelRuntimeCard\b/g) || []).length, 1)
  assert.equal((modal.match(/<SshTunnelGuideModal\b/g) || []).length, 1)
  assert.match(modal, /<SshTunnelRuntimeCard[\s\S]*?key=\{entry\.id\}[\s\S]*?entry=\{entry\}[\s\S]*?busy=\{actionId\}[\s\S]*?onTest=\{handleTest\}[\s\S]*?onEdit=\{\(\) => handleEdit\(entry\)\}[\s\S]*?onEditAndRestart=\{\(\) => handleEditAndRestart\(entry\)\}[\s\S]*?onStop=\{handleStop\}[\s\S]*?onOpenGuide=\{\(section, context\) => openGuide\(section, context\)\}[\s\S]*?onShowHistory=\{\(\) => showDisconnectHistory\(entry\)\}/)
  assert.match(modal, /<SshTunnelGuideModal[\s\S]*?open=\{guideState\.open\}[\s\S]*?activeSection=\{guideState\.section\}[\s\S]*?context=\{guideState\.context\}/)
  assert.match(modal, /setGuideState\(current => \(\{[\s\S]*?\.\.\.current,[\s\S]*?open: false[\s\S]*?\}\)\)/)
  assert.doesNotMatch(modal, /function TunnelRuntimeFailure/)
  assert.doesNotMatch(modal, /className='ssh-tunnel-test-result/)
  assert.doesNotMatch(modal, /<article className='ssh-tunnel-running-card'/)
})

test('modal preserves legacy usage identity while the runtime card renders lifecycle separately', async () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const { getTunnelUsage } = await loadTunnelUsage()
  const baseDefinition = {
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 16060,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 6060
  }
  const httpEntry = { id: 'http-1', state: 'running', definition: { ...baseDefinition, name: 'HTTP' } }
  const mysqlEntry = { id: 'mysql-1', state: 'running', definition: { ...baseDefinition, name: 'MySQL' } }

  assert.deepEqual(
    { ...getTunnelUsage(httpEntry.definition) },
    {
      kind: 'web',
      profile: 'http',
      host: '127.0.0.1',
      port: 16060,
      endpoint: '127.0.0.1:16060',
      requiresProxy: false,
      canOpen: true,
      url: 'http://127.0.0.1:16060'
    }
  )
  assert.equal(getTunnelUsage(mysqlEntry.definition).kind, 'database')
  assert.equal(getTunnelUsage(mysqlEntry.definition).profile, 'mysql')
  assert.match(modal, /entry=\{entry\}/)
  assert.doesNotMatch(modal, /runtimeEntryForCard|definition:\s*\{[\s\S]*?name:/)
  assert.match(card, /lifecyclePresentation/)
  assert.match(card, /e\(lifecycle\.label\)/)
  assert.match(card, /getTunnelUsage\(entry\?\.definition \|\| \{\}\)/)
})

test('guide handler normalizes section and merges the supported runtime context', () => {
  let guideState = {
    open: false,
    section: 'choose-type',
    context: { definition: { name: 'old' }, tunnelType: 'old', errorCode: 'old', helpSection: 'old' }
  }
  const openGuide = loadModalFunction('openGuide', {
    setGuideState: updater => {
      guideState = typeof updater === 'function' ? updater(guideState) : updater
    }
  })

  openGuide(42, {
    definition: { sshTunnel: 'dynamicForward', name: 'proxy' },
    tunnelType: 'dynamicForward',
    errorCode: 'SSH_TUNNEL_TEST_TIMEOUT',
    helpSection: 'test-timeout',
    ignored: 'not copied'
  })
  assert.equal(guideState.open, true)
  assert.equal(guideState.section, 'choose-type')
  assert.deepEqual(JSON.parse(JSON.stringify(guideState.context)), {
    definition: { sshTunnel: 'dynamicForward', name: 'proxy' },
    tunnelType: 'dynamicForward',
    errorCode: 'SSH_TUNNEL_TEST_TIMEOUT',
    helpSection: 'test-timeout'
  })
})

test('editor guide action maps the current draft type and passes definition context', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const guideSectionForDraft = loadModalFunction('guideSectionForDraft')

  assert.equal(guideSectionForDraft({ sshTunnel: 'dynamicForward' }), 'socks-browser')
  assert.equal(guideSectionForDraft({ sshTunnel: 'forwardRemoteToLocal' }), 'remote-safety')
  assert.equal(guideSectionForDraft({ sshTunnel: 'forwardLocalToRemote' }), 'how-to-access')
  assert.equal(guideSectionForDraft({}), 'choose-type')
  assert.match(modal, /<Button[\s\S]*?onClick=\{\(\) => openGuide\(guideSectionForDraft\(draft\), \{[\s\S]*?definition: draft,[\s\S]*?tunnelType: draft\.sshTunnel[\s\S]*?\}\)\}[\s\S]*?shellpilotTunnelFullGuide/)
})

test('template and type selection keep usage profiles truthful without persisting UI template state', async () => {
  let draft = { id: 'old', name: 'old', usageProfile: 'mysql' }
  let selectedTemplate = ''
  let savedEditingId = 'saved'
  const stateContext = {
    draft,
    typeOptions: [
      { value: 'forwardLocalToRemote', label: 'Local' },
      { value: 'forwardRemoteToLocal', label: 'Remote' },
      { value: 'dynamicForward', label: 'Dynamic' }
    ],
    tunnelTemplates: {
      HTTPSPreset: { name: 'HTTPS Custom', usageProfile: 'https' }
    },
    getTunnelTemplate: name => ({
      id: 'generated',
      name: 'normalized',
      usageProfile: name === 'HTTPSPreset' ? 'https' : 'generic',
      sshTunnel: 'forwardLocalToRemote',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 8443,
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 443
    }),
    setPortConflict: () => {},
    setDraft: updater => {
      draft = typeof updater === 'function' ? updater(draft) : updater
      stateContext.draft = draft
    },
    setSelectedTemplate: value => { selectedTemplate = value },
    setSavedEditingId: value => { savedEditingId = value }
  }
  const applyTemplate = loadModalFunction('applyTemplate', stateContext)
  applyTemplate('HTTPSPreset')
  assert.deepEqual(JSON.parse(JSON.stringify(draft)), {
    id: '',
    name: 'HTTPS Custom',
    usageProfile: 'https',
    sshTunnel: 'forwardLocalToRemote',
    sshTunnelLocalHost: '127.0.0.1',
    sshTunnelLocalPort: 8443,
    sshTunnelRemoteHost: '127.0.0.1',
    sshTunnelRemotePort: 443
  })
  assert.equal(selectedTemplate, 'HTTPSPreset')
  assert.equal(savedEditingId, '')

  const expectedProfiles = {
    dynamicForward: 'socks5',
    forwardLocalToRemote: 'generic',
    forwardRemoteToLocal: 'generic'
  }
  for (const [sshTunnel, usageProfile] of Object.entries(expectedProfiles)) {
    draft = {
      id: 'old',
      name: 'old',
      usageProfile: 'mysql',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 8080,
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 80
    }
    stateContext.draft = draft
    const selectType = loadModalFunction('selectType', stateContext)
    selectType(sshTunnel)
    assert.equal(draft.usageProfile, usageProfile, sshTunnel)
    assert.equal(draft.id, '', sshTunnel)
  }

  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  assert.match(modal, /function handleEdit \(entry\)[\s\S]*?setDraft\(\{[\s\S]*?\.\.\.entry\.definition,[\s\S]*?id: ''/)
  assert.match(modal, /serializeTunnelForBookmark\(draft\)/)
  assert.doesNotMatch(modal, /\btemplate:\s*(?:templateName|'')/)
  const definitionPath = path.join(root, 'src/client/components/ssh-tunnel/ssh-tunnel-definition.js')
  const { serializeTunnelForBookmark } = await import(
    `${pathToFileURL(definitionPath).href}?tunnel-ui=${Date.now()}-${Math.random()}`
  )
  const serialized = serializeTunnelForBookmark(draft)
  assert.equal(Object.hasOwn(serialized, 'template'), false)
  assert.equal(serialized.usageProfile, 'generic')
})

test('test result messages route only by final verdict', async () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')
  const expectedChannel = {
    passed: 'success',
    limited: 'warning',
    failed: 'error',
    unverified: 'info',
    checking: 'info'
  }

  for (const [verdict, channel] of Object.entries(expectedChannel)) {
    const calls = []
    const handleTest = loadModalFunction('handleTest', {
      store: {},
      tab: {},
      setActionId: () => {},
      testSshTunnelRuntime: async () => ({
        verdict,
        ok: verdict !== 'passed',
        message: 'internal stack must not surface',
        stack: 'secret stack'
      }),
      message: {
        success: value => calls.push(['success', value]),
        warning: value => calls.push(['warning', value]),
        error: value => calls.push(['error', value]),
        info: value => calls.push(['info', value])
      },
      e: key => key,
      refresh: async () => {},
      readableError: error => String(error?.message || 'failed')
    })
    await handleTest('tunnel-1')
    assert.deepEqual(calls, [[channel, `shellpilotTunnelTest${verdict === 'passed' ? 'Passed' : verdict === 'limited' ? 'Limited' : verdict === 'failed' ? 'Failed' : 'Unverified'}`]], verdict)
  }
  const handleTestSource = generate(findFunction(
    'src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx',
    'handleTest'
  )).code
  assert.doesNotMatch(handleTestSource, /result\??\.ok|result\??\.message|result\??\.stack/)
  assert.match(modal, /switch \(result\?\.verdict\)/)
})

test('every tunnel guidance translation resolves in both catalogs with matching placeholders', async () => {
  const {
    getShellPilotCatalogKeys,
    getShellPilotTranslation,
    formatShellPilotTranslation
  } = await loadTunnelCatalog()
  const keys = referencedTunnelTranslationKeys()
  assert.ok(keys.length > 80, 'the scanner must cover the full runtime and guide surface')
  assert.deepEqual(getShellPilotCatalogKeys('zh_cn'), getShellPilotCatalogKeys('en_us'))

  for (const key of keys) {
    const zh = getShellPilotTranslation(key, 'zh_cn')
    const en = getShellPilotTranslation(key, 'en_us')
    assert.ok(zh?.trim(), `${key} must have Chinese copy`)
    assert.ok(en?.trim(), `${key} must have English copy`)
    assert.notEqual(zh, key, `${key} must not leak in Chinese`)
    assert.notEqual(en, key, `${key} must not leak in English`)
    const placeholders = value => [...value.matchAll(/\{([A-Za-z0-9]+)\}/g)].map(match => match[1]).sort()
    assert.deepEqual(placeholders(zh), placeholders(en), `${key} placeholders`)
    const replacements = Object.fromEntries(placeholders(en).map(name => [name, `value-${name}`]))
    assert.doesNotMatch(
      formatShellPilotTranslation(candidate => getShellPilotTranslation(candidate, 'zh_cn'), key, replacements),
      /\{[A-Za-z0-9]+\}/,
      `${key} formatted Chinese`
    )
    assert.doesNotMatch(
      formatShellPilotTranslation(candidate => getShellPilotTranslation(candidate, 'en_us'), key, replacements),
      /\{[A-Za-z0-9]+\}/,
      `${key} formatted English`
    )
  }

  const diagnosticsPath = path.join(
    root,
    'src/client/components/ssh-tunnel/ssh-tunnel-diagnostics.js'
  )
  const { getTunnelDiagnostic } = await import(
    `${pathToFileURL(diagnosticsPath).href}?tunnel-ui=${Date.now()}-${Math.random()}`
  )
  const definitions = {
    local: {
      sshTunnel: 'forwardLocalToRemote',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 16060,
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 6060
    },
    remote: {
      sshTunnel: 'forwardRemoteToLocal',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 6060,
      sshTunnelRemoteHost: '127.0.0.1',
      sshTunnelRemotePort: 16060
    },
    dynamic: {
      sshTunnel: 'dynamicForward',
      sshTunnelLocalHost: '127.0.0.1',
      sshTunnelLocalPort: 1080
    }
  }
  const diagnostics = [
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' }, definitions.local),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' }, definitions.dynamic),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' }, {
      ...definitions.local,
      sshTunnelRemoteHost: 'bad host'
    }),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_FORWARDING_PROHIBITED' }, {
      ...definitions.local,
      sshTunnelRemoteHost: '[::1]'
    }),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_DESTINATION_REFUSED' }, definitions.local),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_DESTINATION_REFUSED' }, definitions.remote),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_DESTINATION_REFUSED' }, definitions.dynamic),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_DESTINATION_REFUSED' }, {
      ...definitions.local,
      sshTunnelRemoteHost: 'bad host'
    }),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_PORT_IN_USE' }, definitions.local),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_PORT_IN_USE' }, {
      ...definitions.local,
      sshTunnelLocalPort: 'not-a-port'
    }),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_TEST_TIMEOUT', stage: 'ssh-forwarding' }, definitions.local),
    getTunnelDiagnostic({ code: 'SSH_TUNNEL_UNEXPECTED' }, definitions.local)
  ]
  const { localizedDiagnosticValues } = loadRuntimeGuidanceLogic()
  for (const diagnostic of diagnostics) {
    for (const step of diagnostic.steps) {
      for (const langId of ['zh_cn', 'en_us']) {
        const translate = candidate => getShellPilotTranslation(candidate, langId)
        const formatted = formatShellPilotTranslation(
          translate,
          step.key,
          localizedDiagnosticValues(step.values, translate)
        )
        assert.doesNotMatch(formatted, /\{[A-Za-z0-9]+\}/, `${langId} ${step.key}`)
      }
    }
  }

  const zhTranslate = candidate => getShellPilotTranslation(candidate, 'zh_cn')
  const enTranslate = candidate => getShellPilotTranslation(candidate, 'en_us')
  assert.equal(
    formatShellPilotTranslation(
      zhTranslate,
      'sshTunnel.diagnostic.forwardingProhibited.globalBaseline',
      localizedDiagnosticValues({ scope: 'global-baseline' }, zhTranslate)
    ),
    '请管理员先查看 sshd 的全局基础设置，确认当前账号是否允许端口转发。'
  )
  assert.equal(
    formatShellPilotTranslation(
      zhTranslate,
      'sshTunnel.diagnostic.timeout.checkStage',
      localizedDiagnosticValues({ layer: 'ssh-forwarding' }, zhTranslate)
    ),
    '检测停在 SSH 转发阶段。请先检查这个阶段对应的网络、SSH 策略或目标服务。'
  )
  assert.equal(
    formatShellPilotTranslation(
      zhTranslate,
      'sshTunnel.diagnostic.portInUse.checkListener',
      localizedDiagnosticValues({ localPort: 16060 }, zhTranslate)
    ),
    '查看哪个程序正在使用本机端口 16060，确认后再决定关闭程序还是换端口。'
  )
  assert.equal(
    formatShellPilotTranslation(
      enTranslate,
      'sshTunnel.diagnostic.portInUse.checkListener',
      localizedDiagnosticValues({ localPort: 16060 }, enTranslate)
    ),
    'Identify the program using local port 16060, then decide whether to stop it or choose another port.'
  )
  for (const internalValue of ['global-baseline', 'ssh-forwarding', 'local-host', 'local-port']) {
    const renderedChinese = diagnostics.flatMap(diagnostic => diagnostic.steps).map(step => (
      formatShellPilotTranslation(
        zhTranslate,
        step.key,
        localizedDiagnosticValues(step.values, zhTranslate)
      )
    )).join('\n')
    assert.doesNotMatch(renderedChinese, new RegExp(internalValue), internalValue)
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(localizedDiagnosticValues({
      scope: 'global-baseline',
      layer: 'ssh-forwarding',
      fields: ['local-host', 'local-port'],
      restrictions: ['restrict', 'permitopen']
    }, zhTranslate))),
    {
      scope: '全局基础设置',
      layer: 'SSH 转发',
      fields: '本机地址、本机端口',
      restrictions: 'restrict、permitopen'
    }
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(localizedDiagnosticValues({
      scope: 'global-baseline',
      layer: 'ssh-forwarding',
      fields: ['local-host', 'local-port'],
      restrictions: ['restrict', 'permitopen']
    }, enTranslate))),
    {
      scope: 'global baseline settings',
      layer: 'SSH forwarding',
      fields: 'local host, local port',
      restrictions: 'restrict, permitopen'
    }
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(localizedDiagnosticValues({
      localHost: 'unknown',
      remoteHost: 'proxy',
      localPort: 1080,
      commandTemplate: 'target-service'
    }, zhTranslate))),
    {
      localHost: 'unknown',
      remoteHost: 'proxy',
      localPort: 1080,
      commandTemplate: 'target-service'
    }
  )
})

test('Chrome and Edge SOCKS guidance gives a concrete non-button setup path', async () => {
  const { getShellPilotTranslation } = await loadTunnelCatalog()
  for (const langId of ['zh_cn', 'en_us']) {
    const steps = getShellPilotTranslation('shellpilotTunnelGuideChromiumSteps', langId)
    assert.match(steps, /--user-data-dir/)
    assert.match(steps, langId === 'zh_cn' ? /受信任的代理扩展/ : /trusted proxy extension/i)
    assert.match(steps, langId === 'zh_cn' ? /只供复制参考.*不会执行.*不会修改系统代理/s : /copy-only examples.*does not execute.*change the system proxy/is)
  }
  const guide = source('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx')
  const usage = source('src/client/components/ssh-tunnel/ssh-tunnel-usage.js')
  assert.match(usage, /chrome\.exe --user-data-dir="%TEMP%\\\\shellpilot-chrome-socks-\$\{profileId\}"/)
  assert.match(usage, /msedge\.exe --user-data-dir="%TEMP%\\\\shellpilot-edge-socks-\$\{profileId\}"/)
  assert.match(usage, /--proxy-server="socks5:\/\/\$\{usage\.endpoint\}"/)
  assert.doesNotMatch(guide, /runCmd|sendText|\.write\(/)
})

test('connected SSH tunnel modal parses in the production syntax contract', () => {
  assert.doesNotThrow(() => parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx'))
})
