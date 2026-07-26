const {
  artifactError,
  validateArtifactFormat
} = require('./artifact-validator')

function invalidGeneratorError () {
  return artifactError(
    'ARTIFACT_GENERATOR_INVALID',
    'Artifact generator is invalid.'
  )
}

function createGeneratorRegistry (initialHandlers = []) {
  if (!Array.isArray(initialHandlers)) {
    throw invalidGeneratorError()
  }
  const handlers = new Map()

  function register (handler) {
    if (!handler || typeof handler !== 'object' ||
      typeof handler.format !== 'string' ||
      typeof handler.generate !== 'function') {
      throw invalidGeneratorError()
    }

    let format
    try {
      format = validateArtifactFormat(handler.format)
    } catch {
      throw invalidGeneratorError()
    }
    if (handlers.has(format)) {
      throw artifactError(
        'ARTIFACT_GENERATOR_DUPLICATE',
        'Artifact generator format is already registered.'
      )
    }
    handlers.set(format, handler)
    return format
  }

  async function generate (format, source, context = {}) {
    const safeFormat = validateArtifactFormat(format)
    const handler = handlers.get(safeFormat)
    if (!handler) {
      throw artifactError(
        'ARTIFACT_FORMAT_UNSUPPORTED',
        'Artifact format is unsupported.'
      )
    }
    const content = await handler.generate(source, context)
    if (!Buffer.isBuffer(content)) {
      throw invalidGeneratorError()
    }
    return content
  }

  for (const handler of initialHandlers) {
    register(handler)
  }

  return Object.freeze({
    generate,
    register
  })
}

module.exports = {
  createGeneratorRegistry
}
