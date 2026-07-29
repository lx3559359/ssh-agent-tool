import { auto } from 'manate/react'
import { useEffect, useRef, useState } from 'react'
import classnames from 'classnames'
import { Alert, Button, Modal } from 'antd'
import {
  CloseOutlined,
  DatabaseOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import IncidentList from './incident-list'
import IncidentDetail from './incident-detail'
import IncidentStorageModal from './incident-storage-modal'
import { focusIncidentWorkspace } from './incident-navigation'
import './incidents.styl'

const e = window.translate

export default auto(function IncidentWorkspace ({
  store,
  shellGeometry,
  active
}) {
  const workspaceRef = useRef(null)
  const [creating, setCreating] = useState(false)
  const [detailDirty, setDetailDirty] = useState(false)

  useEffect(() => {
    if (!active) return
    store.loadIncidentArchives()
    store.loadIncidentSummary()
    focusIncidentWorkspace(true, workspaceRef.current)
  }, [active])

  const continueAfterDirtyCheck = action => {
    if (!detailDirty) {
      action()
      return
    }
    Modal.confirm({
      title: e('shellpilotIncidentUnsavedTitle'),
      content: e('shellpilotIncidentUnsavedMessage'),
      okText: e('shellpilotIncidentDiscardAndContinue'),
      cancelText: e('shellpilotIncidentKeepEditing'),
      onOk: action
    })
  }
  const openCreate = () => {
    continueAfterDirtyCheck(() => {
      store.selectIncidentArchive('')
      setCreating(true)
      setDetailDirty(false)
    })
  }
  const selectIncident = id => {
    continueAfterDirtyCheck(() => {
      setCreating(false)
      setDetailDirty(false)
      store.selectIncidentArchive(id)
    })
  }
  const closeWorkspace = () => {
    continueAfterDirtyCheck(() => {
      setCreating(false)
      setDetailDirty(false)
      store.closeIncidentArchiveWorkspace()
    })
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
            onClick={closeWorkspace}
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
          onSelect={selectIncident}
        />
        <IncidentDetail
          store={store}
          creating={creating}
          onCreated={() => setCreating(false)}
          onCancelCreate={() => continueAfterDirtyCheck(() => {
            setCreating(false)
            setDetailDirty(false)
          })}
          onDirtyChange={setDetailDirty}
        />
      </div>
      <IncidentStorageModal store={store} />
    </main>
  )
})
