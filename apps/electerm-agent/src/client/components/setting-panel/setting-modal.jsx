/**
 * hisotry/bookmark/setting modal
 */

import { auto } from 'manate/react'
import { pick } from 'lodash-es'
import { Tabs, Spin } from 'antd'
import { lazy, Suspense, useState } from 'react'
import SettingModal from './setting-wrap'
import SettingHeader from './setting-header'
import { searchSettings } from '../../common/setting-search-index'
import {
  settingMap,
  modals
} from '../../common/constants'
const TabBookmarks = lazy(() => import('./tab-bookmarks'))
const TabQuickCommands = lazy(() => import('./tab-quick-commands'))
const TabSettings = lazy(() => import('./tab-settings'))
const TabThemes = lazy(() => import('./tab-themes'))
const TabProfiles = lazy(() => import('./tab-profiles'))
const TabWidgets = lazy(() => import('./tab-widgets'))

const Loading = () => <div style={{ padding: 20, textAlign: 'center' }}><Spin /></div>

const e = window.translate

export default auto(function SettingModalWrap (props) {
  const { store } = props
  const [query, setQuery] = useState('')
  const effectiveLanguage = store.previewLanguage || store.config.language

  const selectItem = (item) => {
    window.store.setSettingItem(item)
  }

  function openSearchResult () {
    const result = searchSettings(query)[0]
    if (!result) {
      return
    }
    store.handleChangeSettingTab(result.tab)
    if (!result.itemId) {
      return
    }
    const item = store.getSidebarList(result.tab)
      .find(item => item.id === result.itemId)
    if (item) {
      store.setSettingItem(item)
    }
  }

  function handleClose () {
    store.previewLanguage = ''
    setQuery('')
    store.hideSettingModal()
  }

  function renderTabs () {
    const tabsShouldConfirmDel = [
      settingMap.bookmarks,
      settingMap.terminalThemes
    ]
    const { settingTab, settingItem, settingSidebarList, bookmarkSelectMode } = store
    const props0 = {
      store,
      activeItemId: settingItem.id,
      type: settingTab,
      onClickItem: selectItem,
      shouldConfirmDel: tabsShouldConfirmDel.includes(settingTab),
      list: settingSidebarList
    }
    const { bookmarks, bookmarkGroups, widgetInstances } = store
    const formProps = {
      store,
      formData: settingItem,
      type: settingTab,
      hide: store.hideSettingModal,
      ...pick(store, [
        'currentBookmarkGroupId',
        'config'
      ]),
      bookmarkGroups,
      bookmarks,
      widgetInstancesLength: widgetInstances.length,
      serials: store.serials,
      loaddingSerials: store.loaddingSerials
    }
    const treeProps = {
      ...props0,
      bookmarkSelectMode,
      bookmarkGroups,
      bookmarkGroupTree: store.bookmarkGroupTree,
      bookmarksMap: store.bookmarksMap,
      bookmarks,
      ...pick(store, [
        'currentBookmarkGroupId',
        'config',
        'checkedKeys',
        'expandedKeys',
        'leftSidebarWidth',
        'initLoadingData'
      ])
    }
    const items = [
      {
        key: settingMap.bookmarks,
        label: e(settingMap.bookmarks),
        children: null
      },
      {
        key: settingMap.setting,
        label: e(settingMap.setting),
        children: null
      },
      {
        key: settingMap.terminalThemes,
        label: e('uiThemes'),
        children: null
      },
      {
        key: settingMap.quickCommands,
        label: e(settingMap.quickCommands),
        children: null
      },
      {
        key: settingMap.profiles,
        label: e(settingMap.profiles),
        children: null
      },
      {
        key: settingMap.widgets,
        label: <>工具中心 <sup>预览</sup></>,
        children: null
      }
    ]
    const tabsProps = {
      activeKey: settingTab,
      animated: false,
      items,
      onChange: store.handleChangeSettingTab,
      destroyOnHidden: true,
      className: 'setting-tabs',
      type: 'card'
    }
    return (
      <>
        <SettingHeader
          store={store}
          languages={window.et.langs || []}
          query={query}
          onQueryChange={setQuery}
          onSearch={openSearchResult}
          onClose={handleClose}
        />
        <Tabs
          {...tabsProps}
        />
        <Suspense fallback={<Loading />}>
          <TabQuickCommands
            languageVersion={effectiveLanguage}
            listProps={props0}
            settingItem={settingItem}
            formProps={formProps}
            store={store}
            settingTab={settingTab}
          />
          <TabBookmarks
            languageVersion={effectiveLanguage}
            treeProps={treeProps}
            settingItem={settingItem}
            formProps={formProps}
            settingTab={settingTab}
          />
          <TabSettings
            languageVersion={effectiveLanguage}
            listProps={props0}
            settingItem={settingItem}
            settingTab={settingTab}
            store={store}
          />
          <TabThemes
            languageVersion={effectiveLanguage}
            listProps={props0}
            settingItem={settingItem}
            formProps={formProps}
            store={store}
            settingTab={settingTab}
          />
          <TabProfiles
            languageVersion={effectiveLanguage}
            listProps={props0}
            settingItem={settingItem}
            formProps={formProps}
            store={store}
            settingTab={settingTab}
          />
          <TabWidgets
            languageVersion={effectiveLanguage}
            listProps={props0}
            settingItem={settingItem}
            formProps={formProps}
            store={store}
            settingTab={settingTab}
          />
        </Suspense>
      </>
    )
  }

  const {
    showModal,
    innerWidth,
    useSystemTitleBar
  } = props.store
  const show = showModal === modals.setting
  if (!show) {
    return null
  }
  return (
    <SettingModal
      onCancel={handleClose}
      visible={show}
      useSystemTitleBar={useSystemTitleBar}
      innerWidth={innerWidth}
    >
      {renderTabs()}
    </SettingModal>
  )
})
