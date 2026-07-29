import { auto } from 'manate/react'
import { useEffect, useRef, useState } from 'react'
import classnames from 'classnames'
import { Alert, Button, Empty } from 'antd'
import {
  CloseOutlined,
  DatabaseOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import IncidentList from './incident-list'
import { focusIncidentWorkspace } from './incident-navigation'
import './incidents.styl'

const e = window.translate

function IncidentDetail ({ creating }) {
  return (
    <section className='incident-detail-panel'>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={creating
          ? e('shellpilotIncidentCreatePrompt')
          : e('shellpilotIncidentSelectPrompt')}
      />
    </section>
  )
}

export default auto(function IncidentWorkspace ({
  store,
  shellGeometry,
  active
}) {
  const workspaceRef = useRef(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!active) return
    store.loadIncidentArchives()
    store.loadIncidentSummary()
    focusIncidentWorkspace(true, workspaceRef.current)
  }, [active])

  const openCreate = () => {
    store.selectIncidentArchive('')
    setCreating(true)
  }
  const openStorage = () => {
    store.incidentStorageOpen = true
    store.loadIncidentStorage()
  }

  return (
    <main
      ref={workspaceRef}
      tabIndex={active ? -1 : undefined}
      className={classnames('incident-workspace', {
        'incident-workspace-active': active
      })}
      style={shellGeometry.terminalInsets}
      aria-hidden={!active}
    >
      <header className='incident-workspace-header'>
        <div>
          <h1>{e('shellpilotIncidentArchive')}</h1>
          <p>{e('shellpilotIncidentArchiveSubtitle')}</p>
        </div>
        <div className='incident-workspace-actions'>
          <Button
            icon={<ReloadOutlined />}
            loading={store.incidentLoading}
            onClick={() => store.loadIncidentArchives()}
          >
            {e('refresh')}
          </Button>
          <Button
            icon={<DatabaseOutlined />}
            onClick={openStorage}
          >
            {e('shellpilotIncidentStorage')}
          </Button>
          <Button
            aria-label={e('shellpilotIncidentClose')}
            icon={<CloseOutlined />}
            onClick={() => store.closeIncidentArchiveWorkspace()}
          />
        </div>
      </header>

      {store.incidentError && (
        <Alert
          className='incident-workspace-error'
          type='error'
          showIcon
          message={store.incidentError}
        />
      )}

      <div className='incident-workspace-grid'>
        <IncidentList
          store={store}
          onCreate={openCreate}
          onOpenStorage={openStorage}
        />
        <IncidentDetail
          store={store}
          creating={creating}
          onCancelCreate={() => setCreating(false)}
        />
      </div>
    </main>
  )
})
