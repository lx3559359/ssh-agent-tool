import resolve from '../../common/resolve.js'

const transactionSegment = '.shellpilot-transactions'
const maxConcurrency = 4

function normalizeConcurrency (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return maxConcurrency
  return Math.min(maxConcurrency, Math.max(1, Math.floor(number)))
}

export function buildFastDeleteTarget (file = {}) {
  if (file.type !== 'remote' || file.isParent || file.isEmpty) {
    throw new Error('快速删除只支持真实远程文件或目录。')
  }
  const rawName = String(file.name || '')
  const checkedName = rawName.trim()
  if (!checkedName || checkedName === '.' || checkedName === '..') {
    throw new Error('快速删除拒绝父目录或空目标。')
  }
  if (/[\\/]/.test(rawName)) {
    throw new Error('快速删除拒绝包含路径分隔符的文件名。')
  }
  const parentPath = String(file.path || '')
  if (!parentPath.startsWith('/') || parentPath.includes('\\')) {
    throw new Error('快速删除要求安全的绝对远程路径。')
  }
  const raw = String(resolve(parentPath, rawName)).replace(/\\/g, '/')
  if (!raw.startsWith('/') || raw === '/' || raw.split('/').includes('..')) {
    throw new Error('快速删除要求安全的绝对远程路径。')
  }
  const segments = raw.split('/').filter(Boolean)
  if (segments.some(segment => segment.toLowerCase() === transactionSegment)) {
    throw new Error('快速删除不能操作 ShellPilot 事务存储。')
  }
  return {
    file,
    path: raw,
    isDirectory: file.isDirectory === true
  }
}

export function buildFastDeleteTargets (files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('快速删除没有可执行的远程目标。')
  }
  return files.map(buildFastDeleteTarget)
}

export async function executeFastRemoteDelete ({
  sftp,
  files,
  concurrency = maxConcurrency
} = {}) {
  const targets = buildFastDeleteTargets(files)
  const outcomes = new Array(targets.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < targets.length) {
      const index = nextIndex
      nextIndex += 1
      const target = targets[index]
      try {
        if (target.isDirectory) {
          await sftp.rmdir(target.path)
        } else {
          await sftp.rm(target.path)
        }
        outcomes[index] = {
          ok: true,
          result: {
            file: target.file,
            path: target.path
          }
        }
      } catch (error) {
        outcomes[index] = {
          ok: false,
          result: {
            file: target.file,
            path: target.path,
            error
          }
        }
      }
    }
  }

  const workerCount = Math.min(
    targets.length,
    normalizeConcurrency(concurrency)
  )
  await Promise.all(Array.from({ length: workerCount }, worker))

  const completed = []
  const failed = []
  for (const outcome of outcomes) {
    if (outcome.ok) {
      completed.push(outcome.result)
    } else {
      failed.push(outcome.result)
    }
  }
  return {
    completed,
    failed,
    total: targets.length
  }
}
