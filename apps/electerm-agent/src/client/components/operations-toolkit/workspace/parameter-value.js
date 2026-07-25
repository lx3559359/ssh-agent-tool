export function normalizeOperationsParameterValue (value) {
  if (value && typeof value === 'object' && value.target) {
    return value.target.value
  }
  return value
}
