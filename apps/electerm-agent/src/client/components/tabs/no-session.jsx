import { Button } from 'antd'
import {
  ApiOutlined,
  CodeOutlined,
  HistoryOutlined,
  PlusOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import HistoryPanel from '../sidebar/history'
import IncidentHomeSummary from '../incidents/incident-home-summary'
import './no-session.styl'

const e = window.translate

export default function NoSessionPanel ({ height, onNewTab, onNewSsh, batch }) {
  const props = {
    style: {
      height: height + 'px'
    }
  }
  const handleClick = () => {
    window.openTabBatch = batch
  }

  const handleOpenHelp = () => {
    window.dispatchEvent(new Event('shellpilot-open-help-center'))
  }

  const handleShowRecent = () => {
    document.querySelector('.no-session-recents')?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    })
  }

  const handleConfigureAI = () => {
    window.store.toggleAIConfig()
  }

  const newTabDom = window.store.hasNodePty
    ? (
      <Button
        onClick={onNewTab}
        type='text'
        className='no-session-action add-new-tab-btn'
        icon={<CodeOutlined />}
      >
        <span className='no-session-action-copy'>
          <strong>{e('shellpilotHomeLocalTerminal')}</strong>
          <small>{e('shellpilotHomeLocalTerminalHint')}</small>
        </span>
      </Button>
      )
    : null
  return (
    <div className='no-sessions' {...props}>
      <div className='no-session-shell'>
        <header className='no-session-heading'>
          <div className='no-session-heading-title'>
            <span className='no-session-mark'>
              <CodeOutlined />
            </span>
            <span>
              <strong>{e('shellpilotHomeWorkspace')}</strong>
              <small>ShellPilot</small>
            </span>
          </div>
          <span className='no-session-status'>
            {e('shellpilotTopbarDisconnected')}
          </span>
        </header>
        <div className='no-session-start-hint'>
          <span>{e('shellpilotHomeStartHint')}</span>
          <Button type='link' size='small' onClick={onNewSsh}>
            {e('shellpilotHomeStartAction')}
          </Button>
        </div>
        <div className='no-session-actions'>
          <Button
            onClick={onNewSsh}
            type='text'
            className='no-session-action no-session-action-primary'
            icon={<PlusOutlined />}
          >
            <span className='no-session-action-copy'>
              <strong>{e('shellpilotHomeNewConnection')}</strong>
              <small>{e('shellpilotHomeNewConnectionHint')}</small>
            </span>
          </Button>
          <Button
            onClick={handleShowRecent}
            type='text'
            className='no-session-action'
            icon={<HistoryOutlined />}
          >
            <span className='no-session-action-copy'>
              <strong>{e('shellpilotHomeRecentConnections')}</strong>
              <small>{e('shellpilotHomeNoRecentConnections')}</small>
            </span>
          </Button>
          <Button
            onClick={handleConfigureAI}
            type='text'
            className='no-session-action'
            icon={<ApiOutlined />}
          >
            <span className='no-session-action-copy'>
              <strong>{e('shellpilotTopbarModelApi')}</strong>
              <small>{e('shellpilotAiConfigureHint')}</small>
            </span>
          </Button>
          <Button
            onClick={handleOpenHelp}
            type='text'
            className='no-session-action'
            icon={<QuestionCircleOutlined />}
          >
            <span className='no-session-action-copy'>
              <strong>{e('shellpilotTopbarHelp')}</strong>
              <small>{e('shellpilotHomeStartHint')}</small>
            </span>
          </Button>
        </div>
        {newTabDom ? <div className='no-session-secondary-actions'>{newTabDom}</div> : null}
        <IncidentHomeSummary store={window.store} />
        <section className='no-session-recents'>
          <header className='no-session-recents-heading'>
            <span>
              <HistoryOutlined />
              <strong>{e('shellpilotHomeRecentConnections')}</strong>
            </span>
          </header>
          <div className='no-session-history' onClick={handleClick}>
            <HistoryPanel sort emptyText={e('shellpilotHomeNoRecentConnections')} />
          </div>
        </section>
      </div>
    </div>
  )
}
