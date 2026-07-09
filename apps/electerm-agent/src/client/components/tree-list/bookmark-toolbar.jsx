import {
  BookOutlined,
  FolderOutlined,
  ImportOutlined,
  ExportOutlined,
  CodeOutlined,
  MenuOutlined,
  EditOutlined,
  ProfileOutlined
} from '@ant-design/icons'
import { Button, Space, Dropdown, Flex } from 'antd'
import time from '../../common/time'
import download from '../../common/download'
import Upload from '../common/upload'
import { beforeBookmarkUpload } from './bookmark-upload'
import {
  createBookmarkBackup,
  createEncryptedBookmarkBackup
} from '../../common/bookmark-backup'
import { packInfo } from '../../common/constants'
import { createConnectionInventoryCsv } from '../../common/connection-inventory'

const e = window.translate

export default function BookmarkToolbar (props) {
  const {
    onNewBookmark,
    onNewBookmarkGroup,
    onSshConfigs,
    onConnectionInventory,
    bookmarkGroups,
    bookmarks
  } = props
  const beforeUpload = beforeBookmarkUpload

  const handleDownload = () => {
    const backup = createBookmarkBackup({
      bookmarkGroups,
      bookmarks,
      version: packInfo.version
    })
    const txt = JSON.stringify(backup, null, 2)
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('aigshell-bookmarks-backup-' + stamp + '.json', txt)
  }
  const handleDownloadWithoutCredentials = () => {
    const backup = createBookmarkBackup({
      bookmarkGroups,
      bookmarks,
      version: packInfo.version,
      includeCredentials: false
    })
    const txt = JSON.stringify(backup, null, 2)
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('aigshell-bookmarks-no-credentials-' + stamp + '.json', txt)
  }
  const handleDownloadEncrypted = async () => {
    const passphrase = window.prompt('请输入备份加密密码')
    if (!passphrase) {
      return
    }
    const backup = await createEncryptedBookmarkBackup({
      bookmarkGroups,
      bookmarks,
      version: packInfo.version,
      passphrase
    })
    const txt = JSON.stringify(backup, null, 2)
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('aigshell-bookmarks-encrypted-' + stamp + '.json', txt)
  }
  const handleDownloadConnectionInventory = () => {
    const ok = window.confirm('将导出包含明文密码/密钥路径的连接清单 CSV，请只保存在可信位置。是否继续？')
    if (!ok) {
      return
    }
    const txt = '\uFEFF' + createConnectionInventoryCsv(bookmarks)
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('shellpilot-connections-with-credentials-' + stamp + '.csv', txt)
  }
  const handleToggleEdit = () => {
    window.store.bookmarkSelectMode = true
  }
  const titleNew = `${e('new')} ${e('bookmarks')}`
  const titleEdit = `${e('new')} ${e('bookmarkCategory')}`
  const items = [
    {
      label: titleNew,
      onClick: onNewBookmark,
      icon: <BookOutlined />
    },
    {
      label: titleEdit,
      onClick: onNewBookmarkGroup,
      icon: <FolderOutlined />
    },
    {
      label: e('edit'),
      onClick: handleToggleEdit,
      icon: <EditOutlined />
    },
    {
      label: e('import'),
      onClick: () => {
        const fileInput = document.querySelector('.upload-bookmark-icon')
        if (fileInput) {
          fileInput.click()
        }
      },
      icon: <ImportOutlined />
    },
    {
      label: e('export'),
      onClick: handleDownload,
      icon: <ExportOutlined />
    },
    {
      label: `${e('export')} (不含凭据)`,
      onClick: handleDownloadWithoutCredentials,
      icon: <ExportOutlined />
    },
    {
      label: `${e('export')} (加密)`,
      onClick: handleDownloadEncrypted,
      icon: <ExportOutlined />
    },
    {
      label: '导出连接清单 CSV（含账号密码）',
      onClick: handleDownloadConnectionInventory,
      icon: <ExportOutlined />
    },
    {
      label: '服务器详情 / 连接信息',
      onClick: onConnectionInventory,
      icon: <ProfileOutlined />
    },
    {
      label: e('loadSshConfigs'),
      onClick: onSshConfigs,
      icon: <CodeOutlined />
    }
  ]

  const ddProps = {
    menu: {
      items
    }
  }

  return (

    <div className='pd1b pd1r'>
      <Flex justify='space-between' align='center'>
        <div>
          <Space.Compact>
            <Button onClick={onNewBookmark}>
              <BookOutlined className='with-plus' />
            </Button>
            <Button onClick={onNewBookmarkGroup}>
              <FolderOutlined className='with-plus' />
            </Button>
            <Button
              icon={<EditOutlined />}
              onClick={handleToggleEdit}
              title={e('edit')}
            />
            <Button
              icon={<ExportOutlined />}
              onClick={handleDownload}
              title={e('export')}
              className='download-bookmark-icon'
            />
            <Upload
              beforeUpload={beforeUpload}
              fileList={[]}
              className='upload-bookmark-icon'
            >
              <Button
                icon={<ImportOutlined />}
                title={e('importFromFile')}
              />
            </Upload>
            <Button onClick={onSshConfigs}>
              <CodeOutlined />
            </Button>
          </Space.Compact>
        </div>
        <div>
          <Dropdown {...ddProps}>
            <MenuOutlined />
          </Dropdown>
        </div>
      </Flex>
    </div>
  )
}
