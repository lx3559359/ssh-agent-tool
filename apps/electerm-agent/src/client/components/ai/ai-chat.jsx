import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Flex, Input, Popconfirm, Segmented } from 'antd'
import TabSelect from '../footer/tab-select'
import AiChatHistory from './ai-chat-history'
import uid from '../../common/uid'
import { pick } from 'lodash-es'
import {
  ApiOutlined,
  CodeOutlined,
  FileTextOutlined,
  HighlightOutlined,
  CloseOutlined,
  PaperClipOutlined,
  SettingOutlined,
  LoadingOutlined,
  SendOutlined,
  ToolOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { refs, refsStatic } from '../common/ref'
import {
  getAgentComposerActionState,
  getAIChatSubmitAction
} from './ai-chat-submit'
import {
  adoptLegacyAIChatHistoryScope,
  appendAIChatHistory,
  cancelAndClearAIChatContext,
  getAIChatHistoryForScope
} from './ai-chat-actions'
import { cancelAgentRun } from './agent'
import { cancelDetachedAIStream } from './ai-chat-history-item'
import {
  buildCommandSuggestionPrompt,
  buildTerminalContextPrompt
} from './ai-ssh-context'
import {
  buildMcpServerContextPrompt
} from './agent-mcp-servers'
import {
  buildLocalCliContextPrompt
} from './agent-local-cli-tools'
import {
  getActiveSftpRef,
  getActiveTerminalRef,
  getAIContextUnavailableMessage,
  getTerminalOutputText,
  getTerminalSelectionText,
  buildSelectedSftpFileAnalysisPrompt,
  replacePromptIfUnchanged,
  shouldAutoAttachSelectedSftpFileContext
} from './ai-chat-context-actions'
import {
  buildAttachmentContextPrompt,
  createLocalFileAttachments,
  parseSftpDropPayload
} from './ai-attachments'
import {
  getActiveAIConfig
} from './ai-profiles'
import {
  aiHealthCoordinator,
  getAIHealthRequestKey,
  resolveAIChatHealthTransitions
} from './ai-health-coordinator'
import { agentTaskRegistry } from './agent-task-registry.js'
import { resolveAgentRuntimeEndpoint } from './agent-runtime-context.js'
import { createAIRequestCredentialReference } from './ai-request-credentials'
import message from '../common/message'
import './ai.styl'

const { TextArea } = Input
const MAX_HISTORY = 100
const e = window.translate

export default function AIChat (props) {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('ask')
  const [attachmentQueue, setAttachmentQueue] = useState([])
  const fileInputRef = useRef(null)
  const submittedHealthChecksRef = useRef(new Map())
  const [, setAgentTaskVersion] = useState(0)
  const isAgent = mode === 'agent'
  const conversationScopeId = String(
    props.conversationScopeId || props.activeTabId || 'global'
  )
  const activeEndpoint = resolveAgentRuntimeEndpoint(props.activeTabId)
  const agentRunning = activeEndpoint
    ? agentTaskRegistry.isEndpointBusy(activeEndpoint)
    : agentTaskRegistry.isScopeBusy(conversationScopeId)
  const submitDisabled = isAgent && agentRunning
  const composerActionState = getAgentComposerActionState({
    isAgent,
    agentRunning,
    disabled: submitDisabled
  })
  const activeAIConfig = useMemo(
    () => getActiveAIConfig(props.config),
    [props.config]
  )
  const visibleHistory = getAIChatHistoryForScope(
    props.aiChatHistory,
    conversationScopeId
  )

  useEffect(() => {
    if (props.activeTabId) {
      adoptLegacyAIChatHistoryScope(window.store, conversationScopeId)
    }
  }, [props.activeTabId, conversationScopeId, props.aiChatHistory])

  useEffect(() => agentTaskRegistry.subscribe(() => {
    setAgentTaskVersion(version => version + 1)
  }), [])

  function handlePromptChange (e) {
    setPrompt(e.target.value)
  }

  const handleSubmit = useCallback(async function (submitPromptOverride) {
    const promptAtSubmit = prompt
    const attachmentQueueAtSubmit = attachmentQueue
    let submitPrompt = typeof submitPromptOverride === 'string' ? submitPromptOverride : prompt
    if (!String(submitPrompt || '').trim() && attachmentQueueAtSubmit.length) {
      submitPrompt = '请分析附件内容。'
    }
    const submitAction = getAIChatSubmitAction({
      prompt: submitPrompt,
      config: activeAIConfig
    })
    if (submitAction === 'noop') return
    if (submitAction === 'open-config') {
      window.store.toggleAIConfig()
      return
    }

    const userPrompt = String(submitPrompt || '').trim()

    if (shouldAutoAttachSelectedSftpFileContext(submitPrompt)) {
      const result = await buildSelectedSftpFileAnalysisPrompt({
        sftpRef: getActiveSftpRef({
          store: window.store,
          refs
        }),
        termRef: getActiveTerminalRef({
          store: window.store,
          refs
        }),
        fsApi: window.fs
      }).catch(err => {
        window.store.onError(err)
        return null
      })
      if (!result) {
        return
      }
      if (!result.ok) {
        message.warning(result.message)
        return
      }
      submitPrompt = `${submitPrompt}\n\n${result.prompt}`
    }

    if (attachmentQueueAtSubmit.length) {
      const attachmentPrompt = await buildAttachmentContextPrompt({
        attachments: attachmentQueueAtSubmit,
        fsApi: window.fs,
        sftpRef: getActiveSftpRef({
          store: window.store,
          refs
        })
      }).catch(err => {
        window.store.onError(err)
        return ''
      })
      if (!attachmentPrompt) {
        return
      }
      submitPrompt = `${submitPrompt}\n\n${attachmentPrompt}`
    }

    const chatId = uid()
    const chatEntry = {
      prompt: submitPrompt,
      displayPrompt: userPrompt,
      conversationScopeId,
      sourceTabId: String(props.activeTabId || ''),
      completionStatus: 'pending',
      response: '',
      isStreaming: false,
      pending: true,
      sessionId: null,
      mode,
      toolCalls: [],
      ...createAIRequestCredentialReference(activeAIConfig),
      ...pick(activeAIConfig, [
        'nameAI',
        'modelAI',
        'roleAI',
        'languageAI'
      ]),
      timestamp: Date.now(),
      id: chatId
    }

    const healthKey = getAIHealthRequestKey(activeAIConfig)
    submittedHealthChecksRef.current.set(chatId, {
      key: healthKey,
      seen: false
    })
    aiHealthCoordinator.recordChatStarted(healthKey)
    appendAIChatHistory(window.store, chatEntry, MAX_HISTORY)
    setPrompt(current =>
      replacePromptIfUnchanged(current, promptAtSubmit, '')
    )
    setAttachmentQueue(current =>
      current === attachmentQueueAtSubmit ? [] : current
    )
  }, [
    prompt,
    mode,
    activeAIConfig,
    attachmentQueue,
    props.activeTabId,
    conversationScopeId
  ])

  function renderHistory () {
    return (
      <AiChatHistory
        history={visibleHistory}
        agentRunning={agentRunning}
      />
    )
  }

  function toggleConfig () {
    window.store.toggleAIConfig()
  }

  async function clearHistory () {
    await cancelAndClearAIChatContext(window.store, conversationScopeId, {
      cancelAgent: cancelAgentRun,
      cancelDetachedStream: cancelDetachedAIStream,
      cancelRequest: requestId => window.pre.runGlobalAsync('AIChatCancel', requestId),
      stopStream: sessionId => window.pre.runGlobalAsync('stopStream', sessionId)
    })
  }

  function setContextPrompt (source, text) {
    const value = String(text || '').trim()
    if (!value) {
      message.warning(getAIContextUnavailableMessage(source))
      return
    }
    setPrompt(buildTerminalContextPrompt({
      source,
      text: value
    }))
  }

  function handleQuoteTerminalOutput () {
    const termRef = getActiveTerminalRef({
      store: window.store,
      refs
    })
    setContextPrompt('terminal', getTerminalOutputText(termRef))
  }

  function handleQuoteTerminalSelection () {
    const termRef = getActiveTerminalRef({
      store: window.store,
      refs
    })
    setContextPrompt('selection', getTerminalSelectionText(termRef))
  }

  function handleGenerateCommand () {
    const termRef = getActiveTerminalRef({
      store: window.store,
      refs
    })
    const selection = getTerminalSelectionText(termRef)
    const output = selection || getTerminalOutputText(termRef)
    const source = selection ? 'selection' : 'terminal'
    const value = String(output || '').trim()
    if (!value) {
      message.warning(getAIContextUnavailableMessage(source))
      return
    }
    setPrompt(buildCommandSuggestionPrompt({
      source,
      text: value
    }))
  }

  async function handleQuoteSftpFile () {
    const promptAtStart = prompt
    const result = await buildSelectedSftpFileAnalysisPrompt({
      sftpRef: getActiveSftpRef({
        store: window.store,
        refs
      }),
      termRef: getActiveTerminalRef({
        store: window.store,
        refs
      }),
      fsApi: window.fs
    }).catch(err => {
      window.store.onError(err)
      return null
    })
    if (!result) {
      return
    }
    if (!result.ok) {
      message.warning(result.message)
      return
    }
    setPrompt(current =>
      replacePromptIfUnchanged(current, promptAtStart, result.prompt)
    )
  }

  function handleQuoteMcpServers () {
    const text = buildMcpServerContextPrompt({
      mcpServers: activeAIConfig?.mcpServers || window.store.config?.mcpServers || []
    })
    if (!text) {
      message.warning(getAIContextUnavailableMessage('mcp'))
      return
    }
    setPrompt(text)
  }

  function handleQuoteLocalCliTools () {
    setPrompt(buildLocalCliContextPrompt())
  }

  function appendAttachments (items = []) {
    const nextItems = items.filter(Boolean)
    if (!nextItems.length) {
      return
    }
    setAttachmentQueue(current => [...current, ...nextItems])
  }

  function handlePickLocalAttachments () {
    fileInputRef.current?.click()
  }

  function handleLocalAttachmentChange (e) {
    appendAttachments(createLocalFileAttachments(e.target.files))
    e.target.value = ''
  }

  function handlePasteAttachments (e) {
    const files = e.clipboardData?.files
    if (files?.length) {
      appendAttachments(createLocalFileAttachments(files))
    }
  }

  function handleDropAttachments (e) {
    const localFiles = e.dataTransfer?.files
    const sftpPayload = e.dataTransfer?.getData?.('fromFile')
    const attachments = [
      ...parseSftpDropPayload(sftpPayload),
      ...createLocalFileAttachments(localFiles)
    ]
    if (!attachments.length) {
      return
    }
    e.preventDefault()
    appendAttachments(attachments)
  }

  function handleDragOverAttachments (e) {
    if (
      e.dataTransfer?.types?.includes?.('Files') ||
      e.dataTransfer?.types?.includes?.('fromFile')
    ) {
      e.preventDefault()
    }
  }

  function removeAttachment (id) {
    setAttachmentQueue(current => current.filter(item => item.id !== id))
  }

  function renderTabSelect () {
    if (isAgent) {
      return null
    }
    return (
      <TabSelect
        selectedTabIds={props.selectedTabIds}
        tabs={props.tabs}
        activeTabId={props.activeTabId}
      />
    )
  }

  function renderModeSwitch () {
    return (
      <Segmented
        size='small'
        value={mode}
        onChange={value => setMode(value)}
        options={[
          {
            label: e('shellpilotAiModeChat'),
            value: 'ask'
          },
          {
            label: e('shellpilotAiModeAgent'),
            value: 'agent',
            disabled: agentRunning
          }
        ]}
      />
    )
  }

  function renderSendIcon () {
    if (composerActionState.kind === 'loading') {
      return (
        <LoadingOutlined
          spin
          className='mg1l send-to-ai-icon agent-send-running'
          title={e('shellpilotAiRunningTitle')}
        />
      )
    }
    return (
      <SendOutlined
        onClick={composerActionState.disabled ? undefined : handleSubmit}
        aria-disabled={composerActionState.disabled}
        className={`mg1l send-to-ai-icon ${
          composerActionState.disabled
            ? 'agent-send-disabled'
            : 'pointer icon-hover'
        }`}
        title={e('shellpilotAiSendTitle')}
      />
    )
  }

  function renderContextActions () {
    const items = [
      {
        key: 'terminal',
        text: e('shellpilotAiQuoteTerminal'),
        icon: <CodeOutlined />,
        handleClick: handleQuoteTerminalOutput
      },
      {
        key: 'selection',
        text: e('shellpilotAiQuoteSelection'),
        icon: <HighlightOutlined />,
        handleClick: handleQuoteTerminalSelection
      },
      {
        key: 'file',
        text: e('shellpilotAiQuoteFile'),
        icon: <FileTextOutlined />,
        handleClick: handleQuoteSftpFile
      },
      {
        key: 'command',
        text: e('shellpilotAiGenerateCommand'),
        icon: <ToolOutlined />,
        handleClick: handleGenerateCommand
      },
      {
        key: 'mcp',
        text: e('shellpilotAiQuoteMcpConfiguration'),
        icon: <ApiOutlined />,
        handleClick: handleQuoteMcpServers
      },
      {
        key: 'cli',
        text: e('shellpilotAiQuoteCliCapabilities'),
        icon: <ToolOutlined />,
        handleClick: handleQuoteLocalCliTools
      }
    ]

    return (
      <Flex className='ai-context-actions' wrap='wrap' gap={6} onWheel={handleHorizontalRailWheel}>
        {
          items.map(item => (
            <button
              key={item.key}
              type='button'
              className='ai-context-action'
              onClick={item.handleClick}
              title={item.text}
            >
              {item.icon}
              <span>{item.text}</span>
            </button>
          ))
        }
      </Flex>
    )
  }

  function renderAttachments () {
    if (!attachmentQueue.length) {
      return null
    }
    return (
      <Flex className='ai-attachment-queue' wrap='wrap' gap={6} onWheel={handleHorizontalRailWheel}>
        {
          attachmentQueue.map(item => (
            <button
              key={item.id}
              type='button'
              className='ai-attachment-chip'
              title={item.path || item.name}
            >
              <FileTextOutlined />
              <span>{item.name}</span>
              <CloseOutlined
                onClick={() => removeAttachment(item.id)}
                className='ai-attachment-remove'
              />
            </button>
          ))
        }
      </Flex>
    )
  }

  function renderUploadButton () {
    return (
      <button
        type='button'
        className='ai-attachment-upload-button'
        onClick={handlePickLocalAttachments}
        title={e('shellpilotAiUploadHint')}
      >
        <PaperClipOutlined />
        <span>{e('shellpilotAiUpload')}</span>
      </button>
    )
  }

  function handleHorizontalRailWheel (event) {
    const rail = event.currentTarget
    if (
      rail.scrollWidth <= rail.clientWidth ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX)
    ) {
      return
    }
    const previousScrollLeft = rail.scrollLeft
    rail.scrollLeft += event.deltaY
    if (rail.scrollLeft !== previousScrollLeft) {
      event.preventDefault()
    }
  }

  useEffect(() => {
    const result = resolveAIChatHealthTransitions(
      props.aiChatHistory,
      submittedHealthChecksRef.current
    )
    submittedHealthChecksRef.current = result.tracked
    for (const update of result.updates) {
      aiHealthCoordinator.recordChatResult(update.key, {
        ok: update.ok,
        status: update.status,
        message: update.ok
          ? '当前模型已完成真实对话'
          : '当前模型对话失败'
      })
    }
  }, [props.aiChatHistory])

  useEffect(() => () => {
    submittedHealthChecksRef.current.clear()
  }, [])

  useEffect(() => {
    refsStatic.add('AIChat', {
      setPrompt,
      handleSubmit
    })
    return () => {
      refsStatic.remove('AIChat')
    }
  }, [handleSubmit])

  if (props.rightPanelTab !== 'ai') {
    return null
  }

  const handleKeyPress = (e) => {
    const nativeEvent = e.nativeEvent || e
    if (
      e.isComposing ||
      nativeEvent?.isComposing ||
      e.keyCode === 229 ||
      e.which === 229 ||
      nativeEvent?.keyCode === 229
    ) {
      return
    }
    if (!e.shiftKey) {
      e.preventDefault()
      if (!composerActionState.disabled) {
        handleSubmit()
      }
    }
  }

  return (
    <Flex vertical className='ai-chat-container'>
      <Flex className='ai-chat-history' flex='auto'>
        {renderHistory()}
      </Flex>

      <Flex
        vertical
        className='ai-chat-input'
        onPaste={handlePasteAttachments}
        onDrop={handleDropAttachments}
        onDragOver={handleDragOverAttachments}
      >
        {renderContextActions()}
        {renderAttachments()}
        <TextArea
          value={prompt}
          onChange={handlePromptChange}
          onPressEnter={handleKeyPress}
          placeholder={e('shellpilotAiInputPlaceholder')}
          autoSize={{ minRows: 3, maxRows: 10 }}
          className='ai-chat-textarea'
        />
        <input
          ref={fileInputRef}
          type='file'
          multiple
          className='hide'
          onChange={handleLocalAttachmentChange}
        />
        <Flex className='ai-chat-terminals' justify='space-between' align='center'>
          <Flex align='center' gap={6}>
            {renderModeSwitch()}
            {renderTabSelect()}
            {renderUploadButton()}
            <SettingOutlined
              onClick={toggleConfig}
              className='mg1l pointer icon-hover toggle-ai-setting-icon'
            />
            <Popconfirm
              title={window.translate('clear') + ' AI ' + window.translate('history') + '?'}
              okText={window.translate('ok')}
              cancelText={window.translate('cancel')}
              onConfirm={clearHistory}
            >
              <UnorderedListOutlined
                className='mg2x pointer clear-ai-icon icon-hover'
                title={e('shellpilotAiClearHistoryTitle')}
              />
            </Popconfirm>
          </Flex>
          {renderSendIcon()}
        </Flex>
      </Flex>
    </Flex>
  )
}
