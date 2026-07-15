const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientRoot = path.resolve(__dirname, '../../src/client')
const interactionUrl = pathToFileURL(path.join(
  clientRoot,
  'common/settings-search-interaction.js'
)).href
const i18nUrl = pathToFileURL(path.join(
  clientRoot,
  'common/shellpilot-i18n-overrides.js'
)).href

function target (tagName, options = {}) {
  return {
    tagName,
    isContentEditable: Boolean(options.isContentEditable),
    classList: {
      contains: name => (options.classes || []).includes(name)
    }
  }
}

test('settings search shortcut ignores SSH and editing targets without consuming the event', async () => {
  const { shouldHandleSettingsSearchShortcut } = await import(interactionUrl)
  const editableTargets = [
    target('INPUT'),
    target('TEXTAREA'),
    target('DIV', { isContentEditable: true }),
    target('TEXTAREA', { classes: ['xterm-helper-textarea'] })
  ]

  for (const editableTarget of editableTargets) {
    assert.equal(shouldHandleSettingsSearchShortcut({
      key: 'k',
      ctrlKey: true,
      target: editableTarget,
      activeElement: editableTarget
    }), false)
  }
  const input = target('INPUT')
  assert.equal(shouldHandleSettingsSearchShortcut({
    key: 'k',
    metaKey: true,
    target: target('BODY'),
    activeElement: input
  }), false)
  assert.equal(shouldHandleSettingsSearchShortcut({
    key: 'k',
    ctrlKey: true,
    isComposing: true,
    target: target('BODY')
  }), false)
})

test('settings search shortcut handles Ctrl or Command K only outside editing contexts', async () => {
  const { shouldHandleSettingsSearchShortcut } = await import(interactionUrl)
  const body = target('BODY')

  assert.equal(shouldHandleSettingsSearchShortcut({ key: 'k', ctrlKey: true, target: body }), true)
  assert.equal(shouldHandleSettingsSearchShortcut({ key: 'K', metaKey: true, target: body }), true)
  assert.equal(shouldHandleSettingsSearchShortcut({ key: 'k', target: body }), false)
  assert.equal(shouldHandleSettingsSearchShortcut({ key: 'p', ctrlKey: true, target: body }), false)
})

test('settings search shortcut title uses Command on macOS and Ctrl elsewhere through the catalog', async () => {
  const {
    formatSettingsSearchShortcutTitle,
    getSettingsSearchShortcutLabel
  } = await import(interactionUrl)
  const { getShellPilotTranslation } = await import(i18nUrl)
  const translate = language => key => getShellPilotTranslation(key, language)

  assert.equal(getSettingsSearchShortcutLabel(false), 'Ctrl+K')
  assert.equal(getSettingsSearchShortcutLabel(true), '⌘K')
  assert.equal(
    formatSettingsSearchShortcutTitle(translate('en_us'), false),
    'Search settings (Ctrl+K)'
  )
  assert.equal(
    formatSettingsSearchShortcutTitle(translate('en_us'), true),
    'Search settings (⌘K)'
  )
  assert.equal(
    formatSettingsSearchShortcutTitle(translate('zh_cn'), true),
    '搜索设置（⌘K）'
  )
})
