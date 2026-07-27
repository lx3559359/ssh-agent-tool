function artifactIpcError (payload = {}) {
  const error = new Error(payload.message || 'Artifact operation failed.')
  error.code = payload.code || 'ARTIFACT_IPC_ERROR'
  return error
}

export function unwrapArtifactResult (result) {
  if (!result?.ok) throw artifactIpcError(result?.error)
  return result.value
}

async function runArtifactCall (method, ...args) {
  return unwrapArtifactResult(
    await window.pre.runGlobalAsync(method, ...args)
  )
}

export const listArtifacts = filters => (
  runArtifactCall('listAIArtifacts', filters || {})
)
export const getArtifact = id => runArtifactCall('getAIArtifact', id)
export const createArtifact = (draft, provenance = {}) => (
  runArtifactCall('createAIArtifact', draft, provenance)
)
export const createArtifactVersion = (id, draft) => (
  runArtifactCall('createAIArtifactVersion', id, draft)
)
export const generateArtifact = (id, version, formats) => (
  runArtifactCall('generateAIArtifact', id, version, formats)
)
export const saveArtifactFile = (
  id,
  version,
  format,
  options = {}
) => runArtifactCall(
  'saveAIArtifactFile',
  id,
  version,
  format,
  options
)
export const prepareArtifactUploadSource = (
  id,
  version,
  format
) => runArtifactCall(
  'prepareAIArtifactUploadSource',
  id,
  version,
  format
)
export const deleteArtifact = id => (
  runArtifactCall('deleteAIArtifact', id)
)

export const artifactClient = Object.freeze({
  listArtifacts,
  getArtifact,
  createArtifact,
  createArtifactVersion,
  generateArtifact,
  saveArtifactFile,
  prepareArtifactUploadSource,
  deleteArtifact
})
