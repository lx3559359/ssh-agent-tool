import { auto } from 'manate/react'
import { useEffect, useRef, useState } from 'react'
import classnames from 'classnames'
import { Alert, Button, Modal } from 'antd'
import {
  CloseOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import IncidentList from './incident-list'
import IncidentDetail from './incident-detail'
import IncidentCandidateList from './incident-candidate-list'
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
  const [workspaceView, setWorkspaceView] = useState('archives')
  const [detailDirty, setDetailDirty] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    Boolean(store.activeIncidentId)
  )

  useEffect(() => {
    if (!active) return
    store.loadIncidentArchives()
    store.loadIncidentSummary()
    store.loadIncidentCandidates()
    focusIncidentWorkspace(true, workspaceRef.current)
  }, [active])

  useEffect(() => {
    if (active && store.activeIncidentId) setMobileDetailOpen(true)
  }, [active, store.activeIncidentId])

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
      setWorkspaceView('archives')
      store.selectIncidentArchive('')
      setCreating(true)
      setDetailDirty(false)
      setMobileDetailOpen(true)
    })
  }
  const selectIncident = id => {
    continueAfterDirtyCheck(() => {
      setWorkspaceView('archives')
      setCreating(false)
      setDetailDirty(false)
      store.selectIncidentArchive(id)
      setMobileDetailOpen(true)
    })
  }
  const closeWorkspace = () => {
    continueAfterDirtyCheck(() => {
      setCreating(false)
      setDetailDirty(false)
      setMobileDetailOpen(false)
      store.closeIncidentArchiveWorkspace()
    })
  }
  const showIncidentList = () => {
    continueAfterDirtyCheck(() => {
      setCreating(false)
      setDetailDirty(false)
      setMobileDetailOpen(false)
    })
  }
  const openStorage = () => {
    store.incidentStorageOpen = true
    store.loadIncidentStorage()
  }
  const openCandidateView = () => {
    continueAfterDirtyCheck(() => {
      setCreating(false)
      setDetailDirty(false)
      setWorkspaceView('candidates')
      store.loadIncidentCandidates()
    })
  }
  const openArchiveView = id => {
    setWorkspaceView('archives')
    if (id) selectIncident(id)
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
            type={workspaceView === 'candidates' ? 'primary' : 'default'}
            icon={<FileDoneOutlined />}
            onClick={openCandidateView}
          >
            {e('shellpilotIncidentPendingCandidates')}{' '}
            {store.incidentPendingCandidateTotal || 0}
          </Button>
          <Button
            type={workspaceView === 'archives' ? 'primary' : 'default'}
            onClick={() => openArchiveView()}
          >
            {e('shellpilotIncidentFormalArchives')}
          </Button>
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

      {workspaceView === 'candidates'
        ? (
          <IncidentCandidateList
            store={store}
            onOpenIncident={openArchiveView}
          />
          )
        : (
          <div
            className={classnames('incident-workspace-grid', {
              'incident-workspace-show-detail': mobileDetailOpen
            })}
          >
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
              onBack={showIncidentList}
              onCancelCreate={() => continueAfterDirtyCheck(() => {
                setCreating(false)
                setDetailDirty(false)
                setMobileDetailOpen(false)
              })}
              onDirtyChange={setDetailDirty}
            />
          </div>
          )}
      <IncidentStorageModal store={store} />
    </main>
  )
})
