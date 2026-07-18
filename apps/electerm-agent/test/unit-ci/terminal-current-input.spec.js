const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function importCurrentInput () {
  return import(pathToFileURL(path.resolve(
    __dirname,
    '../../src/client/components/terminal/terminal-current-input.js'
  )))
}

test('extracts commands from Windows command prompts without a trailing space', async () => {
  const { extractTerminalCommandInput } = await importCurrentInput()

  assert.equal(
    extractTerminalCommandInput('C:\\Users\\operator>test'),
    'test'
  )
  assert.equal(
    extractTerminalCommandInput('PS C:\\Users\\operator> Get-ChildItem'),
    'Get-ChildItem'
  )
})

test('preserves Unix prompt parsing and command redirection', async () => {
  const { extractTerminalCommandInput } = await importCurrentInput()

  assert.equal(extractTerminalCommandInput('[root@host ~]# uptime'), 'uptime')
  assert.equal(extractTerminalCommandInput('echo hi >output.txt'), 'echo hi >output.txt')
})
