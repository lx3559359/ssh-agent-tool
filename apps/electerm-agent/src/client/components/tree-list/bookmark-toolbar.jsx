import {
  BookOutlined,
  FolderOutlined,
  ImportOutlined,
  ExportOutlined,
  CodeOutlined,
  MenuOutlined,
  EditOutlined,
  ProfileOutlined,
  QuestionCircleOutlined
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
import message from '../common/message'
import Modal from '../common/modal'

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

  const handleDownloadPlaintext = () => {
    const ok = window.confirm('警告：该文件将以明文包含服务器密码、私钥和代理凭据。仅应保存在可信位置，是否继续？')
    if (!ok) {
      return
    }
    const backup = createBookmarkBackup({
      bookmarkGroups,
      bookmarks,
      version: packInfo.version
    })
    const txt = JSON.stringify(backup, null, 2)
    const stamp = time(undefined, 'YYYY-MM-DD-HH-mm-ss')
    download('shellpilot-bookmarks-plaintext-' + stamp + '.json', txt)
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
    download('shellpilot-bookmarks-no-credentials-' + stamp + '.json', txt)
  }
  const handleDownloadEncrypted = async () => {
    const passphrase = window.prompt('请输入备份加密密码')
    if (!passphrase) {
      return
    }
    const confirmation = window.prompt('再次输入备份加密密码')
    if (confirmation !== passphrase) {
      message.error('两次输入的备份密码不一致')
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
    download('shellpilot-bookmarks-encrypted-' + stamp + '.json', txt)
  }
  const handleDownloadConnectionInventory = () => {
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
  const handleShowMigrationGuide = () => {
    Modal.info({
      title: '跨电脑迁移说明',
      okText: '知道了',
      width: 620,
      content: (
        <div>
          <ol>
            <li>在源电脑选择“加密备份（推荐）”，设置并牢记备份密码。</li>
            <li>通过可信方式把加密 JSON 文件传到目标电脑。</li>
            <li>在目标电脑打开“服务器”，点击“导入”，选择文件并输入备份密码。</li>
            <li>出现冲突时，按需要选择保留本地、使用备份覆盖或创建副本。</li>
          </ol>
          <p>备份包含服务器连接、分组和连接凭据，并使用密码加密。</p>
          <p>不包含本地私钥文件、AI 模型配置、终端历史和客户端其他设置；使用私钥路径的连接需要在目标电脑重新选择私钥文件。</p>
        </div>
      )
    })
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
      label: '加密备份（推荐）',
      onClick: handleDownloadEncrypted,
      icon: <ExportOutlined />
    },
    {
      label: `${e('export')} (不含凭据)`,
      onClick: handleDownloadWithoutCredentials,
      icon: <ExportOutlined />
    },
    {
      label: '明文备份（含凭据，不推荐）',
      onClick: handleDownloadPlaintext,
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
    },
    {
      label: '跨电脑迁移说明',
      onClick: handleShowMigrationGuide,
      icon: <QuestionCircleOutlined />
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
              onClick={handleDownloadEncrypted}
              title='加密备份（推荐）'
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
