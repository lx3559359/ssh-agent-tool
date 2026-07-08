const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const confirmModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../src/client/components/ai/agent-tool-confirm.js')
).href

test('Agent command confirmation blocks terminal execution when the user cancels', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const result = await confirmAgentToolExecution({
    toolName: 'send_terminal_command',
    args: {
      command: 'systemctl status nginx'
    },
    confirm: message => {
      assert.match(message, /systemctl status nginx/)
      return false
    }
  })

  assert.equal(result.accepted, false)
  assert.equal(result.cancelled, true)
})

test('Agent command confirmation allows terminal execution only after approval', async () => {
  const {
    confirmAgentToolExecution
  } = await import(confirmModuleUrl)

  const result = await confirmAgentToolExecution({
    toolName: 'run_background_command',
    args: {
      command: 'tail -f /var/log/nginx/error.log'
    },
    confirm: message => {
      assert.match(message, /tail -f \/var\/log\/nginx\/error\.log/)
      return true
    }
  })

  assert.equal(result.accepted, true)
  assert.equal(result.cancelled, false)
})

test('Agent tool execution routes command tools through user confirmation', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
    'utf8'
  )

  assert.match(source, /confirmAgentToolExecution/)
  assert.match(source, /case 'send_terminal_command':[\s\S]*confirmAgentToolExecution/)
  assert.match(source, /case 'run_background_command':[\s\S]*confirmAgentToolExecution/)
})

test('Agent prompt rules do not allow direct command execution without confirmation', () => {
  const copy = fs.readFileSync(
    path.resolve(__dirname, '../../src/client/components/ai/ai-agent-copy.json'),
    'utf8'
  )

  assert.doesNotMatch(copy, /可以直接执行/)
  assert.match(copy, /必须等待用户确认/)
})
