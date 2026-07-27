import { useEffect, useState } from 'react'
import { Button, Dropdown, Modal, message } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  ReloadOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { artifactClient } from './artifact-client'
import './artifacts.styl'

const e = window.translate

const formatLabels = Object.freeze({
  md: 'Markdown',
  csv: 'CSV',
  docx: 'Word',
  xlsx: 'Excel',
  pdf: 'PDF',
  html: e('shellpilotArtifactWebFormat')
})

function latestOutput (artifact = {}) {
  const outputs = Array.isArray(artifact.outputs) ? artifact.outputs : []
  return outputs.at(-1) || {}
}

export default function ArtifactCard ({ artifactId }) {
  const [artifact, setArtifact] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    artifactClient.getArtifact(artifactId)
      .then(value => {
        if (active) setArtifact(value)
      })
      .catch(error => {
        if (active) message.error(error?.message || e('shellpilotArtifactReadFailed'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [artifactId])

  const openPreview = () => {
    window.store.openArtifactWorkspace(artifactId)
  }

  const regenerate = async () => {
    if (!artifact) return
    const formats = (artifact.outputs || [])
      .map(output => output.format)
      .filter(Boolean)
    await artifactClient.generateArtifact(
      artifactId,
      artifact.version,
      formats.length ? formats : ['md']
    )
    message.success(e('shellpilotArtifactRegenerated'))
    setArtifact(await artifactClient.getArtifact(artifactId))
  }

  const remove = () => {
    Modal.confirm({
      title: e('shellpilotArtifactDeleteTitle'),
      content: e('shellpilotArtifactDeleteDescription'),
      okText: e('shellpilotDelete'),
      okButtonProps: { danger: true },
      cancelText: e('cancel'),
      onOk: async () => {
        await artifactClient.deleteArtifact(artifactId)
        message.success(e('shellpilotArtifactDeleted'))
      }
    })
  }

  const output = latestOutput(artifact)
  const status = output.format
    ? e('shellpilotArtifactGenerated')
    : e('shellpilotArtifactDraft')
  const formatLabel = formatLabels[output.format] || e('shellpilotArtifactMultiFormat')
  const items = [
    {
      key: 'save',
      icon: <DownloadOutlined />,
      label: e('shellpilotArtifactSaveLocal'),
      onClick: openPreview
    },
    {
      key: 'open',
      icon: <FolderOpenOutlined />,
      label: e('shellpilotArtifactOpenExternal'),
      onClick: openPreview
    },
    {
      key: 'upload',
      icon: <UploadOutlined />,
      label: e('shellpilotArtifactUploadServer'),
      onClick: openPreview
    },
    {
      key: 'regenerate',
      icon: <ReloadOutlined />,
      label: e('shellpilotArtifactRegenerate'),
      onClick: regenerate
    },
    { type: 'divider' },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      danger: true,
      label: e('shellpilotDelete'),
      onClick: remove
    }
  ]

  return (
    <article className='artifact-card'>
      <FileDoneOutlined className='artifact-card-icon' />
      <div className='artifact-card-copy'>
        <strong>{artifact?.title || (
          loading
            ? e('shellpilotArtifactLoading')
            : e('shellpilotArtifactFallbackName')
        )}
        </strong>
        <span>
          {formatLabel} · {e('shellpilotArtifactVersionStatus')
            .replace('{version}', artifact?.version || 1)
            .replace('{status}', status)}
        </span>
      </div>
      <Button type='primary' ghost onClick={openPreview} disabled={loading}>
        {e('shellpilotArtifactPreview')}
      </Button>
      <Dropdown menu={{ items }} trigger={['click']}>
        <Button
          aria-label={e('shellpilotArtifactMoreActions')}
          icon={<MoreOutlined />}
          disabled={loading}
        />
      </Dropdown>
    </article>
  )
}
