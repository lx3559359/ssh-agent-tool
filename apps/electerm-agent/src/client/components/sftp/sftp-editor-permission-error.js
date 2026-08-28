const stageMarkerPattern = /\[SFTP_EDITOR_STAGE:([a-z-]+)\]\s*/i

const stageLabels = {
  transaction: '事务初始化',
  snapshot: '恢复快照',
  staging: '暂存写入',
  metadata: '权限与所有权校验',
  replace: '原子替换'
}

function isPermissionError (error) {
  const code = error?.code ?? error?.statusCode
  return code === 3 || ['EACCES', 'EPERM'].includes(String(code).toUpperCase()) ||
    /permission denied|operation not permitted|access denied|eacces|eperm/i.test(
      String(error?.message || error || '')
    )
}

function extractStage (error) {
  return error?.sftpEditorStage ||
    String(error?.message || '').match(stageMarkerPattern)?.[1]
}

export function markSftpEditorStage (stage, error) {
  if (error?.name === 'AbortError' || extractStage(error)) return error
  const source = error instanceof Error ? error : new Error(String(error))
  const message = `[SFTP_EDITOR_STAGE:${stage}] ${source.message}`
  try {
    source.message = message
    source.sftpEditorStage = stage
    return source
  } catch {
    const marked = new Error(message)
    marked.name = source.name
    marked.code = source.code
    marked.sftpEditorStage = stage
    marked.cause = source
    return marked
  }
}

export function formatSftpEditorSaveError (error, {
  path,
  loginUsername,
  effectiveUsername,
  channel
} = {}) {
  if (!isPermissionError(error)) return error
  const loginIdentity = String(loginUsername || '未知账号')
  const effectiveIdentity = String(effectiveUsername || loginIdentity)
  const targetPath = String(path || '目标文件')
  const stage = stageLabels[extractStage(error)] || '安全保存'
  const identity = channel === 'pty-root'
    ? `SSH 登录：${loginIdentity}，文件操作：${effectiveIdentity}（当前终端）`
    : `SFTP 身份：${effectiveIdentity}`
  const prefix = `无法保存 ${targetPath}（${identity}，阶段：${stage}）。编辑内容已保留，可修正权限后重试。`
  const guidance = channel === 'pty-root'
    ? 'root 身份仍被服务器拒绝，请检查只读文件系统、ACL/SELinux、文件不可变属性，以及 SFTP/chroot 服务限制。'
    : '请检查该 SFTP 身份对目标目录的写入、暂存和文件替换权限，或使用具有所需权限的账号重新连接。'
  const formatted = new Error(`${prefix}${guidance}`)
  formatted.name = error?.name || 'Error'
  formatted.code = error?.code
  formatted.sftpEditorStage = extractStage(error)
  formatted.cause = error
  return formatted
}
