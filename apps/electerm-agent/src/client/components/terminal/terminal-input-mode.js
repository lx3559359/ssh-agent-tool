export function isTerminalPasswordInputMode ({
  transportPasswordMode = false,
  suggestionPasswordMode = false
} = {}) {
  return transportPasswordMode === true || suggestionPasswordMode === true
}
