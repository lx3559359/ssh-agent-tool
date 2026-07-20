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
    const ok = window.confirm(e('shellpilotPlaintextBackupWarning'))
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
    const passphrase = window.prompt(e('shellpilotBackupPasswordPrompt'))
    if (!passphrase) {
      return
    }
    const confirmation = window.prompt(e('shellpilotBackupPasswordConfirm'))
    if (confirmation !== passphrase) {
      message.error(e('shellpilotBackupPasswordMismatch'))
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
    const ok = window.confirm(e('shellpilotConnectionCsvWarning'))
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
      title: e('shellpilotMigrationGuideTitle'),
      okText: e('shellpilotUnderstood'),
      width: 620,
      content: (
        <div>
          <ol>
            <li>{e('shellpilotMigrationStepOne')}</li>
            <li>{e('shellpilotMigrationStepTwo')}</li>
            <li>{e('shellpilotMigrationStepThree')}</li>
            <li>{e('shellpilotMigrationStepFour')}</li>
          </ol>
          <p>{e('shellpilotMigrationIncludes')}</p>
          <p>{e('shellpilotMigrationExcludes')}</p>
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
      label: e('shellpilotEncryptedBackupRecommended'),
      onClick: handleDownloadEncrypted,
      icon: <ExportOutlined />
    },
    {
      label: `${e('export')} ${e('shellpilotWithoutCredentials')}`,
      onClick: handleDownloadWithoutCredentials,
      icon: <ExportOutlined />
    },
    {
      label: e('shellpilotPlaintextBackupNotRecommended'),
      onClick: handleDownloadPlaintext,
      icon: <ExportOutlined />
    },
    {
      label: e('shellpilotExportConnectionCsvWithCredentials'),
      onClick: handleDownloadConnectionInventory,
      icon: <ExportOutlined />
    },
    {
      label: e('shellpilotServerDetailsConnectionInfo'),
      onClick: onConnectionInventory,
      icon: <ProfileOutlined />
    },
    {
      label: e('loadSshConfigs'),
      onClick: onSshConfigs,
      icon: <CodeOutlined />
    },
    {
      label: e('shellpilotMigrationGuideTitle'),
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
              title={e('shellpilotEncryptedBackupRecommended')}
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
