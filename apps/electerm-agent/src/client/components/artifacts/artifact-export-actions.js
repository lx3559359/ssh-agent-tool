import { artifactClient } from './artifact-client'

function artifactActionError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function requireRemotePath (value) {
  const remotePath = String(value || '').trim()
  if (
    !remotePath.startsWith('/') ||
    remotePath.length > 4096 ||
    remotePath.includes('\0')
  ) {
    throw artifactActionError(
      'ARTIFACT_REMOTE_PATH_INVALID',
      '请输入服务器上的绝对路径，例如 /tmp/巡检报告.pdf'
    )
  }
  return remotePath
}

export function saveArtifactExport ({
  artifactId,
  version,
  format,
  openAfterSave = false
}) {
  return artifactClient.saveArtifactFile(
    artifactId,
    version,
    format,
    { openAfterSave }
  )
}

export async function uploadArtifactToCurrentServer ({
  artifactId,
  version,
  format,
  remotePath
}) {
  const store = window.store
  const endpoint = store.getCurrentOperationsEndpoint?.()
  if (!endpoint?.tabId) {
    throw artifactActionError(
      'ARTIFACT_SSH_ENDPOINT_REQUIRED',
      '当前没有可用的 SSH 会话，请先连接目标服务器。'
    )
  }
  const safeRemotePath = requireRemotePath(remotePath)
  const prepared = await artifactClient.prepareArtifactUploadSource(
    artifactId,
    version,
    format
  )
  return store.mcpSftpUpload({
    localPath: prepared.localPath,
    remotePath: safeRemotePath,
    tabId: endpoint.tabId
  })
}
