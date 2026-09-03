const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const utilsPath = path.resolve(
  __dirname,
  '../../build/bin/prepare-command-utils'
)
const preparePath = path.resolve(__dirname, '../../build/bin/prepare.js')
const failureMessage = 'Package cleanup failed. Install Yarn Classic 1.22.22 and retry.'

function loadUtils () {
  return require(utilsPath)
}

test('required shell command returns a successful ShellJS result', () => {
  const { runRequiredShellCommand } = loadUtils()
  const command = 'yarn autoclean --force'
  const result = { code: 0, stdout: 'cleaned' }
  const calls = []

  const actual = runRequiredShellCommand(command, value => {
    calls.push(value)
    return result
  })

  assert.equal(actual, result)
  assert.deepEqual(calls, [command])
})

test('required shell command reports a nonzero ShellJS exit code', () => {
  const { runRequiredShellCommand } = loadUtils()
  const command = 'yarn autoclean --force'

  assert.throws(
    () => runRequiredShellCommand(command, () => ({ code: 23 })),
    error => {
      assert.equal(error.message, failureMessage)
      assert.equal(error.code, 'PACKAGE_PREPARE_COMMAND_FAILED')
      assert.equal(error.command, command)
      assert.equal(error.exitCode, 23)
      return true
    }
  )
})

test('required shell command preserves a thrown execution error as its cause', () => {
  const { runRequiredShellCommand } = loadUtils()
  const command = 'yarn autoclean --force'
  const cause = new Error('execution unavailable')

  assert.throws(
    () => runRequiredShellCommand(command, () => { throw cause }),
    error => {
      assert.equal(error.message, failureMessage)
      assert.equal(error.code, 'PACKAGE_PREPARE_COMMAND_FAILED')
      assert.equal(error.command, command)
      assert.equal(error.exitCode, null)
      assert.equal(error.cause, cause)
      return true
    }
  )
})

test('package prepare requires the exact Yarn cleanup command before later cleanup', () => {
  const source = fs.readFileSync(preparePath, 'utf8')
  const cwdExpression = '$' + '{cwd}'
  const commandSource = 'cd work/app && yarn generate-lock-entry > yarn.lock && yarn autoclean --force && cd ' + cwdExpression
  const requiredCommand = 'runRequiredShellCommand(`' + commandSource + '`)'
  const commandIndex = source.indexOf(requiredCommand)

  assert.match(
    source,
    /const \{ runRequiredShellCommand \} = require\('\.\/prepare-command-utils'\)/
  )
  assert.notEqual(commandIndex, -1)
  assert.equal(
    source.includes('exec(`' + commandSource + '`)'),
    false
  )
  assert.ok(
    source.indexOf("cp('-r', 'build/bin/.yarnclean', 'work/app/')") < commandIndex
  )

  const laterSteps = [
    "rm('-rf', 'work/app/.yarnclean')",
    "rm('-rf', 'work/app/package-lock.json')",
    "rm('-rf', 'work/app/yarn.lock')",
    "require('./clean-empty-folders').main()",
    "require('./verify-runtime-package').main()",
    'echo(`done pack prepare in'
  ]
  for (const step of laterSteps) {
    assert.ok(commandIndex < source.indexOf(step), `${step} must follow required Yarn cleanup`)
  }
})
