const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const terminalSource = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/client/components/terminal/terminal.jsx'
), 'utf8')

test('async terminal readiness cannot steal focus while a modal owns keyboard input', () => {
  assert.match(
    terminalSource,
    /focusAfterAsyncTerminalReady = \(term = this\.term\) => \{[\s\S]*?window\.store\.showModal[\s\S]*?!this\.isActiveTerminal\(\)[\s\S]*?term\.focus\(\)[\s\S]*?return true[\s\S]*?\n {2}\}/
  )
  assert.equal(
    (terminalSource.match(/this\.focusAfterAsyncTerminalReady\(term\)/g) || []).length,
    2,
    'both remote-init and socket-open readiness paths must use the modal-aware focus policy'
  )
})

test('async terminal readiness respects interactive focus outside the current terminal', () => {
  assert.match(
    terminalSource,
    /const activeElement = window\.document\.activeElement/
  )
  assert.match(
    terminalSource,
    /activeElement === window\.document\.body[\s\S]*?activeElement === window\.document\.documentElement[\s\S]*?term\?\.element\?\.contains\(activeElement\)/
  )
  assert.match(
    terminalSource,
    /if \(!term \|\| window\.store\.showModal \|\| !this\.isActiveTerminal\(\) \|\| !terminalOwnsFocus\)/
  )
})
