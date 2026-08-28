export function bindSftpTransportGeneration (transport, value) {
  const generation = String(value || '').trim()
  if (!generation) throw new Error('SFTP 缺少 SSH session generation')
  Object.defineProperty(transport, 'sshSessionGeneration', {
    value: generation,
    enumerable: true,
    configurable: false,
    writable: false
  })
  return generation
}
