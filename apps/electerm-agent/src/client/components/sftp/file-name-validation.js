export function validateSftpFileName (name) {
  const value = String(name || '').trim()
  if (!value) {
    return {
      ok: false,
      message: '文件名不能为空'
    }
  }
  if (value === '.' || value === '..') {
    return {
      ok: false,
      message: '文件名不能为 . 或 ..'
    }
  }
  return {
    ok: true,
    name: value
  }
}
