const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Terminal } = require('@xterm/headless')

function writeTerminal (terminal, data) {
  return new Promise(resolve => terminal.write(data, resolve))
}

describe('terminal OSC color query helpers', () => {
  test('builds OSC background responses from the locked terminal color', async () => {
    const { buildOscColorResponse } = await import('../../src/client/components/terminal/terminal-color-query.mjs')

    assert.strictEqual(
      buildOscColorResponse(11, '#0E0F12'),
      '\x1b]11;rgb:0e/0f/12\x1b\\'
    )
  })

  test('falls back when a transparent theme color cannot describe the visible background', async () => {
    const { buildOscColorResponse } = await import('../../src/client/components/terminal/terminal-color-query.mjs')

    assert.strictEqual(
      buildOscColorResponse(11, 'rgba(0, 0, 0, 0)', '#121214'),
      '\x1b]11;rgb:12/12/14\x1b\\'
    )
  })

  test('locks OSC 11 query and set requests without intercepting configurable OSC 10 colors', async () => {
    const {
      handleTerminalBackgroundColorRequest,
      handleTerminalColorQuery
    } = await import('../../src/client/components/terminal/terminal-color-query.mjs')
    const sent = []
    const terminal = {
      input: (data, wasUserInput) => sent.push({ data, wasUserInput })
    }

    assert.equal(handleTerminalBackgroundColorRequest(terminal, '?'), true)
    assert.deepEqual(sent, [
      {
        data: '\x1b]11;rgb:0e/0f/12\x1b\\',
        wasUserInput: false
      }
    ])

    for (const setPayload of ['#ffffff', 'rgb:ffff/ffff/ffff']) {
      assert.equal(handleTerminalBackgroundColorRequest(terminal, setPayload), true)
    }
    assert.equal(sent.length, 1)

    assert.equal(handleTerminalBackgroundColorRequest(terminal, '?;#ffffff'), true)
    assert.deepEqual(sent[1], {
      data: '\x1b]11;rgb:0e/0f/12\x1b\\',
      wasUserInput: false
    })

    assert.equal(handleTerminalColorQuery(terminal, 10, '#222222', null, '#ffffff'), false)
    assert.equal(handleTerminalColorQuery(terminal, 10, '#222222', null, '?'), true)
    assert.deepEqual(sent[2], {
      data: '\x1b]10;rgb:22/22/22\x1b\\',
      wasUserInput: false
    })
  })

  test('filters stacked OSC 10 background slots at the xterm parser boundary', async () => {
    const helpers = await import('../../src/client/components/terminal/terminal-color-query.mjs')
    const terminal = new Terminal({ allowProposedApi: true })
    const colorEvents = []
    const replies = []
    const themeConfig = {
      foreground: '#E6EDF7',
      cursor: '#AAB6C8'
    }
    const handleOsc10 = data => helpers.handleTerminalForegroundColorRequest(
      terminal,
      data,
      themeConfig,
      '#E6EDF7'
    )

    const colorDisposable = terminal._core._inputHandler.onColor(events => {
      colorEvents.push(...events)
    })
    const dataDisposable = terminal.onData(data => replies.push(data))
    const osc10Disposable = terminal.parser.registerOscHandler(10, handleOsc10)
    const osc11Disposable = terminal.parser.registerOscHandler(11, data => {
      return helpers.handleTerminalBackgroundColorRequest(terminal, data)
    })

    try {
      await writeTerminal(terminal, '\x1b]10;#123456\x1b\\')
      assert.deepEqual(colorEvents, [
        { type: 1, index: 256, color: [18, 52, 86] }
      ])

      colorEvents.length = 0
      await writeTerminal(terminal, '\x1b]10;?\x1b\\')
      assert.deepEqual(colorEvents, [])
      assert.deepEqual(replies, ['\x1b]10;rgb:e6/ed/f7\x1b\\'])

      colorEvents.length = 0
      await writeTerminal(terminal, '\x1b]10;#111111;#ffffff\x1b\\')
      assert.equal(
        colorEvents.some(event => event.index === 257),
        false,
        'stacked OSC 10 must not expose a background SET event'
      )

      colorEvents.length = 0
      replies.length = 0
      await writeTerminal(terminal, '\x1b]10;?;?;?\x1b\\')
      assert.equal(colorEvents.some(event => event.index === 257), false)
      assert.deepEqual(replies, [
        '\x1b]10;rgb:e6/ed/f7\x1b\\',
        '\x1b]11;rgb:0e/0f/12\x1b\\',
        '\x1b]12;rgb:aa/b6/c8\x1b\\'
      ])

      replies.length = 0
      await writeTerminal(terminal, '\x1b]11;?\x1b\\')
      await writeTerminal(terminal, '\x1b]11;#ffffff\x1b\\')
      assert.deepEqual(replies, ['\x1b]11;rgb:0e/0f/12\x1b\\'])
      assert.equal(colorEvents.some(event => event.index === 257), false)
    } finally {
      colorDisposable.dispose()
      dataDisposable.dispose()
      osc10Disposable.dispose()
      osc11Disposable.dispose()
      terminal.dispose()
    }
  })

  test('locks the xterm renderer background for DOM and WebGL under a light UI', async () => {
    const { createRendererThemeConfig } = await import('../../src/client/components/terminal/terminal-color-query.mjs')
    const themeConfig = {
      foreground: '#bbbbbb',
      background: '#0E0F12'
    }

    for (const rendererType of ['dom', 'webGL']) {
      assert.deepEqual(
        createRendererThemeConfig(themeConfig, rendererType, '#ededed'),
        {
          foreground: '#bbbbbb',
          background: '#0E0F12'
        }
      )
    }
  })

  test('terminal component never derives its visible background from the UI theme', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/terminal/terminal.jsx'),
      'utf8'
    )

    assert.doesNotMatch(source, /uiThemeConfig\.main/)
    assert.doesNotMatch(source, /getPropertyValue\('--main'\)/)
    assert.match(source, /registerOscHandler\(10,[\s\S]+?handleTerminalForegroundColorRequest/)
    assert.doesNotMatch(
      source,
      /registerOscHandler\(10,[\s\S]+?handleTerminalColorQuery\(term, 10/
    )
    assert.match(source, /registerOscHandler\(11,[\s\S]+?handleTerminalBackgroundColorRequest/)
    assert.doesNotMatch(
      source,
      /registerOscHandler\(11,[\s\S]+?handleTerminalColorQuery\(term, 11/
    )
  })

  test('terminal canvas and blank-area containers use the locked background', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/terminal/terminal.styl'),
      'utf8'
    )

    assert.match(source, /shellPilotTerminalBackground = #0E0F12/)
    assert.match(source, /\.terms-box\r?\n {2}background shellPilotTerminalBackground/)
    assert.match(source, /\.terminal-control\r?\n {2}background shellPilotTerminalBackground/)
    assert.match(source, /\.term-wrap\r?\n {2}background shellPilotTerminalBackground/)
    assert.match(
      source,
      /\.xterm\r?\n {4}background shellPilotTerminalBackground/
    )
    assert.match(
      source,
      /\.xterm-viewport\r?\n {4}background-color shellPilotTerminalBackground !important/
    )
  })

  test('terminal session tab container and active or inactive tabs reuse the locked background in layout scope', () => {
    const terminalSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/terminal/terminal.styl'),
      'utf8'
    )
    const tabsSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/tabs/tabs.styl'),
      'utf8'
    )
    const tabsComponentSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/tabs/index.jsx'),
      'utf8'
    )
    const layoutSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/layout/layout.jsx'),
      'utf8'
    )

    assert.match(
      terminalSource,
      /:root\r?\n {2}--shellpilot-terminal-background shellPilotTerminalBackground/
    )
    assert.match(
      tabsSource,
      /\.tabs\.terminal-session-tabs\r?\n {2}background var\(--shellpilot-terminal-background\)\r?\n {2}\.tab\r?\n {4}background var\(--shellpilot-terminal-background\)/
    )
    assert.match(layoutSource, /className='terminal-session-tabs'/)
    assert.match(tabsComponentSource, /className=\{classNames\('tabs', this\.props\.className\)\}/)
    assert.match(tabsSource, /&\.active\r?\n {4}color var\(--text\)\r?\n {4}background var\(--main\)/)
    assert.doesNotMatch(tabsSource, /\.ant-tabs[^\n]*--shellpilot-terminal-background/)
  })

  test('terminal controls use fixed high-contrast foreground tokens', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/client/components/terminal/terminal.styl'),
      'utf8'
    )
    const control = source.match(
      /\.terminal-control\r?\n[\s\S]+?(?=\r?\n\.terms-box)/
    )?.[0] || ''

    assert.match(source, /shellPilotTerminalForeground = #E6EDF7/)
    assert.match(source, /shellPilotTerminalMutedForeground = #AAB6C8/)
    assert.match(source, /shellPilotTerminalActiveForeground = #FFFFFF/)
    assert.match(control, /color shellPilotTerminalForeground/)
    assert.match(control, /\.type-tab,[\s\S]+?\.spliter,[\s\S]+?\.sess-icon/)
    assert.match(control, /color shellPilotTerminalMutedForeground/)
    assert.match(control, /\.type-tab:hover,[\s\S]+?\.type-tab\.active/)
    assert.match(control, /\.spliter:hover,[\s\S]+?\.spliter:focus-visible/)
    assert.match(control, /\.sess-icon:hover,[\s\S]+?\.sess-icon\.active/)
    assert.match(control, /color shellPilotTerminalActiveForeground/)
    assert.doesNotMatch(control, /var\(--text(?:-light)?\)/)
  })
})
