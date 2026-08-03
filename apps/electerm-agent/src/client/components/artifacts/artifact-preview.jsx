import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Segmented, message } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  UploadOutlined
} from '@ant-design/icons'
import {
  saveArtifactExport,
  uploadArtifactToCurrentServer
} from './artifact-export-actions'
import DocumentPreview from './document-preview'
import SpreadsheetPreview from './spreadsheet-preview'

const e = window.translate

const DOCUMENT_FORMATS = ['md', 'docx', 'pdf', 'html']
const SPREADSHEET_FORMATS = ['csv', 'xlsx']
const FORMAT_OPTIONS = [
  { label: 'Markdown', value: 'md' },
  { label: e('shellpilotArtifactFormatWord'), value: 'docx' },
  { label: e('shellpilotArtifactFormatPdf'), value: 'pdf' },
  { label: e('shellpilotArtifactWebFormat'), value: 'html' },
  { label: e('shellpilotArtifactFormatCsv'), value: 'csv' },
  { label: e('shellpilotArtifactFormatExcel'), value: 'xlsx' }
]

function safeRemoteFilename (value) {
  return [...String(value || '')]
    .map(character => {
      const code = character.charCodeAt(0)
      return code <= 31 || '<>:"/\\|?*'.includes(character)
        ? '-'
        : character
    })
    .join('')
    .replace(/[.\s]+$/g, '')
    .slice(0, 100)
}

export default function ArtifactPreview ({ artifact, store }) {
  const [format, setFormat] = useState('md')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [remotePath, setRemotePath] = useState('')
  const source = artifact?.source || {}

  useEffect(() => {
    if (!artifact) return
    const available = (artifact.versions || [])
      .find(item => item.version === artifact.version)
      ?.formats
      ?.map(item => typeof item === 'string' ? item : item.format) || []
    setFormat(available[0] || (
      source.tables?.length && !source.sections?.length ? 'xlsx' : 'md'
    ))
  }, [artifact?.id, artifact?.version])

  const saveDraft = async draft => {
    if (!artifact || !store) return
    const updated = await store.createArtifactVersion(artifact.id, draft)
    if (!updated) throw new Error(e('shellpilotArtifactAutoSaveFailed'))
  }

  const saveArtifact = async openAfterSave => {
    if (!artifact) return
    setSaving(true)
    try {
      const result = await saveArtifactExport({
        artifactId: artifact.id,
        version: artifact.version,
        format,
        openAfterSave
      })
      if (!result?.canceled) {
        message.success(
          openAfterSave
            ? e('shellpilotArtifactSavedAndOpened')
            : e('shellpilotArtifactSaved')
        )
      }
    } catch (error) {
      message.error(error?.message || e('shellpilotArtifactSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const openUploadDialog = () => {
    if (!artifact) return
    const fallbackName = e('shellpilotArtifactFallbackFilename')
    const safeTitle = safeRemoteFilename(artifact.title || fallbackName)
    setRemotePath(`/tmp/${safeTitle || fallbackName}.${format}`)
    setUploadDialogOpen(true)
  }

  const uploadArtifact = async () => {
    if (!artifact) return
    setUploading(true)
    try {
      await uploadArtifactToCurrentServer({
        artifactId: artifact.id,
        version: artifact.version,
        format,
        remotePath
      })
      setUploadDialogOpen(false)
      message.success(e('shellpilotArtifactUploadQueued'))
    } catch (error) {
      message.error(error?.message || e('shellpilotArtifactUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const deleteArtifact = () => {
    Modal.confirm({
      title: e('shellpilotArtifactDeleteConfirm'),
      content: e('shellpilotArtifactDeleteLocalOnly'),
      okText: e('delete'),
      cancelText: e('cancel'),
      okButtonProps: { danger: true },
      onOk: () => store.deleteArtifact(artifact.id)
    })
  }

  if (!artifact) {
    return (
      <section className='artifact-preview artifact-preview-empty'>
        <FileTextOutlined />
        <h2>{e('shellpilotArtifactSelect')}</h2>
        <p>{e('shellpilotArtifactSelectHint')}</p>
      </section>
    )
  }

  return (
    <section className='artifact-preview'>
      <header className='artifact-preview-header'>
        <div>
          <h2 title={artifact.title}>{artifact.title}</h2>
          <p>
            {artifact.server || e('shellpilotArtifactUnlinkedServer')} · {
              e('shellpilotArtifactVersion')
                .replace('{version}', artifact.version)
            }
          </p>
        </div>
        <div className='artifact-preview-actions'>
          <Segmented
            value={format}
            options={FORMAT_OPTIONS}
            onChange={setFormat}
          />
          <Button
            icon={<DownloadOutlined />}
            loading={saving}
            onClick={() => saveArtifact(false)}
          >
            {e('shellpilotArtifactSaveLocal')}
          </Button>
          <Button
            icon={<FolderOpenOutlined />}
            disabled={saving}
            onClick={() => saveArtifact(true)}
          >
            {e('shellpilotArtifactOpenExternal')}
          </Button>
          <Button
            icon={<UploadOutlined />}
            disabled={saving || uploading}
            onClick={openUploadDialog}
          >
            {e('shellpilotArtifactUploadServer')}
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={saving || uploading}
            onClick={deleteArtifact}
          >
            {e('delete')}
          </Button>
        </div>
      </header>
      {!source.schemaVersion && (
        <Alert
          type='warning'
          showIcon
          message={e('shellpilotArtifactMissingSource')}
        />
      )}
      <div className='artifact-preview-body' data-format={format}>
        {DOCUMENT_FORMATS.includes(format) && (
          <DocumentPreview source={source} onSave={saveDraft} />
        )}
        {SPREADSHEET_FORMATS.includes(format) && (
          <SpreadsheetPreview source={source} onSave={saveDraft} />
        )}
      </div>
      <Modal
        title={e('shellpilotArtifactUploadTitle')}
        open={uploadDialogOpen}
        okText={e('shellpilotArtifactQueueUpload')}
        cancelText={e('cancel')}
        confirmLoading={uploading}
        onOk={uploadArtifact}
        onCancel={() => !uploading && setUploadDialogOpen(false)}
        destroyOnHidden
      >
        <label className='artifact-upload-field'>
          <span>{e('shellpilotArtifactRemotePath')}</span>
          <Input
            value={remotePath}
            onChange={event => setRemotePath(event.target.value)}
            placeholder={e('shellpilotArtifactRemotePathPlaceholder')}
            onPressEnter={uploadArtifact}
          />
          <small>{e('shellpilotArtifactUploadHint')}</small>
        </label>
      </Modal>
    </section>
  )
}
