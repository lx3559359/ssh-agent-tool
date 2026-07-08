import { useState, useEffect, useRef, useCallback } from 'react'
import AIOutput from './ai-output'
import AIStopIcon from './ai-stop-icon'
import AgentToolCallCard from './agent-tool-call-card'
import { runAgentLoop } from './agent'
import {
  Alert,
  Dropdown,
  Tooltip
} from 'antd'
import {
  CopyOutlined,
  CloseOutlined,
  DownloadOutlined,
  ReloadOutlined,
  CaretDownOutlined,
  CaretRightOutlined
} from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import download from '../../common/download'
import aiAgentCopy from './ai-agent-copy.json'
import uid from '../../common/uid'
import { buildAgentDiagnosticReportFiles } from './agent-diagnostic-report'
import {
  appendAIChatHistory,
  buildAIChatRole,
  createRetryChatEntry,
  getAIChatCopyText,
  getAIChatStreamSessionId
} from './ai-chat-actions'

export default function AIChatHistoryItem ({ item }) {
  const [showOutput, setShowOutput] = useState(true)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef(false)
  const {
    prompt,
    nameAI,
    modelAI,
    roleAI,
    baseURLAI,
    apiPathAI,
    apiKeyAI,
    authHeaderNameAI,
    proxyAI,
    languageAI,
    mode,
    toolCalls
  } = item

  function toggleOutput () {
    setShowOutput(!showOutput)
  }

  function buildRole () {
    return buildAIChatRole({
      roleAI,
      languageAI,
      getLangName: () => window.store.getLangName()
    })
  }

  const pollStreamContent = useCallback(async (sid) => {
    try {
      const streamResponse = await window.pre.runGlobalAsync('getStreamContent', sid)

      if (streamResponse && streamResponse.error) {
        if (streamResponse.error === 'Session not found') {
          return
        }
        window.store.removeAiHistory(item.id)
        return window.store.onError(new Error(streamResponse.error))
      }

      const index = window.store.aiChatHistory.findIndex(i => i.id === item.id)
      if (index !== -1) {
        window.store.aiChatHistory[index].response = streamResponse.content || ''
        window.store.aiChatHistory = [...window.store.aiChatHistory]
      }
      setIsStreaming(streamResponse.hasMore)
      if (streamResponse.hasMore) {
        setTimeout(() => pollStreamContent(sid), 200)
      }
    } catch (error) {
      window.store.removeAiHistory(item.id)
      window.store.onError(error)
    }
  }, [item.id])

  const startRequest = useCallback(async () => {
    try {
      const aiResponse = await window.pre.runGlobalAsync(
        'AIchat',
        prompt,
        modelAI,
        buildRole(),
        baseURLAI,
        apiPathAI,
        apiKeyAI,
        proxyAI,
        true,
        authHeaderNameAI
      )

      if (aiResponse && aiResponse.error) {
        window.store.removeAiHistory(item.id)
        return window.store.onError(new Error(aiResponse.error))
      }

      if (aiResponse && aiResponse.isStream && aiResponse.sessionId) {
        setIsStreaming(true)
        const index = window.store.aiChatHistory.findIndex(i => i.id === item.id)
        if (index !== -1) {
          window.store.aiChatHistory[index].sessionId = aiResponse.sessionId
          window.store.aiChatHistory[index].response = aiResponse.content || ''
        }
        pollStreamContent(aiResponse.sessionId)
      } else if (aiResponse && aiResponse.response) {
        const index = window.store.aiChatHistory.findIndex(i => i.id === item.id)
        if (index !== -1) {
          window.store.aiChatHistory[index].response = aiResponse.response
        }
      }
    } catch (error) {
      window.store.removeAiHistory(item.id)
      window.store.onError(error)
    }
  }, [prompt, modelAI, baseURLAI, apiPathAI, apiKeyAI, authHeaderNameAI, proxyAI, item.id, pollStreamContent])

  const startAgentRequest = useCallback(async () => {
    abortRef.current = false
    const config = {
      modelAI,
      roleAI,
      baseURLAI,
      apiPathAI,
      apiKeyAI,
      authHeaderNameAI,
      proxyAI,
      languageAI
    }
    await runAgentLoop(item, config, abortRef, setIsStreaming)
  }, [modelAI, roleAI, baseURLAI, apiPathAI, apiKeyAI, authHeaderNameAI, proxyAI, languageAI, item.id])

  useEffect(() => {
    if (item.pending) {
      const index = window.store.aiChatHistory.findIndex(i => i.id === item.id)
      if (index !== -1) {
        window.store.aiChatHistory[index].pending = false
      }
      if (mode === 'agent') {
        startAgentRequest()
      } else {
        startRequest()
      }
    }
  }, [])

  async function handleStop (e) {
    e.stopPropagation()
    if (mode === 'agent') {
      abortRef.current = true
      setIsStreaming(false)
      return
    }
    const activeSessionId = getAIChatStreamSessionId(item, window.store)
    if (!activeSessionId) return

    try {
      await window.pre.runGlobalAsync('stopStream', activeSessionId)
      setIsStreaming(false)
    } catch (error) {
      console.error('Error stopping stream:', error)
    }
  }

  function renderStopButton () {
    if (!isStreaming) {
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

  const alertProps = {
    title: (
      <div className='ai-history-item-title'>
        <span className='pointer mg1r' onClick={toggleOutput}>
          {showOutput ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
        <span className='ai-history-item-prompt'>{prompt}</span>
        <span className='ai-history-item-actions'>
          <CopyOutlined
            className='pointer'
            onClick={handleCopyAnswer}
            title={aiAgentCopy.copyAnswerTitle}
          />
          <ReloadOutlined
            className='pointer mg1l'
            onClick={handleRetry}
            title={aiAgentCopy.retryTitle}
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

  function handleDel (e) {
    e.stopPropagation()
    window.store.removeAiHistory(item.id)
  }

  function handleCopyPrompt (e) {
    e.stopPropagation()
    copy(prompt)
  }

  function handleCopyAnswer (e) {
    e.stopPropagation()
    copy(getAIChatCopyText(item))
  }

  function handleRetry (e) {
    e.stopPropagation()
    const retryEntry = createRetryChatEntry(item, {
      id: uid(),
      timestamp: Date.now()
    })
    appendAIChatHistory(window.store, retryEntry)
  }

  function renderTitle () {
    return (
      <div>
        {nameAI && (
          <p>
            <b>名称：</b> {nameAI}
          </p>
        )}
        <p>
          <b>模型：</b> {modelAI}
        </p>
        <p>
          <b>角色：</b> {roleAI}
        </p>
        <p>
          <b>基础地址：</b> {baseURLAI}
        </p>
        <p>
          <b>时间：</b> {new Date(item.timestamp).toLocaleString()}
        </p>
        <p>
          <CopyOutlined
            className='pointer'
            onClick={handleCopyPrompt}
            title={aiAgentCopy.copyPromptTitle}
          />
          <CopyOutlined
            className='pointer mg1l'
            onClick={handleCopyAnswer}
            title={aiAgentCopy.copyAnswerTitle}
          />
          <ReloadOutlined
            className='pointer mg1l'
            onClick={handleRetry}
            title={aiAgentCopy.retryTitle}
          />
          {renderReportExportAction()}
          <CloseOutlined
            className='pointer mg1l'
            onClick={handleDel}
            title={aiAgentCopy.deleteTitle}
          />
        </p>
      </div>
    )
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
        <Tooltip title={renderTitle()}>
          <Alert {...alertProps} />
        </Tooltip>
      </div>
      {renderToolCalls()}
      {showOutput && <AIOutput item={item} />}
      {renderStopButton()}
    </div>
  )
}
