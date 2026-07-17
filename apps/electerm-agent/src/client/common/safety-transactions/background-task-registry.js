import { redactAuditText } from './audit-redaction.js'

const defaultMonitorInitialDelayMs = 500
const defaultMonitorMaxDelayMs = 10000
const defaultMonitorTimeoutMs = 24 * 60 * 60 * 1000
const defaultTerminalRecordLimit = 100
const defaultTerminalRecordTtlMs = 24 * 60 * 60 * 1000
const minimumMonitorDelayMs = 250

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

function boundedNumber (value, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

function resolveScheduler (scheduler = {}) {
  const set = scheduler.setTimeout || globalThis.setTimeout
  const clear = scheduler.clearTimeout || globalThis.clearTimeout
  if (typeof set !== 'function' || typeof clear !== 'function') {
    throw new TypeError('后台任务 scheduler 缺少定时器能力。')
  }
  return {
    setTimeout (callback, delay) {
      const timer = set(callback, delay)
      timer?.unref?.()
      return timer
    },
    clearTimeout: timer => clear(timer)
  }
}

export function createBackgroundTaskRegistry (options = {}) {
  const readFile = options.readFile
  const isAlive = options.isAlive
  const kill = options.kill
  const now = options.now || Date.now
  const scheduler = resolveScheduler(options.scheduler)
  const launchGraceMs = boundedNumber(options.launchGraceMs, 2000, 0)
  const monitorInitialDelayMs = boundedNumber(
    options.monitorInitialDelayMs,
    defaultMonitorInitialDelayMs,
    minimumMonitorDelayMs,
    60000
  )
  const monitorMaxDelayMs = boundedNumber(
    options.monitorMaxDelayMs,
    defaultMonitorMaxDelayMs,
    monitorInitialDelayMs,
    5 * 60 * 1000
  )
  const monitorTimeoutMs = boundedNumber(
    options.monitorTimeoutMs,
    defaultMonitorTimeoutMs,
    monitorInitialDelayMs,
    7 * 24 * 60 * 60 * 1000
  )
  const terminalRecordLimit = Math.floor(boundedNumber(
    options.terminalRecordLimit,
    defaultTerminalRecordLimit,
    0,
    10000
  ))
  const terminalRecordTtlMs = boundedNumber(
    options.terminalRecordTtlMs,
    defaultTerminalRecordTtlMs,
    0,
    30 * 24 * 60 * 60 * 1000
  )
  const onTerminalError = options.onTerminalError || (() => {})
  if (typeof readFile !== 'function' || typeof isAlive !== 'function' ||
    typeof kill !== 'function') {
    throw new TypeError('后台任务 registry 缺少监控能力。')
  }

  const records = new Map()
  const capabilities = new Map()

  function currentTime () {
    const value = now()
    const time = value instanceof Date ? value.getTime() : Number(value)
    if (!Number.isFinite(time)) throw new Error('后台任务时钟无效。')
    return time
  }

  function clearMonitor (capability) {
    if (!capability || capability.timer === null) return
    scheduler.clearTimeout(capability.timer)
    capability.timer = null
  }

  function isCurrentCapability (record, capability) {
    return records.get(record.id) === record &&
      capabilities.get(record.id) === capability
  }

  function pruneTerminalRecords () {
    const time = currentTime()
    const terminal = []
    for (const record of records.values()) {
      if (capabilities.has(record.id)) continue
      if (!Number.isFinite(record.endTime) ||
        time - record.endTime > terminalRecordTtlMs) {
        records.delete(record.id)
        continue
      }
      terminal.push(record)
    }
    terminal.sort((left, right) => left.endTime - right.endTime)
    while (terminal.length > terminalRecordLimit) {
      records.delete(terminal.shift().id)
    }
  }

  function finishTerminal (record, patch) {
    const capability = capabilities.get(record.id)
    clearMonitor(capability)
    Object.assign(record, patch, { endTime: currentTime() })
    if (patch.interrupted !== true) delete record.interrupted
    delete record.finalizePending
    capabilities.delete(record.id)
    pruneTerminalRecords()
    const result = { ...record }
    if (typeof capability?.onTerminal === 'function') {
      Promise.resolve()
        .then(() => capability.onTerminal(result))
        .catch(onTerminalError)
    }
    return result
  }

  function markFinalizeFailure (record, error, returnedFalse) {
    record.status = 'unknown'
    record.interrupted = true
    record.finalizePending = true
    record.message = returnedFalse
      ? '后台任务事务未完成，将仅重试事务收口，不会重复执行原命令。'
      : `后台任务事务收口失败，将仅重试事务收口，不会重复执行原命令：${safeMessage(error, '未知错误')}`
    return { ...record }
  }

  function scheduleMonitor (record, delay) {
    const capability = capabilities.get(record.id)
    if (!capability || capability.timer !== null) return
    const boundedDelay = Math.min(
      monitorMaxDelayMs,
      Math.max(monitorInitialDelayMs, Number(delay) || monitorInitialDelayMs)
    )
    capability.timer = scheduler.setTimeout(async () => {
      capability.timer = null
      await monitor(record.id)
    }, boundedDelay)
    capability.nextDelay = Math.min(monitorMaxDelayMs, boundedDelay * 2)
  }

  async function finalize (record, exitCode) {
    const capability = capabilities.get(record.id)
    if (!capability) return { ...record }
    if (capability.settling) return capability.settling
    record.exitCode = exitCode
    clearMonitor(capability)
    capability.settling = Promise.resolve()
      .then(() => capability.finalize(exitCode))
      .then(result => {
        if (result === false) return markFinalizeFailure(record, undefined, true)
        return finishTerminal(record, {
          status: exitCode === 0 ? 'completed' : 'failed',
          exitCode,
          message: exitCode === 0
            ? '后台命令执行完成。'
            : `后台命令执行失败，退出码 ${exitCode}。`
        })
      })
      .catch(error => markFinalizeFailure(record, error, false))
      .finally(() => {
        const current = capabilities.get(record.id)
        if (current !== capability) return
        capability.settling = null
        scheduleMonitor(record, capability.nextDelay)
      })
    return capability.settling
  }

  async function settleTerminal (record, action, patch, failurePrefix) {
    const capability = capabilities.get(record.id)
    if (!capability) return { ...record }
    if (capability.settling) return capability.settling
    clearMonitor(capability)
    capability.settling = Promise.resolve()
      .then(action)
      .then(result => {
        if (result === false) throw new Error('事务终态回调返回失败。')
        return finishTerminal(record, patch)
      })
      .catch(error => finishTerminal(record, {
        status: 'unknown',
        interrupted: true,
        message: `${failurePrefix}：${safeMessage(error, '未知错误')}`
      }))
    return capability.settling
  }

  async function interrupt (record, message) {
    const capability = capabilities.get(record.id)
    return settleTerminal(
      record,
      () => capability?.cancel(message),
      { status: 'unknown', interrupted: true, message },
      '后台任务中断收口失败'
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

  async function checkStatus (record, capability) {
    try {
      const exit = await readExit(record)
      if (!isCurrentCapability(record, capability)) return { ...record }
      if (exit.present) {
        if (exit.exitCode === undefined) {
          return interrupt(record, '后台任务退出码无效，执行已标记为中断。')
        }
        return finalize(record, exit.exitCode)
      }
      const pidOutput = await readFile(record.tabId, record.pidFile)
      if (!isCurrentCapability(record, capability)) return { ...record }
      const pid = parsePid(pidOutput)
      if (!pid) {
        if (currentTime() - record.startTime <= launchGraceMs) {
          record.status = 'starting'
          return { ...record }
        }
        return interrupt(record, '后台任务 PID 无效或已丢失，执行结果未知。')
      }
      const alive = await isAlive(record.tabId, pid)
      if (!isCurrentCapability(record, capability)) return { ...record }
      if (alive) {
        record.status = 'running'
        record.pid = pid
        return { ...record }
      }
      const lateExit = await readExit(record)
      if (!isCurrentCapability(record, capability)) return { ...record }
      if (lateExit.exitCode !== undefined) return finalize(record, lateExit.exitCode)
      return interrupt(record, '后台进程已退出但没有可靠退出码，执行已标记为中断。')
    } catch (error) {
      if (!isCurrentCapability(record, capability)) return { ...record }
      return interrupt(
        record,
        `后台任务状态检查失败：${safeMessage(error, '未知错误')}`
      )
    }
  }

  async function status (taskId) {
    pruneTerminalRecords()
    const record = records.get(String(taskId))
    if (!record) return unknownTask(taskId)
    const capability = capabilities.get(record.id)
    if (!capability) return { ...record }
    if (capability.checking) return capability.checking
    capability.checking = Promise.resolve()
      .then(() => checkStatus(record, capability))
      .finally(() => {
        if (capabilities.get(record.id) === capability) {
          capability.checking = null
        }
      })
    return capability.checking
  }

  async function monitor (taskId) {
    const record = records.get(String(taskId))
    const capability = record && capabilities.get(record.id)
    if (!record || !capability) return
    if (currentTime() - capability.monitorStartedAt >= monitorTimeoutMs) {
      await interrupt(record, '后台任务监控超时，事务已停止跟踪并标记为中断。')
      return
    }
    await status(record.id)
    const current = capabilities.get(record.id)
    if (current) scheduleMonitor(record, current.nextDelay)
  }

  function handleLifecycleEnd (record, outcome, error) {
    const capability = capabilities.get(record.id)
    if (!capability || capability.settling) return
    if (!error && !outcome?.cancelled && !outcome?.error &&
      !(Number.isInteger(outcome?.exitCode) && outcome.exitCode !== 0)) return
    const reason = safeMessage(
      error || { message: outcome?.error },
      '后台启动执行已中断。'
    )
    finishTerminal(record, {
      status: 'unknown',
      interrupted: true,
      message: `后台任务生命周期已中断：${reason}`
    })
  }

  function register (task) {
    if (!task?.id || !task.operationId || typeof task.finalize !== 'function' ||
      typeof task.cancel !== 'function') {
      throw new Error('后台任务记录不完整。')
    }
    pruneTerminalRecords()
    const id = String(task.id)
    if (records.has(id)) throw new Error('后台任务标识已存在。')
    const time = currentTime()
    const record = {
      id,
      operationId: String(task.operationId),
      tabId: String(task.tabId),
      command: String(task.command),
      startTime: Number(task.startTime ?? time),
      logFile: String(task.logFile),
      pidFile: String(task.pidFile),
      exitFile: String(task.exitFile),
      status: 'started'
    }
    const capability = {
      finalize: task.finalize,
      cancel: task.cancel,
      settling: null,
      checking: null,
      timer: null,
      nextDelay: monitorInitialDelayMs,
      monitorStartedAt: time,
      onTerminal: task.onTerminal
    }
    records.set(record.id, record)
    capabilities.set(record.id, capability)
    if (task.completion?.then) {
      Promise.resolve(task.completion)
        .then(outcome => handleLifecycleEnd(record, outcome))
        .catch(error => handleLifecycleEnd(record, undefined, error))
    }
    try {
      scheduleMonitor(record, monitorInitialDelayMs)
    } catch (error) {
      records.delete(record.id)
      capabilities.delete(record.id)
      throw error
    }
    return { ...record }
  }

  async function cancel (taskId) {
    pruneTerminalRecords()
    const record = records.get(String(taskId))
    if (!record) {
      return unknownTask(taskId, '后台任务上下文已丢失，无法确认取消结果。')
    }
    const capability = capabilities.get(record.id)
    if (!capability) return { ...record }
    try {
      const exit = await readExit(record)
      if (exit.exitCode !== undefined) return finalize(record, exit.exitCode)
      const pid = parsePid(await readFile(record.tabId, record.pidFile))
      if (!pid) return interrupt(record, '后台任务 PID 无效，事务已取消并标记为中断。')
      const killed = await kill(record.tabId, pid)
      if (killed === true) {
        return settleTerminal(
          record,
          () => capability.cancel('用户取消了后台任务。'),
          { status: 'cancelled', pid, message: '后台进程已终止，事务已取消。' },
          '后台任务取消收口失败'
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
    pruneTerminalRecords()
    const record = records.get(String(taskId))
    return record ? { ...record } : undefined
  }

  function list () {
    pruneTerminalRecords()
    return [...records.values()]
      .sort((left, right) => right.startTime - left.startTime || left.id.localeCompare(right.id))
      .map(record => ({ ...record }))
  }

  return { register, get, list, status, cancel }
}
