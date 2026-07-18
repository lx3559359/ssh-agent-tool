import {
  ApiOutlined,
  CodeOutlined,
  DashboardOutlined,
  FolderAddOutlined,
  MessageOutlined,
  MoonOutlined,
  PlusCircleOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { lazy, Suspense, useEffect, useState } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'
import { auto } from 'manate/react'
import { Button, Popover, Tooltip } from 'antd'
import QuickConnect from '../tabs/quick-connect'
import WindowControl from '../tabs/window-control'
import ConnectionInventoryModal from '../tree-list/connection-inventory-modal'
import ConnectionInfoModal from '../tree-list/connection-info-modal'
import SafetyOperationCenterModal from './safety-operation-center-modal'
import { logoPath1, packInfo, statusMap } from '../../common/constants'
import * as safetyTransactionStore from '../../common/safety-transactions/transaction-store.js'
import {
  commandOrphanRecoveryStartedAt,
  recoverOrphanedCommandOperationsOnce
} from '../../common/safety-transactions/command-orphan-recovery.js'
import './aigshell-topbar.styl'

const UpdateCenterModal = lazy(() => import('./update-center-modal'))
const HelpCenterModal = lazy(() => import('./help-center-modal'))
const ServerStatusModal = lazy(() => import('../server-status/server-status-modal'))

export default auto(function AIGShellTopBar ({ store }) {
  const [showConnectionInventory, setShowConnectionInventory] = useState(false)
  const [showUpdateCenter, setShowUpdateCenter] = useState(false)
  const [showHelpCenter, setShowHelpCenter] = useState(false)
  const [showSafetyCenter, setShowSafetyCenter] = useState(false)
  const [showServerStatus, setShowServerStatus] = useState(false)
  const [connectionInfoBookmark, setConnectionInfoBookmark] = useState(null)
  const currentTab = store.tabs.find(tab => tab.id === store.activeTabId) || store.currentTab || {}
  const title = currentTab.title || currentTab.name || currentTab.host || '未连接'
  const online = currentTab.status === statusMap.success
  const serverStatusAvailable = Boolean(
    online &&
    currentTab.host &&
    (currentTab.type === 'ssh' || currentTab.type === undefined)
  )

  useEffect(() => {
    const openSafetyCenter = () => setShowSafetyCenter(true)
    const openUpdateCenter = () => {
      setShowUpdateCenter(true)
      window.store.upgradeInfo.showUpdateCenter = true
    }
    window.addEventListener('shellpilot-open-safety-center', openSafetyCenter)
    window.addEventListener('shellpilot-open-update-center', openUpdateCenter)
    return () => {
      window.removeEventListener('shellpilot-open-safety-center', openSafetyCenter)
      window.removeEventListener('shellpilot-open-update-center', openUpdateCenter)
    }
  }, [])

  useEffect(() => {
    recoverOrphanedCommandOperationsOnce({
      store: safetyTransactionStore,
      startedAt: commandOrphanRecoveryStartedAt
    }).catch(() => {
      window.store.onError?.(new Error('后台安全事务启动恢复失败。'))
    })
  }, [])

  function handleFastNew () {
    if (window.store.hasNodePty) {
      window.store.addTab()
      return
    }
    window.store.onNewSsh()
  }

  function handleCheckUpdate () {
    setShowUpdateCenter(true)
    window.store.upgradeInfo.showUpdateCenter = true
    window.store.onCheckUpdate(true)
  }

  function handleCloseUpdateCenter () {
    setShowUpdateCenter(false)
    window.store.upgradeInfo.showUpdateCenter = false
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

  function handleOpenQuickCommands () {
    window.store.openQuickCommandBar = true
  }

  const actions = [
    {
      key: 'serverStatus',
      label: '服务器状态',
      icon: <DashboardOutlined />,
      onClick: () => setShowServerStatus(true),
      disabled: !serverStatusAvailable
    },
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
      key: 'quickCommands',
      label: '快捷命令',
      icon: <CodeOutlined />,
      onClick: handleOpenQuickCommands,
      primary: true
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
      key: 'safetyCenter',
      label: '安全中心',
      icon: <SafetyCertificateOutlined />,
      onClick: () => setShowSafetyCenter(true)
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
    },
    {
      key: 'help',
      label: '帮助',
      icon: <QuestionCircleOutlined />,
      onClick: () => setShowHelpCenter(true)
    }
  ]

  function renderAction (item) {
    const btn = (
      <Button
        type='text'
        size='small'
        icon={item.icon}
        disabled={item.disabled}
        onClick={item.popover ? undefined : item.onClick}
        className={'aigshell-topbar-action' + (item.primary ? ' aigshell-topbar-action-primary' : '')}
      >
        <span className='aigshell-topbar-action-label'>{item.label}</span>
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
      {
        showUpdateCenter
          ? (
            <LazyModuleBoundary moduleName='更新中心' fallback={null}>
              <Suspense fallback={null}>
                <UpdateCenterModal
                  open
                  onClose={handleCloseUpdateCenter}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
      {
        showHelpCenter
          ? (
            <LazyModuleBoundary moduleName='帮助中心' fallback={null}>
              <Suspense fallback={null}>
                <HelpCenterModal
                  open
                  onClose={() => setShowHelpCenter(false)}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
      <SafetyOperationCenterModal
        open={showSafetyCenter}
        onClose={() => setShowSafetyCenter(false)}
        store={store}
      />
      {
        showServerStatus
          ? (
            <LazyModuleBoundary moduleName='服务器状态' fallback={null}>
              <Suspense fallback={null}>
                <ServerStatusModal
                  open
                  onClose={() => setShowServerStatus(false)}
                  store={store}
                  tab={currentTab}
                />
              </Suspense>
            </LazyModuleBoundary>
            )
          : null
      }
    </div>
  )
})
