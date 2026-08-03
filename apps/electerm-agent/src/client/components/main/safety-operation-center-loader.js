export async function loadSafetyCenterRecords ({
  listOperations,
  listTasks,
  listOperationTasks,
  buildIntegrityResults,
  onOptionalError = () => {}
}) {
  const optionalOperationTasks = Promise.resolve()
    .then(() => listOperationTasks())
    .catch(error => {
      onOptionalError(error)
      return []
    })
  const [records, tasks, operationTasks] = await Promise.all([
    listOperations(),
    listTasks(),
    optionalOperationTasks
  ])
  const safeRecords = Array.isArray(records) ? records : []
  return {
    records: safeRecords,
    tasks: Array.isArray(tasks) ? tasks : [],
    operationTasks: Array.isArray(operationTasks) ? operationTasks : [],
    integrityResults: await buildIntegrityResults(safeRecords)
  }
}
