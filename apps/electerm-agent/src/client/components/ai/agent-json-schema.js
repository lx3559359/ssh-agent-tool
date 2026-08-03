function schemaError (path, rule) {
  const error = new Error(`Agent tool arguments failed ${rule} at ${path}`)
  error.code = 'AGENT_TOOL_ARGUMENTS_SCHEMA_INVALID'
  return error
}

function propertyPath (path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function matchesType (type, value) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'null') return value === null
  return true
}

export function validateAgentJsonSchema (schema = {}, value, path = '$') {
  if (schema.type && !matchesType(schema.type, value)) {
    throw schemaError(path, 'type')
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    throw schemaError(path, 'enum')
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw schemaError(path, 'type')
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw schemaError(path, 'minimum')
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw schemaError(path, 'maximum')
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw schemaError(path, 'minLength')
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw schemaError(path, 'maxLength')
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw schemaError(path, 'minItems')
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw schemaError(path, 'maxItems')
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateAgentJsonSchema(schema.items, item, `${path}[${index}]`)
      })
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {}
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw schemaError(propertyPath(path, key), 'required')
      }
    }
    for (const key of Object.keys(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateAgentJsonSchema(properties[key], value[key], propertyPath(path, key))
      } else if (schema.additionalProperties === false) {
        throw schemaError(propertyPath(path, key), 'additionalProperties')
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateAgentJsonSchema(
          schema.additionalProperties,
          value[key],
          propertyPath(path, key)
        )
      }
    }
  }

  return value
}
