const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/ai-ssh-context.js')
).href

test('AI SSH context builds Chinese prompts for selected terminal text', async () => {
  const {
    buildTerminalContextPrompt
  } = await import(moduleUrl)

  const prompt = buildTerminalContextPrompt({
    source: 'selection',
    text: 'nginx: [emerg] bind() to 0.0.0.0:80 failed'
  })

  assert.match(prompt, /请解释下面选中的终端内容/)
  assert.match(prompt, /bind\(\)/)
  assert.match(prompt, /请给出结论、证据和下一步建议/)
})

test('AI SSH context builds Chinese prompts for current terminal output', async () => {
  const {
    buildTerminalContextPrompt
  } = await import(moduleUrl)

  const prompt = buildTerminalContextPrompt({
    source: 'terminal',
    text: 'df -h\n/dev/sda1 90%'
  })

  assert.match(prompt, /请分析当前 SSH 终端输出/)
  assert.match(prompt, /\/dev\/sda1 90%/)
})

test('AI SSH context builds SFTP file prompts with bounded content', async () => {
  const {
    buildSftpFileContextPrompt
  } = await import(moduleUrl)

  const prompt = buildSftpFileContextPrompt({
    path: '/var/log/nginx/error.log',
    content: 'x'.repeat(9000),
    maxChars: 120
  })

  assert.match(prompt, /请分析下面的 SFTP 文件内容/)
  assert.match(prompt, /远程路径：\/var\/log\/nginx\/error\.log/)
  assert.equal(prompt.includes('x'.repeat(500)), false)
  assert.match(prompt, /内容已截断/)
})

test('AI SSH context builds command generation prompts without executing commands', async () => {
  const {
    buildCommandSuggestionPrompt
  } = await import(moduleUrl)

  const prompt = buildCommandSuggestionPrompt({
    source: 'terminal',
    text: 'nginx: [emerg] bind() to 0.0.0.0:80 failed',
    maxChars: 120
  })

  assert.match(prompt, /请根据当前 SSH 终端输出生成排查命令/)
  assert.match(prompt, /bind\(\)/)
  assert.match(prompt, /只生成必要命令/)
  assert.match(prompt, /不要直接执行命令/)
  assert.match(prompt, /执行前必须由用户确认/)
})

test('AI SSH context filters command blocks before running', async () => {
  const {
    prepareAICommandForTerminal
  } = await import(moduleUrl)

  assert.equal(
    prepareAICommandForTerminal('\n# check nginx\nsystemctl status nginx\n\n# tail logs\ntail -n 50 /var/log/nginx/error.log\n'),
    'systemctl status nginx\ntail -n 50 /var/log/nginx/error.log'
  )
})

test('AI SSH context requires confirmation before running generated commands', async () => {
  const {
    confirmAndRunAICommand
  } = await import(moduleUrl)

  const commands = []
  const store = {
    activeTabId: 'tab-1',
    runSafetyCommand: async (command, options) => {
      commands.push({ command, options })
      return { sent: true }
    },
    mcpWaitForTerminalIdle: async () => ({ output: 'active' })
  }

  const denied = await confirmAndRunAICommand({
    code: 'rm -rf /tmp/demo',
    store,
    confirm: () => false
  })
  assert.equal(denied, false)
  assert.deepEqual(commands, [])

  const accepted = await confirmAndRunAICommand({
    code: '# readonly\nsystemctl status nginx',
    store,
    confirm: message => {
      assert.match(message, /确认发送以下命令到当前终端/)
      assert.match(message, /systemctl status nginx/)
      return true
    }
  })
  assert.equal(accepted, true)
  assert.deepEqual(commands, [{
    command: 'systemctl status nginx',
    options: {
      tabId: 'tab-1',
      source: 'agent',
      title: 'AI 代码块'
    }
  }])
})
