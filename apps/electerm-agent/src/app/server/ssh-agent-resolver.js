const WINDOWS_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

function resolveSshAgent (initOptions = {}, options = {}) {
  if (initOptions.useSshAgent === false) {
    return undefined
  }

  if (initOptions.sshAgent) {
    return initOptions.sshAgent
  }

  const env = options.env || process.env
  if (env.SSH_AUTH_SOCK) {
    return env.SSH_AUTH_SOCK
  }

  const platform = options.platform || process.platform
  if (platform === 'win32') {
    return WINDOWS_OPENSSH_AGENT_PIPE
  }

  return undefined
}

module.exports = {
  WINDOWS_OPENSSH_AGENT_PIPE,
  resolveSshAgent
}
