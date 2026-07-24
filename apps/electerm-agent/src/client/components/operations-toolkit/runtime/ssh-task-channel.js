import {
  buildCancelRemoteTaskCommand,
  buildCleanupRemoteTaskCommand,
  buildPollRemoteTaskCommand,
  buildPrepareRemoteTaskCommand,
  buildStartRemoteTaskCommand,
  parseRemoteTaskPoll
} from './remote-task-envelope.js'

function commandOutput (result) {
  if (typeof result === 'string') return result
  return [result?.stdout, result?.stderr].filter(Boolean).join('\n')
}

function decodeUtf8Base64 (value) {
  if (!value) return ''
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function abortError () {
  const error = new Error('运维任务已取消')
  error.name = 'AbortError'
  return error
}

function timeoutError () {
  const error = new Error('运维任务执行超时')
  error.name = 'TimeoutError'
  return error
}

export function createSshTaskChannel ({
  runCmd,
  cancelRunCmd,
  pollDelay = 300,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now
} = {}) {
  if (typeof runCmd !== 'function' || typeof cancelRunCmd !== 'function') {
    throw new Error('SSH 运维任务通道缺少执行或取消接口')
  }
  let sequence = 0

  return Object.freeze({
    async execute ({
      pid,
      taskId,
      script,
      timeoutMs = 60000,
      signal,
      onChunk = () => {}
    }) {
      const startedAt = now()
      let activeExecutionId = ''
      const invoke = async (
        command,
        phase,
        maxOutputBytes = 512 * 1024,
        ignoreAbort = false
      ) => {
        if (!ignoreAbort && signal?.aborted) throw abortError()
        const executionId = `${taskId}-${phase}-${++sequence}`
        activeExecutionId = executionId
        const cancelActive = () => {
          Promise.resolve(cancelRunCmd(pid, executionId)).catch(() => {})
        }
        signal?.addEventListener('abort', cancelActive, { once: true })
        try {
          return await runCmd(pid, command, {
            executionId,
            timeoutMs: Math.min(timeoutMs, 15000),
            maxOutputBytes
          })
        } finally {
          signal?.removeEventListener('abort', cancelActive)
          if (activeExecutionId === executionId) activeExecutionId = ''
        }
      }
      const cancelRemote = async () => {
        if (activeExecutionId) {
          await Promise.resolve(
            cancelRunCmd(pid, activeExecutionId)
          ).catch(() => {})
        }
        await Promise.resolve(invoke(
          buildCancelRemoteTaskCommand(taskId),
          'cancel',
          32 * 1024,
          true
        )).catch(() => {})
      }

      try {
        await invoke(
          buildPrepareRemoteTaskCommand(taskId, script),
          'prepare'
        )
        await invoke(buildStartRemoteTaskCommand(taskId), 'start')
        let offset = 0
        while (true) {
          if (signal?.aborted) throw abortError()
          if (now() - startedAt > timeoutMs) throw timeoutError()
          const raw = await invoke(
            buildPollRemoteTaskCommand(taskId, offset),
            'poll'
          )
          const poll = parseRemoteTaskPoll(commandOutput(raw))
          if (poll.data) onChunk(decodeUtf8Base64(poll.data))
          offset = Math.max(offset, poll.nextOffset)
          if (poll.exitCode !== null && offset >= poll.size) {
            return {
              exitCode: poll.exitCode,
              bytes: offset
            }
          }
          await sleep(pollDelay)
        }
      } catch (error) {
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
          await cancelRemote()
        }
        throw error
      } finally {
        await Promise.resolve(invoke(
          buildCleanupRemoteTaskCommand(taskId),
          'cleanup',
          32 * 1024,
          true
        )).catch(() => {})
      }
    }
  })
}
