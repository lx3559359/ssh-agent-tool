const {
  artifactError,
  assertArtifactId,
  validateArtifactDestination,
  validateArtifactDraft,
  validateArtifactFormat,
  validateArtifactFormats,
  validateArtifactFilters,
  validateArtifactProvenance,
  validateArtifactVersion
} = require('./artifact-validator')

function createArtifactService (options = {}) {
  const repository = options.repository
  if (!repository) {
    throw artifactError(
      'ARTIFACT_REPOSITORY_REQUIRED',
      'Artifact repository is required.'
    )
  }

  async function requireVersion (id, version) {
    const artifact = await repository.get(assertArtifactId(id))
    if (!artifact) {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact was not found.')
    }
    const safeVersion = validateArtifactVersion(version)
    if (!artifact.versions.some(item => item.version === safeVersion)) {
      throw artifactError(
        'ARTIFACT_VERSION_NOT_FOUND',
        'Artifact version was not found.'
      )
    }
    return artifact
  }

  function listAIArtifacts (filters = {}) {
    return repository.list(validateArtifactFilters(filters))
  }

  function getAIArtifact (id) {
    return repository.get(assertArtifactId(id))
  }

  function createAIArtifact (draft, provenance = {}) {
    return repository.create(
      validateArtifactDraft(draft),
      validateArtifactProvenance(provenance)
    )
  }

  function createAIArtifactVersion (id, draft) {
    return repository.createVersion(
      assertArtifactId(id),
      validateArtifactDraft(draft)
    )
  }

  async function generateAIArtifact (id, version, formats) {
    await requireVersion(id, version)
    validateArtifactFormats(formats)
    throw artifactError(
      'ARTIFACT_GENERATOR_UNAVAILABLE',
      'Artifact generators are not available yet.'
    )
  }

  async function exportAIArtifactFile (
    id,
    version,
    format,
    destination
  ) {
    await requireVersion(id, version)
    validateArtifactFormat(format)
    validateArtifactDestination(destination)
    throw artifactError(
      'ARTIFACT_GENERATOR_UNAVAILABLE',
      'Artifact generators are not available yet.'
    )
  }

  function deleteAIArtifact (id) {
    return repository.delete(assertArtifactId(id))
  }

  return Object.freeze({
    listAIArtifacts,
    getAIArtifact,
    createAIArtifact,
    createAIArtifactVersion,
    generateAIArtifact,
    exportAIArtifactFile,
    deleteAIArtifact
  })
}

module.exports = {
  createArtifactService
}
