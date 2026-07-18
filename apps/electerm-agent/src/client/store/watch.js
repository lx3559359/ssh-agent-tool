/**
 * auto run when data change
 */

import createTitle from '../common/create-title'
import { autoRun } from 'manate'
import { update, remove, dbNamesForWatch, dbNamesForSync } from '../common/db'
import handleError from '../common/error-handler'
import { createStatePersistenceQueue, persistStateSnapshot } from './state-persistence-queue'
import {
  sftpDefaultSortSettingKey,
  checkedKeysLsKey,
  expandedKeysLsKey,
  resolutionsLsKey,
  localAddrBookmarkLsKey,
  syncServerDataKey
} from '../common/constants'
import * as ls from '../common/safe-local-storage'
import { debounce, isEmpty } from 'lodash-es'
import { refsStatic } from '../components/common/ref'
import dataCompare from '../common/data-compare'
import { serializeClientRecoveryState } from '../common/recovery/client-recovery-state.js'

export default store => {
  const saveRecoverySnapshot = debounce(snapshot => {
    window.pre.runGlobalAsync('saveRecoverySnapshot', snapshot).catch(() => false)
  }, 500)
  const persistenceQueue = createStatePersistenceQueue({
    persist: (name, oldState, snapshot) => persistStateSnapshot({
      oldState,
      snapshot,
      getChanges: dataCompare,
      removeItem: item => remove(name, item.id, true),
      upsertItem: item => update(item.id, item, name, true, true),
      writeOrder: order => update(
        `${name}:order`,
        order,
        'data',
        true,
        true
      )
    }),
    getCommittedState: name => refsStatic.get('oldState-' + name),
    commitState: (name, snapshot) => {
      refsStatic.add('oldState-' + name, snapshot)
      if (name === 'bookmarks') {
        store.bookmarksMap = new Map(
          snapshot.map(item => [item.id, item])
        )
      }
      Promise.resolve().then(async () => {
        await store.updateLastDataUpdateTime()
        if (dbNamesForSync.includes(name)) {
          const syncSetting = store.config.syncSetting || {}
          const { autoSync, autoSyncInterval, autoSyncDirection } = syncSetting
          if (autoSync && autoSyncInterval === 0) {
            if (autoSyncDirection === 'download') {
              await store.downloadSettingAll()
            } else {
              await store.uploadSettingAll()
            }
          }
        }
      }).catch(handleError)
    },
    onError: handleError
  })

  for (const name of dbNamesForWatch) {
    window[`watch${name}`] = autoRun(async () => {
      const snapshot = store.getItems(name)
      if (window.migrating) {
        return
      }
      await persistenceQueue.enqueue(name, snapshot)
      return store[name]
    })
    window[`watch${name}`].start()
  }
  autoRun(async () => {
    ls.setItemJSON(resolutionsLsKey, store.resolutions)
    return store.resolutions
  }).start()

  autoRun(() => {
    if (!store.showModal) {
      store.focus()
    } else {
      store.blur()
    }
    return store.showModal
  }).start()

  autoRun(() => {
    if (!isEmpty(store.config)) {
      window.pre.runGlobalAsync('saveUserConfig', store.config)
    }
    return store.config
  }, func => debounce(func, 100)).start()

  autoRun(() => {
    store.updateLastDataUpdateTime()
    return store.config.theme
  }, func => debounce(func, 100)).start()

  autoRun(() => {
    store.updateTabsStatus()
    return store.transferCount
  }).start()

  autoRun(() => {
    ls.setItemJSON(sftpDefaultSortSettingKey, store.sftpSortSetting)
    return store.sftpSortSetting
  }).start()

  autoRun(() => {
    ls.setItemJSON(expandedKeysLsKey, store.expandedKeys)
    return store.expandedKeys
  }).start()

  autoRun(() => {
    ls.setItemJSON(localAddrBookmarkLsKey, store.addressBookmarksLocal)
    return store.addressBookmarksLocal
  }).start()

  autoRun(() => {
    ls.setItemJSON(checkedKeysLsKey, store.checkedKeys)
    return store.checkedKeys
  }).start()

  autoRun(() => {
    ls.setItemJSON(syncServerDataKey, store.syncServerStatus)
    return store.syncServerStatus
  }).start()

  autoRun(() => {
    store.updateBatchInputSelectedTabIds()
    const tabs = store.getTabs()
    const { activeTabId } = store
    const tab = tabs.find(t => t.id === activeTabId)
    if (tab) {
      const title = createTitle(tab)
      window.pre.runGlobalAsync('setTitle', title)
      window.store.currentLayoutBatch = tab.batch
    }
    if (tab && store.rightPanelVisible) {
      window.store.openInfoPanelAction()
    }
    return store.activeTabId
  }).start()

  autoRun(() => {
    const snapshot = serializeClientRecoveryState(store)
    saveRecoverySnapshot(snapshot)
    return JSON.stringify(snapshot)
  }).start()
}
