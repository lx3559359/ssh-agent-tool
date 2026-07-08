const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-diagnostic-report.js')
).href

test('Agent diagnostic report builds Markdown HTML and JSON exports with redaction', async () => {
  const {
    buildAgentDiagnosticReportFiles
  } = await import(moduleUrl)

  const files = buildAgentDiagnosticReportFiles({
    item: {
      prompt: '请分析当前终端输出\n\n```text\nroot@prod# df -h\n/dev/sda1 91%\npassword=root-secret\n```',
      response: '磁盘使用率较高，建议清理日志。\n\n```bash\ndu -sh /var/log/*\n```',
      modelAI: 'deepseek-chat',
      nameAI: 'DeepSeek',
      apiKeyAI: 'sk-live-secret',
      timestamp: Date.UTC(2026, 6, 8, 0, 0, 0),
      toolCalls: [
        {
          name: 'send_terminal_command',
          args: { command: 'df -h' },
          result: '{"output":"/dev/sda1 91%"}'
        }
      ]
    },
    now: '2026-07-08T00:00:00.000Z'
  })

  assert.equal(files.markdown.filename, 'AIGShell-agent-report-20260708-000000.md')
  assert.equal(files.html.filename, 'AIGShell-agent-report-20260708-000000.html')
  assert.equal(files.json.filename, 'AIGShell-agent-report-20260708-000000.json')

  assert.match(files.markdown.content, /# AIGShell Agent 诊断报告/)
  assert.match(files.markdown.content, /## 终端输出摘要/)
  assert.match(files.markdown.content, /\/dev\/sda1 91%/)
  assert.match(files.markdown.content, /## AI 分析/)
  assert.match(files.markdown.content, /磁盘使用率较高/)
  assert.match(files.markdown.content, /## 建议操作/)
  assert.match(files.markdown.content, /du -sh \/var\/log\/\*/)
  assert.match(files.html.content, /<h1>AIGShell Agent 诊断报告<\/h1>/)

  const data = JSON.parse(files.json.content)
  assert.equal(data.app, 'AIGShell')
  assert.equal(data.model, 'deepseek-chat')
  assert.equal(data.terminalSummary.includes('/dev/sda1 91%'), true)
  assert.equal(data.aiAnalysis.includes('磁盘使用率较高'), true)
  assert.deepEqual(data.suggestedActions, ['du -sh /var/log/*', 'df -h'])

  const all = files.markdown.content + files.html.content + files.json.content
  assert.equal(all.includes('root-secret'), false)
  assert.equal(all.includes('sk-live-secret'), false)
})

test('AI chat history item exposes report export formats to users', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
    'utf8'
  )

  assert.match(source, /buildAgentDiagnosticReportFiles/)
  assert.match(source, /download\(file\.filename,\s*file\.content\)/)
  assert.match(source, /Markdown/)
  assert.match(source, /HTML/)
  assert.match(source, /JSON/)
})
