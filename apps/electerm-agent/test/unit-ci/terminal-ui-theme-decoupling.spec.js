const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const storeDir = path.resolve(__dirname, '../../src/client/store')

registerHooks({
  resolve (specifier, context, nextResolve) {
    if (specifier === '../common/download') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export default function download () {}'
      }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      for (const extension of ['.js', '.jsx']) {
        const candidate = new URL(`${specifier}${extension}`, context.parentURL)
        if (fs.existsSync(candidate)) {
          return { shortCircuit: true, url: candidate.href }
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load (url, context, nextLoad) {
    if (/\.(?:png|svg)$/.test(url)) {
      return {
        shortCircuit: true,
        format: 'module',
        source: 'export default "test-asset"'
      }
    }
    return nextLoad(url, context)
  }
})

async function createStore (config, terminalThemes = []) {
  global.window = {
    et: { packInfo: {}, isWin: true, isMac: false, isArm: false },
    pre: { packInfo: {}, isWin: true, isMac: false, isArm: false },
    navigator: { userAgent: 'node-test' },
    translate: key => key
  }
  const [{ default: itemExtend }, { default: terminalThemeExtend }] = await Promise.all([
    import(pathToFileURL(path.join(storeDir, 'item.js')).href),
    import(pathToFileURL(path.join(storeDir, 'terminal-theme.js')).href)
  ])

  class Store {}
  itemExtend(Store)
  terminalThemeExtend(Store)
  const store = new Store()
  store.config = { ...config }
  store.terminalThemes = terminalThemes
  store.itermThemes = []
  store.updateConfig = updates => Object.assign(store.config, updates)
  window.store = store
  return store
}

test('applying a ShellPilot UI palette preserves the active default-light terminal palette', async () => {
  const store = await createStore({ theme: 'defaultLight' })
  const before = store.getThemeConfig()

  store.setTheme('shellpilot-ocean')

  assert.equal(store.config.theme, 'shellpilot-ocean')
  assert.equal(store.config.terminalTheme, 'defaultLight')
  assert.deepEqual(store.getThemeConfig(), before)
  assert.equal(store.getThemeConfig().background, '#0E0F12')
})

test('switching ShellPilot UI palettes preserves custom terminal foreground, cursor, selection and ANSI colors', async () => {
  const customTheme = {
    id: 'custom-ansi',
    name: 'Custom ANSI',
    uiThemeConfig: { main: '#223344', text: '#ffffff' },
    themeConfig: {
      background: '#ffffff',
      foreground: '#ABCDEF',
      cursor: '#102030',
      selectionBackground: '#405060',
      black: '#010101',
      red: '#A10000',
      brightCyan: '#00A1A1'
    }
  }
  const store = await createStore({ theme: customTheme.id }, [customTheme])
  const expected = store.getThemeConfig()

  store.setTheme('shellpilot-jade')
  store.setTheme('shellpilot-indigo')

  const paletteRecord = store.getSidebarList('terminalThemes')
    .find(theme => theme.id === 'shellpilot-indigo')
  assert.equal(store.config.theme, 'shellpilot-indigo')
  assert.equal(store.config.terminalTheme, customTheme.id)
  assert.deepEqual(store.getThemeConfig(), expected)
  assert.deepEqual(paletteRecord.themeConfig, expected)
  assert.equal(store.getThemeConfig().background, '#0E0F12')
  assert.equal(store.getThemeConfig().foreground, '#ABCDEF')
  assert.equal(store.getThemeConfig().cursor, '#102030')
  assert.equal(store.getThemeConfig().selectionBackground, '#405060')
  assert.equal(store.getThemeConfig().red, '#A10000')
  assert.equal(store.getThemeConfig().brightCyan, '#00A1A1')
})

test('old persisted configs without terminalTheme keep a non-ShellPilot theme and safely fall back from a ShellPilot theme', async () => {
  const legacyLight = await createStore({ theme: 'defaultLight' })
  const defaultLightTerminal = legacyLight.getSidebarList('terminalThemes')
    .find(theme => theme.id === 'defaultLight').themeConfig
  assert.deepEqual(legacyLight.getThemeConfig(), defaultLightTerminal)

  const legacyShellPilot = await createStore({ theme: 'shellpilot-amber' })
  const defaultTerminal = legacyShellPilot.getSidebarList('terminalThemes')
    .find(theme => theme.id === 'default').themeConfig
  assert.deepEqual(legacyShellPilot.getThemeConfig(), defaultTerminal)
  legacyShellPilot.setTheme('shellpilot-graphite')
  assert.equal(legacyShellPilot.config.terminalTheme, 'default')
})
