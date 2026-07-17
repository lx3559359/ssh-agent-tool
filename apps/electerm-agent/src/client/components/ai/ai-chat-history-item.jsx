import { memo, useState, useEffect, useRef, useCallback } from 'react'
import AIOutput from './ai-output'
import AIStopIcon from './ai-stop-icon'
import AgentToolCallCard from './agent-tool-call-card'
import { cancelAgentRun, isAgentRunActive, runAgentLoop } from './agent'
import {
  Alert,
  Dropdown
} from 'antd'
import {
  CopyOutlined,
  CloseOutlined,
  DownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import download from '../../common/download'
import { normalizeAsyncResult } from '../../common/async-result.js'
import aiAgentCopy from './ai-agent-copy.json'
import uid from '../../common/uid'
import { buildAgentCancellationUpdate } from './agent-cancellation-status.js'
import { buildAgentDiagnosticReportFiles } from './agent-diagnostic-report'
import {
  appendAIChatHistory,
  buildAIChatRole,
  createRetryChatEntry,
  getAIChatCopyText,
  getInterruptedAIChatUpdate,
  getAIChatRequestId,
  getAIChatStreamSessionId,
  updateAIChatHistoryEntry
} from './ai-chat-actions'
import { buildAIConversationMessages } from './ai-conversation-context'
import {
  createAIStoredTextAccumulator,
  createAIRequestCredentialReference,
  resolveAIRequestConfigForProfile,
  sanitizeAIStoredText
} from './ai-request-credentials'

export function buildAIRequestFailureText (error, existingResponse = '') {
  const errorText = `**${aiAgentCopy.errorLabel}:** ${sanitizeAIStoredText(error)}`
  const partial = String(existingResponse || '').trim()
  return partial ? `${partial}\n\n${errorText}` : errorText
}

export async function consumeAIStreamPoll ({
  request,
  isActive,
  onResponse,
  onError,
  onInactiveResponse,
  onInactiveError
}) {
  const rawResult = await request()
  const result = normalizeAsyncResult(rawResult)
  if (!isActive()) {
    if (result.ok && onInactiveResponse) {
      await onInactiveResponse(result.data)
    } else if (!result.ok && onInactiveError) {
      await onInactiveError(result.error, rawResult)
    }
    return result
  }
  if (!result.ok) {
    if (rawResult?.content && onResponse) {
      onResponse({ ...rawResult, error: undefined, hasMore: false })
    }
    onError(result.error)
    return result
  }
  onResponse(result.data)
  return result
}

export async function consumeAIChatRequest (options) {
  return consumeAIStreamPoll(options)
}

export async function stopAIStreamSafely ({
  sessionId,
  stopStream,
  onError = error => console.error('Error stopping stream:', error)
}) {
  if (!sessionId) {
    return false
  }
  try {
    await stopStream(sessionId)
    return true
  } catch (error) {
    onError(error)
    return false
  }
}

const detachedAIStreams = new Map()
const DETACHED_STREAM_POLL_DELAY = 200

export function shouldApplyAIChatAsyncUpdate (store, chatId) {
  const latest = store?.aiChatHistory?.find(chat => chat.id === chatId)
  return latest?.completionStatus === 'running'
}

export function isDetachedAIStreamActive (chatId) {
  return detachedAIStreams.has(chatId)
}

export function cancelDetachedAIStream (chatId) {
  const active = detachedAIStreams.get(chatId)
  if (!active) return false
  active.cancelled = true
  detachedAIStreams.delete(chatId)
  return true
}

function mergeAIStreamResponse (streamResponse, state) {
  if (streamResponse.incremental) {
    if (streamResponse.offset !== state.cursor) {
      throw new Error('AI 流式响应游标不连续，请重试。')
    }
    state.rawContent += streamResponse.content || ''
    state.cursor = streamResponse.nextOffset
  } else {
    state.rawContent = streamResponse.content || ''
    state.cursor = state.rawContent.length
  }
}

export function startDetachedAIStream ({
  chatId,
  sessionId,
  store,
  initialContent = '',
  initialOffset = 0,
  request = (sid, offset) => window.pre.runGlobalAsync(
    'getStreamContent',
    sid,
    offset
  )
}) {
  if (!chatId || !sessionId || !store) return null
  const existing = detachedAIStreams.get(chatId)
  if (existing?.sessionId === sessionId) return existing.promise
  if (existing) existing.cancelled = true

  const active = {
    sessionId,
    cancelled: false,
    promise: null
  }
  detachedAIStreams.set(chatId, active)
  active.promise = (async () => {
    const state = {
      rawContent: initialContent,
      cursor: Math.max(0, Number(initialOffset) || 0)
    }
    const sanitizer = createAIStoredTextAccumulator()
    while (!active.cancelled && shouldApplyAIChatAsyncUpdate(store, chatId)) {
      const rawResult = await request(sessionId, state.cursor)
      if (active.cancelled || !shouldApplyAIChatAsyncUpdate(store, chatId)) break
      const result = normalizeAsyncResult(rawResult)
      if (!result.ok) {
        if (rawResult?.content) {
          mergeAIStreamResponse({
            ...rawResult,
            error: undefined,
            hasMore: false
          }, state)
        }
        updateAIChatHistoryEntry(store, chatId, {
          response: buildAIRequestFailureText(result.error, state.rawContent),
          completionStatus: 'failed',
          requestId: ''
        })
        break
      }

      const streamResponse = result.data
      mergeAIStreamResponse(streamResponse, state)
      if (!shouldApplyAIChatAsyncUpdate(store, chatId)) break
      updateAIChatHistoryEntry(store, chatId, {
        response: sanitizer.sanitize(state.rawContent, {
          final: !streamResponse.hasMore
        }),
        completionStatus: streamResponse.hasMore ? 'running' : 'completed',
        requestId: ''
      }, { sanitized: true })
      if (!streamResponse.hasMore) break
      await new Promise(resolve => setTimeout(resolve, DETACHED_STREAM_POLL_DELAY))
    }
  })().catch(error => {
    if (!active.cancelled && shouldApplyAIChatAsyncUpdate(store, chatId)) {
      const latest = store.aiChatHistory?.find(chat => chat.id === chatId)
      updateAIChatHistoryEntry(store, chatId, {
        response: buildAIRequestFailureText(error?.message || error, latest?.response),
        completionStatus: 'failed',
        requestId: ''
      })
      store.onError?.(error)
    }
  }).finally(() => {
    if (detachedAIStreams.get(chatId) === active) {
      detachedAIStreams.delete(chatId)
    }
  })
  return active.promise
}

export default memo(function AIChatHistoryItem ({
  item,
  config,
  agentRunning
}) {
  const [isStreaming, setIsStreaming] = useState(
    item.completionStatus === 'running'
  )
  const requestIsRunning = item.completionStatus === 'running' && isStreaming
  const abortRef = useRef(false)
  const mountedRef = useRef(true)
  const pollTimerRef = useRef(null)
  const requestEpochRef = useRef(0)
  const initialRequestIdRef = useRef('')
  const streamSanitizerRef = useRef(createAIStoredTextAccumulator())
  const streamCursorRef = useRef(0)
  const streamRawContentRef = useRef('')
  const streamPollingRef = useRef('')
  const {
    prompt,
    modelAI,
    roleAI,
    credentialTokenAI,
    aiProfileId,
    credentialRevisionAI,
    languageAI,
    mode,
    toolCalls
  } = item
  const visiblePrompt = item.displayPrompt || prompt
  const requestConfig = resolveAIRequestConfigForProfile(
    credentialTokenAI,
    aiProfileId,
    credentialRevisionAI,
    config || {}
  )
  const {
    apiKeyAI = '',
    baseURLAI = '',
    apiPathAI = '',
    authHeaderNameAI = '',
    proxyAI = '',
    mcpServers = []
  } = requestConfig

  function buildRole () {
    return buildAIChatRole({
      roleAI,
      languageAI,
      getLangName: () => window.store.getLangName()
    })
  }

  function markRequestFailed (error) {
    if (!shouldApplyAIChatAsyncUpdate(window.store, item.id)) return
    const safeError = sanitizeAIStoredText(error?.message || error)
    const latest = window.store.aiChatHistory?.find(chat => chat.id === item.id)
    updateAIChatHistoryEntry(window.store, item.id, {
      response: buildAIRequestFailureText(safeError, latest?.response || item.response),
      completionStatus: 'failed',
      requestId: ''
    })
    if (mountedRef.current) setIsStreaming(false)
    window.store.onError(new Error(safeError))
  }

  const pollStreamContent = useCallback(async (sid, requestEpoch) => {
    const isActive = () => (
      mountedRef.current && requestEpochRef.current === requestEpoch
    )
    try {
      await consumeAIStreamPoll({
        request: () => window.pre.runGlobalAsync(
          'getStreamContent',
          sid,
          streamCursorRef.current
        ),
        isActive,
        onInactiveError: (error, streamResponse) => {
          if (!shouldApplyAIChatAsyncUpdate(window.store, item.id)) return
          let partial = streamRawContentRef.current
          if (streamResponse?.content) {
            partial = streamResponse.incremental
              ? partial + streamResponse.content
              : streamResponse.content
          }
          const latest = window.store.aiChatHistory?.find(chat => chat.id === item.id)
          updateAIChatHistoryEntry(window.store, item.id, {
            response: buildAIRequestFailureText(error, partial || latest?.response),
            completionStatus: 'failed',
            requestId: ''
          })
        },
        onInactiveResponse: streamResponse => {
          if (!shouldApplyAIChatAsyncUpdate(window.store, item.id)) return
          const state = {
            rawContent: streamRawContentRef.current,
            cursor: streamCursorRef.current
          }
          mergeAIStreamResponse(streamResponse, state)
          streamRawContentRef.current = state.rawContent
          streamCursorRef.current = state.cursor
          const response = streamSanitizerRef.current.sanitize(
            streamRawContentRef.current,
            { final: !streamResponse.hasMore }
          )
          updateAIChatHistoryEntry(window.store, item.id, {
            response,
            completionStatus: streamResponse.hasMore ? 'running' : 'completed',
            requestId: ''
          }, { sanitized: true })
          if (streamResponse.hasMore) {
            startDetachedAIStream({
              chatId: item.id,
              sessionId: sid,
              store: window.store,
              initialContent: state.rawContent,
              initialOffset: state.cursor
            })
          }
        },
        onError: error => {
          streamPollingRef.current = ''
          markRequestFailed(error)
        },
        onResponse: streamResponse => {
          const state = {
            rawContent: streamRawContentRef.current,
            cursor: streamCursorRef.current
          }
          mergeAIStreamResponse(streamResponse, state)
          streamRawContentRef.current = state.rawContent
          streamCursorRef.current = state.cursor
          const response = streamSanitizerRef.current.sanitize(
            streamRawContentRef.current,
            { final: !streamResponse.hasMore }
          )
          updateAIChatHistoryEntry(window.store, item.id, {
            response,
            completionStatus: streamResponse.hasMore ? 'running' : 'completed',
            requestId: ''
          }, { sanitized: true })
          setIsStreaming(streamResponse.hasMore)
          if (streamResponse.hasMore) {
            pollTimerRef.current = setTimeout(
              () => pollStreamContent(sid, requestEpoch),
              200
            )
          } else {
            pollTimerRef.current = null
            streamPollingRef.current = ''
          }
        }
      })
    } catch (error) {
      if (!isActive()) {
        if (shouldApplyAIChatAsyncUpdate(window.store, item.id)) {
          markRequestFailed(error)
        }
        return
      }
      markRequestFailed(error)
    }
  }, [item.id])

  const resumeStreamSession = useCallback((sid) => {
    if (!sid || streamPollingRef.current === sid) return
    streamPollingRef.current = sid
    streamSanitizerRef.current.reset()
    streamCursorRef.current = 0
    streamRawContentRef.current = ''
    const requestEpoch = requestEpochRef.current + 1
    requestEpochRef.current = requestEpoch
    setIsStreaming(true)
    pollStreamContent(sid, requestEpoch)
  }, [pollStreamContent])

  const startRequest = useCallback(async () => {
    const requestEpoch = requestEpochRef.current + 1
    requestEpochRef.current = requestEpoch
    const isActive = () => (
      mountedRef.current && requestEpochRef.current === requestEpoch
    )
    if (!baseURLAI || !apiKeyAI) {
      markRequestFailed('历史 API 凭据已失效，请选择当前 API 配置后重新发送')
      return
    }
    const requestId = `chat-${item.id}-${requestEpoch}-${uid()}`
    streamSanitizerRef.current.reset()
    streamCursorRef.current = 0
    streamRawContentRef.current = ''
    initialRequestIdRef.current = requestId
    setIsStreaming(true)
    updateAIChatHistoryEntry(window.store, item.id, {
      completionStatus: 'running',
      requestId
    })
    try {
      const conversationMessages = buildAIConversationMessages(window.store.aiChatHistory, item)
      await consumeAIChatRequest({
        request: () => window.pre.runGlobalAsync(
          'AIchat',
          conversationMessages,
          modelAI,
          buildRole(),
          baseURLAI,
          apiPathAI,
          apiKeyAI,
          proxyAI,
          true,
          authHeaderNameAI,
          requestId
        ),
        isActive,
        onError: error => {
          markRequestFailed(error)
        },
        onInactiveError: error => {
          if (shouldApplyAIChatAsyncUpdate(window.store, item.id)) markRequestFailed(error)
        },
        onInactiveResponse: aiResponse => {
          if (!shouldApplyAIChatAsyncUpdate(window.store, item.id)) return
          if (aiResponse?.isStream && aiResponse.sessionId) {
            const initialContent = aiResponse.content || ''
            updateAIChatHistoryEntry(window.store, item.id, {
              sessionId: aiResponse.sessionId,
              response: sanitizeAIStoredText(initialContent),
              completionStatus: 'running',
              requestId: ''
            })
            startDetachedAIStream({
              chatId: item.id,
              sessionId: aiResponse.sessionId,
              store: window.store,
              initialContent,
              initialOffset: initialContent.length
            })
          } else if (aiResponse && Object.prototype.hasOwnProperty.call(aiResponse, 'response')) {
            updateAIChatHistoryEntry(window.store, item.id, {
              response: aiResponse.response || '',
              completionStatus: 'completed',
              requestId: ''
            })
          }
        },
        onResponse: aiResponse => {
          if (aiResponse.isStream && aiResponse.sessionId) {
            setIsStreaming(true)
            streamPollingRef.current = aiResponse.sessionId
            streamRawContentRef.current = aiResponse.content || ''
            streamCursorRef.current = streamRawContentRef.current.length
            const response = streamSanitizerRef.current.sanitize(
              streamRawContentRef.current
            )
            updateAIChatHistoryEntry(window.store, item.id, {
              sessionId: aiResponse.sessionId,
              response,
              completionStatus: 'running',
              requestId: ''
            }, { sanitized: true })
            pollStreamContent(aiResponse.sessionId, requestEpoch)
          } else if (aiResponse && Object.prototype.hasOwnProperty.call(aiResponse, 'response')) {
            updateAIChatHistoryEntry(window.store, item.id, {
              response: aiResponse.response || '',
              completionStatus: 'completed',
              requestId: ''
            })
          }
        }
      })
    } catch (error) {
      if (!isActive()) {
        if (shouldApplyAIChatAsyncUpdate(window.store, item.id)) {
          markRequestFailed(error)
        }
        return
      }
      markRequestFailed(error)
    } finally {
      if (initialRequestIdRef.current === requestId) {
        initialRequestIdRef.current = ''
      }
    }
  }, [prompt, modelAI, baseURLAI, apiPathAI, apiKeyAI, authHeaderNameAI, proxyAI, item.id, pollStreamContent])

  const startAgentRequest = useCallback(async () => {
    if (!baseURLAI || !apiKeyAI) {
      markRequestFailed('历史 API 凭据已失效，请选择当前 API 配置后重新发送')
      return
    }
    abortRef.current = false
    const config = {
      modelAI,
      roleAI,
      baseURLAI,
      apiPathAI,
      apiKeyAI,
      authHeaderNameAI,
      proxyAI,
      languageAI,
      mcpServers
    }
    await runAgentLoop(item, config, abortRef, value => {
      if (mountedRef.current) {
        setIsStreaming(value)
      }
    }, window.store.aiChatHistory)
  }, [modelAI, roleAI, baseURLAI, apiPathAI, apiKeyAI, authHeaderNameAI, proxyAI, languageAI, mcpServers, item.id])

  useEffect(() => {
    mountedRef.current = true
    const interruptedUpdate = getInterruptedAIChatUpdate(item)
    if (
      interruptedUpdate &&
      !(mode === 'agent' && isAgentRunActive(item.id))
    ) {
      updateAIChatHistoryEntry(window.store, item.id, interruptedUpdate)
      setIsStreaming(false)
    } else if (item.pending) {
      updateAIChatHistoryEntry(window.store, item.id, {
        pending: false,
        completionStatus: 'running'
      })
      if (mode === 'agent') {
        startAgentRequest()
      } else {
        startRequest()
      }
    }

    return () => {
      const latest = window.store.aiChatHistory?.find(chat => chat.id === item.id)
      const activeSessionId = getAIChatStreamSessionId(item, window.store)
      if (
        mode !== 'agent' &&
        latest?.completionStatus === 'running' &&
        activeSessionId
      ) {
        startDetachedAIStream({
          chatId: item.id,
          sessionId: activeSessionId,
          store: window.store,
          initialContent: streamRawContentRef.current,
          initialOffset: streamCursorRef.current
        })
      }
      mountedRef.current = false
      requestEpochRef.current += 1
      streamPollingRef.current = ''
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (
      mode !== 'agent' &&
      item.completionStatus === 'running' &&
      item.sessionId &&
      !isDetachedAIStreamActive(item.id)
    ) {
      resumeStreamSession(item.sessionId)
    }
  }, [item.sessionId, item.completionStatus, mode, resumeStreamSession])

  useEffect(() => {
    setIsStreaming(item.completionStatus === 'running')
  }, [item.completionStatus])

  async function handleStop (e) {
    e.stopPropagation()
    const latest = window.store.aiChatHistory?.find(chat => chat.id === item.id)
    if (latest?.completionStatus !== 'running') {
      setIsStreaming(false)
      return
    }
    if (mode === 'agent') {
      abortRef.current = true
      setIsStreaming(false)
      let cancellationError
      if (abortRef.cancelCurrent) {
        await abortRef.cancelCurrent().catch(error => {
          cancellationError = error
          window.store.onError?.(error)
        })
      } else {
        await cancelAgentRun(item.id).catch(error => {
          cancellationError = error
          window.store.onError?.(error)
        })
      }
      const current = window.store.aiChatHistory?.find(chat => chat.id === item.id)
      updateAIChatHistoryEntry(window.store, item.id, buildAgentCancellationUpdate({
        response: current?.response || item.response,
        stoppedText: aiAgentCopy.stoppedText,
        error: cancellationError && sanitizeAIStoredText(
          cancellationError?.message || cancellationError
        )
      }))
      return
    }
    requestEpochRef.current += 1
    cancelDetachedAIStream(item.id)
    streamPollingRef.current = ''
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    const initialRequestId = getAIChatRequestId(item, window.store) || initialRequestIdRef.current
    setIsStreaming(false)
    updateAIChatHistoryEntry(window.store, item.id, {
      completionStatus: 'cancelled',
      requestId: ''
    })
    initialRequestIdRef.current = ''
    if (initialRequestId) {
      try {
        await window.pre.runGlobalAsync('AIChatCancel', initialRequestId)
      } catch (error) {
        console.error('Error cancelling AI request:', error)
      }
    }
    const activeSessionId = getAIChatStreamSessionId(item, window.store)
    if (!activeSessionId) return

    try {
      await window.pre.runGlobalAsync('stopStream', activeSessionId)
    } catch (error) {
      console.error('Error stopping stream:', error)
    }
  }

  function renderStopButton () {
    if (!requestIsRunning) {
      return null
    }
    return (
      <AIStopIcon
        onClick={handleStop}
        title={aiAgentCopy.stopTitle}
      />
    )
  }

  const reportExportItems = [
    {
      key: 'markdown',
      label: 'Markdown'
    },
    {
      key: 'html',
      label: 'HTML'
    },
    {
      key: 'json',
      label: 'JSON'
    }
  ]

  async function handleExportReport (format, e) {
    e?.stopPropagation?.()
    const files = buildAgentDiagnosticReportFiles({ item })
    const file = files[format]
    if (!file) {
      return
    }
    await download(file.filename, file.content)
  }

  function renderReportExportAction () {
    return (
      <Dropdown
        menu={{
          items: reportExportItems,
          onClick: ({ key, domEvent }) => handleExportReport(key, domEvent)
        }}
        trigger={['click']}
      >
        <DownloadOutlined
          className='pointer mg1l'
          onClick={e => e.stopPropagation()}
          title='导出诊断报告'
        />
      </Dropdown>
    )
  }

  const retryDisabled = requestIsRunning || (
    mode === 'agent' && agentRunning
  )
  const alertProps = {
    title: (
      <div className='ai-history-item-title'>

        <span className='ai-history-item-prompt'>{visiblePrompt}</span>
        <span className='ai-history-item-actions'>
          <CopyOutlined
            className='pointer'
            onClick={handleCopyAnswer}
            title={aiAgentCopy.copyAnswerTitle}
          />
          <ReloadOutlined
            className={retryDisabled ? 'mg1l disabled' : 'pointer mg1l'}
            onClick={handleRetry}
            title={retryDisabled ? '当前任务运行中，暂时不能重试' : aiAgentCopy.retryTitle}
          />
          {renderReportExportAction()}
          <CloseOutlined
            className='pointer mg1l'
            onClick={handleDel}
            title={aiAgentCopy.deleteTitle}
          />
        </span>
      </div>
    ),
    type: 'info'
  }

  async function handleDel (e) {
    e.stopPropagation()
    if (requestIsRunning || item.completionStatus === 'running') {
      await handleStop(e)
    }
    window.store.removeAiHistory(item.id)
  }

  function handleCopyAnswer (e) {
    e.stopPropagation()
    copy(getAIChatCopyText(item))
  }

  function handleRetry (e) {
    e.stopPropagation()
    if (retryDisabled) {
      return
    }
    const retryEntry = {
      ...createRetryChatEntry(item, {
        id: uid(),
        timestamp: Date.now()
      }),
      ...createAIRequestCredentialReference({
        ...requestConfig,
        id: aiProfileId,
        credentialRevisionAI
      })
    }
    appendAIChatHistory(window.store, retryEntry)
  }

  function renderToolCalls () {
    if (mode !== 'agent' || !toolCalls || !toolCalls.length) {
      return null
    }
    return (
      <div className='agent-tool-calls'>
        {toolCalls.map((tc) => (
          <AgentToolCallCard key={tc.id} toolCall={tc} />
        ))}
      </div>
    )
  }

  return (
    <div className='chat-history-item'>
      <div className='mg1y'>
        <Alert {...alertProps} />
      </div>
      {renderToolCalls()}
      <AIOutput item={item} isStreaming={requestIsRunning} />
      {renderStopButton()}
    </div>
  )
})
