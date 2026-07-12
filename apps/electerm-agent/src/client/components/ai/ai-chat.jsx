import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Flex, Input, Popconfirm, Segmented, Select } from 'antd'
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
  SendOutlined,
  ToolOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import {
  aiConfigWikiLink
} from '../../common/constants'
import { refs, refsStatic } from '../common/ref'
import { getAIChatSubmitAction } from './ai-chat-submit'
import {
  appendAIChatHistory,
  clearAIChatContext
} from './ai-chat-actions'
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
  getActiveAIConfig,
  getAIProfileOptions,
  migrateAIProfiles
} from './ai-profiles'
import message from '../common/message'
import aiAgentCopy from './ai-agent-copy.json'
import './ai.styl'

const { TextArea } = Input
const MAX_HISTORY = 100

export default function AIChat (props) {
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('ask')
  const [attachmentQueue, setAttachmentQueue] = useState([])
  const fileInputRef = useRef(null)
  const isAgent = mode === 'agent'
  const submitDisabled = isAgent && props.agentRunning
  const activeAIConfig = useMemo(
    () => getActiveAIConfig(props.config),
    [props.config]
  )
  const aiProfileOptions = useMemo(
    () => getAIProfileOptions(props.config),
    [props.config]
  )

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
      response: '',
      isStreaming: false,
      pending: true,
      sessionId: null,
      mode,
      toolCalls: [],
      ...pick(activeAIConfig, [
        'nameAI',
        'modelAI',
        'roleAI',
        'baseURLAI',
        'apiPathAI',
        'apiKeyAI',
        'authHeaderNameAI',
        'proxyAI',
        'languageAI',
        'mcpServers'
      ]),
      timestamp: Date.now(),
      id: chatId
    }

    appendAIChatHistory(window.store, chatEntry, MAX_HISTORY)
    setPrompt(current =>
      replacePromptIfUnchanged(current, promptAtSubmit, '')
    )
    setAttachmentQueue(current =>
      current === attachmentQueueAtSubmit ? [] : current
    )
  }, [prompt, mode, activeAIConfig, attachmentQueue])

  function renderHistory () {
    return (
      <AiChatHistory
        history={props.aiChatHistory}
      />
    )
  }

  function toggleConfig () {
    window.store.toggleAIConfig()
  }

  function handleActiveAIProfileChange (profileId) {
    const next = migrateAIProfiles({
      ...props.config,
      activeAIProfileId: profileId
    })
    window.store.updateConfig(next)
  }

  function clearHistory () {
    clearAIChatContext(window.store)
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
            label: '对话',
            value: 'ask'
          },
          {
            label: 'Agent',
            value: 'agent',
            disabled: props.agentRunning
          }
        ]}
      />
    )
  }

  function renderAIProfileSelect () {
    if (!aiProfileOptions.length) {
      return null
    }
    return (
      <Select
        size='small'
        className='ai-profile-select'
        value={activeAIConfig.activeAIProfileId}
        options={aiProfileOptions}
        onChange={handleActiveAIProfileChange}
        popupMatchSelectWidth={false}
        title='选择 AI API 和模型'
      />
    )
  }

  function renderSendIcon () {
    if (submitDisabled) {
      return (
        <SendOutlined
          className='mg1l send-to-ai-icon disabled'
          title={aiAgentCopy.runningTitle}
        />
      )
    }
    return (
      <SendOutlined
        onClick={handleSubmit}
        className='mg1l pointer icon-hover send-to-ai-icon'
        title={aiAgentCopy.sendTitle}
      />
    )
  }

  function renderContextActions () {
    const items = [
      {
        key: 'terminal',
        text: '引用终端',
        icon: <CodeOutlined />,
        handleClick: handleQuoteTerminalOutput
      },
      {
        key: 'selection',
        text: '引用选中',
        icon: <HighlightOutlined />,
        handleClick: handleQuoteTerminalSelection
      },
      {
        key: 'file',
        text: '引用文件',
        icon: <FileTextOutlined />,
        handleClick: handleQuoteSftpFile
      },
      {
        key: 'command',
        text: '生成命令',
        icon: <ToolOutlined />,
        handleClick: handleGenerateCommand
      },
      {
        key: 'mcp',
        text: '引用 MCP 配置',
        icon: <ApiOutlined />,
        handleClick: handleQuoteMcpServers
      },
      {
        key: 'cli',
        text: '引用 CLI 能力',
        icon: <ToolOutlined />,
        handleClick: handleQuoteLocalCliTools
      }
    ]

    return (
      <Flex className='ai-context-actions' wrap='wrap' gap={6}>
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
      <Flex className='ai-attachment-queue' wrap='wrap' gap={6}>
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
    if (!e.shiftKey) {
      e.preventDefault()
      if (!submitDisabled) {
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
          placeholder={aiAgentCopy.inputPlaceholder}
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
            {renderAIProfileSelect()}
            {renderTabSelect()}
            <PaperClipOutlined
              onClick={handlePickLocalAttachments}
              className='mg1l pointer icon-hover ai-attachment-pick-icon'
              title='添加附件'
            />
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
                title={aiAgentCopy.clearHistoryTitle}
              />
            </Popconfirm>
            <span className='ai-help-link' onClick={() => window.open(aiConfigWikiLink)}>帮助</span>
          </Flex>
          {renderSendIcon()}
        </Flex>
      </Flex>
    </Flex>
  )
}
