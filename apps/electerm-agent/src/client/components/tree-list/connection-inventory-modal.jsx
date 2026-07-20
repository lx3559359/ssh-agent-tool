import { Button, Empty, Space } from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  ProfileOutlined
} from '@ant-design/icons'
import Modal from '../common/modal'
import download from '../../common/download'
import time from '../../common/time'
import createName from '../../common/create-title'
import { createConnectionInventoryCsv } from '../../common/connection-inventory'

const e = window.translate

function hostOf (bookmark = {}) {
  return bookmark.host || bookmark.hostname || bookmark.url || bookmark.path || '-'
}

function userOf (bookmark = {}) {
  return bookmark.username || bookmark.user || '-'
}

function portOf (bookmark = {}) {
  return bookmark.port || '-'
}

export default function ConnectionInventoryModal ({
  bookmarks = [],
  bookmarkGroups = [],
  onClose,
  onViewConnectionInfo
}) {
  const handleExport = () => {
    const ok = window.confirm(e('shellpilotConnectionCsvWarning'))
    if (!ok) {
      return
    }
    const txt = '\uFEFF' + createConnectionInventoryCsv(bookmarks, {
      headerType: 'label',
      bookmarkGroups,
      translate: e
    })
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('shellpilot-connections-with-credentials-' + stamp + '.csv', txt)
  }

  const footer = (
    <Space>
      <Button
        icon={<DownloadOutlined />}
        onClick={handleExport}
        disabled={!bookmarks.length}
      >
        {e('shellpilotExportConnectionCsv')}
      </Button>
      <Button type='primary' onClick={onClose}>
        {e('shellpilotClose')}
      </Button>
    </Space>
  )

  return (
    <Modal
      open
      title={e('shellpilotServerDetails')}
      width={780}
      onCancel={onClose}
      footer={footer}
      wrapClassName='connection-inventory-modal'
    >
      <div className='connection-inventory-head'>
        <ProfileOutlined />
        <span>{e('shellpilotServerDetailsDescription')}</span>
      </div>
      {
        !bookmarks.length
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={e('shellpilotNoSavedServers')}
            />
            )
          : (
            <div className='connection-inventory-list'>
              {
                bookmarks.map(bookmark => (
                  <div className='connection-inventory-row' key={bookmark.id}>
                    <div className='connection-inventory-main'>
                      <div className='connection-inventory-title'>{createName(bookmark)}</div>
                      <div className='connection-inventory-meta'>
                        <span>{e('shellpilotIpHost')}：{hostOf(bookmark)}</span>
                        <span>{e('shellpilotPort')}：{portOf(bookmark)}</span>
                        <span>{e('shellpilotAccount')}：{userOf(bookmark)}</span>
                      </div>
                    </div>
                    <Button
                      size='small'
                      icon={<EyeOutlined />}
                      onClick={() => onViewConnectionInfo(bookmark)}
                    >
                      {e('shellpilotViewConnectionInfo')}
                    </Button>
                  </div>
                ))
              }
            </div>
            )
      }
    </Modal>
  )
}
