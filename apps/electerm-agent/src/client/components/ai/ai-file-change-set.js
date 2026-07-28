export const AI_FILE_DIFF_PREVIEW_MAX_CHARS = 200000
export const AI_FILE_CHANGE_MAX_FILES = 50

function changeSetError (code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeRemotePath (value) {
  const path = String(value || '').trim().replace(/\/{2,}/g, '/')
  if (!path.startsWith('/') || path.includes('\0') ||
    path.split('/').some(part => part === '..')) {
    throw changeSetError(
      'AI_FILE_CHANGE_PATH_INVALID',
      'AI 文件变更必须使用不含上级跳转的远程绝对路径。'
    )
  }
  return path
}

function freezeRecord (value) {
  if (!value || typeof value !== 'object') return value
  for (const child of Object.values(value)) freezeRecord(child)
  return Object.freeze(value)
}

function boundedPreview (value) {
  const preview = typeof value === 'string'
    ? value
    : JSON.stringify(value ?? '')
  return {
    diffPreview: preview.slice(0, AI_FILE_DIFF_PREVIEW_MAX_CHARS),
    truncated: preview.length > AI_FILE_DIFF_PREVIEW_MAX_CHARS
  }
}

function normalizedFingerprint (value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    existed: source.existed === true,
    size: Number.isSafeInteger(source.size) && source.size >= 0
      ? source.size
      : 0,
    digest: String(source.digest || ''),
    digestAlgorithm: String(source.digestAlgorithm || '')
  }
}

function normalizeFileChange (file) {
  const path = normalizeRemotePath(file?.path)
  return freezeRecord({
    path,
    selected: file?.selected !== false,
    originalFingerprint: normalizedFingerprint(file?.originalFingerprint),
    proposedFingerprint: normalizedFingerprint(file?.proposedFingerprint),
    ...boundedPreview(file?.diffPreview),
    status: 'pending'
  })
}

export function createAiFileChangeSet ({
  id,
  files,
  createdAt = new Date().toISOString()
} = {}) {
  if (!Array.isArray(files) || files.length < 1 ||
    files.length > AI_FILE_CHANGE_MAX_FILES) {
    throw changeSetError(
      'AI_FILE_CHANGE_COUNT_INVALID',
      `AI 文件变更数量必须在 1 到 ${AI_FILE_CHANGE_MAX_FILES} 之间。`
    )
  }
  const normalizedFiles = files.map(normalizeFileChange)
  const paths = new Set()
  for (const file of normalizedFiles) {
    if (paths.has(file.path)) {
      throw changeSetError(
        'AI_FILE_CHANGE_PATH_DUPLICATE',
        `AI 文件变更包含重复路径：${file.path}`
      )
    }
    paths.add(file.path)
  }
  return freezeRecord({
    schemaVersion: 1,
    id: String(id || `ai-file-review-${Date.now()}`),
    createdAt: String(createdAt),
    status: 'reviewing',
    files: normalizedFiles
  })
}

export function setAiFileChangeSelected (changeSet, path, selected) {
  const target = normalizeRemotePath(path)
  let matched = false
  const files = changeSet.files.map(file => {
    if (file.path !== target) return file
    matched = true
    return freezeRecord({
      ...file,
      selected: selected === true
    })
  })
  if (!matched) {
    throw changeSetError(
      'AI_FILE_CHANGE_NOT_FOUND',
      `未找到 AI 文件变更：${target}`
    )
  }
  return freezeRecord({
    ...changeSet,
    files
  })
}

export function countSelectedAiFileChanges (changeSet) {
  return changeSet.files.filter(file => file.selected).length
}

export function formatAiFileChangeDiffPreview (preview) {
  if (!preview || !Array.isArray(preview.lines)) {
    return '无法读取原文件内容，执行前仍会校验文件指纹。'
  }
  const prefixes = {
    add: '+',
    remove: '-',
    context: ' '
  }
  const body = preview.lines.map(line => (
    `${prefixes[line.type] || ' '}${line.text || ''}`
  ))
  return [
    `--- ${preview.path || '原文件'}`,
    `+++ ${preview.path || '修改后文件'}`,
    `@@ +${preview.addedLines || 0} -${preview.removedLines || 0} @@`,
    ...body,
    ...(preview.truncated ? ['... 差异预览已截断 ...'] : [])
  ].join('\n')
}

export function validateAiFileChangeFingerprint (reviewed, current) {
  const expected = normalizedFingerprint(reviewed)
  const actual = normalizedFingerprint(current)
  const same = expected.existed === actual.existed &&
    expected.size === actual.size &&
    expected.digest === actual.digest &&
    expected.digestAlgorithm === actual.digestAlgorithm
  return same
    ? { ok: true }
    : { ok: false, code: 'AI_FILE_CHANGED_SINCE_REVIEW' }
}
