export function normalizeOperationsParameterValue (value) {
  if (value && typeof value === 'object' && value.target) {
    return value.target.value
  }
  return value
}

export function isOperationsParameterEnabled (parameter = {}, values = {}) {
  if (!parameter.enabledWhen) return true
  const allowed = parameter.enabledWhen.values || []
  return allowed.includes(values[parameter.enabledWhen.id])
}

export function normalizeOperationsParameterDependencies (tool, values = {}) {
  const normalized = { ...values }
  for (const parameter of tool?.parameters || []) {
    if (isOperationsParameterEnabled(parameter, normalized)) continue
    normalized[parameter.id] = parameter.defaultValue ?? ''
  }
  return normalized
}
