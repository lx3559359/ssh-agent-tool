const { removePackagedBatchScripts } = require('./prepare-cleanup-utils')

module.exports = async function afterPackCleanup (context) {
  removePackagedBatchScripts(context.appOutDir)
}
