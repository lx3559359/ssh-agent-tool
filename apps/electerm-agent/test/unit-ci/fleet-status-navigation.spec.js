const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default
const generate = require('@babel/generator').default
const t = require('@babel/types')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const navigationPath = path.join(
  root,
  'src/client/components/fleet-status/fleet-status-navigation.js'
)

function readClient (file) {
  return fs.readFileSync(path.join(root, 'src/client', file), 'utf8')
}

function parseClient (file) {
  return parser.parse(readClient(file), {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining']
  })
}

async function loadNavigation () {
  assert.ok(
    fs.existsSync(navigationPath),
    'fleet status navigation behavior module must exist'
  )
  return import(pathToFileURL(navigationPath))
}

function importExpression (source, property) {
  const imported = t.callExpression(t.identifier('__import'), [
    t.stringLiteral(source)
  ])
  return property
    ? t.memberExpression(imported, t.identifier(property))
    : imported
}

function loadClientModule (file, options = {}) {
  const ast = parseClient(file)
  options.prepareAst?.(ast)
  traverse(ast, {
    ImportDeclaration (modulePath) {
      const source = modulePath.node.source.value
      const declarations = modulePath.node.specifiers.map(specifier => {
        let value
        if (t.isImportDefaultSpecifier(specifier)) {
          value = importExpression(source, 'default')
        } else if (t.isImportNamespaceSpecifier(specifier)) {
          value = importExpression(source)
        } else {
          value = importExpression(source, specifier.imported.name)
        }
        return t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(specifier.local.name), value)
        ])
      })
      modulePath.replaceWithMultiple(declarations)
    },
    ExportDefaultDeclaration (exportPath) {
      exportPath.replaceWith(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('module'), t.identifier('exports')),
            t.toExpression(exportPath.node.declaration)
          )
        )
      )
    }
  })

  const noop = () => {}
  const fallbackImport = new Proxy({ default: noop }, {
    get: (target, property) => target[property] || noop
  })
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    __import: source => options.imports?.[source] || fallbackImport,
    window: options.window || {},
    console,
    setTimeout,
    clearTimeout,
    structuredClone
  }
  vm.runInNewContext(generate(ast).code, context, { filename: file })
  return module.exports
}

function createControlledTimers () {
  let now = 0
  let nextId = 0
  const pending = new Map()
  const setTimer = (callback, delay) => {
    const id = ++nextId
    pending.set(id, { callback, due: now + delay })
    return id
  }
  const clearTimer = id => pending.delete(id)
  const advance = duration => {
    now += duration
    const due = [...pending.entries()]
      .filter(([, task]) => task.due <= now)
      .sort((left, right) => left[1].due - right[1].due)
    for (const [id, task] of due) {
      pending.delete(id)
      task.callback()
    }
  }
  const debounce = (callback, delay) => {
    let timerId
    return function (...args) {
      clearTimer(timerId)
      const context = this
      timerId = setTimer(() => {
        timerId = undefined
        callback.apply(context, args)
      }, delay)
    }
  }
  return { advance, debounce }
}

async function createStoreHarness () {
  const navigation = await loadNavigation()
  const timers = createControlledTimers()
  let generatedId = 0
  class Store {}
  const window = {
    translate: value => value,
    et: {},
    pre: {}
  }
  const store = new Store()
  Object.assign(store, {
    activeTabId: 'tab-1',
    activeTabId0: 'tab-1',
    config: {},
    history: [],
    mainWorkspaceMode: 'fleet-status',
    tabs: [{ id: 'tab-1', batch: 0, title: 'Primary' }],
    focusCalls: 0,
    focus () {
      this.focusCalls += 1
    }
  })
  window.store = store

  const imports = {
    'lodash-es': {
      debounce: timers.debounce,
      isEqual: () => false
    },
    '../common/constants': {
      maxHistory: 10,
      paneMap: { terminal: 'terminal' },
      splitConfig: {
        c1: { children: 1 },
        c2: { children: 2 }
      },
      statusMap: { processing: 'processing' }
    },
    '../components/common/ref': {
      refs: { get: () => null },
      refsTabs: { get: () => null }
    },
    '../components/common/message': { default: () => {} },
    '../common/safe-local-storage': {},
    'json-deep-copy': { default: value => structuredClone(value) },
    '../common/id-with-stamp': {
      default: () => `generated-${++generatedId}`
    },
    '../common/uid': { default: () => 'uid' },
    '../common/new-terminal.js': {
      default: () => ({ id: 'new-terminal', batch: 0 }),
      updateCount: () => 2
    },
    manate: { action: fn => fn },
    '../components/fleet-status/fleet-status-navigation': navigation
  }

  const installTabs = loadClientModule('store/tab.js', { imports, window })
  installTabs(Store)
  const installMcp = loadClientModule('store/mcp-handler.js', { window })
  installMcp(Store)

  return { Store, navigation, store, timers, window }
}

function findJsxOpening (ast, name) {
  let result
  traverse(ast, {
    JSXOpeningElement (elementPath) {
      if (
        !result &&
        t.isJSXIdentifier(elementPath.node.name, { name })
      ) {
        result = elementPath
      }
    }
  })
  return result
}

test('workspace state switches without mutating mounted terminal state', async () => {
  const { openFleetStatus, closeFleetStatus } = await loadNavigation()
  const tabs = [{ id: 'terminal-1', pane: 'terminal' }]
  const store = {
    mainWorkspaceMode: 'terminal',
    tabs,
    activeTabId: 'terminal-1'
  }

  assert.equal(openFleetStatus(store), true)
  assert.equal(store.mainWorkspaceMode, 'fleet-status')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(store.activeTabId, 'terminal-1')

  assert.equal(closeFleetStatus(store), true)
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.strictEqual(store.tabs, tabs)
  assert.equal(closeFleetStatus(store), false)

  const ast = parseClient('store/init-state.js')
  let defaultMode
  traverse(ast, {
    ObjectProperty (propertyPath) {
      if (t.isIdentifier(propertyPath.node.key, { name: 'mainWorkspaceMode' })) {
        defaultMode = propertyPath.node.value.value
      }
    }
  })
  assert.equal(defaultMode, 'terminal')
})

test('public tab switch validates stale ids before exiting fleet', async () => {
  const { store } = await createStoreHarness()

  store.changeActiveTabId('tab-1')
  assert.equal(store.mainWorkspaceMode, 'terminal')

  store.mainWorkspaceMode = 'fleet-status'
  assert.equal(store.changeActiveTabId('missing'), undefined)
  assert.equal(store.mainWorkspaceMode, 'fleet-status')

  store.mainWorkspaceMode = 'fleet-status'
  store.duplicateTab('tab-1')
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.tabs.length, 2)
  assert.equal(store.activeTabId, 'generated-1')
})

test('duplicate and clone intents still exit fleet before no-op paths', async () => {
  const { store } = await createStoreHarness()

  store.mainWorkspaceMode = 'fleet-status'
  assert.equal(store.duplicateTab('missing'), undefined)
  assert.equal(store.mainWorkspaceMode, 'terminal')

  store.mainWorkspaceMode = 'fleet-status'
  assert.equal(store.cloneToNextLayout(), undefined)
  assert.equal(store.mainWorkspaceMode, 'terminal')

  store.mainWorkspaceMode = 'fleet-status'
  store.duplicateTab('tab-1')
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.tabs.length, 2)
  assert.equal(store.activeTabId, 'generated-1')
})

test('keyboard tab navigation closes once, focuses after switching, and ignores stale close tails', async () => {
  const { navigation, store, timers, window } = await createStoreHarness()
  store.tabs.push({ id: 'tab-2', batch: 0, title: 'Secondary' })
  const body = {}
  const fleetWorkspace = {
    classList: {
      contains: name => name === 'fleet-status-workspace'
    }
  }
  window.document = { activeElement: fleetWorkspace, body }
  let mode = store.mainWorkspaceMode
  let closeWrites = 0
  Object.defineProperty(store, 'mainWorkspaceMode', {
    configurable: true,
    get: () => mode,
    set: value => {
      if (value === 'terminal') closeWrites += 1
      mode = value
    }
  })

  const dispatchNext = () => navigation.routeFleetStatusShortcut({
    active: true,
    funcName: 'nextTabShortcut',
    event: {},
    close: () => navigation.closeFleetStatus(store),
    invoke: () => store.clickNextTab()
  })
  const dispatchPrev = () => navigation.routeFleetStatusShortcut({
    active: true,
    funcName: 'prevTabShortcut',
    event: {},
    close: () => navigation.closeFleetStatus(store),
    invoke: () => store.clickPrevTab()
  })

  assert.deepEqual(dispatchNext(), { routed: true, value: undefined })
  assert.equal(mode, 'terminal')
  assert.equal(closeWrites, 1)
  assert.equal(store.activeTabId, 'tab-1')
  assert.equal(store.focusCalls, 0)

  timers.advance(99)
  assert.equal(store.activeTabId, 'tab-1')
  assert.equal(store.focusCalls, 0)
  timers.advance(1)
  assert.equal(store.activeTabId, 'tab-2')
  assert.equal(store.focusCalls, 1)
  assert.equal(closeWrites, 1)

  store.activeTabId = 'tab-1'
  store.activeTabId0 = 'tab-1'
  store.focusCalls = 0
  store.mainWorkspaceMode = 'fleet-status'
  closeWrites = 0
  dispatchNext()
  assert.equal(closeWrites, 1)
  store.mainWorkspaceMode = 'fleet-status'
  timers.advance(100)
  assert.equal(store.activeTabId, 'tab-2')
  assert.equal(store.mainWorkspaceMode, 'fleet-status')
  assert.equal(store.focusCalls, 0)
  assert.equal(closeWrites, 1)

  store.activeTabId = 'tab-1'
  store.activeTabId0 = 'tab-1'
  store.focusCalls = 0
  store.mainWorkspaceMode = 'fleet-status'
  window.document.activeElement = fleetWorkspace
  dispatchNext()
  window.document.activeElement = { role: 'ai-textarea' }
  timers.advance(100)
  assert.equal(store.activeTabId, 'tab-2')
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.focusCalls, 0)

  store.activeTabId = 'tab-1'
  store.activeTabId0 = 'tab-1'
  store.focusCalls = 0
  store.mainWorkspaceMode = 'fleet-status'
  store.showModal = false
  window.document.activeElement = fleetWorkspace
  dispatchNext()
  store.showModal = true
  window.document.activeElement = body
  timers.advance(100)
  assert.equal(store.activeTabId, 'tab-2')
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.focusCalls, 0)

  store.activeTabId = 'tab-2'
  store.activeTabId0 = 'tab-2'
  store.focusCalls = 0
  store.showModal = false
  store.mainWorkspaceMode = 'fleet-status'
  window.document.activeElement = fleetWorkspace
  closeWrites = 0
  dispatchPrev()
  assert.equal(closeWrites, 1)
  timers.advance(100)
  assert.equal(store.activeTabId, 'tab-1')
  assert.equal(store.mainWorkspaceMode, 'terminal')
  assert.equal(store.focusCalls, 1)
})

test('MCP and system menu tab switches reuse the public tab switch', async () => {
  const { store, window } = await createStoreHarness()
  const publicSwitch = store.changeActiveTabId.bind(store)
  const switchedIds = []
  store.changeActiveTabId = id => {
    switchedIds.push(id)
    return publicSwitch(id)
  }

  const result = store.mcpSwitchTab({ tabId: 'tab-1' })
  assert.equal(result.success, true)
  assert.deepEqual(switchedIds, ['tab-1'])
  assert.equal(store.mainWorkspaceMode, 'terminal')

  store.mainWorkspaceMode = 'fleet-status'
  assert.throws(
    () => store.mcpSwitchTab({ tabId: 'missing' }),
    /Tab not found/
  )
  assert.deepEqual(switchedIds, ['tab-1', 'missing'])
  assert.equal(store.mainWorkspaceMode, 'fleet-status')

  const MenuTab = loadClientModule(
    'components/sys-menu/sub-tab-menu.jsx',
    {
      window,
      imports: {
        react: {
          PureComponent: class PureComponent {
            constructor (props) {
              this.props = props
            }
          }
        }
      },
      prepareAst: ast => {
        traverse(ast, {
          ClassMethod (methodPath) {
            if (t.isIdentifier(methodPath.node.key, { name: 'render' })) {
              methodPath.node.body = t.blockStatement([
                t.returnStatement(t.nullLiteral())
              ])
            }
          }
        })
      }
    }
  )
  store.mainWorkspaceMode = 'fleet-status'
  new MenuTab({ item: { id: 'tab-1' } }).handleClick()
  assert.deepEqual(switchedIds, ['tab-1', 'missing', 'tab-1'])
  assert.equal(store.mainWorkspaceMode, 'terminal')
})

test('fleet shortcut router blocks controls, exits for navigation, and keeps AI submit', async () => {
  const {
    dispatchAiChatShortcut,
    routeFleetStatusShortcut
  } = await loadNavigation()
  const blockedCalls = []
  const blockedEvent = {
    preventDefault: () => blockedCalls.push('prevent'),
    stopPropagation: () => blockedCalls.push('stop')
  }
  const blocked = routeFleetStatusShortcut({
    active: true,
    funcName: 'closeCurrentTabShortcut',
    event: blockedEvent,
    close: () => blockedCalls.push('close'),
    invoke: () => blockedCalls.push('invoke')
  })
  assert.deepEqual(blocked, { routed: true, value: false })
  assert.deepEqual(blockedCalls, ['prevent', 'stop'])

  const navigationCalls = []
  const navigated = routeFleetStatusShortcut({
    active: true,
    funcName: 'newTabShortcut',
    event: {},
    close: () => navigationCalls.push('close'),
    invoke: () => navigationCalls.push('invoke')
  })
  assert.deepEqual(navigated, { routed: true, value: 2 })
  assert.deepEqual(navigationCalls, ['close', 'invoke'])

  let aiSubmitCalls = 0
  const aiHandled = dispatchAiChatShortcut({
    event: {
      ctrlKey: true,
      key: 'Enter',
      shiftKey: false,
      altKey: false,
      metaKey: false
    },
    rightPanelTab: 'ai',
    activeElement: {
      tagName: 'TEXTAREA',
      classList: { contains: name => name === 'ai-chat-textarea' }
    },
    submit: () => {
      aiSubmitCalls += 1
    }
  })
  assert.equal(aiHandled, true)
  assert.equal(aiSubmitCalls, 1)
})

test('fleet accessibility props use inert and focus the active workspace', async () => {
  const {
    focusFleetStatusWorkspace,
    getTerminalWorkspaceAccessibility
  } = await loadNavigation()
  assert.deepEqual(getTerminalWorkspaceAccessibility(false), {
    inert: false,
    'aria-hidden': false
  })
  assert.deepEqual(getTerminalWorkspaceAccessibility(true), {
    inert: true,
    'aria-hidden': true
  })

  const calls = []
  const workspace = { focus: options => calls.push(options) }
  assert.equal(focusFleetStatusWorkspace(false, workspace), false)
  assert.equal(focusFleetStatusWorkspace(true, workspace), true)
  assert.deepEqual(calls, [{ preventScroll: true }])
})

test('main keeps Layout mounted while the AI panel stays outside the terminal layer', () => {
  const ast = parseClient('components/main/main.jsx')
  const layout = findJsxOpening(ast, 'Layout')
  const fleet = findJsxOpening(ast, 'FleetStatusWorkspace')
  const rightPanel = findJsxOpening(ast, 'RightSidePanel')
  assert.ok(layout)
  assert.ok(fleet)
  assert.ok(rightPanel)

  const terminalLayer = layout.findParent(parentPath => {
    if (!parentPath.isJSXElement()) return false
    return parentPath.node.openingElement.attributes.some(attribute => (
      t.isJSXSpreadAttribute(attribute) &&
      t.isIdentifier(attribute.argument, { name: 'terminalWorkspaceProps' })
    ))
  })
  assert.ok(terminalLayer)
  assert.equal(
    Boolean(rightPanel.findParent(parentPath => parentPath === terminalLayer)),
    false
  )
  assert.equal(
    Boolean(layout.findParent(parentPath => (
      parentPath.isConditionalExpression() || parentPath.isLogicalExpression()
    ))),
    false
  )
  assert.ok(fleet.node.start > layout.node.start)
  assert.ok(rightPanel.node.start > fleet.node.start)
})

test('fleet skeleton exposes real controls without fabricated status data', () => {
  const source = readClient('components/fleet-status/fleet-status-workspace.jsx')
  assert.match(source, /shellpilotFleetServerStatusOverview/)
  assert.match(source, /shellpilotFleetNoStatusData/)
  assert.match(
    source,
    /<Button[\s\S]*?disabled=\{statusState\.running\}[\s\S]*?shellpilotFleetRefresh/
  )

  const styles = readClient('components/fleet-status/fleet-status.styl')
  assert.doesNotMatch(styles, /border-radius\s+(?:9|[1-9]\d+)px/)
})
