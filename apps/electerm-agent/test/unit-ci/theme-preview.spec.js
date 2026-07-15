const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const clientDir = path.resolve(__dirname, '../../src/client')
const previewModelUrl = pathToFileURL(path.join(
  clientDir,
  'common/theme-preview-model.js'
)).href
const paletteModuleUrl = pathToFileURL(path.join(
  clientDir,
  'common/shellpilot-ui-palettes.js'
)).href

function read (file) {
  return fs.readFileSync(path.join(clientDir, file), 'utf8')
}

test('preview controller keeps preview local and toggles the same theme off', async () => {
  const { createThemePreviewController } = await import(previewModelUrl)
  const persisted = []
  const observed = []
  const controller = createThemePreviewController({
    setTheme: id => persisted.push(id),
    onChange: id => observed.push(id)
  })

  assert.equal(controller.preview('ocean'), 'ocean')
  assert.equal(controller.getPreviewThemeId(), 'ocean')
  assert.deepEqual(persisted, [])

  assert.equal(controller.preview('ocean'), '')
  assert.equal(controller.preview('jade'), 'jade')
  assert.equal(controller.preview('indigo'), 'indigo')
  assert.equal(controller.getPreviewThemeId(), 'indigo')
  assert.deepEqual(persisted, [])
  assert.deepEqual(observed, ['ocean', '', 'jade', 'indigo'])
})

test('apply persists exactly once and clears preview only after success', async () => {
  const { createThemePreviewController } = await import(previewModelUrl)
  const persisted = []
  const observed = []
  const controller = createThemePreviewController({
    setTheme: async id => persisted.push(id),
    onChange: id => observed.push(id)
  })

  controller.preview('ocean')
  const result = await controller.apply('jade')

  assert.deepEqual(result, {
    ok: true,
    previewThemeId: ''
  })
  assert.deepEqual(persisted, ['jade'])
  assert.equal(controller.getPreviewThemeId(), '')
  assert.deepEqual(observed, ['ocean', ''])
})

test('apply clears failed preview and avoids an unnecessary rollback', async t => {
  const { createThemePreviewController } = await import(previewModelUrl)

  for (const scenario of [
    {
      name: 'throw',
      error: new Error('write failed'),
      setTheme (id) {
        assert.equal(id, 'jade')
        throw this.error
      }
    },
    {
      name: 'reject',
      error: new Error('write rejected'),
      setTheme (id) {
        assert.equal(id, 'jade')
        return Promise.reject(this.error)
      }
    }
  ]) {
    await t.test(scenario.name, async () => {
      let calls = 0
      const observed = []
      const controller = createThemePreviewController({
        setTheme: id => {
          calls++
          return scenario.setTheme(id)
        },
        getCurrentThemeId: () => 'default',
        onChange: id => observed.push(id)
      })
      controller.preview('ocean')

      let caught
      try {
        await controller.apply('jade')
      } catch (error) {
        caught = error
      }

      assert.equal(calls, 1)
      assert.equal(caught, scenario.error)
      assert.equal(caught.themeApplyResult.ok, false)
      assert.equal(caught.themeApplyResult.rollbackAttempted, false)
      assert.equal(caught.themeApplyResult.previewThemeId, '')
      assert.equal(controller.getPreviewThemeId(), '')
      assert.deepEqual(observed, ['ocean', ''])
    })
  }
})

test('apply rolls a partial theme write back once and exposes rollback failure', async t => {
  const { createThemePreviewController } = await import(previewModelUrl)

  await t.test('rollback succeeds', async () => {
    let currentThemeId = 'default'
    const calls = []
    const writeError = new Error('partial write')
    const controller = createThemePreviewController({
      getCurrentThemeId: () => currentThemeId,
      setTheme: id => {
        calls.push(id)
        currentThemeId = id
        if (id === 'jade') throw writeError
      }
    })

    await assert.rejects(controller.apply('jade'), error => {
      assert.equal(error, writeError)
      assert.equal(error.themeApplyResult.rollbackAttempted, true)
      assert.equal(error.themeApplyResult.rollbackError, undefined)
      return true
    })
    assert.deepEqual(calls, ['jade', 'default'])
    assert.equal(currentThemeId, 'default')
  })

  await t.test('rollback failure is not retried', async () => {
    let currentThemeId = 'default'
    const calls = []
    const writeError = new Error('partial write')
    const rollbackError = new Error('rollback failed')
    const controller = createThemePreviewController({
      getCurrentThemeId: () => currentThemeId,
      setTheme: id => {
        calls.push(id)
        currentThemeId = id
        if (id === 'jade') throw writeError
        throw rollbackError
      }
    })

    await assert.rejects(controller.apply('jade'), error => {
      assert.equal(error, writeError)
      assert.equal(error.themeApplyResult.rollbackAttempted, true)
      assert.equal(error.themeApplyResult.rollbackError, rollbackError)
      return true
    })
    assert.deepEqual(calls, ['jade', 'default'])
  })
})

test('apply normalizes a non-Error write failure without losing cleanup result', async () => {
  const { createThemePreviewController } = await import(previewModelUrl)
  const controller = createThemePreviewController({
    getCurrentThemeId: () => 'default',
    setTheme: () => ({
      then: (resolve, reject) => reject('write failed')
    })
  })
  controller.preview('jade')

  await assert.rejects(controller.apply('jade'), error => {
    assert.equal(error instanceof Error, true)
    assert.equal(error.message, 'write failed')
    assert.equal(error.themeApplyResult.ok, false)
    assert.equal(error.themeApplyResult.previewThemeId, '')
    return true
  })
})

test('apply feedback handler awaits failure cleanup before showing localized error', async () => {
  const {
    applyThemeWithFeedback,
    createThemePreviewController
  } = await import(previewModelUrl)
  const events = []
  const controller = createThemePreviewController({
    getCurrentThemeId: () => 'default',
    setTheme: () => {
      events.push('write')
      throw new Error('write failed')
    },
    onChange: id => events.push(`preview:${id}`)
  })
  controller.preview('jade')

  const result = await applyThemeWithFeedback({
    controller,
    themeId: 'jade',
    errorMessage: 'Unable to apply theme',
    showError: content => events.push(`error:${content}`)
  })

  assert.equal(result.ok, false)
  assert.deepEqual(events, [
    'preview:jade',
    'write',
    'preview:',
    'error:Unable to apply theme'
  ])
})

test('in-flight apply cannot clear a newer preview and concurrent apply is blocked', async () => {
  const { createThemePreviewController } = await import(previewModelUrl)
  let finishWrite
  const writes = []
  const applyingStates = []
  const controller = createThemePreviewController({
    getCurrentThemeId: () => 'default',
    setTheme: id => {
      writes.push(id)
      if (writes.length > 1) return Promise.resolve()
      return new Promise(resolve => {
        finishWrite = resolve
      })
    },
    onApplyingChange: value => applyingStates.push(value)
  })

  controller.preview('ocean')
  const firstApply = controller.apply('ocean')
  controller.preview('jade')
  const blockedApply = await controller.apply('jade')
  finishWrite()
  const firstResult = await firstApply

  assert.deepEqual(writes, ['ocean'])
  assert.deepEqual(blockedApply, {
    ok: false,
    busy: true,
    previewThemeId: 'jade'
  })
  assert.equal(firstResult.ok, true)
  assert.equal(controller.getPreviewThemeId(), 'jade')
  assert.deepEqual(applyingStates, [true, false])
})

test('clear removes local preview and can avoid notifying during unmount', async () => {
  const { createThemePreviewController } = await import(previewModelUrl)
  const observed = []
  const controller = createThemePreviewController({
    setTheme: () => assert.fail('clear must not persist a theme'),
    onChange: id => observed.push(id)
  })

  controller.preview('graphite')
  assert.equal(controller.clear(), '')
  assert.equal(controller.getPreviewThemeId(), '')
  controller.preview('amber')
  assert.equal(controller.clear({ notify: false }), '')
  assert.equal(controller.getPreviewThemeId(), '')
  assert.deepEqual(observed, ['graphite', '', 'amber'])
})

test('normalizes missing and malformed theme configs with a locked background', async () => {
  const {
    normalizeThemePreview,
    shellPilotTerminalBackground
  } = await import(previewModelUrl)
  const cases = [
    undefined,
    null,
    [],
    'invalid',
    {},
    { uiThemeConfig: [], themeConfig: 'invalid' },
    { uiThemeConfig: { main: 'bad' }, themeConfig: { background: '#FFFFFF' } }
  ]

  for (const source of cases) {
    const normalized = normalizeThemePreview(source)
    assert.equal(normalized.themeConfig.background, shellPilotTerminalBackground)
    assert.equal(typeof normalized.themeConfig.foreground, 'string')
    assert.equal(typeof normalized.themeConfig.cursor, 'string')
    assert.equal(typeof normalized.themeConfig.selectionBackground, 'string')
    assert.equal(typeof normalized.tokens.page, 'string')
    assert.equal(typeof normalized.tokens.surface, 'string')
    assert.equal(typeof normalized.uiThemeConfig, 'object')
    assert.equal(Array.isArray(normalized.uiThemeConfig), false)
  }

  const customized = normalizeThemePreview({
    themeConfig: {
      background: '#FFFFFF',
      foreground: '#ABCDEF',
      cursor: '#123456',
      selectionBackground: 'rgba(1, 2, 3, .4)'
    }
  })
  assert.equal(customized.themeConfig.foreground, '#ABCDEF')
  assert.equal(customized.themeConfig.cursor, '#123456')
  assert.equal(customized.themeConfig.selectionBackground, 'rgba(1, 2, 3, .4)')
})

test('protected themes remain selectable for readonly details and safe actions', async () => {
  const {
    getThemeCapabilities,
    selectThemeForDetails
  } = await import(previewModelUrl)
  const safeActions = {
    view: true,
    select: true,
    preview: true,
    apply: true,
    copy: true,
    edit: false,
    write: false,
    delete: false
  }

  const protectedThemes = [
    { id: 'readonly', readonly: true },
    { id: 'default' },
    { id: 'iterm#source', type: 'iterm' }
  ]
  const selected = []
  for (const theme of protectedThemes) {
    assert.deepEqual(getThemeCapabilities(theme), safeActions)
    assert.equal(
      selectThemeForDetails(theme, item => selected.push(item.id)),
      true
    )
  }
  assert.deepEqual(selected, ['readonly', 'default', 'iterm#source'])
  assert.deepEqual(getThemeCapabilities({
    id: 'user-theme',
    type: 'custom'
  }), {
    view: true,
    select: true,
    preview: true,
    apply: true,
    copy: true,
    edit: true,
    write: true,
    delete: true
  })
})

test('safe deletion clears preview and selects a stable fallback', async () => {
  const {
    createThemePreviewController,
    deleteThemeSafely
  } = await import(previewModelUrl)
  let currentThemeId = 'default'
  const deleted = []
  const selected = []
  const themes = [
    { id: 'default' },
    { id: 'user-theme' }
  ]
  const controller = createThemePreviewController({
    getCurrentThemeId: () => currentThemeId,
    setTheme: id => { currentThemeId = id }
  })
  controller.preview('user-theme')

  const result = await deleteThemeSafely({
    item: themes[1],
    themes,
    currentThemeId,
    selectedThemeId: 'user-theme',
    previewController: controller,
    setTheme: id => { currentThemeId = id },
    deleteTheme: item => deleted.push(item.id),
    onSelect: item => selected.push(item.id)
  })

  assert.equal(result.ok, true)
  assert.equal(result.fallback.id, 'default')
  assert.equal(controller.getPreviewThemeId(), '')
  assert.deepEqual(deleted, ['user-theme'])
  assert.deepEqual(selected, ['default'])
})

test('safe deletion switches away from the current theme before deleting it', async () => {
  const { deleteThemeSafely } = await import(previewModelUrl)
  let currentThemeId = 'user-theme'
  const events = []
  const themes = [
    { id: 'shellpilot-ocean', readonly: true },
    { id: 'user-theme' }
  ]

  const result = await deleteThemeSafely({
    item: themes[1],
    themes,
    currentThemeId,
    selectedThemeId: 'user-theme',
    setTheme: async id => {
      events.push(`apply:${id}`)
      currentThemeId = id
    },
    deleteTheme: item => events.push(`delete:${item.id}`),
    onSelect: item => events.push(`select:${item.id}`)
  })

  assert.equal(result.ok, true)
  assert.equal(currentThemeId, 'shellpilot-ocean')
  assert.deepEqual(events, [
    'apply:shellpilot-ocean',
    'delete:user-theme',
    'select:shellpilot-ocean'
  ])
})

test('safe deletion does not delete the current theme when fallback switch fails', async () => {
  const { deleteThemeSafely } = await import(previewModelUrl)
  const deleted = []

  await assert.rejects(deleteThemeSafely({
    item: { id: 'user-theme' },
    themes: [{ id: 'default' }, { id: 'user-theme' }],
    currentThemeId: 'user-theme',
    selectedThemeId: 'user-theme',
    setTheme: () => { throw new Error('switch failed') },
    deleteTheme: item => deleted.push(item.id),
    onSelect: () => assert.fail('selection must wait for deletion')
  }), /switch failed/)
  assert.deepEqual(deleted, [])
})

test('shared display names localize ShellPilot themes and preserve third-party names', async () => {
  const { getThemeDisplayName } = await import(paletteModuleUrl)
  const shellPilotTheme = {
    type: 'shellpilot',
    name: 'Ocean Blue',
    nameKey: 'shellpilotThemeOcean'
  }
  assert.equal(getThemeDisplayName(shellPilotTheme, () => '海湾蓝'), '海湾蓝')
  assert.equal(getThemeDisplayName(shellPilotTheme, () => 'Ocean Blue'), 'Ocean Blue')
  assert.equal(getThemeDisplayName({
    type: 'iterm',
    name: 'Third-party Theme',
    nameKey: 'doNotTranslate'
  }, () => '不应出现'), 'Third-party Theme')
})

test('theme components consume the tested model without global preview writes', () => {
  const gallery = read('components/theme/theme-gallery.jsx')
  const preview = read('components/theme/theme-preview.jsx')
  const tab = read('components/setting-panel/tab-themes.jsx')
  const legacyItem = read('components/theme/theme-list-item.jsx')

  assert.match(gallery, /getThemeCapabilities/)
  assert.match(gallery, /selectThemeForDetails/)
  assert.match(gallery, /capabilities\.edit[\s\S]*themeViewDetails/)
  assert.match(gallery, /disabled=\{applying \|\| active \|\| !capabilities\.apply\}/)
  assert.match(
    gallery,
    /mode === 'dark' \? 'themeFilterDark' : 'themeFilterLight'/
  )
  assert.doesNotMatch(gallery, /<Tag>\{e\(mode\)\}<\/Tag>/)
  assert.match(preview, /normalizeThemePreview/)
  assert.doesNotMatch(preview, /<Button|from 'antd'/)
  assert.match(preview, /aria-hidden='true'/)
  assert.match(tab, /createThemePreviewController/)
  assert.match(tab, /applyThemeWithFeedback/)
  assert.match(tab, /message\.error/)
  assert.match(tab, /deleteThemeSafely/)
  assert.doesNotMatch(gallery + preview + legacyItem, /window\.originalTheme/)
  assert.doesNotMatch(gallery + preview + legacyItem, /store\.setTheme/)
  assert.equal((tab.match(/store\.setTheme\(/g) || []).length, 1)
  assert.match(tab, /controller\.clear\(\{ notify: false \}\)/)
})

test('theme tab separates dependency clears from the unmount-only silent clear', () => {
  const tab = read('components/setting-panel/tab-themes.jsx')

  assert.match(
    tab,
    /useEffect\(\(\) => \{\s*controller\.clear\(\)\s*\}, \[controller, settingTab, currentThemeId\]\)/
  )
  assert.match(
    tab,
    /useEffect\(\(\) => \{\s*return \(\) => controller\.clear\(\{ notify: false \}\)\s*\}, \[controller\]\)/
  )
})

test('theme gallery cards wrap text and preview styles remain scoped', () => {
  const style = read('components/theme/theme-gallery.styl')

  assert.match(style, /\.sp-theme-card-grid[\s\S]*grid-template-columns repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(style, /\.sp-theme-card-title[\s\S]*white-space normal/)
  assert.match(style, /\.sp-theme-card-actions[\s\S]*flex-wrap wrap/)
  assert.match(style, /\.sp-theme-gallery[\s\S]*overflow-x hidden/)
  assert.match(style, /@media \(max-width: 680px\)[\s\S]*grid-template-columns minmax\(0, 1fr\)/)
  assert.match(style, /\.sp-theme-preview-action[\s\S]*background var\(--sp-primary\)/)
  assert.doesNotMatch(style, /\.sp-theme-preview-card[\s\S]*\.ant-btn-primary/)
  assert.doesNotMatch(style, /text-overflow ellipsis|white-space nowrap/)
})
