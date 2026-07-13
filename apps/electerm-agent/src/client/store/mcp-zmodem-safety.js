const protocols = Object.freeze({
  rzsz: { upload: 'rz', download: 'sz' },
  trzsz: { upload: 'trz', download: 'tsz' }
})

function requireProtocol (value = 'rzsz') {
  const protocol = String(value || 'rzsz')
  if (!protocols[protocol]) throw new Error('Zmodem 协议不受支持。')
  return protocol
}

function requireSafePath (value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}路径不能为空。`)
  }
  if (value.length > 4096) throw new Error(`${label}路径过长。`)
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`${label}路径包含换行或 NUL，已拒绝执行。`)
  }
  return value
}

function requirePathList (values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 128) {
    throw new Error(`${label}路径列表必须包含 1 到 128 项。`)
  }
  return values.map(value => requireSafePath(value, label))
}

function quotePosixArgument (value) {
  const quote = String.fromCharCode(39)
  const escapedQuote = `${quote}"${quote}"${quote}`
  return `${quote}${value.replaceAll(quote, escapedQuote)}${quote}`
}

function requireTab (store, requestedTabId) {
  const tabId = requestedTabId || store?.activeTabId
  if (!tabId) throw new Error('当前没有活动终端。')
  if (Array.isArray(store?.tabs) && !store.tabs.some(tab => tab.id === tabId)) {
    throw new Error('指定的终端不存在。')
  }
  return tabId
}

export function buildZmodemUpload (args = {}) {
  const protocol = requireProtocol(args.protocol)
  const files = requirePathList(args.files, '本地文件')
  return {
    protocol,
    files,
    command: protocols[protocol].upload,
    metadata: {
      zmodemDirection: 'upload',
      remoteLandingKnown: false,
      fileCount: files.length
    }
  }
}

export function buildZmodemDownload (args = {}) {
  const protocol = requireProtocol(args.protocol)
  const saveFolder = requireSafePath(args.saveFolder, '本地保存目录')
  const remoteFiles = requirePathList(args.remoteFiles, '远程文件')
  const references = remoteFiles.map(quotePosixArgument).join(' ')
  return {
    protocol,
    saveFolder,
    remoteFiles,
    command: `${protocols[protocol].download} -- ${references}`,
    metadata: {
      zmodemDirection: 'download',
      remoteFileCount: remoteFiles.length
    }
  }
}

export async function runZmodemUploadSafety ({
  store,
  args = {},
  setSelectedFiles = () => {}
}) {
  const tabId = requireTab(store, args.tabId)
  const built = buildZmodemUpload(args)
  setSelectedFiles(built.files)
  const result = await store.runSafetyCommand(built.command, {
    tabId,
    source: 'agent',
    title: 'Zmodem 上传',
    metadata: built.metadata
  })
  return {
    success: result?.sent === true,
    cancelled: result?.cancelled === true,
    retryable: result?.retryable === true,
    operationId: result?.operationId,
    protocol: built.protocol,
    command: built.command,
    files: built.files,
    tabId,
    message: result?.sent
      ? `Zmodem 上传已启动，共 ${built.files.length} 个文件。`
      : (result?.error || 'Zmodem 上传命令尚未发送。')
  }
}

export async function runZmodemDownloadSafety ({
  store,
  args = {},
  setSelectedFolder = () => {}
}) {
  const tabId = requireTab(store, args.tabId)
  const built = buildZmodemDownload(args)
  setSelectedFolder(built.saveFolder)
  const result = await store.runSafetyCommand(built.command, {
    tabId,
    source: 'agent',
    title: 'Zmodem 下载',
    metadata: built.metadata
  })
  return {
    success: result?.sent === true,
    cancelled: result?.cancelled === true,
    retryable: result?.retryable === true,
    operationId: result?.operationId,
    protocol: built.protocol,
    command: built.command,
    remoteFiles: built.remoteFiles,
    saveFolder: built.saveFolder,
    tabId,
    message: result?.sent
      ? `Zmodem 下载已启动，共 ${built.remoteFiles.length} 个文件。`
      : (result?.error || 'Zmodem 下载命令尚未发送。')
  }
}
