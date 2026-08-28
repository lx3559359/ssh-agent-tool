import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button, Flex, Input, Modal, Popconfirm, Segmented } from 'antd'
import TabSelect from '../footer/tab-select'
import AiChatHistory from './ai-chat-history'
import AIStopIcon from './ai-stop-icon'
import uid from '../../common/uid'
import { pick } from 'lodash-es'
import {
  CodeOutlined,
  FileTextOutlined,
  HighlightOutlined,
  PaperClipOutlined,
  SettingOutlined,
  LoadingOutlined,
  SendOutlined,
  ToolOutlined,
  UnorderedListOutlined,
  GlobalOutlined
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
  cancelScopedAIChatRun,
  getActiveAIChatRun
} from './ai-run-cancellation.js'
import {
  buildCommandSuggestionPrompt,
  buildTerminalContextPrompt
} from './ai-ssh-context'
import {
  getActiveSftpRef,
  getActiveTerminalRef,
  getAIContextUnavailableMessage,
  getTerminalOutputText,
  getTerminalSelectionText,
  replacePromptIfUnchanged,
  shouldAutoAttachSelectedSftpFileContext
} from './ai-chat-context-actions'
import {
  buildAttachmentAIContent,
  createLocalFileAttachments,
  createSftpFileAttachments,
  createWebAttachment,
  parseSftpDropPayload
} from './ai-attachments'
import {
  registerAIContentParts
} from './ai-content-registry'
import AIWebAccessModal from './ai-web-access-modal'
import {
  getActiveAIConfig
} from './ai-profiles'
import { haveSameAIConfig } from './ai-chat-entry-props.js'
import {
  aiHealthCoordinator,
  getAIHealthRequestKey,
  resolveAIChatHealthTransitions
} from './ai-health-coordinator'
import { agentTaskRegistry } from './agent-task-registry.js'
import { resolveAgentRuntimeEndpoint } from './agent-runtime-context.js'
import { createAIRequestCredentialReference } from './ai-request-credentials'
import message from '../common/message'
import CreateArtifactMenu from '../artifacts/create-artifact-menu'
import AIAttachmentCard from './ai-attachment-card'
import './ai.styl'

const { TextArea } = Input
const MAX_HISTORY = 100
const e = window.translate

function getSingleSftpAttachment (sftpRef) {
  const selectedFiles = sftpRef?.getSelectedFiles?.() || []
  let attachments = []
  try {
    attachments = createSftpFileAttachments(selectedFiles, sftpRef)
  } catch {
    return {
      error: '当前 SFTP 连接缺少安全源绑定，请重新连接后重试。'
    }
  }
  if (selectedFiles.length > 1) {
    return {
      error: '当前选择了多个文件，请一次只引用一个文件。'
    }
  }
  if (selectedFiles.some(file => file?.isDirectory)) {
    return {
      error: '当前选择的是目录，请选择一个文件后再引用。'
    }
  }
  if (attachments.length !== 1) {
    return {
      error: '请先在 SFTP 中选择一个文件。'
    }
  }
  return {
    attachment: attachments[0]
  }
}

export default function AIChat (props) {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('ask')
  const [attachmentQueue, setAttachmentQueue] = useState([])
  const [webUrlDialogOpen, setWebUrlDialogOpen] = useState(false)
  const [webUrl, setWebUrl] = useState('')
  const [webAccessChallenge, setWebAccessChallenge] = useState(null)
  const fileInputRef = useRef(null)
  const composerRef = useRef(null)
  const webAccessResolverRef = useRef(null)
  const submittedHealthChecksRef = useRef(new Map())
  const stableConfigRef = useRef(props.config)
  if (!haveSameAIConfig(stableConfigRef.current, props.config)) {
    stableConfigRef.current = props.config
  }
  const stableConfig = stableConfigRef.current
  const [, setAgentTaskVersion] = useState(0)
  const isAgent = mode === 'agent'
  const conversationScopeId = String(
    props.conversationScopeId || props.activeTabId || 'global'
  )
  const activeEndpoint = resolveAgentRuntimeEndpoint(props.activeTabId)
  const agentRunning = activeEndpoint
    ? agentTaskRegistry.isEndpointBusy(activeEndpoint)
    : agentTaskRegistry.isScopeBusy(conversationScopeId)
  const visibleHistory = useMemo(
    () => getAIChatHistoryForScope(
      props.aiChatHistory,
      conversationScopeId
    ),
    [props.aiChatHistory, conversationScopeId]
  )
  const activeRun = useMemo(
    () => getActiveAIChatRun(visibleHistory),
    [visibleHistory]
  )
  const submitDisabled = Boolean(activeRun) || (isAgent && agentRunning)
  const composerActionState = getAgentComposerActionState({
    activeRunStatus: activeRun?.completionStatus,
    isAgent,
    agentRunning,
    disabled: submitDisabled
  })
  const activeAIConfig = useMemo(
    () => getActiveAIConfig(stableConfig),
    [stableConfig]
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

  const requestWebAccessAuthorization = useCallback(challenge => (
    new Promise(resolve => {
      webAccessResolverRef.current?.(null)
      webAccessResolverRef.current = resolve
      setWebAccessChallenge(challenge)
    })
  ), [])

  const resolveWebAccessAuthorization = useCallback(scope => {
    const resolve = webAccessResolverRef.current
    webAccessResolverRef.current = null
    setWebAccessChallenge(null)
    resolve?.(scope)
  }, [])

  const handleSubmit = useCallback(async function (submitPromptOverride) {
    const promptAtSubmit = prompt
    const attachmentQueueAtSubmit = attachmentQueue
    let aiContentParts = []
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

    if (
      shouldAutoAttachSelectedSftpFileContext(submitPrompt) &&
      !attachmentQueueAtSubmit.length
    ) {
      const sftpRef = getActiveSftpRef({
        store: window.store,
        refs
      })
      const selected = getSingleSftpAttachment(sftpRef)
      if (selected.error) {
        message.warning(selected.error)
        return
      }
      const selectedContent = await buildAttachmentAIContent({
        attachments: [selected.attachment],
        fsApi: window.fs,
        sftpRefs: refs,
        requestWebAccessAuthorization
      }).catch(err => {
        window.store.onError(err)
        return null
      })
      if (selectedContent?.errors?.length) {
        message.warning(selectedContent.errors.join('；'))
      }
      if (!selectedContent?.prompt) {
        return
      }
      submitPrompt = `${submitPrompt}\n\n${selectedContent.prompt}`
      aiContentParts = selectedContent.aiContentParts || []
    }

    if (attachmentQueueAtSubmit.length) {
      const attachmentContent = await buildAttachmentAIContent({
        attachments: attachmentQueueAtSubmit,
        fsApi: window.fs,
        sftpRefs: refs,
        requestWebAccessAuthorization
      }).catch(err => {
        window.store.onError(err)
        return null
      })
      if (attachmentContent?.errors?.length) {
        message.warning(attachmentContent.errors.join('；'))
      }
      if (!attachmentContent?.prompt) {
        return
      }
      submitPrompt = `${submitPrompt}\n\n${attachmentContent.prompt}`
      aiContentParts = attachmentContent.aiContentParts || []
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
    registerAIContentParts(chatId, aiContentParts)

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
    requestWebAccessAuthorization,
    props.activeTabId,
    conversationScopeId
  ])

  const handleStopActiveRun = useCallback(async () => {
    if (!activeRun) return
    const result = await cancelScopedAIChatRun({
      store: window.store,
      item: activeRun,
      cancelAgent: cancelAgentRun,
      cancelDetachedStream: cancelDetachedAIStream,
      cancelRequest: requestId => window.pre.runGlobalAsync('AIChatCancel', requestId),
      stopStream: sessionId => window.pre.runGlobalAsync('stopStream', sessionId),
      stoppedText: e('shellpilotAiStoppedByUser')
    })
    if (result.error) {
      window.store.onError?.(result.error)
    }
  }, [activeRun])

  function renderHistory () {
    return (
      <AiChatHistory
        history={visibleHistory}
        agentRunning={agentRunning}
        config={stableConfig}
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
    const sftpRef = getActiveSftpRef({
      store: window.store,
      refs
    })
    const selected = getSingleSftpAttachment(sftpRef)
    if (selected.error) {
      message.warning(selected.error)
      return
    }
    appendAttachments([selected.attachment])
    setPrompt(current => current.trim() ? current : '请分析这个文件。')
    requestAnimationFrame(() => composerRef.current?.focus())
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

  function handleOpenWebUrl () {
    setWebUrlDialogOpen(true)
  }

  function handleConfirmWebUrl () {
    const attachment = createWebAttachment(webUrl)
    if (!attachment) {
      message.warning(e('shellpilotAiWebUrlRequired'))
      return
    }
    appendAttachments([attachment])
    setWebUrl('')
    setWebUrlDialogOpen(false)
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
        className='ai-mode-segmented'
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
    if (['stop', 'stopping'].includes(composerActionState.kind)) {
      return (
        <AIStopIcon
          onClick={handleStopActiveRun}
          stopping={composerActionState.kind === 'stopping'}
          title={e('shellpilotAiStopRequest')}
        />
      )
    }
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
        data-testid='ai-chat-submit'
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

  function handleSeedArtifactPrompt (nextPrompt) {
    setPrompt(nextPrompt)
    requestAnimationFrame(() => composerRef.current?.focus())
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
        key: 'web',
        text: e('shellpilotAiReadWebUrl'),
        icon: <GlobalOutlined />,
        handleClick: handleOpenWebUrl
      }
    ]

    return (
      <Flex className='ai-context-actions' wrap='wrap' gap={6} onWheel={handleHorizontalRailWheel}>
        {
          items.map(item => (
            <button
              key={item.key}
              type='button'
              data-testid={item.key === 'web' ? 'ai-web-add-url' : undefined}
              className='ai-context-action'
              onClick={item.handleClick}
              onFocus={handleHorizontalRailFocus}
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
            <AIAttachmentCard
              key={item.id}
              attachment={item}
              onFocus={handleHorizontalRailFocus}
              onRemove={removeAttachment}
              removeLabel={e('remove')}
            />
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

  function handleHorizontalRailFocus (event) {
    event.currentTarget.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    })
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
    webAccessResolverRef.current?.(null)
    webAccessResolverRef.current = null
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

  const aiPanelVisible = props.rightPanelTab === 'ai'

  const aiConfigured = Boolean(
    String(activeAIConfig.baseURLAI || '').trim() &&
    String(activeAIConfig.apiKeyAI || '').trim()
  )

  if (!aiConfigured) {
    return (
      <Flex
        vertical
        className={'ai-chat-container ai-chat-unconfigured' +
          (aiPanelVisible ? '' : ' ai-chat-container-hidden')}
        aria-hidden={!aiPanelVisible}
        inert={!aiPanelVisible}
        align='center'
        justify='center'
      >
        <div
          className='ai-chat-unconfigured-status'
          role='status'
          aria-labelledby='ai-chat-unconfigured-title'
          aria-describedby='ai-chat-unconfigured-description'
        >
          <ToolOutlined className='ai-chat-unconfigured-icon' />
          <strong id='ai-chat-unconfigured-title'>{e('shellpilotAiUnconfigured')}</strong>
          <span id='ai-chat-unconfigured-description'>{e('shellpilotAiConfigureHint')}</span>
        </div>
        <Button
          type='primary'
          onClick={toggleConfig}
          aria-label={e('shellpilotAiApiConfiguration')}
        >
          {e('shellpilotAiApiConfiguration')}
        </Button>
      </Flex>
    )
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
      if (
        composerActionState.kind === 'send' &&
        !composerActionState.disabled
      ) {
        handleSubmit()
      }
    }
  }

  return (
    <>
      <Flex
        vertical
        className={'ai-chat-container' +
          (aiPanelVisible ? '' : ' ai-chat-container-hidden')}
        aria-hidden={!aiPanelVisible}
        inert={!aiPanelVisible}
      >
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
          <div className={`ai-composer-surface${attachmentQueue.length ? ' ai-composer-surface-with-attachments' : ''}`}>
            {renderAttachments()}
            <TextArea
              ref={composerRef}
              value={prompt}
              onChange={handlePromptChange}
              onPressEnter={handleKeyPress}
              placeholder={e('shellpilotAiInputPlaceholder')}
              autoSize={{ minRows: 3, maxRows: 10 }}
              className='ai-chat-textarea'
            />
          </div>
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
              <CreateArtifactMenu onSeedPrompt={handleSeedArtifactPrompt} />
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
      <Modal
        title={e('shellpilotAiReadWebUrl')}
        open={aiPanelVisible && webUrlDialogOpen}
        okText={e('shellpilotAiAddWebUrl')}
        cancelText={e('cancel')}
        onOk={handleConfirmWebUrl}
        onCancel={() => setWebUrlDialogOpen(false)}
        okButtonProps={{ 'data-testid': 'ai-web-url-confirm' }}
        destroyOnClose
      >
        <Input
          value={webUrl}
          onChange={event => setWebUrl(event.target.value)}
          onPressEnter={handleConfirmWebUrl}
          placeholder='https://example.com/article'
          data-testid='ai-web-url-input'
          autoFocus
        />
        <div className='shellpilot-ai-web-url-hint'>
          {e('shellpilotAiWebUrlHint')}
        </div>
      </Modal>
      <AIWebAccessModal
        challenge={aiPanelVisible ? webAccessChallenge : null}
        activeAIName={activeAIConfig.nameAI || activeAIConfig.modelAI || 'AI'}
        onDecision={resolveWebAccessAuthorization}
        onCancel={() => resolveWebAccessAuthorization(null)}
      />
    </>
  )
}
