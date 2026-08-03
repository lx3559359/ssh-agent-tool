import { auto } from 'manate/react'
import { useEffect } from 'react'
import classnames from 'classnames'
import { Alert, Button, Modal } from 'antd'
import { CloseOutlined, ReloadOutlined } from '@ant-design/icons'
import ArtifactList from './artifact-list'
import ArtifactPreview from './artifact-preview'
import './artifacts.styl'

const e = window.translate

export default auto(function ArtifactWorkspace ({
  store,
  shellGeometry,
  active
}) {
  useEffect(() => {
    if (active) store.loadArtifacts()
  }, [active])

  const deleteArtifact = artifact => {
    Modal.confirm({
      title: e('shellpilotArtifactDeleteConfirm'),
      content: e('shellpilotArtifactDeleteLocalOnly'),
      okText: e('delete'),
      cancelText: e('cancel'),
      okButtonProps: { danger: true },
      onOk: () => store.deleteArtifact(artifact.id)
    })
  }

  return (
    <main
      className={classnames('artifact-workspace', {
        'artifact-workspace-active': active
      })}
      style={shellGeometry.terminalInsets}
      aria-hidden={!active}
    >
      <header className='artifact-workspace-header'>
        <div>
          <h1>{e('shellpilotArtifactWorkspaceModule')}</h1>
          <p>{e('shellpilotArtifactWorkspaceSubtitle')}</p>
        </div>
        <div className='artifact-workspace-header-actions'>
          <Button
            icon={<ReloadOutlined />}
            loading={store.artifactLoading}
            onClick={() => store.loadArtifacts()}
          >
            {e('refresh')}
          </Button>
          <Button
            aria-label={e('shellpilotArtifactWorkspaceClose')}
            icon={<CloseOutlined />}
            onClick={() => store.closeArtifactWorkspace()}
          />
        </div>
      </header>
      {store.artifactError && (
        <Alert
          className='artifact-workspace-error'
          type='error'
          showIcon
          message={store.artifactError}
          action={
            <Button size='small' onClick={() => store.loadArtifacts()}>
              {e('retry')}
            </Button>
          }
        />
      )}
      <div className='artifact-workspace-grid'>
        <ArtifactList store={store} onDelete={deleteArtifact} />
        <ArtifactPreview artifact={store.activeArtifact} store={store} />
      </div>
    </main>
  )
})
