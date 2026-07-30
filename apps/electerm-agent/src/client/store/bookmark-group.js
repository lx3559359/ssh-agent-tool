/**
 * bookmark group functions
 */

import {
  defaultBookmarkGroupId,
  settingMap
} from '../common/constants'
import { removeCyclicBookmarkGroupIds } from '../common/bookmark-group-tree'
import { deleteBookmarkGroupState } from '../common/bookmark-deletion'
import uid from '../common/uid'
import { getRandomDefaultColor } from '../common/rand-hex-color.js'
import {
  assignBookmarkToGroup,
  cloneBookmarkMembership,
  createBookmarkGroupInParent,
  moveBookmarksToGroup as moveMembership,
  repairBookmarkMembership,
  restoreBookmarkMembership
} from '../common/bookmark-membership'
import { action } from 'manate'

export default Store => {
  Store.prototype.getBookmarkGroupsTotal = function () {
    return window.store.bookmarkGroups
  }

  Store.prototype.setBookmarkGroups = function (items) {
    return window.store.setItems('bookmarkGroups', items)
  }

  Store.prototype.addBookmarkGroup = async function (group) {
    window.store.addItem(group, settingMap.bookmarkGroups)
  }

  Store.prototype.editBookmarkGroup = function (id, updates) {
    window.store.editItem(id, updates, settingMap.bookmarkGroups)
  }

  Store.prototype.saveBookmarkInGroup = function (bookmark, groupId) {
    const { store } = window
    const snapshot = cloneBookmarkMembership(store.bookmarkGroups)
    try {
      store.addItem(bookmark, settingMap.bookmarks)
      const result = assignBookmarkToGroup(
        store.bookmarkGroups,
        bookmark.id,
        groupId,
        defaultBookmarkGroupId
      )
      store.rememberLastBookmarkGroup(result.groupId)
      return { bookmark, groupId: result.groupId }
    } catch (error) {
      store.delItem({ id: bookmark.id }, settingMap.bookmarks)
      restoreBookmarkMembership(store.bookmarkGroups, snapshot)
      throw error
    }
  }

  Store.prototype.moveBookmarksToGroup = function (bookmarkIds, groupId) {
    const { store } = window
    const result = moveMembership(
      store.bookmarkGroups,
      bookmarkIds,
      groupId,
      defaultBookmarkGroupId
    )
    store.rememberLastBookmarkGroup(result.groupId)
    return result
  }

  Store.prototype.createBookmarkGroup = function ({
    title,
    parentId,
    color
  }) {
    return createBookmarkGroupInParent(window.store.bookmarkGroups, {
      id: uid(),
      title,
      parentId,
      color: color || getRandomDefaultColor()
    })
  }

  Store.prototype.rememberLastBookmarkGroup = function (groupId) {
    const valid = window.store.bookmarkGroups.some(
      group => group.id === groupId
    )
      ? groupId
      : defaultBookmarkGroupId
    window.localStorage?.setItem(
      'shellpilot-last-bookmark-group-id',
      valid
    )
    return valid
  }

  Store.prototype.getLastBookmarkGroup = function () {
    const saved = window.localStorage?.getItem(
      'shellpilot-last-bookmark-group-id'
    )
    return window.store.bookmarkGroups.some(group => group.id === saved)
      ? saved
      : defaultBookmarkGroupId
  }

  Store.prototype.openAllBookmarkInCategory = function (item) {
    const { store } = window
    let ids = item.bookmarkIds
    const gids = item.bookmarkGroupIds || []
    const bookmarkGroups = store.bookmarkGroups
    for (const gid of gids) {
      const g = bookmarkGroups.find(g => g.id === gid)
      if (g && g.bookmarkIds && g.bookmarkIds.length) {
        ids = [
          ...ids,
          ...g.bookmarkIds
        ]
      }
    }
    for (const id of ids) {
      store.onSelectBookmark(id)
    }
  }

  Store.prototype.delBookmarkGroup = action(function ({ id }) {
    const { store } = window
    const result = deleteBookmarkGroupState(
      store.bookmarkGroups,
      id,
      defaultBookmarkGroupId
    )
    if (result.deleted && id === store.currentBookmarkGroupId) {
      store.currentBookmarkGroupId = result.parentGroupId
    }
  })

  Store.prototype.fixBookmarkGroups = function () {
    const { store } = window
    const { bookmarks, bookmarkGroups } = store
    const result = repairBookmarkMembership(
      bookmarks,
      bookmarkGroups,
      defaultBookmarkGroupId
    )
    removeCyclicBookmarkGroupIds(bookmarkGroups)
    return result
  }
}
