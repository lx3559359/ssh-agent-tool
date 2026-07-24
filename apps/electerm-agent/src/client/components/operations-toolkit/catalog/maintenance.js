export function isSafeMaintenanceCommand (command = {}) {
  return Boolean(
    command.mutatesServer === true &&
    command.editBeforeRun === true &&
    command.confirmRequired === true &&
    command.rollback &&
    command.safetyMetadata &&
    Array.isArray(command.safetyMetadata.verifyCommands) &&
    command.safetyMetadata.verifyCommands.length > 0
  )
}

export function getSafeMaintenanceCommands (commands = []) {
  return commands.filter(isSafeMaintenanceCommand)
}
