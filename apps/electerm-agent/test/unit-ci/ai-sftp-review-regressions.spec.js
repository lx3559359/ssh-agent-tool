const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const contextActionsUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-chat-context-actions.js')
).href
const { isLikelyBinaryBuffer } = require('../../src/app/common/file-preview')

test('invalid UTF-8 bytes are classified as binary', () => {
  assert.equal(
    isLikelyBinaryBuffer(Buffer.from([0xff, 0xff, 0xff, 0xff])),
    true
  )
})

test('old backend text reads cannot pass NUL or replacement characters to AI', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  for (const content of ['\0abc', '\ufffd\ufffd\ufffd\ufffd']) {
    const result = await readSelectedSftpFileContext({
      sftpRef: {
        getSelectedFiles: () => [{
          name: 'binary.dat',
          path: '/tmp',
          type: 'remote',
          size: 4
        }],
        sftp: {
          readFile: async () => content
        }
      }
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /二进制/)
    assert.equal(Object.hasOwn(result, 'content'), false)
  }
})

test('negative file sizes cannot bypass old-backend bounded reads', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  let readCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'unknown.log',
        path: '/tmp',
        type: 'remote',
        size: -1
      }],
      sftp: {
        readFile: async () => {
          readCalled = true
        }
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /大小未知|安全读取上限/)
  assert.equal(readCalled, false)
})

test('selected-file analysis helper carries terminal and byte truncation context', async () => {
  const { buildSelectedSftpFileAnalysisPrompt } = await import(contextActionsUrl)
  const result = await buildSelectedSftpFileAnalysisPrompt({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'large.log',
        path: '/var/log',
        type: 'remote',
        size: 99999
      }],
      sftp: {
        readFilePreview: async () => ({
          content: 'preview line',
          truncated: true,
          binary: false,
          bytesRead: 4096
        })
      }
    },
    termRef: {
      getTerminalBufferText: () => 'systemctl status nginx failed'
    }
  })

  assert.equal(result.ok, true)
  assert.match(result.prompt, /preview line/)
  assert.match(result.prompt, /systemctl status nginx failed/)
  assert.match(result.prompt, /仅安全读取前 4096 字节/)
})

test('AI chat selected-file flows use the complete analysis prompt helper', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/ai/ai-chat.jsx'),
    'utf8'
  )
  const submitSource = source.slice(
    source.indexOf('const handleSubmit'),
    source.indexOf('function handleQuoteTerminalOutput')
  )
  const quoteSource = source.slice(
    source.indexOf('async function handleQuoteSftpFile'),
    source.indexOf('function handleQuoteMcpServers')
  )

  assert.match(source, /buildSelectedSftpFileAnalysisPrompt/)
  assert.match(submitSource, /buildSelectedSftpFileAnalysisPrompt/)
  assert.match(submitSource, /termRef:\s*getActiveTerminalRef/)
  assert.match(quoteSource, /buildSelectedSftpFileAnalysisPrompt/)
  assert.match(quoteSource, /termRef:\s*getActiveTerminalRef/)
  assert.doesNotMatch(quoteSource, /buildSftpFileContextPrompt/)
})
