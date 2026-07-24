import { Button } from 'antd'
import {
  CodeOutlined,
  HistoryOutlined,
  PlusOutlined,
  RobotOutlined
} from '@ant-design/icons'
import HistoryPanel from '../sidebar/history'
import QuickConnect from './quick-connect'
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

  const handleCreateAIBookmark = () => {
    window.store.onNewSshAI()
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
          {newTabDom}
          <Button
            onClick={handleCreateAIBookmark}
            type='text'
            className='no-session-action'
            icon={<RobotOutlined />}
          >
            <span className='no-session-action-copy'>
              <strong>{e('createBookmarkByAI')}</strong>
              <small>{e('shellpilotHomeAiConnectionHint')}</small>
            </span>
          </Button>
          <div className='no-session-quick-connect'>
            <QuickConnect batch={batch} />
            <small className='no-session-quick-connect-hint'>
              {e('shellpilotHomeQuickConnectHint')}
            </small>
          </div>
        </div>
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
