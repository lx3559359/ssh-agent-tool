const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '../..')
const sshContextModuleUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-ssh-context.js')
).href
const contextActionsModuleUrl = pathToFileURL(
  path.join(root, 'src/client/components/ai/ai-chat-context-actions.js')
).href

test('builds SFTP file analysis prompt with terminal context', async () => {
  const {
    buildSftpFileTerminalAnalysisPrompt
  } = await import(sshContextModuleUrl)

  const prompt = buildSftpFileTerminalAnalysisPrompt({
    source: '远程 SFTP',
    path: '/var/log/nginx/error.log',
    size: '2 KB',
    content: 'nginx error line',
    terminalOutput: 'systemctl status nginx'
  })

  assert.match(prompt, /远程 SFTP/)
  assert.match(prompt, /\/var\/log\/nginx\/error\.log/)
  assert.match(prompt, /nginx error line/)
  assert.match(prompt, /systemctl status nginx/)
  assert.match(prompt, /只生成命令/)
  assert.doesNotMatch(prompt, /secret-password|API Key|privateKey/)
})

test('truncates large SFTP file content before sending to AI', async () => {
  const {
    buildSftpFileTerminalAnalysisPrompt
  } = await import(sshContextModuleUrl)

  const prompt = buildSftpFileTerminalAnalysisPrompt({
    path: '/tmp/large.log',
    content: 'x'.repeat(50),
    contentLimit: 10
  })

  assert.match(prompt, /已截断/)
  assert.match(prompt, /原始长度 50 字符/)
  assert.doesNotMatch(prompt, /x{20}/)
})

test('builds selected SFTP file analysis prompt from file and terminal refs', async () => {
  const {
    buildSelectedSftpFileAnalysisPrompt
  } = await import(contextActionsModuleUrl)

  const sftpRef = {
    sftp: {
      readFilePreview: async filePath => ({
        content: `content from ${filePath}`,
        truncated: false,
        binary: false,
        bytesRead: Buffer.byteLength(`content from ${filePath}`)
      })
    },
    getSelectedFiles: () => [
      {
        type: 'remote',
        path: '/etc/nginx',
        name: 'nginx.conf',
        size: 1024
      }
    ]
  }
  const termRef = {
    getTerminalBufferText: () => 'nginx -t failed'
  }

  const result = await buildSelectedSftpFileAnalysisPrompt({
    sftpRef,
    termRef
  })

  assert.equal(result.ok, true)
  assert.match(result.prompt, /\/etc\/nginx\/nginx\.conf/)
  assert.match(result.prompt, /content from \/etc\/nginx\/nginx\.conf/)
  assert.match(result.prompt, /nginx -t failed/)
})

test('selected SFTP file analysis rejects directory selection', async () => {
  const {
    buildSelectedSftpFileAnalysisPrompt
  } = await import(contextActionsModuleUrl)

  const result = await buildSelectedSftpFileAnalysisPrompt({
    sftpRef: {
      getSelectedFiles: () => [
        {
          type: 'remote',
          path: '/var',
          name: 'log',
          isDirectory: true
        }
      ]
    }
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /目录/)
})

test('SFTP file context menu exposes AI analysis wording', async () => {
  const { buildSftpFileContextItems } = await import(pathToFileURL(
    path.join(root, 'src/client/components/sftp/sftp-file-context-menu.js')
  ).href)
  const items = buildSftpFileContextItems({
    file: { id: 'file-1', type: 'remote', size: 1 },
    selectedFiles: new Set(['file-1']),
    tab: { host: 'server.example' },
    translate: key => key === 'shellpilotSftpAnalyzeFileWithAi'
      ? '让 AI 分析此文件'
      : key
  })

  assert.equal(items.find(item => item.func === 'askAiAboutFile').text, '让 AI 分析此文件')
})
