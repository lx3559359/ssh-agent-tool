const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const contextActionsUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-chat-context-actions.js')
).href
const sshContextUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-ssh-context.js')
).href

test('selected remote file uses bounded preview without a full read', async () => {
  const {
    AI_FILE_PREVIEW_MAX_BYTES,
    readSelectedSftpFileContext
  } = await import(contextActionsUrl)
  let fullReadCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'large.log',
        path: '/var/log',
        type: 'remote',
        size: 100000
      }],
      sftp: {
        readFilePreview: async (filePath, maxBytes) => {
          assert.equal(filePath, '/var/log/large.log')
          assert.equal(maxBytes, AI_FILE_PREVIEW_MAX_BYTES)
          return {
            content: 'remote preview',
            truncated: true,
            binary: false,
            bytesRead: maxBytes
          }
        },
        readFile: async () => {
          fullReadCalled = true
        }
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.content, 'remote preview')
  assert.equal(result.truncated, true)
  assert.equal(result.bytesRead, AI_FILE_PREVIEW_MAX_BYTES)
  assert.equal(fullReadCalled, false)
})

test('selected local file uses bounded preview without a full read', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  let fullReadCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'app.conf',
        path: 'C:/tmp',
        type: 'local',
        size: 20
      }]
    },
    fsApi: {
      readFilePreview: async filePath => ({
        content: `local preview:${filePath}`,
        truncated: false,
        binary: false,
        bytesRead: 20
      }),
      readFile: async () => {
        fullReadCalled = true
      }
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.content, 'local preview:C:/tmp/app.conf')
  assert.equal(result.bytesRead, 20)
  assert.equal(fullReadCalled, false)
})

test('binary preview is blocked without exposing its content', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'archive.bin',
        path: '/tmp',
        type: 'remote',
        size: 50
      }],
      sftp: {
        readFilePreview: async () => ({
          content: 'must-not-leak',
          truncated: false,
          binary: true,
          bytesRead: 50
        })
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /二进制/)
  assert.equal(Object.hasOwn(result, 'content'), false)
})

test('multiple selected files are rejected before any read', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  let readCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [
        { name: 'a.log', path: '/tmp', type: 'remote', size: 1 },
        { name: 'b.log', path: '/tmp', type: 'remote', size: 1 }
      ],
      sftp: {
        readFilePreview: async () => {
          readCalled = true
        }
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /只允许.*单.*文件/)
  assert.equal(readCalled, false)
})

test('preview read failures return a Chinese result instead of throwing', async () => {
  const { readSelectedSftpFileContext } = await import(contextActionsUrl)
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'error.log',
        path: '/tmp',
        type: 'remote',
        size: 10
      }],
      sftp: {
        readFilePreview: async () => {
          throw new Error('connection lost')
        }
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /^读取文件失败/)
  assert.match(result.message, /connection lost/)
})

test('old backends cannot perform a full read above the preview limit', async () => {
  const {
    AI_FILE_PREVIEW_MAX_BYTES,
    readSelectedSftpFileContext
  } = await import(contextActionsUrl)
  let fullReadCalled = false
  const result = await readSelectedSftpFileContext({
    sftpRef: {
      getSelectedFiles: () => [{
        name: 'huge.log',
        path: '/tmp',
        type: 'remote',
        size: AI_FILE_PREVIEW_MAX_BYTES + 1
      }],
      sftp: {
        readFile: async () => {
          fullReadCalled = true
        }
      }
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /安全预览/)
  assert.equal(fullReadCalled, false)
})

test('file analysis prompt states byte-level safe truncation', async () => {
  const { buildSftpFileTerminalAnalysisPrompt } = await import(sshContextUrl)
  const prompt = buildSftpFileTerminalAnalysisPrompt({
    path: '/tmp/large.log',
    content: 'preview content',
    filePreviewTruncated: true,
    previewBytesRead: 65536
  })

  assert.match(prompt, /仅安全读取前 65536 字节/)
  assert.match(prompt, /文件仍有后续内容/)
  assert.match(prompt, /不要自动执行命令/)
})

test('SFTP context menu exposes AI analysis outside the edit-size guard', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/client/components/sftp/file-item.jsx'),
    'utf8'
  )
  const methodSource = source.slice(
    source.indexOf('askAiAboutFile = async'),
    source.indexOf('transferOrEnterDirectory = async')
  )
  const aiMenuIndex = source.indexOf("func: 'askAiAboutFile'")
  const showEditIndex = source.indexOf('if (showEdit)')

  assert.ok(aiMenuIndex > -1 && aiMenuIndex < showEditIndex)
  assert.match(methodSource, /readSftpFileContext/)
  assert.match(methodSource, /message\.warning\(result\.message\)/)
  assert.doesNotMatch(methodSource, /fetchEditorText\(filePath,\s*type\)/)
})
