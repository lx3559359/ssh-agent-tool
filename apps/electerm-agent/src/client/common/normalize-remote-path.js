/**
 * Ensure remote path always starts with /
 * Windows drive letters like c: become /c:
 * Also fixes mixed separators like /c:\windows → /c:/windows
 * This is needed because SFTP protocol expects paths with leading /
 * @param {String} path
 * @return {String}
 */
export default function normalizeRemotePath (path) {
  if (!path) return path
  const normalized = String(path).replace(/\\/g, '/')
  if (normalized === '~' || normalized.startsWith('~/')) {
    return normalized
  }
  // Fix mixed separators: /c:\windows → /c:/windows
  if (/^\/[a-zA-Z]:\//.test(normalized)) {
    return normalized
  }
  // Add leading / to bare drive letters: c: → /c:, c:\windows → /c:/windows
  if (/^[a-zA-Z]:/.test(normalized)) {
    return '/' + normalized
  }
  if (normalized.startsWith('/')) {
    return normalized
  }
  return '/' + normalized.replace(/^(\.\/)+/, '').replace(/^(\.\.\/)+/, '')
}
