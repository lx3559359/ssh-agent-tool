const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')
const { pathToFileURL } = require('node:url')

const clientCommonDir = path.resolve(__dirname, '../../src/client/common')
const terminalThemeUrl = pathToFileURL(path.join(clientCommonDir, 'terminal-theme.js'))

registerHooks({
  resolve (specifier, context, nextResolve) {
    if (context.parentURL === terminalThemeUrl.href) {
      if (specifier === '../common/constants') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export const settingMap = {}'
        }
      }
      if (specifier === '../common/download') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export default function download () {}'
        }
      }
      if (specifier === './theme-defaults') {
        return {
          shortCircuit: true,
          url: 'data:text/javascript,export function defaultTheme () { return { themeConfig: {} } }'
        }
      }
    }
    return nextResolve(specifier, context)
  }
})

global.window = {
  translate: value => value
}

test('ShellPilot locks terminal background while preserving other theme colors', async () => {
  const {
    shellPilotTerminalBackground,
    normalizeTerminalThemeConfig
  } = await import(pathToFileURL(path.join(clientCommonDir, 'shellpilot-theme-constraints.js')))

  assert.equal(shellPilotTerminalBackground, '#0E0F12')
  assert.deepEqual(
    normalizeTerminalThemeConfig({
      background: '#fafafa',
      foreground: '#222222'
    }),
    {
      background: '#0E0F12',
      foreground: '#222222'
    }
  )
  assert.deepEqual(
    normalizeTerminalThemeConfig(['#ffffff']),
    { background: '#0E0F12' }
  )
  assert.deepEqual(
    normalizeTerminalThemeConfig('background=#ffffff'),
    { background: '#0E0F12' }
  )
})

test('imported terminal themes keep their foreground and use the locked background', async () => {
  const { convertTheme } = await import(terminalThemeUrl)

  const converted = convertTheme([
    'main=#ffffff',
    'terminal:background=#fafafa',
    'terminal:foreground=#222222'
  ].join('\n'))

  assert.equal(converted.themeConfig.background, '#0E0F12')
  assert.equal(converted.themeConfig.foreground, '#222222')
})

test('theme save and database defaults enforce the locked background', () => {
  const themeFormSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/theme/theme-form.jsx'),
    'utf8'
  )
  const dbDefaultsSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/app/upgrade/db-defaults.js'),
    'utf8'
  )

  assert.match(themeFormSource, /normalizeTerminalThemeConfig/)
  assert.doesNotMatch(
    themeFormSource,
    /converted\.themeConfig\.background\s*=\s*converted\.uiThemeConfig\.main/
  )
  assert.match(dbDefaultsSource, /background=#0E0F12/)
  assert.match(dbDefaultsSource, /background:\s*'#0E0F12'/)
})
