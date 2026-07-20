import { useMemo, useState } from 'react'
import { Button, Space } from 'antd'
import {
  CopyOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  EyeOutlined
} from '@ant-design/icons'
import Modal from '../common/modal'
import { copy } from '../../common/clipboard'
import download from '../../common/download'
import time from '../../common/time'
import {
  createConnectionInventoryCsv,
  formatConnectionInfoText,
  getConnectionInfoFields
} from '../../common/connection-inventory'

const e = window.translate

function safeName (value = 'connection') {
  return String(value || 'connection')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export default function ConnectionInfoModal ({
  bookmark,
  bookmarkGroups = [],
  onClose
}) {
  const [showSecrets, setShowSecrets] = useState(false)
  const fields = useMemo(
    () => getConnectionInfoFields(bookmark || {}, { showSecrets, bookmarkGroups, translate: e }),
    [bookmark, showSecrets, bookmarkGroups]
  )

  if (!bookmark) {
    return null
  }

  const handleCopyAll = () => {
    copy(formatConnectionInfoText(bookmark, { showSecrets, bookmarkGroups, translate: e }))
  }

  const handleCopyValue = (field) => {
    copy(String((showSecrets ? field.rawValue : field.value) ?? ''))
  }

  const handleExport = () => {
    if (!window.confirm(e('shellpilotCurrentConnectionExportWarning'))) {
      return
    }
    const txt = '\uFEFF' + createConnectionInventoryCsv([bookmark], {
      headerType: 'label',
      bookmarkGroups,
      translate: e
    })
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download(`shellpilot-connection-${safeName(bookmark.title || bookmark.host)}-${stamp}.csv`, txt)
  }

  const footer = (
    <Space>
      <Button
        icon={showSecrets ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        onClick={() => setShowSecrets(!showSecrets)}
      >
        {showSecrets ? e('shellpilotHidePassword') : e('shellpilotShowPassword')}
      </Button>
      <Button icon={<CopyOutlined />} onClick={handleCopyAll}>
        {e('shellpilotCopyAll')}
      </Button>
      <Button icon={<DownloadOutlined />} onClick={handleExport}>
        {e('shellpilotExportCurrentConnection')}
      </Button>
      <Button type='primary' onClick={onClose}>
        {e('shellpilotClose')}
      </Button>
    </Space>
  )

  return (
    <Modal
      open
      title={e('shellpilotConnectionInfo')}
      width={640}
      onCancel={onClose}
      footer={footer}
      wrapClassName='connection-info-modal'
    >
      <div className='connection-info-list'>
        {
          fields.map(field => (
            <div className='connection-info-row' key={field.key}>
              <div className='connection-info-label'>{field.label}</div>
              <div className='connection-info-value' title={String(field.value ?? '')}>
                {String(field.value ?? '') || '-'}
              </div>
              <Button
                size='small'
                icon={<CopyOutlined />}
                onClick={() => handleCopyValue(field)}
                disabled={!field.hasValue}
              >
                {e('shellpilotCopy')}
              </Button>
            </div>
          ))
        }
      </div>
    </Modal>
  )
}
