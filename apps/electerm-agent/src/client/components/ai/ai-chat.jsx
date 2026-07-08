import { useState, useCallback, useEffect } from 'react'
import { Flex, Input, Popconfirm } from 'antd'
import TabSelect from '../footer/tab-select'
import AiChatHistory from './ai-chat-history'
import uid from '../../common/uid'
import { pick } from 'lodash-es'
import {
  ApiOutlined,
  CodeOutlined,
  FileTextOutlined,
  HighlightOutlined,
  SearchOutlined,
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
  buildSftpFileContextPrompt,
  buildTerminalContextPrompt
} from './ai-ssh-context'
import {
  buildMcpServerContextPrompt
} from './agent-mcp-servers'
import {
  getActiveSftpRef,
  getActiveTerminalRef,
  getAIContextUnavailableMessage,
  getTerminalOutputText,
  getTerminalSelectionText,
  readSelectedSftpFileContext
} from './ai-chat-context-actions'
import message from '../common/message'
import aiAgentCopy from './ai-agent-copy.json'
import './ai.styl'

const { TextArea } = Input
const MAX_HISTORY = 100

export default function AIChat (props) {
  const [prompt, setPrompt] = useState('')
  const mode = 'ask'
  const isAgent = mode === 'agent'
  const submitDisabled = isAgent && props.agentRunning

  function handlePromptChange (e) {
    setPrompt(e.target.value)
  }

  const handleSubmit = useCallback(function (submitPromptOverride) {
    const submitPrompt = typeof submitPromptOverride === 'string' ? submitPromptOverride : prompt
    const submitAction = getAIChatSubmitAction({
      prompt: submitPrompt,
      config: props.config
    })
    if (submitAction === 'noop') return
    if (submitAction === 'open-config') {
      window.store.toggleAIConfig()
      return
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
      ...pick(props.config, [
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
    setPrompt('')
  }, [prompt, mode, props.config])

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

  async function handleQuoteSftpFile () {
    const result = await readSelectedSftpFileContext({
      sftpRef: getActiveSftpRef({
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
    setPrompt(buildSftpFileContextPrompt({
      path: result.path,
      content: result.content
    }))
  }

  function handleQuoteMcpServers () {
    const text = buildMcpServerContextPrompt({
      mcpServers: props.config?.mcpServers || window.store.config?.mcpServers || []
    })
    if (!text) {
      message.warning(getAIContextUnavailableMessage('mcp'))
      return
    }
    setPrompt(text)
  }

  function showUnavailableContextAction (type) {
    message.warning(getAIContextUnavailableMessage(type))
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
        key: 'web',
        text: '联网搜索',
        icon: <SearchOutlined />,
        handleClick: () => showUnavailableContextAction('web')
      },
      {
        key: 'mcp',
        text: 'MCP',
        icon: <ApiOutlined />,
        handleClick: handleQuoteMcpServers
      },
      {
        key: 'cli',
        text: 'CLI',
        icon: <ToolOutlined />,
        handleClick: () => showUnavailableContextAction('cli')
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

      <Flex vertical className='ai-chat-input'>
        {renderContextActions()}
        <TextArea
          value={prompt}
          onChange={handlePromptChange}
          onPressEnter={handleKeyPress}
          placeholder={aiAgentCopy.inputPlaceholder}
          autoSize={{ minRows: 3, maxRows: 10 }}
          className='ai-chat-textarea'
        />
        <Flex className='ai-chat-terminals' justify='space-between' align='center'>
          <Flex align='center'>
            {renderTabSelect()}
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
