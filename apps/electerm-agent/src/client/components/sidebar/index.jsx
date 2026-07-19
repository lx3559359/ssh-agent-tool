import {
  BookOutlined,
  DashboardOutlined,
  FileTextOutlined,
  HistoryOutlined,
  KeyOutlined,
  SettingOutlined,
  UpCircleOutlined,
  AimOutlined
} from '@ant-design/icons'
import { Tooltip } from 'antd'
import SideBarPanel from './sidebar-panel'
import TransferList from './transfer-list'
import MenuBtn from '../sys-menu/menu-btn'
import {
  infoTabs,
  paneMap,
  sidebarWidth,
  settingPasswordsId,
  settingMap,
  modals
} from '../../common/constants'
import SideIcon from './side-icon'
import SidePanel from './side-panel'
import hasActiveInput from '../../common/has-active-input'
import settingList from '../../common/setting-list'
import './sidebar.styl'

const e = window.translate

export default function Sidebar (props) {
  const {
    height,
    upgradeInfo,
    settingTab,
    settingItem,
    leftSidebarWidth,
    pinned,
    fileTransfers,
    openedSideBar,
    transferHistory,
    transferTab,
    showModal,
    showInfoModal,
    sidebarPanelTab,
    zoom
  } = props

  const { store } = window

  const handleClickOutside = (event) => {
    // Don't close if pinned or has active input
    if (store.pinned || hasActiveInput()) {
      return
    }

    // Check if click is outside the sidebar panel
    const sidebarPanel = document.querySelector('.sidebar-panel')
    if (sidebarPanel && !sidebarPanel.contains(event.target)) {
      store.setOpenedSideBar('')
      document.removeEventListener('click', handleClickOutside)
    }
  }

  const handleOpenSidebarPanel = tab => {
    if (showModal) {
      store.showModal = 0
    }
    store.handleSidebarPanelTab(tab)
    if (pinned) {
      return
    }
    if (openedSideBar === 'bookmarks' && sidebarPanelTab === tab) {
      // Remove listener when closing
      document.removeEventListener('click', handleClickOutside)
      store.setOpenedSideBar('')
    } else {
      // Add listener when opening, with slight delay to avoid conflict with this click
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)
      store.setOpenedSideBar('bookmarks')
    }
  }

  const handleOpenTerminalSidebarPanel = tab => {
    store.closeFleetStatus()
    handleOpenSidebarPanel(tab)
  }

  const handleOpenFleetStatus = () => {
    store.openFleetStatus()
  }

  const handleOpenSftp = () => {
    store.closeFleetStatus()
    store.updateTab(store.activeTabId, { pane: paneMap.fileManager })
  }

  const handleOpenSettingItem = id => {
    store.storeAssign({
      settingTab: settingMap.setting
    })
    store.setSettingItem(settingList().find(d => d.id === id))
    store.openSettingModal()
  }

  const handleShowUpgrade = () => {
    window.store.upgradeInfo.showUpgradeModal = true
  }

  const handleZoomReset = () => {
    store.onZoomReset()
  }

  const {
    openSetting,
    openAbout,
    setLeftSidePanelWidth
  } = store
  const {
    showUpgradeModal,
    upgradePercent,
    checkingRemoteVersion,
    shouldUpgrade
  } = upgradeInfo
  const showSetting = showModal === modals.setting
  const settingActive = showSetting && settingTab === settingMap.setting && settingItem.id === 'setting-common'
  const passwordsActive = showSetting && settingTab === settingMap.setting && settingItem.id === settingPasswordsId
  const bookmarksActive = openedSideBar === 'bookmarks' && sidebarPanelTab === 'bookmarks'
  const historyActive = openedSideBar === 'bookmarks' && sidebarPanelTab === 'history'
  const fleetStatusActive = store.mainWorkspaceMode === 'fleet-status'
  const logActive = showInfoModal && store.infoModalTab === infoTabs.log
  const sideProps = openedSideBar
    ? {
        className: 'sidebar-list',
        style: {
          width: `${leftSidebarWidth}px`
        }
      }
    : {
        className: 'sidebar-list'
      }
  const sidebarProps = {
    className: `sidebar type-${openedSideBar}`,
    style: {
      width: sidebarWidth,
      height
    }
  }
  const transferProps = {
    fileTransfers,
    transferTab,
    transferHistory
  }
  return (
    <div {...sidebarProps}>
      <div className='sidebar-bar btns'>
        <div className='control-icon-wrap'>
          <MenuBtn store={store} config={store.config} />
        </div>
        <SideIcon
          title='状态总览'
          label='状态总览'
          active={fleetStatusActive}
          onClick={handleOpenFleetStatus}
        >
          <DashboardOutlined
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <SideIcon
          title='服务器'
          label='服务器'
          active={bookmarksActive}
          onClick={() => handleOpenTerminalSidebarPanel('bookmarks')}
        >
          <BookOutlined
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <TransferList
          {...transferProps}
          active={store.currentTab?.pane === paneMap.fileManager}
          onOpenSftp={handleOpenSftp}
        />
        <SideIcon
          title='历史'
          label='历史'
          active={historyActive}
          onClick={() => handleOpenTerminalSidebarPanel('history')}
        >
          <HistoryOutlined
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <SideIcon
          title='密钥'
          label='密钥'
          active={passwordsActive}
          onClick={() => handleOpenSettingItem(settingPasswordsId)}
        >
          <KeyOutlined
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <SideIcon
          title='日志'
          label='日志'
          active={logActive}
          onClick={() => openAbout(infoTabs.log)}
        >
          <FileTextOutlined
            className='font20 iblock control-icon'
          />
        </SideIcon>
        <SideIcon
          title='设置'
          label='设置'
          active={settingActive}
          onClick={openSetting}
        >
          <SettingOutlined className='iblock font20 control-icon' />
        </SideIcon>
        {
          Math.round((zoom ?? 1) * 100) !== 100
            ? (
              <SideIcon
                title={e('resetzoom')}
                onClick={handleZoomReset}
              >
                <AimOutlined
                  className='iblock font16 control-icon zoom-reset-icon'
                />
              </SideIcon>
              )
            : null
        }
        {
          !checkingRemoteVersion && !showUpgradeModal && shouldUpgrade
            ? (
              <Tooltip
                title={`${e('upgrading')} ${upgradePercent || 0}%`}
                placement='right'
              >
                <div
                  className='control-icon-wrap'
                >
                  <UpCircleOutlined
                    className='iblock font18 control-icon upgrade-icon'
                    onClick={handleShowUpgrade}
                  />
                </div>
              </Tooltip>
              )
            : null
        }
      </div>
      <SidePanel
        sideProps={sideProps}
        setLeftSidePanelWidth={setLeftSidePanelWidth}
        leftSidebarWidth={leftSidebarWidth}
      >
        <SideBarPanel
          pinned={pinned}
          sidebarPanelTab={sidebarPanelTab}
        />
      </SidePanel>
    </div>
  )
}
