import { useState } from 'react'
import { Tag } from 'antd'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  DatabaseOutlined
} from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import { refs } from '../common/ref'
import {
  fillAgentCommandIntoTerminal,
  getAgentCommandFillState
} from './agent-tool-presentation.js'
import aiAgentCopy from './ai-agent-copy.json'

const toolIcons = {
  run_readonly_command: CodeOutlined,
  send_terminal_command: CodeOutlined,
  get_terminal_output: CodeOutlined,
  open_local_terminal: CodeOutlined,
  list_tabs: CodeOutlined,
  get_active_tab: CodeOutlined,
  switch_tab: CodeOutlined,
  list_bookmarks: DatabaseOutlined,
  open_bookmark: DatabaseOutlined,
  add_bookmark: DatabaseOutlined
}

function formatResult (result) {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result)
    if (parsed.output) return parsed.output
    return JSON.stringify(parsed, null, 2)
  } catch {
    return result
  }
}

function formatRawJson (args, result) {
  let parsedResult = result
  if (typeof result === 'string') {
    try {
      parsedResult = JSON.parse(result)
    } catch {}
  }
  return JSON.stringify({ arguments: args || {}, result: parsedResult }, null, 2)
}

export default function AgentToolCallCard ({ toolCall }) {
  const [expanded, setExpanded] = useState(toolCall.status === 'running')
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [rawExpanded, setRawExpanded] = useState(false)
  const { name, args, status, result, presentation } = toolCall
  const Icon = toolIcons[name] || CodeOutlined
  const isReadonly = presentation && presentation.kind === 'readonly-exec'
  const activeTabId = window.store.activeTabId
  const activeTerminal = activeTabId
    ? refs.get('term-' + activeTabId)
    : null
  const fillState = isReadonly
    ? getAgentCommandFillState({
      presentation,
      activeTabId,
      terminal: activeTerminal
    })
    : { allowed: false, reason: '' }

  function renderStatus () {
    if (status === 'running') {
      return <LoadingOutlined spin className='agent-tool-status-running' />
    }
    if (status === 'completed') {
      return <CheckCircleOutlined className='agent-tool-status-completed' />
    }
    return <CloseCircleOutlined className='agent-tool-status-error' />
  }

  function renderTag () {
    const color = status === 'running' ? 'processing' : status === 'completed' ? 'success' : 'error'
    return (
      <Tag color={color} className='agent-tool-tag'>
        {aiAgentCopy.toolCall.status[status] || status}
      </Tag>
    )
  }

  function handleCopyCommand (e) {
    e.stopPropagation()
    copy(presentation.command)
  }

  async function handleFillTerminal (e) {
    e.stopPropagation()
    await fillAgentCommandIntoTerminal({
      presentation,
      getActiveTabId: () => window.store.activeTabId,
      getTerminal: tabId => refs.get('term-' + tabId),
      sendTerminalCommand: payload => window.store.mcpSendTerminalCommand(payload),
      onError: error => window.store.onError(error)
    })
  }

  function renderReadonlyDetail () {
    return (
      <div className='agent-tool-detail agent-readonly-detail'>
        <div className='agent-readonly-status-line'>
          {presentation.target && (
            <span title={presentation.target}>
              {aiAgentCopy.toolCall.targetLabel}: {presentation.target}
            </span>
          )}
          {presentation.durationMs !== undefined && (
            <span>{aiAgentCopy.toolCall.durationLabel}: {presentation.durationMs} ms</span>
          )}
          {presentation.exitCode !== undefined && (
            <span>{aiAgentCopy.toolCall.exitCodeLabel}: {presentation.exitCode}</span>
          )}
          {presentation.truncated !== undefined && (
            <span className={presentation.truncated ? 'agent-readonly-truncated' : ''}>
              {aiAgentCopy.toolCall.truncatedLabel}: {
                presentation.truncated
                  ? aiAgentCopy.toolCall.yesLabel
                  : aiAgentCopy.toolCall.noLabel
              }
            </span>
          )}
        </div>
        {presentation.error && (
          <pre className='agent-tool-pre agent-readonly-error'>{presentation.error}</pre>
        )}
        <div className='agent-readonly-actions'>
          <button
            type='button'
            className='agent-readonly-action'
            onClick={handleCopyCommand}
          >
            {aiAgentCopy.toolCall.copyCommand}
          </button>
          <button
            type='button'
            className='agent-readonly-action'
            disabled={!fillState.allowed}
            title={fillState.reason}
            onClick={handleFillTerminal}
          >
            {aiAgentCopy.toolCall.fillTerminal}
          </button>
        </div>
        {!fillState.allowed && fillState.reason && (
          <span className='agent-readonly-fill-reason'>{fillState.reason}</span>
        )}
        {presentation.output !== undefined && (
          <div className='agent-readonly-section'>
            <button
              type='button'
              className='agent-readonly-toggle'
              onClick={() => setOutputExpanded(!outputExpanded)}
              aria-expanded={outputExpanded}
            >
              {outputExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
              <span>{aiAgentCopy.toolCall.outputLabel}</span>
            </button>
            {outputExpanded && (
              <pre className='agent-tool-pre agent-readonly-output'>{presentation.output}</pre>
            )}
          </div>
        )}
        <div className='agent-readonly-section agent-readonly-raw'>
          <button
            type='button'
            className='agent-readonly-toggle'
            onClick={() => setRawExpanded(!rawExpanded)}
            aria-expanded={rawExpanded}
          >
            {rawExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
            <span>{aiAgentCopy.toolCall.rawLabel}</span>
          </button>
          {rawExpanded && (
            <pre className='agent-tool-pre'>{formatRawJson(args, result)}</pre>
          )}
        </div>
      </div>
    )
  }

  if (isReadonly) {
    return (
      <div className={`agent-tool-call-card agent-tool-${status} agent-tool-readonly-card`}>
        <div className='agent-tool-header agent-readonly-header'>
          <Icon />
          <span className='agent-tool-name'>{aiAgentCopy.toolCall.readonlyTitle}</span>
          <code className='agent-readonly-command'>{presentation.command}</code>
          {renderTag()}
          {renderStatus()}
        </div>
        {renderReadonlyDetail()}
      </div>
    )
  }

  return (
    <div className={`agent-tool-call-card agent-tool-${status}`}>
      <div
        className='agent-tool-header pointer'
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        <Icon className='mg1l' />
        <span className='mg1l agent-tool-name'>{name}</span>
        {renderTag()}
        {renderStatus()}
      </div>
      {expanded && (
        <div className='agent-tool-detail'>
          {args && Object.keys(args).length > 0 && (
            <div className='agent-tool-args'>
              <div className='agent-tool-label'>{aiAgentCopy.toolCall.argumentsLabel}:</div>
              <pre className='agent-tool-pre'>{JSON.stringify(args, null, 2)}</pre>
            </div>
          )}
          {result && (
            <div className='agent-tool-result'>
              <div className='agent-tool-label'>{aiAgentCopy.toolCall.resultLabel}:</div>
              <pre className='agent-tool-pre'>{formatResult(result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
