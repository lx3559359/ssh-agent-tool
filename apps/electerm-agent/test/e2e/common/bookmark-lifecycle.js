const { _electron: electron } = require('@playwright/test')
const { promises: fs } = require('fs')
const { tmpdir } = require('os')
const { resolve, sep } = require('path')
const appOptions = require('./app-options')
const extendClient = require('./client-extend')
const log = require('./log')

const profilePrefix = 'electerm-bookmark-e2e-'
const testProfileRoot = resolve(
  tmpdir(),
  `${profilePrefix}${process.pid}-${Date.now()}`
)

async function launchBookmarkApp () {
  const electronApp = await electron.launch({
    ...appOptions,
    env: {
      ...appOptions.env,
      APPDATA: testProfileRoot,
      LOCALAPPDATA: testProfileRoot,
      DATA_PATH: resolve(testProfileRoot, 'data')
    }
  })
  try {
    const client = electronApp.windows()[0] || await electronApp.firstWindow()
    extendClient(client, electronApp)
    await client.waitForFunction(() => {
      return window.store &&
        window.migrating === false &&
        window.store.configLoaded === true &&
        Array.isArray(window.store.bookmarks) &&
        Array.isArray(window.store.bookmarkGroups)
    }, { timeout: 15000 })
    return { electronApp, client }
  } catch (error) {
    await closeBookmarkApp(electronApp, __filename).catch(() => {})
    throw error
  }
}

async function openBookmarksSidebar (client) {
  await client.evaluate(() => {
    window.store.handleSidebarPanelTab('bookmarks')
    window.store.setOpenedSideBar('bookmarks')
  })
  await client.locator('.sidebar-panel-bookmarks .tree-list').waitFor({
    state: 'visible',
    timeout: 10000
  })
}

async function cleanupBookmarkArtifacts (client, artifacts = {}) {
  const { bookmarkIds = [], bookmarkTitles = [], groupIds = [], groupTitles = [] } = artifacts
  await client.evaluate((targets) => {
    const store = window.store
    for (const bookmark of [...store.bookmarks]) {
      if (targets.bookmarkIds.includes(bookmark.id) || targets.bookmarkTitles.includes(bookmark.title)) {
        store.delBookmark(bookmark)
      }
    }
    for (const group of [...store.bookmarkGroups]) {
      if (
        group.id !== 'default' &&
        (targets.groupIds.includes(group.id) || targets.groupTitles.includes(group.title))
      ) {
        store.delBookmarkGroup({ id: group.id })
      }
    }
  }, { bookmarkIds, bookmarkTitles, groupIds, groupTitles })
  await client.waitForFunction((targets) => {
    return !window.store.bookmarks.some(item =>
      targets.bookmarkIds.includes(item.id) || targets.bookmarkTitles.includes(item.title)
    ) && !window.store.bookmarkGroups.some(item =>
      targets.groupIds.includes(item.id) || targets.groupTitles.includes(item.title)
    )
  }, { bookmarkIds, bookmarkTitles, groupIds, groupTitles })
  await client.waitForTimeout(750)
}

async function closeBookmarkApp (electronApp, fileName) {
  if (!electronApp) return
  try {
    await Promise.race([
      electronApp.close(),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('close timeout')), 5000)
      })
    ])
  } catch (error) {
    if (error.message === 'close timeout') {
      log(`${fileName}: close timed out, killing process`)
      electronApp.process().kill()
      return
    }
    if (!/closed|disconnected/i.test(error.message)) throw error
  }
}

async function cleanupBookmarkProfile () {
  const tempRoot = resolve(tmpdir()) + sep
  if (!testProfileRoot.startsWith(tempRoot) || !testProfileRoot.includes(profilePrefix)) {
    throw new Error(`Refusing to remove unexpected test profile: ${testProfileRoot}`)
  }
  await fs.rm(testProfileRoot, { recursive: true, force: true })
}

module.exports = {
  launchBookmarkApp,
  openBookmarksSidebar,
  cleanupBookmarkArtifacts,
  closeBookmarkApp,
  cleanupBookmarkProfile
}
