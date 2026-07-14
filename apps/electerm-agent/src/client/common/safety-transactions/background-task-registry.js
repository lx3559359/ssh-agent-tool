import { redactAuditText } from './audit-redaction.js'

function safeMessage (error, fallback) {
  return redactAuditText(String(error?.message || fallback))
}

function parsePid (value) {
  const text = String(value || '').trim()
  return /^[1-9]\d*$/.test(text) ? text : undefined
}

function parseExitCode (value) {
  const text = String(value || '').trim()
  if (!/^-?\d+$/.test(text)) return undefined
  const code = Number(text)
  return Number.isSafeInteger(code) ? code : undefined
}

function unknownTask (taskId, message = '后台任务上下文已丢失，执行结果未知。') {
  return {
    taskId: String(taskId || ''),
    status: 'unknown',
    interrupted: true,
    message
  }
}

export function createBackgroundTaskRegistry (options = {}) {
  const readFile = options.readFile
  const isAlive = options.isAlive
  const kill = options.kill
  const now = options.now || Date.now
  const launchGraceMs = Number(options.launchGraceMs ?? 2000)
  if (typeof readFile !== 'function' || typeof isAlive !== 'function' ||
    typeof kill !== 'function') {
    throw new TypeError('后台任务 registry 缺少监控能力。')
  }
  const records = new Map()
  const capabilities = new Map()

  function register (task) {
    if (!task?.id || !task.operationId || typeof task.finalize !== 'function' ||
      typeof task.cancel !== 'function') {
      throw new Error('后台任务记录不完整。')
    }
    const record = {
      id: String(task.id),
      operationId: String(task.operationId),
      tabId: String(task.tabId),
      command: String(task.command),
      startTime: Number(task.startTime || now()),
      logFile: String(task.logFile),
      pidFile: String(task.pidFile),
      exitFile: String(task.exitFile),
      status: 'started'
    }
    records.set(record.id, record)
    capabilities.set(record.id, {
      finalize: task.finalize,
      cancel: task.cancel,
      settling: null
    })
    return { ...record }
  }

  async function settle (record, action, patch) {
    const capability = capabilities.get(record.id)
    if (!capability) return { ...record }
    if (!capability.settling) {
      capability.settling = Promise.resolve()
        .then(action)
        .then(() => {
          Object.assign(record, patch, { endTime: now() })
          capabilities.delete(record.id)
          return { ...record }
        })
        .catch(error => {
          Object.assign(record, {
            status: 'unknown',
            interrupted: true,
            message: `后台任务事务收口失败：${safeMessage(error, '未知错误')}`
          })
          capabilities.delete(record.id)
          return { ...record }
        })
    }
    return capability.settling
  }

  async function interrupt (record, message) {
    return settle(
      record,
      () => capabilities.get(record.id)?.cancel(message),
      { status: 'unknown', interrupted: true, message }
    )
  }

  async function finalize (record, exitCode) {
    return settle(
      record,
      () => capabilities.get(record.id)?.finalize(exitCode),
      {
        status: exitCode === 0 ? 'completed' : 'failed',
        exitCode,
        message: exitCode === 0
          ? '后台命令执行完成。'
          : `后台命令执行失败，退出码 ${exitCode}。`
      }
    )
  }

  async function readExit (record) {
    const output = await readFile(record.tabId, record.exitFile)
    const text = String(output || '').trim()
    return {
      present: text.length > 0,
      exitCode: parseExitCode(text)
    }
  }

  async function status (taskId) {
    const record = records.get(String(taskId))
    if (!record) return unknownTask(taskId)
    if (!capabilities.has(record.id)) return { ...record }
    try {
      const exit = await readExit(record)
      if (exit.present) {
        if (exit.exitCode === undefined) {
          return interrupt(record, '后台任务退出码无效，执行已标记为中断。')
        }
        return finalize(record, exit.exitCode)
      }
      const pidOutput = await readFile(record.tabId, record.pidFile)
      const pid = parsePid(pidOutput)
      if (!pid) {
        if (now() - record.startTime <= launchGraceMs) {
          record.status = 'starting'
          return { ...record }
        }
        return interrupt(record, '后台任务 PID 无效或已丢失，执行结果未知。')
      }
      if (await isAlive(record.tabId, pid)) {
        record.status = 'running'
        record.pid = pid
        return { ...record }
      }
      const lateExit = await readExit(record)
      if (lateExit.exitCode !== undefined) return finalize(record, lateExit.exitCode)
      return interrupt(record, '后台进程已退出但没有可靠退出码，执行已标记为中断。')
    } catch (error) {
      return interrupt(
        record,
        `后台任务状态检查失败：${safeMessage(error, '未知错误')}`
      )
    }
  }

  async function cancel (taskId) {
    const record = records.get(String(taskId))
    if (!record) return unknownTask(taskId, '后台任务上下文已丢失，无法确认取消结果。')
    if (!capabilities.has(record.id)) return { ...record }
    try {
      const exit = await readExit(record)
      if (exit.exitCode !== undefined) return finalize(record, exit.exitCode)
      const pid = parsePid(await readFile(record.tabId, record.pidFile))
      if (!pid) return interrupt(record, '后台任务 PID 无效，已取消事务并标记为中断。')
      const killed = await kill(record.tabId, pid)
      if (killed === true) {
        return settle(
          record,
          () => capabilities.get(record.id)?.cancel('用户取消了后台任务。'),
          { status: 'cancelled', pid, message: '后台进程已终止，事务已取消。' }
        )
      }
      const lateExit = await readExit(record)
      if (lateExit.exitCode !== undefined) return finalize(record, lateExit.exitCode)
      return interrupt(record, '无法确认后台进程已终止，事务已取消并标记为中断。')
    } catch (error) {
      return interrupt(
        record,
        `后台任务取消失败：${safeMessage(error, '未知错误')}`
      )
    }
  }

  function get (taskId) {
    const record = records.get(String(taskId))
    return record ? { ...record } : undefined
  }

  return { register, get, status, cancel }
}
