const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('node:vm')
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

function loadRuntimeGuidanceLogic () {
  const ast = parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')
  const names = new Set([
    'failureStates',
    'availabilityFor',
    'currentFailureFor',
    'guideSectionFor',
    'guideRequestFor',
    'canOpenWebFor',
    'canCopyFor'
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
  vm.runInNewContext(generate(t.file(t.program(body))).code, { module }, {
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
    'focusErrorFor'
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
  const definition = source('src/client/components/ssh-tunnel/ssh-tunnel-definition.js')
  const translations = source('src/client/common/shellpilot-i18n-overrides.js')
  const combined = `${modal}\n${definition}\n${translations}`

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
  assert.match(modal, /shellpilotTunnelCopyDescription/)
  assert.match(modal, /shellpilotTunnelEditAndRestart/)
  assert.match(modal, /shellpilotTunnelStop/)
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

test('SSH tunnel manager surfaces the latest actionable runtime failure', () => {
  const modal = source('src/client/components/ssh-tunnel/ssh-tunnel-modal.jsx')

  assert.match(modal, /latestTunnelFailure/)
  assert.match(modal, /ssh-tunnel-runtime-failure/)
  assert.match(modal, /latestFailure\.message/)
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
  assert.match(card, /canCopyFor\(text, copy\)/)
  assert.match(card, /data-stage=\{stage\.id\}/)
  for (const status of ['passed', 'limited', 'failed', 'unverified']) {
    assert.match(card, new RegExp(`${status}: \\{ icon:`))
  }
  assert.doesNotMatch(card, /lastTest\.stages\.map/)
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
  assert.match(card, /formatShellPilotTranslation\(e, step\.key, step\.values\)/)
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
  assert.match(card, /copy\(diagnostic\.checksText\)/)
  assert.match(card, /copy\(diagnostic\.configExample\)/)
  assert.doesNotMatch(card, /checksText\s*\+|configExample\s*\+/)
  assert.match(card, /onOpenGuide\?\.\(guideRequestFor\([^)]*diagnostic[^)]*definition[^)]*\)\)/)
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
  const { guideSectionFor, guideRequestFor } = loadRuntimeGuidanceLogic()
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
      { type: 'local', remoteHost: '127.0.0.1' }
    ))),
    {
      section: 'forwarding-prohibited',
      context: {
        definition: { type: 'local', remoteHost: '127.0.0.1' },
        errorCode: 'SSH_TUNNEL_FORWARDING_PROHIBITED',
        helpSection: 'forwarding-prohibited'
      }
    }
  )
  assert.match(card, /className='ssh-tunnel-runtime-guide-button'/)
  assert.match(card, /onOpenGuide\?\.\(guideRequestFor\(usage, diagnostic, entry\?\.definition\)\)/)
})

test('web and clipboard actions share defensive capability gates', () => {
  const { canOpenWebFor, canCopyFor } = loadRuntimeGuidanceLogic()
  const card = source('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx')

  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, undefined), false)
  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, {}), false)
  assert.equal(canOpenWebFor({ canOpen: false, url: 'http://127.0.0.1:16060' }, { openLink () {} }), false)
  assert.equal(canOpenWebFor({ canOpen: true }, { openLink () {} }), false)
  assert.equal(canOpenWebFor({ canOpen: true, url: 'http://127.0.0.1:16060' }, { openLink () {} }), true)
  assert.equal(canCopyFor('127.0.0.1:16060', () => {}), true)
  assert.equal(canCopyFor('', () => {}), false)
  assert.equal(canCopyFor('127.0.0.1:16060', undefined), false)
  assert.match(card, /disabled=\{!canOpenWeb\}[\s\S]*if \(canOpenWeb\)/)
  assert.match(card, /disabled=\{!canCopy\}[\s\S]*if \(canCopy\)/)
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
  assert.match(guide, /const errorHelpSections = new Set\(\[/)
  assert.match(guide, /errorHelpSections\.has\(section\) \? 'errors' : 'choose-type'/)
  assert.match(guide, /const \[requestedSection, setRequestedSection\] = useState/)
  assert.match(guide, /const section = normalizeSection\(requestedSection\)/)
  assert.match(guide, /focusErrorFor\(requestedSection, context\)/)
  assert.match(guide, /aria-current=\{section === item\.id \? 'page' : undefined\}/)
  assert.match(guide, /data-error='forwarding-prohibited'/)
  assert.match(guide, /focusError === 'forwarding-prohibited' \? 'active' : ''/)
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
})

test('both unconnected JSX components parse in the production syntax contract', () => {
  assert.doesNotThrow(() => parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-runtime-card.jsx'))
  assert.doesNotThrow(() => parseJsx('src/client/components/ssh-tunnel/ssh-tunnel-guide-modal.jsx'))
})
