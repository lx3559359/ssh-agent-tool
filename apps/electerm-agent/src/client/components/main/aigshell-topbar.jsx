import {
  ApiOutlined,
  FolderAddOutlined,
  MessageOutlined,
  MoonOutlined,
  PlusCircleOutlined,
  ProfileOutlined,
  ReloadOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useState } from 'react'
import { Button, Popover, Tooltip } from 'antd'
import QuickConnect from '../tabs/quick-connect'
import WindowControl from '../tabs/window-control'
import ConnectionInventoryModal from '../tree-list/connection-inventory-modal'
import ConnectionInfoModal from '../tree-list/connection-info-modal'
import { logoPath1, packInfo, statusMap } from '../../common/constants'
import './aigshell-topbar.styl'

export default function AIGShellTopBar ({ store }) {
  const [showConnectionInventory, setShowConnectionInventory] = useState(false)
  const [connectionInfoBookmark, setConnectionInfoBookmark] = useState(null)
  const currentTab = store.currentTab || {}
  const title = currentTab.title || currentTab.name || currentTab.host || '未连接'
  const online = currentTab.status === statusMap.success

  function handleFastNew () {
    if (window.store.hasNodePty) {
      window.store.addTab()
      return
    }
    window.store.onNewSsh()
  }

  function handleCheckUpdate () {
    window.store.onCheckUpdate(true)
  }

  function handleOpenConnectionInventory () {
    setShowConnectionInventory(true)
  }

  function handleCloseConnectionInventory () {
    setShowConnectionInventory(false)
  }

  function handleViewConnectionInfo (bookmark) {
    setConnectionInfoBookmark(bookmark)
  }

  function handleCloseConnectionInfo () {
    setConnectionInfoBookmark(null)
  }

  const isLightTheme = store.config.theme === 'defaultLight'

  function handleToggleTheme () {
    window.store.setTheme(isLightTheme ? 'default' : 'defaultLight')
  }

  const actions = [
    {
      key: 'new',
      label: '新建',
      icon: <PlusCircleOutlined />,
      onClick: window.store.onNewSsh
    },
    {
      key: 'quick',
      label: '快连',
      icon: <ThunderboltOutlined />,
      popover: <QuickConnect formOnly />,
      onClick: handleFastNew
    },
    {
      key: 'ai',
      label: 'AI助手',
      icon: <MessageOutlined />,
      onClick: window.store.handleOpenAIPanel
    },
    {
      key: 'model',
      label: '模型API',
      icon: <ApiOutlined />,
      onClick: window.store.toggleAIConfig
    },
    {
      key: 'backup',
      label: '备份同步',
      icon: <FolderAddOutlined />,
      onClick: window.store.openSettingSync
    },
    {
      key: 'connections',
      label: '连接信息',
      icon: <ProfileOutlined />,
      onClick: handleOpenConnectionInventory
    },
    {
      key: 'update',
      label: '检查更新',
      icon: <ReloadOutlined />,
      onClick: handleCheckUpdate
    },
    {
      key: 'theme',
      label: isLightTheme ? '夜间' : '日间',
      icon: isLightTheme ? <MoonOutlined /> : <SunOutlined />,
      onClick: handleToggleTheme
    },
    {
      key: 'setting',
      label: '设置',
      icon: <SettingOutlined />,
      onClick: window.store.openSetting
    }
  ]

  function renderAction (item) {
    const btn = (
      <Button
        type='text'
        size='small'
        icon={item.icon}
        onClick={item.popover ? undefined : item.onClick}
        className='aigshell-topbar-action'
      >
        {item.label}
      </Button>
    )
    if (!item.popover) {
      return btn
    }
    return (
      <Popover
        content={item.popover}
        trigger='click'
        placement='bottom'
      >
        {btn}
      </Popover>
    )
  }

  return (
    <div className='aigshell-topbar'>
      <div className='aigshell-topbar-brand'>
        <img src={logoPath1} alt='ShellPilot' />
        <span className='aigshell-topbar-name'>ShellPilot</span>
        <span className='aigshell-topbar-version' title={`当前版本 ${packInfo.version}`}>v{packInfo.version}</span>
        <span className='aigshell-topbar-separator' />
        <span className='aigshell-topbar-current' title={title}>{title}</span>
        <Tooltip title={online ? '已连接' : '未连接'}>
          <span className={'aigshell-topbar-dot ' + (online ? 'online' : '')} />
        </Tooltip>
      </div>
      <div className='aigshell-topbar-actions'>
        {
          actions.map(item => (
            <span key={item.key} className='aigshell-topbar-action-wrap'>
              {renderAction(item)}
            </span>
          ))
        }
      </div>
      <WindowControl store={store} />
      {
        showConnectionInventory
          ? (
            <ConnectionInventoryModal
              bookmarks={store.bookmarks}
              bookmarkGroups={store.bookmarkGroups}
              onClose={handleCloseConnectionInventory}
              onViewConnectionInfo={handleViewConnectionInfo}
            />
            )
          : null
      }
      <ConnectionInfoModal
        bookmark={connectionInfoBookmark}
        bookmarkGroups={store.bookmarkGroups}
        onClose={handleCloseConnectionInfo}
      />
    </div>
  )
}
