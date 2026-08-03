import '../../app/common/parse-quick-connect.js'

const quickConnect = globalThis.__shellpilotQuickConnect

if (!quickConnect) {
  throw new Error('Quick connect parser bridge is unavailable')
}

delete globalThis.__shellpilotQuickConnect

const {
  parseQuickConnect,
  getDefaultPort,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
  DEFAULT_PORTS,
  OPTS_DENY_LIST
} = quickConnect

export {
  parseQuickConnect,
  getDefaultPort,
  getSupportedProtocols,
  SUPPORTED_PROTOCOLS,
  DEFAULT_PORTS,
  OPTS_DENY_LIST
}
