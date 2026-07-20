const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const stylus = require('stylus')
const stylusPackage = require('stylus/package.json')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const t = require('@babel/types')

const root = path.resolve(__dirname, '../..')

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}
function readTest (file) {
  return fs.readFileSync(path.join(root, 'test', file), 'utf8')
}

function parseClient (file) {
  return parser.parse(readClient(file), {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining']
  })
}

test('toolbar exposes filters refresh cancel and honest batch actions', () => {
  const source = readClient('components/fleet-status/fleet-status-toolbar.jsx')
  const ast = parseClient('components/fleet-status/fleet-status-toolbar.jsx')
  for (const expected of [
    'shellpilotFleetSearchPlaceholder',
    'shellpilotFleetSearchServers',
    'shellpilotFleetAllGroups',
    'shellpilotFleetAllStatuses',
    'shellpilotFleetRefresh',
    'shellpilotFleetCancel',
    'shellpilotFleetCheckServices',
    'shellpilotFleetAiBatchDiagnosis',
    'shellpilotFleetCheckPorts',
    'shellpilotFleetCollectLogs',
    'shellpilotFleetExportReport',
    'shellpilotFleetComingLater'
  ]) {
    assert.ok(source.includes(expected), `missing toolbar translation key: ${expected}`)
  }

  const placeholderDisabled = [
    'shellpilotFleetCheckPorts',
    'shellpilotFleetCollectLogs',
    'shellpilotFleetExportReport'
  ].filter(key => {
    const labelIndex = source.indexOf(`e('${key}')`)
    const buttonStart = source.lastIndexOf('<Button', labelIndex)
    return labelIndex > buttonStart && source.slice(buttonStart, labelIndex).includes('disabled')
  }).length
  let accessibleDisabledWrappers = 0
  let openServiceSelectorCallback = false
  let aiCallback = false
  traverse(ast, {
    JSXElement (elementPath) {
      const opening = elementPath.node.openingElement
      const disabledWrapper = t.isJSXIdentifier(opening.name, { name: 'span' }) &&
        opening.attributes.some(attribute => (
          t.isJSXAttribute(attribute) &&
          t.isJSXIdentifier(attribute.name, { name: 'className' }) &&
          t.isStringLiteral(attribute.value, {
            value: 'fleet-status-disabled-action'
          })
        ))
      if (disabledWrapper) {
        const attributeNames = opening.attributes
          .filter(t.isJSXAttribute)
          .map(attribute => attribute.name.name)
        if (attributeNames.includes('tabIndex') &&
            attributeNames.includes('aria-label')) {
          accessibleDisabledWrappers += 1
        }
      }
    },
    CallExpression (callPath) {
      if (t.isIdentifier(callPath.node.callee, { name: 'onOpenServiceSelector' })) {
        openServiceSelectorCallback = true
      }
      if (t.isIdentifier(callPath.node.callee, { name: 'onAiDiagnose' })) {
        aiCallback = true
      }
    }
  })
  assert.equal(placeholderDisabled, 3)
  assert.equal(accessibleDisabledWrappers, 4)
  assert.equal(openServiceSelectorCallback, true)
  assert.equal(aiCallback, true)
  assert.match(
    source,
    /const aiDiagnoseEnabled = typeof onAiDiagnose === 'function'/
  )
  assert.match(source, /disabled={!state\.selectedCount}/)
  assert.match(source, /disabled={!aiDiagnoseEnabled}/)
  assert.doesNotMatch(source, /checkServicesEnabled|服务选择器尚未启用/)
  assert.ok(source.includes("e('shellpilotFleetAiBatchUnavailable')"))
  assert.match(
    source,
    /<Input[\s\S]*?aria-label=\{e\('shellpilotFleetSearchServers'\)\}[\s\S]*?placeholder=\{e\('shellpilotFleetSearchPlaceholder'\)\}/
  )
  assert.match(
    source,
    /<Tooltip title=\{aiDiagnoseEnabled \? null : e\('shellpilotFleetAiBatchUnavailable'\)\}>\s*<span\s+className='fleet-status-disabled-action'\s+tabIndex=\{aiDiagnoseEnabled \? undefined : 0\}\s+aria-label=\{aiDiagnoseEnabled \? undefined : e\('shellpilotFleetAiBatchUnavailable'\)\}/
  )

  const callbackArguments = new Map()
  traverse(ast, {
    CallExpression (callPath) {
      if (
        t.isIdentifier(callPath.node.callee, { name: 'onOpenServiceSelector' }) ||
        t.isIdentifier(callPath.node.callee, { name: 'onAiDiagnose' })
      ) {
        callbackArguments.set(
          callPath.node.callee.name,
          callPath.node.arguments.map(argument => argument.name)
        )
      }
    }
  })
  assert.deepEqual(callbackArguments.get('onOpenServiceSelector'), [])
  assert.deepEqual(callbackArguments.get('onAiDiagnose'), ['selectedRows'])
})

test('workspace keeps Fleet controls vertically reachable in short frames', () => {
  const style = readClient('components/fleet-status/fleet-status.styl')
  assert.match(style, /\.fleet-status-scroll[\s\S]*?overflow-x hidden[\s\S]*?overflow-y auto/)
})

test('service selector exposes complete read-only Chinese tool UI and responsive scrolling', () => {
  const source = readClient('components/fleet-status/fleet-service-selector.jsx')
  parseClient('components/fleet-status/fleet-service-selector.jsx')
  for (const expected of [
    'shellpilotFleetAutoDetectServices',
    'shellpilotFleetTargetServers',
    'shellpilotFleetSearchServices',
    'shellpilotFleetAllTypes',
    'shellpilotFleetSystemService',
    'shellpilotFleetContainer',
    'shellpilotFleetProcessManager',
    'shellpilotFleetAllStatuses',
    'shellpilotFleetRunning',
    'shellpilotFleetStopped',
    'shellpilotFleetAbnormal',
    'shellpilotFleetDetectAgain',
    'shellpilotFleetCancelDetection',
    'shellpilotFleetSelectFiltered',
    'shellpilotFleetSelectAllAbnormal',
    'shellpilotFleetClearSelection',
    'shellpilotFleetServer',
    'shellpilotFleetServiceName',
    'shellpilotFleetType',
    'shellpilotFleetSource',
    'shellpilotFleetRunningStatus',
    'shellpilotFleetAutostart',
    'shellpilotFleetDescription',
    'shellpilotFleetResultsTruncated',
    'shellpilotFleetAdvancedInformation',
    'shellpilotFleetReadonlyProbeNotice',
    'shellpilotFleetDisconnected',
    'shellpilotFleetPermissionDenied',
    'shellpilotFleetServiceDetectionUnsupported',
    'shellpilotFleetCancelled'
  ]) {
    assert.ok(source.includes(expected), `missing service selector translation key: ${expected}`)
  }

  assert.match(source, /aria-label=\{e\('shellpilotFleetCloseServicePanel'\)\}/)
  assert.match(source, /aria-label=\{e\('shellpilotFleetSearchDiscoveredServices'\)\}/)
  assert.match(source, /aria-label=\{e\('shellpilotFleetServiceTypeFilter'\)\}/)
  assert.match(source, /aria-label=\{e\('shellpilotFleetServiceStatusFilter'\)\}/)
  assert.match(source, /disabled=\{state\.running \|\| !state\.targetCount\}/)
  assert.match(source, /disabled=\{!state\.running\}/)
  assert.match(source, /disabled=\{!state\.visibleRows\.length\}/)
  assert.match(source, /disabled=\{!state\.abnormalCount\}/)
  assert.match(source, /disabled=\{!state\.selectedCount\}/)
  assert.doesNotMatch(source, /rawOutput|arbitrary|任意命令|重启服务|修改服务/i)

  const styles = readClient('components/fleet-status/fleet-service-selector.styl')
  assert.match(styles, /overflow-x\s+auto/)
  assert.match(styles, /overflow-y\s+auto/)
  assert.match(styles, /max-width\s+calc\(100vw\s+-\s+32px\)/)
  assert.match(styles, /min-width\s+1120px/)
  assert.doesNotMatch(styles, /border-radius\s+(?:9|[1-9]\d+)px/)
})

test('service selector keeps controls and results reachable in short crowded drawers', () => {
  const styles = readClient('components/fleet-status/fleet-service-selector.styl').replace(/\r\n/g, '\n')

  assert.match(
    styles,
    / {2}\.ant-drawer-body\n(?: {4}.*\n)*? {4}overflow-y auto/
  )
  assert.match(
    styles,
    /\.fleet-service-selector-content\n(?: {2}.*\n)*? {2}overflow-y auto/
  )
  assert.match(
    styles,
    /\.fleet-service-selector-targets\n(?: {2}.*\n)*? {2}max-height clamp\(120px, 32vh, 240px\)(?:\n|[\s\S])*? {2}overflow-y auto/
  )
  assert.match(
    styles,
    /\.fleet-service-selector-table-scroll\n(?: {2}.*\n)*? {2}min-height clamp\(96px, 30vh, 220px\)/
  )
  assert.doesNotMatch(styles, /min-height\s+220px/)
  assert.match(styles, /overflow-x\s+auto/)
})

test('workspace owns on-demand service inventory without triggering status refresh', () => {
  const source = readClient('components/fleet-status/fleet-status-workspace.jsx')
  assert.match(source, /createFleetServiceSelectorStore/)
  assert.match(source, /<FleetServiceSelector/)
  assert.match(source, /serviceSelectorStore\.open\(selectedBookmarks\)/)
  assert.match(source, /onOpenServiceSelector=\{handleOpenServiceSelector\}/)
  assert.doesNotMatch(source, /onCheckServices|store\.onFleetStatusCheckServices/)

  const openHandler = source.match(
    /const handleOpenServiceSelector = \(\) => \{([\s\S]*?)\n {2}\}/
  )
  assert.ok(openHandler, 'missing internal service selector open handler')
  assert.doesNotMatch(openHandler[1], /refreshAll|refreshOne|\.collect\(/)
})

test('workspace restores check-services focus with a safe animation-frame fallback', () => {
  const source = readClient('components/fleet-status/fleet-status-workspace.jsx')

  assert.match(
    source,
    /const focusCheckServicesButton = \(\) => checkServicesButtonRef\.current\?\.focus\(\)/
  )
  assert.match(source, /typeof globalThis\.requestAnimationFrame === 'function'/)
  assert.match(
    source,
    /globalThis\.requestAnimationFrame\(focusCheckServicesButton\)/
  )
  assert.match(source, /else \{\s*focusCheckServicesButton\(\)\s*\}/)
  assert.doesNotMatch(source, /(^|[^\w.])requestAnimationFrame\s*\(/m)
})

test('table renders every required column with a unified unknown value', () => {
  const source = readClient('components/fleet-status/fleet-status-table.jsx')
  for (const heading of [
    'shellpilotFleetName',
    'shellpilotFleetGroup',
    'shellpilotFleetIpPort',
    'shellpilotFleetSshStatusLatency',
    'CPU',
    'shellpilotFleetMemory',
    'shellpilotFleetDisk',
    'shellpilotFleetLoad',
    'shellpilotFleetUptime',
    'shellpilotFleetNetworkIp',
    'shellpilotFleetFirewall',
    'shellpilotFleetAbnormalServices',
    'shellpilotFleetPlatformServices',
    'shellpilotFleetCollectedAt'
  ]) {
    assert.ok(source.includes(heading), `missing table heading translation key: ${heading}`)
  }
  assert.match(source, /const unknownValue = '--'/)
  assert.doesNotMatch(source, /username|password|privateKey|apiKey/i)
})

test('workspace keeps empty and uncollected states honest', () => {
  const source = readClient('components/fleet-status/fleet-status-workspace.jsx')
  parseClient('components/fleet-status/fleet-status-workspace.jsx')
  assert.match(source, /shellpilotFleetAddConnectionFirst/)
  assert.match(source, /shellpilotFleetNotCollectedYet/)
  assert.match(source, /FleetStatusToolbar/)
  assert.match(source, /FleetStatusTable/)
  assert.match(source, /const bookmarkCount = statusState\.bookmarkCount/)
  assert.doesNotMatch(source, /store\.bookmarks\.length/)
  assert.doesNotMatch(source, /setInterval|autoRefresh|mock|fake/i)

  const styles = readClient('components/fleet-status/fleet-status.styl')
  assert.match(styles, /overflow-x\s+auto/)
  assert.match(styles, /position\s+sticky/)
  assert.match(styles, /white-space\s+nowrap/)
  assert.doesNotMatch(styles, /border-radius\s+(?:9|[1-9]\d+)px/)
})
test('inactive workspace closes service discovery and skips hidden focus restoration', () => {
  const source = readClient('components/fleet-status/fleet-status-workspace.jsx')

  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(!active\) serviceSelectorStore\.close\(\)\s*\}, \[active, serviceSelectorStore\]\)/
  )
  assert.match(
    source,
    /const handleServiceSelectorClosed = \(\) => \{\s*if \(!active\) return/
  )
  assert.match(source, /serviceSelectorStore\.open\(selectedBookmarks\)/)
})

test('selector React keys use identity namespaces and header selection is one batch call', () => {
  const source = readClient('components/fleet-status/fleet-service-selector.jsx')

  assert.match(source, /<li key=\{server\.key\}>/)
  assert.match(
    source,
    /<tr className='fleet-service-selector-service-row' key=\{row\.id\}>/
  )
  const toggleVisible = source.match(
    /const toggleVisible = \(\) => \{([\s\S]*?)\n {2}\}/
  )
  assert.ok(toggleVisible, 'missing visible selection handler')
  assert.match(
    toggleVisible[1],
    /serviceStore\.setVisibleSelected\(!allVisibleSelected\)/
  )
  assert.doesNotMatch(toggleVisible[1], /for\s*\(|toggleSelected/)
})

test('service selector compiles with Stylus 0.64 and preserves color-mix CSS', async () => {
  assert.equal(stylusPackage.version, '0.64.0')
  const filename = path.join(
    root,
    'src/client/components/fleet-status/fleet-service-selector.styl'
  )
  const source = fs.readFileSync(filename, 'utf8')
  const css = await new Promise((resolve, reject) => {
    stylus(source)
      .set('filename', filename)
      .render((error, output) => {
        if (error) {
          reject(error)
          return
        }
        resolve(output)
      })
  })
  const variables = {
    success: 'success',
    info: 'info',
    warn: 'warn',
    error: 'error'
  }
  for (const [name, themeVariable] of Object.entries(variables)) {
    assert.ok(css.includes(
      `--fleet-service-${name}: color-mix(in srgb, var(--${themeVariable}) 15%, var(--text) 85%);`
    ))
  }
})

test('selector status colors stay theme-aware and above 4.5 contrast at 12px', () => {
  const styles = readClient('components/fleet-status/fleet-service-selector.styl').replace(/\r\n/g, '\n')
  const variables = {
    success: 'success',
    info: 'info',
    warn: 'warn',
    error: 'error'
  }
  for (const [name, themeVariable] of Object.entries(variables)) {
    assert.ok(styles.includes(
      `--fleet-service-${name} unquote('color-mix(in srgb, var(--${themeVariable}) 15%, var(--text) 85%)')`
    ))
    const uses = styles.match(new RegExp(
      `color var\\(--fleet-service-${name}\\)`,
      'g'
    )) || []
    assert.ok(uses.length >= 2, `missing semantic uses for ${name}`)
  }
  assert.match(
    styles,
    /\.fleet-service-selector-server-status\n(?: {2}.*\n)*? {2}font-size 12px/
  )
  assert.match(
    styles,
    /\.fleet-service-selector-state\n(?: {2}.*\n)*? {2}font-size 12px/
  )

  const channels = value => [1, 3, 5].map(index => (
    Number.parseInt(value.slice(index, index + 2), 16)
  ))
  const mix = (semantic, text) => {
    const textChannels = channels(text)
    return channels(semantic).map((value, index) => (
      Math.round(value * 0.15 + textChannels[index] * 0.85)
    ))
  }
  const luminance = values => {
    const linear = values.map(value => {
      const channel = value / 255
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const contrast = (foreground, background) => {
    const foregroundLuminance = luminance(foreground)
    const backgroundLuminance = luminance(channels(background))
    return (
      Math.max(foregroundLuminance, backgroundLuminance) + 0.05
    ) / (
      Math.min(foregroundLuminance, backgroundLuminance) + 0.05
    )
  }
  const semanticColors = {
    success: '#06D6A0',
    info: '#FFD166',
    warn: '#E55934',
    error: '#EF476F'
  }
  const themes = {
    dark: {
      text: '#dddddd',
      surfaces: ['#121214', '#2E3338']
    },
    light: {
      text: '#555555',
      surfaces: ['#ededed', '#fefefe']
    }
  }

  for (const [themeName, theme] of Object.entries(themes)) {
    for (const [state, semantic] of Object.entries(semanticColors)) {
      const foreground = mix(semantic, theme.text)
      for (const background of theme.surfaces) {
        const ratio = contrast(foreground, background)
        assert.ok(
          ratio >= 4.5,
          `${themeName} ${state} contrast ${ratio.toFixed(2)}:1`
        )
      }
    }
  }
})

test('025 uses AntD6 dialog semantics and retained hidden content', () => {
  const source = readTest('e2e/025.fleet-service-selector.spec.js')

  assert.match(source, /getByRole\('button', \{ name: \/检查服务\//)
  assert.doesNotMatch(source, /name: '检查服务', exact: true/)
  assert.match(
    source,
    /page\.locator\('\.ant-drawer\.fleet-service-selector-drawer'\)/
  )
  assert.match(
    source,
    /getByRole\('dialog', \{[\s\S]*name: \/自动识别服务\/[\s\S]*includeHidden: true/
  )
  assert.match(source, /await expect\(dialog\)\.toBeHidden\(\)/)
  assert.match(
    source,
    /await expect\(dialog\.getByLabel\('搜索自动发现的服务'\)\)\.toBeHidden\(\)/
  )
  assert.doesNotMatch(source, /expect\(drawer\)\.not\.toBeVisible\(\)/)
})

test('025 proves short unpinned AI layout and preserves themes Escape and focus', () => {
  const workspace = readClient('components/fleet-status/fleet-status-workspace.jsx')
  const source = readTest('e2e/025.fleet-service-selector.spec.js')

  assert.match(workspace, /shellGeometry\.terminalInsets/)
  assert.doesNotMatch(workspace, /frame\.right = store\.rightPanelVisible/)
  assert.doesNotMatch(workspace, /getMaxRightPanelWidth|normalizeRightPanelWidth|getAIGShellFrameInsets/)
  assert.match(source, /const selectorThemes = \[/)
  assert.match(source, /theme: 'default'/)
  assert.match(source, /theme: 'defaultLight'/)
  assert.match(source, /window\.setContentSize\(640, 420\)/)
  assert.match(source, /window\.store\.rightPanelPinned = false/)
  assert.match(source, /document\.elementFromPoint/)
  assert.match(source, /hitIsButton/)
  assert.match(source, /contrastRatio/)
  assert.match(
    source,
    /await setShortWindow\([\s\S]*await checkServices\.click\(\)/
  )
  assert.match(
    source,
    /await checkServices\.click\(\)[\s\S]*await page\.keyboard\.press\('Escape'\)/
  )
  assert.match(source, /await expect\(checkServices\)\.toBeFocused\(\)/)
  assert.doesNotMatch(
    source,
    /\.click\(\{\s*force:\s*true|keyboard\.press\('Enter'\)/
  )
})
