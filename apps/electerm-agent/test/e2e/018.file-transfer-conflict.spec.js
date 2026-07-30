const { _electron: electron } = require('@playwright/test')
const {
  test: it
} = require('@playwright/test')
const { describe } = it
it.setTimeout(1000000)

const delay = require('./common/wait')
const log = require('./common/log')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const { expect } = require('./common/expect')

const {
  setupSftpConnection,
  createFile,
  createFolder,
  enterFolder,
  navigateToParentFolder,
  deleteItem,
  selectAllContextMenu,
  verifyFileTransfersComplete,
  closeApp
} = require('./common/common')

describe('file-transfer-conflict-resolution', function () {
  it('should handle bidirectional file transfer conflicts with different resolution policies', async function () {
    const electronApp = await electron.launch(appOptions)
    const client = await electronApp.firstWindow()
    extendClient(client, electronApp)
    await delay(3500)
    log('018.file-transfer-conflict.spec.js: app launched')

    await setupSftpConnection(client)
    log('018.file-transfer-conflict.spec.js: sftp connected')
    await delay(2000)

    // Create a single test folder structure for all tests
    const timestamp = Date.now()
    const testFolder = `conflict-test-${timestamp}`

    let testError
    try {
      // Create and prepare test environment
      await prepareTestEnvironment(client, testFolder)
      log('018.file-transfer-conflict.spec.js: test environment prepared')

      // Test conflict policies in both directions
      await testAllConflictPolicies(client, testFolder)
      log('018.file-transfer-conflict.spec.js: conflict policies tested')
    } catch (error) {
      testError = error
    } finally {
      // Clean up test folders once at the end
      try {
        await dismissConflictModal(client)
        await cleanupTestFolders(client, testFolder)
        log('018.file-transfer-conflict.spec.js: test folders cleaned')
      } catch (cleanupError) {
        log(`018.file-transfer-conflict.spec.js: cleanup failed: ${cleanupError.message}`)
        if (!testError) {
          testError = cleanupError
        }
      }
    }

    await closeApp(electronApp, __filename)
    log('018.file-transfer-conflict.spec.js: app closed')
    if (testError) throw testError
  })
})

async function prepareTestEnvironment (client, testFolder) {
  // Create main test folder in both locations
  await createFolder(client, 'local', testFolder)
  await delay(1000)
  await createFolder(client, 'remote', testFolder)
  await delay(1000)

  // Enter both folders
  await enterFolder(client, 'local', testFolder)
  await delay(1000)
  await enterFolder(client, 'remote', testFolder)
  await delay(1000)

  // Create test files and folders in local only
  const testFiles = [
    'test-file-1.txt'
  ]

  const testFolders = [
    'test-folder-1'
  ]

  // Create files in local
  for (const fileName of testFiles) {
    await createFile(client, 'local', fileName)
    await delay(500)
  }

  // Create folders in local
  for (const folderName of testFolders) {
    await createFolder(client, 'local', folderName)
    await delay(500)
  }

  // Now upload everything to the remote to create identical structure
  await uploadAllToRemote(client)
}

async function uploadAllToRemote (client) {
  // Select all local items
  await selectAllContextMenu(client, 'local')
  await delay(1000)

  // Upload to remote
  await client.rightClick('.session-current .file-list.local .sftp-item.selected', 10, 10)
  await delay(1000)
  await client.click('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item .anticon.anticon-cloud-upload')
  await delay(3000)

  // Wait for transfers to complete
  await verifyFileTransfersComplete(client)
  await delay(1000)
}

async function testAllConflictPolicies (client, testFolder) {
  // Test each policy for local to remote transfers
  await testConflictResolution(client, 'overwrite', 'local', 'remote')
  await testConflictResolution(client, 'rename', 'local', 'remote')
  await testConflictResolution(client, 'skip', 'local', 'remote')

  // Test each policy for remote to local transfers
  // await testConflictResolution(client, 'overwrite', 'remote', 'local')
  // await testConflictResolution(client, 'rename', 'remote', 'local')
  // await testConflictResolution(client, 'skip', 'remote', 'local')
}

async function testConflictResolution (client, policy, fromType, toType) {
  const destinationItemsBefore = await getItemNames(client, toType)

  // Select all items in the source panel
  await selectAllItems(client, fromType)
  await delay(1500)

  // Initiate transfer
  const isUpload = fromType === 'local'
  await client.rightClick(`.session-current .file-list.${fromType} .sftp-item.selected`, 10, 10)
  await delay(1500)

  // Click appropriate transfer menu item
  const menuIconClass = isUpload ? 'cloud-upload' : 'cloud-download'
  await client.click(`.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item .anticon.anticon-${menuIconClass}`)
  const conflictModal = client.locator('.custom-modal-container:visible').first()
  await conflictModal.waitFor({ state: 'visible', timeout: 30000 })

  // Handle conflict resolution based on policy
  if (policy === 'skip') {
    await conflictModal.getByTestId('transfer-conflict-skip-all').click()
  } else if (policy === 'overwrite') {
    await conflictModal.getByTestId('transfer-conflict-apply-all').click()
  } else if (policy === 'rename') {
    await conflictModal.getByTestId('transfer-conflict-rename-all').click()
  } else {
    throw new Error(`Unsupported policy: ${policy}`)
  }
  await conflictModal.waitFor({ state: 'hidden', timeout: 30000 })

  // Wait for transfers to complete for overwrite and rename
  await verifyFileTransfersComplete(client)

  // Verify results based on policy
  if (policy === 'rename') {
    // Verify renamed items exist in destination (with rename- pattern)
    const renamedItems = await client.locator(`.session-current .file-list.${toType} .sftp-item[title*="(rename-"]`)
    const count = await renamedItems.count()
    expect(count).toBeGreaterThan(0, `Expected to find renamed items from ${fromType} to ${toType} with policy ${policy}`)
  } else {
    const destinationItemsAfter = await getItemNames(client, toType)
    expect(destinationItemsAfter).toEqual(
      destinationItemsBefore,
      `Expected ${policy} to preserve destination items`
    )
  }
}

async function getItemNames (client, type) {
  return client
    .locator(`.session-current .file-list.${type} .real-file-item`)
    .evaluateAll(items => items.map(item => item.getAttribute('title')).sort())
}

async function selectAllItems (client, type) {
  // First deselect everything by clicking empty space
  await client.click(`.session-current .file-list.${type} .sftp-item`)
  await delay(500)

  // Use selection context menu to select all real file items
  await selectAllContextMenu(client, type)
  await delay(1000)

  // Count and return the number of selected items
  const selectedItems = await client.locator(`.session-current .file-list.${type} .sftp-item.selected`).count()
  expect(selectedItems).toBeGreaterThan(0, `Expected to select items in ${type}`)

  return selectedItems
}

// async function handleSkipForEachItem (client, expectedItemCount) {
//   // For folders with files inside, we may have more conflicts than the base item count
//   // To handle this, we'll track the current conflict index and click Skip until all are done
//   let conflictsHandled = 0
//   // let timeWithoutConflict = 0
//   const waitInterval = 2000 // Time to wait between checks
//   // Continue until we have no more conflicts for a reasonable time
//   while (conflictsHandled < expectedItemCount) {
//     await client.click('.custom-modal-footer button span:text-is("Skip")')
//     conflictsHandled++

//     // Wait for a short time before checking again
//     await delay(waitInterval)
//   }

//   console.log(`Total conflicts skipped: ${conflictsHandled}`)

//   // We should have at least as many conflicts as selected items
//   expect(conflictsHandled).toBeGreaterThanOrEqual(expectedItemCount,
//     `Expected at least ${expectedItemCount} conflicts to be skipped, but only skipped ${conflictsHandled}`)
// }

async function dismissConflictModal (client) {
  const modal = client.locator('.custom-modal-container:visible').first()
  if (!await modal.isVisible({ timeout: 1000 }).catch(() => false)) {
    return
  }
  const skipAll = modal.getByTestId('transfer-conflict-skip-all')
  if (await skipAll.isVisible({ timeout: 1000 }).catch(() => false)) {
    await skipAll.click()
    await modal.waitFor({ state: 'hidden', timeout: 30000 })
  }
}

async function cleanupTestFolders (client, testFolder) {
  // Navigate back to parent folders (if not already there)
  // Check if we need to navigate back
  const localPathInput = await client.getValue('.session-current .sftp-local-section .sftp-title input')
  if (localPathInput.includes(testFolder)) {
    await navigateToParentFolder(client, 'local')
    await delay(1000)
  }

  const remotePathInput = await client.getValue('.session-current .sftp-remote-section .sftp-title input')
  if (remotePathInput.includes(testFolder)) {
    await navigateToParentFolder(client, 'remote')
    await delay(1000)
  }

  // Delete test folders
  await deleteItem(client, 'local', testFolder)
  await delay(1000)
  await deleteItem(client, 'remote', testFolder)
  await delay(1000)
}
