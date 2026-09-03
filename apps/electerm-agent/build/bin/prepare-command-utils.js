const { exec } = require('shelljs')

const failureMessage = 'Package cleanup failed. Install Yarn Classic 1.22.22 and retry.'

function createCommandFailure (command, exitCode, cause) {
  const error = new Error(failureMessage)
  error.code = 'PACKAGE_PREPARE_COMMAND_FAILED'
  error.command = command
  error.exitCode = exitCode
  if (cause !== undefined) {
    error.cause = cause
  }
  return error
}

function runRequiredShellCommand (command, shellExec = exec) {
  let result
  try {
    result = shellExec(command)
  } catch (cause) {
    throw createCommandFailure(command, null, cause)
  }

  const exitCode = result?.code ?? null
  if (exitCode !== 0) {
    throw createCommandFailure(command, exitCode)
  }
  return result
}

module.exports = {
  runRequiredShellCommand
}
