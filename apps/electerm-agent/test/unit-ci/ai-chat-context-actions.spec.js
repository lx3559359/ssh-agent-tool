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

test('AI chat context actions read the current selected remote SFTP file', async () => {
  const {
    getActiveSftpRef,
    readSelectedSftpFileContext
  } = await import(moduleUrl)

  const sftpRef = {
    getSelectedFiles: () => [{
      name: 'error.log',
      path: '/var/log/nginx',
      type: 'remote',
      size: 100,
      isDirectory: false
    }],
    sftp: {
      readFilePreview: async (filePath) => ({
        content: `remote:${filePath}`,
        truncated: false,
        binary: false,
        bytesRead: Buffer.byteLength(`remote:${filePath}`)
      })
    }
  }
  const refs = {
    get: (key) => key === 'sftp-tab-1' ? sftpRef : null
  }

  assert.equal(getActiveSftpRef({
    store: { activeTabId: 'tab-1' },
    refs
  }), sftpRef)

  const result = await readSelectedSftpFileContext({
    sftpRef,
    fsApi: {
      readFile: async () => {
        throw new Error('should not read local fs for remote file')
      }
    }
  })

  assert.deepEqual(result, {
    ok: true,
    path: '/var/log/nginx/error.log',
    source: '远程 SFTP',
    size: 100,
    content: 'remote:/var/log/nginx/error.log',
    truncated: false,
    binary: false,
    bytesRead: Buffer.byteLength('remote:/var/log/nginx/error.log')
  })
})

test('AI chat context actions read selected compressed SFTP text members', async () => {
  const {
    readSelectedSftpFileContext
  } = await import(moduleUrl)

  let previewCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'logs.zip',
        path: '/var/log',
        type: 'remote',
        size: 2048,
        isDirectory: false
      }],
      sftp: {
        listArchive: async (filePath) => {
          assert.equal(filePath, '/var/log/logs.zip')
          return {
            type: 'zip',
            entries: [{
              path: 'error.log',
              size: 20
            }]
          }
        },
        readArchiveTextEntry: async (filePath, entryPath, options) => {
          assert.equal(filePath, '/var/log/logs.zip')
          assert.equal(entryPath, 'error.log')
          assert.equal(options.maxBytes > 0, true)
          return {
            content: 'zip member content',
            truncated: false,
            binary: false,
            bytesRead: Buffer.byteLength('zip member content'),
            archiveType: 'zip',
            entryPath
          }
        },
        readFilePreview: async () => {
          previewCalled = true
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.content, 'zip member content')
  assert.equal(result.archiveType, 'zip')
  assert.equal(result.archiveEntryPath, 'error.log')
  assert.match(result.path, /logs\.zip/)
  assert.match(result.path, /error\.log/)
  assert.equal(previewCalled, false)
})

test('AI chat context actions read the current selected local SFTP file', async () => {
  const {
    readSelectedSftpFileContext
  } = await import(moduleUrl)

  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'app.conf',
        path: 'C:/tmp',
        type: 'local',
        size: 100,
        isDirectory: false
      }]
    },
    fsApi: {
      readFilePreview: async (filePath) => ({
        content: `local:${filePath}`,
        truncated: false,
        binary: false,
        bytesRead: Buffer.byteLength(`local:${filePath}`)
      })
    }
  })

  assert.deepEqual(result, {
    ok: true,
    path: 'C:/tmp/app.conf',
    source: '本地文件',
    size: 100,
    content: 'local:C:/tmp/app.conf',
    truncated: false,
    binary: false,
    bytesRead: Buffer.byteLength('local:C:/tmp/app.conf')
  })
})

test('AI chat context actions return Chinese messages when selected SFTP file is unavailable', async () => {
  const {
    readSelectedSftpFileContext
  } = await import(moduleUrl)

  assert.deepEqual(
    await readSelectedSftpFileContext({
      sftpRef: {
        getSelectedFiles: () => []
      }
    }),
    {
      ok: false,
      message: '当前 SFTP 没有选中文件，请先选择一个文件。'
    }
  )

  assert.deepEqual(
    await readSelectedSftpFileContext({
      sftpRef: {
        getSelectedFiles: () => [{
          name: 'logs',
          path: '/var',
          type: 'remote',
          isDirectory: true
        }]
      }
    }),
    {
      ok: false,
      message: '当前选择的是目录，请选择一个文件后再引用。'
    }
  )
})

test('AI chat context actions detect prompts that refer to the selected SFTP file', async () => {
  const {
    shouldAutoAttachSelectedSftpFileContext
  } = await import(moduleUrl)

  assert.equal(shouldAutoAttachSelectedSftpFileContext('查看这个文件'), true)
  assert.equal(shouldAutoAttachSelectedSftpFileContext('帮我分析当前配置'), true)
  assert.equal(shouldAutoAttachSelectedSftpFileContext('explain current file'), true)
  assert.equal(shouldAutoAttachSelectedSftpFileContext('帮我看下磁盘使用情况'), false)
  assert.equal(shouldAutoAttachSelectedSftpFileContext('请分析下面的 SFTP 文件内容\n\n远程路径：/root/a.log'), false)
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
    '请在 SFTP 文件上右键选择“让 AI 分析此文件”。'
  )
})

test('AI chat panel wires completed context actions with clear Chinese labels', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )

  assert.match(source, /Segmented/)
  assert.doesNotMatch(source, /const mode = 'ask'/)
  assert.match(source, /label:\s*e\('shellpilotAiModeChat'\)/)
  assert.match(source, /label:\s*e\('shellpilotAiModeAgent'\)/)
  assert.match(source, /handleQuoteTerminalOutput/)
  assert.match(source, /handleQuoteTerminalSelection/)
  assert.match(source, /handleGenerateCommand/)
  assert.match(source, /shellpilotAiQuoteTerminal/)
  assert.match(source, /shellpilotAiQuoteSelection/)
  assert.match(source, /shellpilotAiQuoteFile/)
  assert.match(source, /shellpilotAiGenerateCommand/)
  assert.match(source, /shellpilotAiQuoteMcpConfiguration/)
  assert.match(source, /shellpilotAiQuoteCliCapabilities/)
  assert.doesNotMatch(source, /联网搜索/)
  assert.doesNotMatch(source, /showUnavailableContextAction\('web'\)/)
})

test('AI chat context actions explain missing MCP configuration instead of saying it is unfinished', async () => {
  const {
    getAIContextUnavailableMessage
  } = await import(moduleUrl)

  const message = getAIContextUnavailableMessage('mcp')
  assert.match(message, /MCP Server/)
  assert.match(message, /配置|添加|启用/)
  assert.doesNotMatch(message, /开发中/)
})

test('AI chat context actions explain CLI capability without stale unfinished wording', async () => {
  const {
    getAIContextUnavailableMessage
  } = await import(moduleUrl)

  const message = getAIContextUnavailableMessage('cli')
  assert.match(message, /CLI/)
  assert.match(message, /命令|能力|确认/)
  assert.doesNotMatch(message, /开发中/)
})
