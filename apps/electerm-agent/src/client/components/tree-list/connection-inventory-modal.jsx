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
    const ok = window.confirm('将导出包含明文密码/密钥路径的连接清单 CSV，请只保存在可信位置。是否继续？')
    if (!ok) {
      return
    }
    const txt = '\uFEFF' + createConnectionInventoryCsv(bookmarks, {
      headerType: 'label',
      bookmarkGroups
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
        导出连接清单 CSV
      </Button>
      <Button type='primary' onClick={onClose}>
        关闭
      </Button>
    </Space>
  )

  return (
    <Modal
      open
      title='服务器详情'
      width={780}
      onCancel={onClose}
      footer={footer}
      wrapClassName='connection-inventory-modal'
    >
      <div className='connection-inventory-head'>
        <ProfileOutlined />
        <span>集中查看已保存服务器，单个连接可查看账号、端口、密码并复制或导出。</span>
      </div>
      {
        !bookmarks.length
          ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description='暂无已保存服务器，请先新建并保存 SSH 连接。'
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
                        <span>IP/主机：{hostOf(bookmark)}</span>
                        <span>端口：{portOf(bookmark)}</span>
                        <span>账号：{userOf(bookmark)}</span>
                      </div>
                    </div>
                    <Button
                      size='small'
                      icon={<EyeOutlined />}
                      onClick={() => onViewConnectionInfo(bookmark)}
                    >
                      查看连接信息
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
