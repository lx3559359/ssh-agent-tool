const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/ai-chat-context-actions.js')
).href

test('AI chat context actions read current terminal selection and output', async () => {
  const {
    getActiveTerminalRef,
    getTerminalSelectionText,
    getTerminalOutputText
  } = await import(moduleUrl)

  const termRef = {
    term: {
      getSelection: () => 'nginx bind failed',
      buffer: {
        active: {
          cursorY: 2,
          baseY: 0,
          length: 3,
          getLine: (index) => ({
            translateToString: () => ['uptime', 'df -h', '/dev/sda1 90%'][index]
          })
        }
      }
    }
  }
  const refs = {
    get: (key) => key === 'term-tab-1' ? termRef : null
  }

  assert.equal(getActiveTerminalRef({
    store: { activeTabId: 'tab-1' },
    refs
  }), termRef)
  assert.equal(getTerminalSelectionText(termRef), 'nginx bind failed')
  assert.equal(getTerminalOutputText(termRef), 'uptime\ndf -h\n/dev/sda1 90%')
})

test('AI chat context actions prefer terminal component buffer helper when available', async () => {
  const {
    getTerminalOutputText
  } = await import(moduleUrl)

  assert.equal(
    getTerminalOutputText({
      getTerminalBufferText: () => 'helper output'
    }),
    'helper output'
  )
})

test('AI chat context actions build user-facing Chinese unavailable messages', async () => {
  const {
    getAIContextUnavailableMessage
  } = await import(moduleUrl)

  assert.equal(
    getAIContextUnavailableMessage('selection'),
    '当前终端没有选中文本，请先在终端中选中内容。'
  )
  assert.equal(
    getAIContextUnavailableMessage('file'),
    '请在 SFTP 文件上右键选择“AI 引用文件”。'
  )
})

test('AI chat panel wires terminal context and unfinished capability buttons with Chinese labels', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )

  assert.match(source, /handleQuoteTerminalOutput/)
  assert.match(source, /handleQuoteTerminalSelection/)
  assert.match(source, /引用终端/)
  assert.match(source, /引用选中/)
  assert.match(source, /引用文件/)
  assert.match(source, /联网搜索/)
  assert.match(source, /MCP/)
  assert.match(source, /CLI/)
})
