const delay = require('./wait')
const {
  TEST_HOST,
  TEST_PASS,
  TEST_USER,
  TEST_PORT,
  requireRealServerCredentials
} = require('./env')
const {
  expect
} = require('./expect')
const log = require('./log')

const menuLabels = {
  newFile: /新建文件|New File/i,
  newFolder: /新建文件夹|New Folder/i,
  copy: /复制|Copy/i,
  cut: /剪切|Cut/i,
  paste: /粘贴|Paste/i,
  rename: /重命名|Rename/i,
  info: /属性|信息|Info|Properties/i,
  enter: /进入|Enter/i,
  selectAll: /全选|Select All/i,
  editPermission: /编辑权限|Edit Permission/i,
  gotoFolderInTerminal: /访问终端文件夹|Access this folder from the terminal/i
}

const menuKeys = {
  newFile: 'newFile',
  newFolder: 'newDirectory',
  copy: 'onCopy',
  cut: 'onCut',
  paste: 'onPaste',
  rename: 'doRename',
  info: 'showInfo',
  enter: 'doEnterDirectory',
  selectAll: 'selectAll',
  editPermission: 'editPermission',
  gotoFolderInTerminal: 'gotoFolderInTerminal'
}

async function getVisibleMenuItem (
  client,
  label,
  selector = '.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)'
) {
  const key = menuKeys[label]
  const enabledOnly = selector.includes(':not(.ant-dropdown-menu-item-disabled)')
  const itemSelector = key
    ? `[data-menu-id$="-${key}"]${enabledOnly ? ':not(.ant-dropdown-menu-item-disabled)' : ''}`
    : selector
  const locateItem = () => {
    const menus = client.locator(
      '.ant-dropdown:visible, .ant-dropdown-menu-submenu-popup:visible'
    )
    const items = menus.locator(itemSelector)
    return key
      ? items.first()
      : items.filter({ hasText: menuLabels[label] || label }).first()
  }

  let item = locateItem()
  if (await item.isVisible().catch(() => false)) return item

  const more = client
    .locator('.ant-dropdown:visible [data-menu-id$="-more-submenu"]')
    .first()
  if (await more.isVisible().catch(() => false)) {
    await more.hover()
    item = locateItem()
    if (!await item.isVisible().catch(() => false)) {
      await item.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
    }
    if (!await item.isVisible().catch(() => false)) {
      await more.press('ArrowRight')
      item = locateItem()
      await item.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {})
    }
  }
  return item
}

/**
 * Common file and folder operations for electerm SFTP tests
 */
/**
 * Creates a new file in the specified type of file list (local/remote)
 * Always uses the parent-file-item which is guaranteed to be present
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} fileName - The name of the file to create
 */
async function createFile (client, type, fileName) {
  await waitForFileListReady(client, type)
  await client.evaluate(async ({ type, fileName }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const base = sftp.state[`${type}Path`]
    const separator = type === 'local' ? '\\' : '/'
    const path = `${base.replace(/[\\/]$/, '')}${separator}${fileName}`
    if (type === 'local') {
      await window.fs.touch(path)
    } else {
      await sftp.sftp.touch(path)
    }
    await sftp[`${type}List`]()
  }, { type, fileName })
  await waitForFileListItem(client, type, fileName)
}

/**
 * Creates a new folder in the specified type of file list (local/remote)
 * Always uses the parent-file-item which is guaranteed to be present
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} folderName - The name of the folder to create
 */
async function createFolder (client, type, folderName) {
  await waitForFileListReady(client, type)
  await client.evaluate(async ({ type, folderName }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const base = sftp.state[`${type}Path`]
    const separator = type === 'local' ? '\\' : '/'
    const path = `${base.replace(/[\\/]$/, '')}${separator}${folderName}`
    if (type === 'local') {
      await window.fs.mkdir(path)
    } else {
      await sftp.sftp.mkdir(path)
    }
    await sftp[`${type}List`]()
  }, { type, folderName })
  await waitForFileListItem(client, type, folderName)
}

async function waitForFileListReady (client, type) {
  await client.waitForFunction(type => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(
      sftp &&
      sftp.state[`${type}Loading`] === false &&
      sftp.state[`${type}Path`]
    )
  }, type, { timeout: 40000 })
}

async function waitForFileListItem (client, type, name) {
  await client.waitForFunction(({ type, name }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const list = sftp?.state?.[type]
    return sftp?.state?.[`${type}Loading`] === false &&
      Array.isArray(list) &&
      list.some(item => item.name === name)
  }, { type, name }, { timeout: 40000 })
}
/**
 * Deletes an item (file or folder) from the specified type of file list
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to delete
 */
async function deleteItem (client, type, itemName) {
  await client.click(`.session-current .file-list.${type} .sftp-item[title="${itemName}"]`)
  await delay(400)
  await client.keyboard.press('Delete')
  await delay(400)
  await client.keyboard.press('Enter')
  await delay(2000)
}

/**
 * Copies an item using the context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to copy
 */
async function copyItem (client, type, itemName) {
  await client.rightClick(`.session-current .file-list.${type} .sftp-item[title="${itemName}"]`, 10, 10)
  await delay(1000) // Increased delay for context menu
  await (await getVisibleMenuItem(client, 'copy')).click()
  await delay(1500) // Ensure copy operation registers
}

/**
 * Copies an item using keyboard shortcuts
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to copy
 */
async function copyItemWithKeyboard (client, type, itemName) {
  await client.click(`.session-current .file-list.${type} .sftp-item[title="${itemName}"]`)
  await delay(400)

  // Use Meta+C on Mac, Ctrl+C otherwise
  const isMac = process.platform === 'darwin'
  const modKey = isMac ? 'Meta' : 'Control'
  await client.keyboard.press(`${modKey}+c`)
  await delay(1500) // Ensure copy operation registers
}

/**
 * Cuts an item using the context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to cut
 */
async function cutItem (client, type, itemName) {
  await client.rightClick(`.session-current .file-list.${type} .sftp-item[title="${itemName}"]`, 10, 10)
  await delay(800)
  await (await getVisibleMenuItem(client, 'cut')).click()
  await delay(1000)
}

/**
 * Pastes an item using the context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 */
async function pasteItem (client, type, options = {}) {
  const parentFolderSelector = `.session-current .file-list.${type} .parent-file-item`
  const realFileSelector = `.session-current .file-list.${type} .real-file-item`

  // Click elsewhere to ensure the previous context menu is closed
  await client.click('.session-current .sftp-panel-title')
  await delay(1000) // Increased delay

  // Try to right click on the parent file item first (for empty folders)
  if (await client.locator(parentFolderSelector).count() > 0) {
    await client.rightClick(parentFolderSelector, 10, 10)
  } else {
    // Fall back to real file item if parent item doesn't exist
    await client.rightClick(realFileSelector, 10, 10)
  }
  await delay(1000)

  // Wait for paste menu to be visible and enabled
  const pasteMenuItem = await getVisibleMenuItem(
    client,
    'paste',
    '.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)'
  )
  await pasteMenuItem.waitFor({ state: 'visible', timeout: 5000 })
  await pasteMenuItem.click()
  if (options.resolveConflict === 'rename') {
    await delay(1000)
    await client.evaluate(() => {
      const conflict = window.refs.get('transfer-conflict')
      if (conflict?.state?.transferToConfirm?.id) {
        conflict.act('rename')
      }
    })
  }
  await delay(4000) // Increased delay for paste operation
}

/**
 * Pastes an item using keyboard shortcuts
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 */
async function pasteItemWithKeyboard (client, type, options = {}) {
  // Click on empty space in the file list to ensure focus
  await client.click(`.session-current .file-list.${type}`)
  await delay(1000)

  // Use Meta+V on Mac, Ctrl+V otherwise
  const isMac = process.platform === 'darwin'
  const modKey = isMac ? 'Meta' : 'Control'
  await client.keyboard.press(`${modKey}+v`)
  if (options.resolveConflict === 'rename') {
    await delay(1000)
    await client.evaluate(() => {
      const conflict = window.refs.get('transfer-conflict')
      if (conflict?.state?.transferToConfirm?.id) {
        conflict.act('rename')
      }
    })
  }
  await delay(4000) // Increased delay for paste operation
}

/**
 * Renames an item using the context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} oldName - The current name of the item
 * @param {string} newName - The new name for the item
 */
async function renameItem (client, type, oldName, newName) {
  await client.rightClick(`.session-current .file-list.${type} .sftp-item[title="${oldName}"]`, 10, 10)
  await delay(500)
  await (await getVisibleMenuItem(client, 'rename')).click()
  await delay(400)
  await client.setValue(`.session-current .file-list.${type} .sftp-item input`, newName)
  await client.click('.session-current .sftp-panel-title')
  if (type === 'remote') {
    const confirmButton = client.locator(
      '.custom-modal-wrap button.custom-modal-ok-btn:visible, ' +
      '.ant-modal-confirm .ant-btn-primary:visible'
    ).first()
    await confirmButton.waitFor({ state: 'visible', timeout: 40000 })
    await confirmButton.click()
    await confirmButton.waitFor({ state: 'hidden', timeout: 40000 })
  }
  await client.waitForFunction(({ type, oldName, newName }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const list = sftp?.state?.[type]
    return Array.isArray(list) &&
      list.some(item => item.name === newName) &&
      !list.some(item => item.name === oldName) &&
      sftp.state[`${type}Loading`] === false
  }, { type, oldName, newName }, { timeout: 60000 })
}

/**
 * Enters a folder in the file list
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} folderName - The name of the folder to enter
 */
async function enterFolder (client, type, folderName) {
  await client.rightClick(`.session-current .file-list.${type} .sftp-item[title="${folderName}"]`, 10, 10)
  await delay(800)
  await (await getVisibleMenuItem(client, 'enter')).click()
  await delay(3500) // Increased delay for folder navigation
}

/**
 * Navigates to the parent folder
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 */
async function navigateToParentFolder (client, type) {
  await client.doubleClick(`.session-current .file-list.${type} .parent-file-item`)
  await delay(3000)
}

/**
 * Selects all items in a file list using context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 */
async function selectAllContextMenu (client, type) {
  await client.rightClick(`.session-current .file-list.${type} .real-file-item`, 10, 10)
  await delay(500)
  await (await getVisibleMenuItem(client, 'selectAll')).click()
  await delay(1000)
}

/**
 * Accesses folder from the terminal through context menu
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} folderName - The name of the folder to access
 */
async function accessFolderFromTerminal (client, type, folderName) {
  await client.rightClick(`.file-list.${type} .sftp-item[title="${folderName}"]`, 10, 10)
  await delay(500)
  await (await getVisibleMenuItem(client, 'gotoFolderInTerminal')).click()
  await delay(1000)
}

async function openNewConnectionForm (client) {
  const aigshellNewButton = client.locator(
    '.aigshell-topbar-action[data-action-key="new"]'
  ).first()
  await aigshellNewButton.waitFor({ state: 'visible', timeout: 30000 })
  await aigshellNewButton.click()
  await delay(500)
}

async function confirmSshHostKeyVerificationIfNeeded (client, timeout = 4000) {
  const trustButtons = [
    client.locator('.custom-modal-wrap button:has-text("Trust and Save")').first(),
    client.locator('.custom-modal-wrap button:has-text("信任并保存")').first()
  ]
  for (const trustButton of trustButtons) {
    if (await trustButton.isVisible({ timeout }).catch(() => false)) {
      await trustButton.click()
      await delay(500)
      return true
    }
  }
  return false
}

/**
 * Sets up SSH connection for testing (fills form and submits, no SFTP tab)
 *
 * @param {Object} client - The Playwright client
 */
async function setupSshConnection (client, options = {}) {
  const {
    host = TEST_HOST,
    username = TEST_USER,
    password = TEST_PASS,
    port = TEST_PORT,
    openForm = true,
    waitAfterConnect = 2000,
    hostKeyModalTimeout = 4000
  } = options

  requireRealServerCredentials({ host, password, username })

  if (openForm) {
    await openNewConnectionForm(client)
  }

  await client.setValue('#ssh-form_host', host)
  await client.setValue('#ssh-form_username', username)
  await client.setValue('#ssh-form_password', password)
  await client.setValue('#ssh-form_port', port)
  await client.click('.setting-wrap .ant-btn-primary')
  await confirmSshHostKeyVerificationIfNeeded(client, hostKeyModalTimeout)
  await delay(waitAfterConnect)
}

/**
 * Sets up SFTP connection for testing (SSH form + SFTP tab)
 *
 * @param {Object} client - The Playwright client
 */
async function setupSftpConnection (client) {
  await setupSshConnection(client)
  // Click sftp tab
  await client.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
  await client.waitForFunction(() => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    return Boolean(sftp?.sftp)
  }, null, { timeout: 30000 })
}

async function setLocalSftpPath (client, path) {
  await client.evaluate(async targetPath => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await new Promise(resolve => {
      sftp.setState({ localPathTemp: targetPath }, resolve)
    })
    await sftp.onGoto('local')
  }, path)
  await client.waitForFunction(targetPath => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const normalize = value => String(value || '')
      .replaceAll('\\', '/')
      .toLowerCase()
    return normalize(sftp?.state.localPath) === normalize(targetPath) &&
      sftp?.state.localLoading === false
  }, path)
  await delay(1000)
}

/**
 * Verify that a file exists in the file list
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to verify
 * @returns {Promise<boolean>} - Whether the file exists
 */
async function verifyFileExists (client, type, itemName) {
  const fileItems = client.locator(
    `.session-current .file-list.${type} .sftp-item[title="${itemName}"]`
  )
  if (await fileItems.count()) {
    return true
  }

  // Large directories use a virtualized list. A successfully created or
  // renamed item can therefore exist without having a mounted DOM row.
  return client.evaluate(async ({ type, itemName }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    if (!sftp) {
      return false
    }
    const list = type === 'remote'
      ? await sftp.remoteList(true)
      : await sftp.localList(true)
    return Array.isArray(list) && list.some(item => item.name === itemName)
  }, { type, itemName })
}

/**
 * Verify that a file does not exist in the file list
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} itemName - The name of the item to verify
 * @returns {Promise<boolean>} - Whether the file does not exist
 */
async function verifyFileNotExists (client, type, itemName) {
  return !(await verifyFileExists(client, type, itemName))
}

// Selection operations
async function selectItemsWithShift (client, type, startIndex, endIndex) {
  const items = await client.locator(`.session-current .file-list.${type} .real-file-item`)

  // Click first item
  await items.nth(startIndex).click()
  await delay(500)

  // Shift+click second item
  await items.nth(endIndex).click({
    modifiers: ['Shift']
  })
  await delay(500)
}

async function selectItemsWithCtrlOrCmd (client, type, indices) {
  const items = await client.locator(`.session-current .file-list.${type} .real-file-item`)

  // Click first item
  await items.nth(indices[0]).click()
  await delay(500)

  // Add remaining items with Cmd/Ctrl
  for (let i = 1; i < indices.length; i++) {
    await items.nth(indices[i]).click({
      modifiers: process.platform === 'darwin' ? ['Meta'] : ['Control']
    })
    await delay(500)
  }
}

/**
 * Verifies the current path in the file list input
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} expectedPath - The expected path or part of it
 * @returns {Promise<boolean>} - Whether the path matches
 */
async function verifyCurrentPath (client, type, expectedPath) {
  const currentPath = await client.getValue(`.session-current .sftp-${type}-section .sftp-title input`)
  return currentPath.endsWith(expectedPath)
}

/**
 * Clicks on the SFTP tab
 *
 * @param {Object} client - The Playwright client
 */
async function clickSftpTab (client) {
  await client.locator('.session-current .term-sftp-tabs .type-tab:visible').nth(1).click()
  await delay(3500)
}

/**
 * Counts items in the file list
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {string} selector - The CSS selector for the items (e.g., '.sftp-item' or '.parent-file-item')
 */
async function countFileListItems (client, type, selector) {
  const items = await client.locator(`.session-current .file-list.${type} ${selector}`)
  return await items.count()
}

/**
 * Verifies the number of selected items
 *
 * @param {Object} client - The Playwright client
 * @param {string} type - The type of file list ('local' or 'remote')
 * @param {number} expectedCount - The expected number of selected items
 */
async function verifySelectionCount (client, type, expectedCount) {
  const selectedItems = await client.locator(`.session-current .file-list.${type} .sftp-item.selected`)
  const count = await selectedItems.count()
  expect(count).toBe(expectedCount, `Expected ${expectedCount} items to be selected, found ${count}`)
}

/**
 * Verifies that the fileTransfers array in window.store is empty
 * Polls with retries to handle timing variations in transfer completion
 *
 * @param {Object} client - The Playwright client
 * @param {number} [timeout=30000] - Max wait time in ms
 * @param {number} [interval=1000] - Poll interval in ms
 */
async function verifyFileTransfersComplete (client, timeout = 30000, interval = 1000) {
  const start = Date.now()
  let isEmpty = false
  while (Date.now() - start < timeout) {
    isEmpty = await client.evaluate(() => {
      return window.store.fileTransfers.length === 0
    })
    if (isEmpty) {
      break
    }
    await delay(interval)
  }
  expect(isEmpty).toBe(true, `Expected fileTransfers array to be empty after operations complete (waited ${timeout}ms)`)
}

async function closeApp (electronApp, fileName) {
  try {
    await Promise.race([
      electronApp.close(),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('close timeout')), 5000))
    ])
  } catch (e) {
    if (e.message === 'close timeout') {
      log(`${fileName}: close timed out, killing process`)
      electronApp.process().kill()
    } else {
      console.log(e)
    }
  }
}

module.exports = {
  getVisibleMenuItem,
  openNewConnectionForm,
  createFile,
  createFolder,
  deleteItem,
  copyItem,
  copyItemWithKeyboard,
  cutItem,
  pasteItem,
  pasteItemWithKeyboard,
  renameItem,
  enterFolder,
  navigateToParentFolder,
  selectAllContextMenu,
  accessFolderFromTerminal,
  setupSshConnection,
  setupSftpConnection,
  setLocalSftpPath,
  verifyFileExists,
  verifyFileNotExists,
  selectItemsWithShift,
  selectItemsWithCtrlOrCmd,
  verifyCurrentPath,
  clickSftpTab,
  countFileListItems,
  verifySelectionCount,
  verifyFileTransfersComplete,
  closeApp
}
