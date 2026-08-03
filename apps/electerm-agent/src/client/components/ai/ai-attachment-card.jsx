import { useEffect, useState } from 'react'
import {
  CloseOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { getAIAttachmentPresentation } from './ai-attachments'

function renderFileIcon (presentation) {
  if (presentation.kind === 'web') return <GlobalOutlined />
  if (presentation.extension === 'pdf') return <FilePdfOutlined />
  if (['doc', 'docx'].includes(presentation.extension)) {
    return <FileWordOutlined />
  }
  if (['xls', 'xlsx', 'csv'].includes(presentation.extension)) {
    return <FileExcelOutlined />
  }
  if (['ppt', 'pptx'].includes(presentation.extension)) {
    return <FilePptOutlined />
  }
  return <FileTextOutlined />
}

function canPreviewLocalImage (attachment, presentation) {
  return presentation.kind === 'image' &&
    attachment.source === 'local' &&
    typeof Blob !== 'undefined' &&
    attachment.file instanceof Blob &&
    typeof URL?.createObjectURL === 'function'
}

export default function AIAttachmentCard ({
  attachment,
  onRemove,
  onFocus,
  removeLabel = 'Remove attachment'
}) {
  const presentation = getAIAttachmentPresentation(attachment)
  const [previewUrl, setPreviewUrl] = useState('')
  const name = String(attachment.name || '')

  useEffect(() => {
    setPreviewUrl('')
    if (!canPreviewLocalImage(attachment, presentation)) return undefined

    const objectUrl = URL.createObjectURL(attachment.file)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [attachment, attachment.file, attachment.source, presentation.kind])

  return (
    <div
      className={`ai-attachment-chip ai-attachment-card ai-attachment-card-${presentation.kind}`}
      onFocus={onFocus}
      title={attachment.path || name}
    >
      {
        presentation.kind === 'image'
          ? (
            <div className='ai-attachment-preview'>
              {
                previewUrl
                  ? <img className='ai-attachment-preview-image' src={previewUrl} alt={name} />
                  : <FileImageOutlined className='ai-attachment-preview-fallback' />
              }
            </div>
            )
          : (
            <>
              <span className='ai-attachment-file-icon' aria-hidden='true'>
                {renderFileIcon(presentation)}
              </span>
              <span className='ai-attachment-file-copy'>
                <strong>{name}</strong>
                <small>{presentation.meta}</small>
              </span>
            </>
            )
      }
      <button
        type='button'
        className='ai-attachment-remove'
        onClick={() => onRemove(attachment.id)}
        aria-label={`${removeLabel} ${name}`.trim()}
        title={`${removeLabel} ${name}`.trim()}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}
