export const rollbackScriptDirectory = '/tmp/shellpilot-rollback'

const linuxFilenameMaxLength = 255
const longestRollbackDerivedSuffix = '.running.lock'

export const rollbackScriptFilenameMaxLength =
  linuxFilenameMaxLength - longestRollbackDerivedSuffix.length

export function isSafeRollbackScriptPath (value) {
  if (typeof value !== 'string') return false
  const prefix = `${rollbackScriptDirectory}/`
  if (!value.startsWith(prefix)) return false
  const filename = value.slice(prefix.length)
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) &&
    !filename.includes('..') &&
    filename.length <= rollbackScriptFilenameMaxLength
}
