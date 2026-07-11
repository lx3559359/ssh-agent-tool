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
    () => getConnectionInfoFields(bookmark || {}, { showSecrets, bookmarkGroups }),
    [bookmark, showSecrets, bookmarkGroups]
  )

  if (!bookmark) {
    return null
  }

  const handleCopyAll = () => {
    copy(formatConnectionInfoText(bookmark, { showSecrets, bookmarkGroups }))
  }

  const handleCopyValue = (field) => {
    copy(String((showSecrets ? field.rawValue : field.value) ?? ''))
  }

  const handleExport = () => {
    if (!window.confirm('将导出当前连接的明文账号、密码和密钥路径，请只保存在可信位置。是否继续？')) {
      return
    }
    const txt = '\uFEFF' + createConnectionInventoryCsv([bookmark], {
      headerType: 'label',
      bookmarkGroups
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
        {showSecrets ? '隐藏密码' : '显示密码'}
      </Button>
      <Button icon={<CopyOutlined />} onClick={handleCopyAll}>
        复制全部
      </Button>
      <Button icon={<DownloadOutlined />} onClick={handleExport}>
        导出当前连接
      </Button>
      <Button type='primary' onClick={onClose}>
        关闭
      </Button>
    </Space>
  )

  return (
    <Modal
      open
      title='连接信息'
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
                复制
              </Button>
            </div>
          ))
        }
      </div>
    </Modal>
  )
}
