const crypto = require('node:crypto')
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
const {
  createGeneratorRegistry
} = require('./generator-registry')
const markdownGenerator = require('./markdown-generator')
const csvGenerator = require('./csv-generator')
const docxGenerator = require('./docx-generator')
const xlsxGenerator = require('./xlsx-generator')
const pdfGenerator = require('./pdf-generator')
const htmlGenerator = require('./html-generator')

function createArtifactService (options = {}) {
  const repository = options.repository
  if (!repository) {
    throw artifactError(
      'ARTIFACT_REPOSITORY_REQUIRED',
      'Artifact repository is required.'
    )
  }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const registry = options.registry || createGeneratorRegistry([
    markdownGenerator,
    csvGenerator,
    docxGenerator,
    xlsxGenerator,
    pdfGenerator,
    htmlGenerator
  ])

  async function requireVersion (id, version) {
    const artifact = await repository.get(assertArtifactId(id))
    if (!artifact) {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact was not found.')
    }
    const safeVersion = validateArtifactVersion(version)
    const selectedVersion = artifact.versions.find(
      item => item.version === safeVersion
    )
    if (!selectedVersion) {
      throw artifactError(
        'ARTIFACT_VERSION_NOT_FOUND',
        'Artifact version was not found.'
      )
    }
    return { artifact, selectedVersion, version: safeVersion }
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
    const selected = await requireVersion(id, version)
    const safeFormats = validateArtifactFormats(formats)
    const generatedAt = now()
    const outputs = await Promise.all(safeFormats.map(async format => {
      const result = await registry.generate(
        format,
        selected.selectedVersion.source,
        {
          artifactId: selected.artifact.id,
          version: selected.version
        }
      )
      const { content } = result
      return {
        format,
        filename: `artifact-v${String(selected.version).padStart(4, '0')}.${format}`,
        content,
        bytes: content.byteLength,
        sha256: crypto.createHash('sha256').update(content).digest('hex'),
        generatedAt
      }
    }))
    return repository.saveGeneratedOutputs(
      selected.artifact.id,
      selected.version,
      outputs
    )
  }

  async function exportAIArtifactFile (
    id,
    version,
    format,
    destination
  ) {
    const selected = await requireVersion(id, version)
    const safeFormat = validateArtifactFormat(format)
    const safeDestination = validateArtifactDestination(destination)
    return repository.exportGeneratedFile(
      selected.artifact.id,
      selected.version,
      safeFormat,
      safeDestination
    )
  }

  async function saveAIArtifactFileToTrustedPath (
    id,
    version,
    format,
    destination
  ) {
    const selected = await requireVersion(id, version)
    const safeFormat = validateArtifactFormat(format)
    return repository.exportGeneratedFileToTrustedPath(
      selected.artifact.id,
      selected.version,
      safeFormat,
      destination
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
    saveAIArtifactFileToTrustedPath,
    deleteAIArtifact
  })
}

module.exports = {
  createArtifactService
}
