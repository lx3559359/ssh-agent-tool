const { _electron: electron } = require('@playwright/test')
const { test: it, expect } = require('@playwright/test')
const { describe } = it
it.setTimeout(100000)
const delay = require('./common/wait')
const nanoid = require('./common/uid')
const appOptions = require('./common/app-options')
const extendClient = require('./common/client-extend')
const {
  getVisibleMenuItem,
  setupSftpConnection
} = require('./common/common')

describe('file info modal', function () {
  it('should show local file information and edit remote permissions', async function () {
    const electronApp = await electron.launch(appOptions)
    try {
      const client = await electronApp.firstWindow()
      extendClient(client, electronApp)
      await delay(3500)

      await setupSftpConnection(client)
      await testFileInfoModal(client, 'local', 'click')
      await testEditFolderPermission(client, 'remote')
    } finally {
      await electronApp.close().catch(console.log)
    }
  })
})

async function testEditFolderPermission (client, folderType) {
  const folderName = `${folderType}-test-folder-${nanoid()}`
  const fixture = await createRemotePermissionFixture(client, folderName)
  try {
    // Right-click on the folder and select "Edit Permission"
    await client.rightClick(`.session-current .file-list.${folderType} .sftp-item[title="${folderName}"]`, 10, 10)
    await delay(500)
    await (await getVisibleMenuItem(client, 'editPermission')).click()
    await delay(1000)

    // Verify that the edit permission modal is open
    await client.hasElem('.custom-modal-container')

    // Check if the modal title is "Edit Folder Permission"
    const modalTitle = await client.getText('.custom-modal-title')
    expect(modalTitle).toMatch(/编辑.*权限|Edit.*Permission/i)

    // Change a specific permission (e.g., 'other' 'write')
    const permissionButton = client
      .locator('.custom-modal-container .file-props > .pd1b > .pd1b')
      .filter({ hasText: /其他|other/i })
      .locator('.ant-btn')
      .filter({ hasText: /写|write/i })
      .first()

    const initialClass = await permissionButton.getAttribute('class')
    const initiallyActive = initialClass.includes('ant-btn-primary')

    await permissionButton.click()
    await delay(200)

    const newClass = await permissionButton.getAttribute('class')
    const nowActive = newClass.includes('ant-btn-primary')

    expect(nowActive).not.toBe(initiallyActive)
    const hasBoundFileItem = await client.evaluate(() => {
      const fileModal = window.refsStatic.get('file-modal')
      return Boolean(
        fileModal?.state?.fileId &&
        window.refs.get(fileModal.state.fileId)
      )
    })
    expect(hasBoundFileItem).toBe(true)

    // Save the changes
    await client.click('.custom-modal-footer .ant-btn-primary')
    const safetyConfirm = client
      .locator('.custom-modal-wrap button.custom-modal-ok-btn:visible')
      .first()
    await resolvePermissionSafetyStep(
      client,
      safetyConfirm,
      fixture.targetPath,
      nowActive
    )

    // Verify that the modal is closed
    await client.hasElem('.custom-modal-container', false)

    await expect.poll(() => client.evaluate(async targetPath => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      const stat = await sftp.sftp.lstat(targetPath)
      return Boolean(stat.mode & 0o2)
    }, fixture.targetPath), { timeout: 30000 }).toBe(nowActive)
  } finally {
    await removeRemotePermissionFixture(client, fixture)
  }
}

async function resolvePermissionSafetyStep (
  client,
  safetyConfirm,
  targetPath,
  expectedOtherWrite
) {
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    if (await safetyConfirm.isVisible().catch(() => false)) {
      await safetyConfirm.click()
      return
    }
    const changed = await client.evaluate(async ({ targetPath, expectedOtherWrite }) => {
      const sftp = window.refs.get('sftp-' + window.store.activeTabId)
      const stat = await sftp.sftp.lstat(targetPath)
      return Boolean(stat.mode & 0o2) === expectedOtherWrite
    }, { targetPath, expectedOtherWrite })
    if (changed) return
    await delay(250)
  }
  throw new Error('权限修改既未进入安全确认，也未写入服务器')
}

async function createRemotePermissionFixture (client, folderName) {
  return client.evaluate(async folderName => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    const originalPath = sftp.state.remotePath
    const sandboxPath = `/tmp/shellpilot-permission-${Date.now()}`
    const targetPath = `${sandboxPath}/${folderName}`
    await sftp.sftp.mkdir(sandboxPath)
    await sftp.sftp.mkdir(targetPath)
    await new Promise(resolve => {
      sftp.setState({
        remotePath: sandboxPath,
        remotePathTemp: sandboxPath
      }, resolve)
    })
    await sftp.remoteList()
    return { originalPath, sandboxPath, targetPath }
  }, folderName)
}

async function removeRemotePermissionFixture (client, fixture) {
  await client.evaluate(async ({ originalPath, sandboxPath }) => {
    const sftp = window.refs.get('sftp-' + window.store.activeTabId)
    await sftp.sftp.removeEntry(sandboxPath)
    await new Promise(resolve => {
      sftp.setState({
        remotePath: originalPath,
        remotePathTemp: originalPath
      }, resolve)
    })
    await sftp.remoteList()
  }, fixture)
}

async function testFileInfoModal (client, fileType, closeMethod) {
  const fname = `${fileType}-test-electerm-${nanoid()}`

  // Create a new folder
  await client.rightClick(`.session-current .file-list.${fileType} .real-file-item`, 10, 10)
  await delay(500)
  await client.click('.ant-dropdown:not(.ant-dropdown-hidden) .anticon-folder-add')
  await delay(200)
  await client.setValue('.session-current .sftp-item input', fname)
  await client.click('.session-current .sftp-panel-title')
  await delay(2500)

  // Verify folder was created
  await client.hasElem(`.session-current .file-list.${fileType} .sftp-item[title="${fname}"]`)

  // Open info modal
  await client.rightClick(`.session-current .file-list.${fileType} .sftp-item[title="${fname}"]`, 10, 10)
  await delay(200)
  await client.click('.ant-dropdown:not(.ant-dropdown-hidden) .anticon-info-circle')
  await delay(1200)

  // Verify modal content and visibility
  await client.hasElem('.custom-modal-container')
  await client.hasElem('.custom-modal-container')
  await client.hasElem('.custom-modal-wrap .file-props')

  // Close modal using different methods
  if (closeMethod === 'click') {
    await client.click('.custom-modal-close')
  } else {
    await client.keyboard.press('Escape')
  }
  await delay(300)

  // Verify modal is closed
  await client.hasElem('.custom-modal-container', false)

  // Delete the test folder
  await client.click(`.session-current .file-list.${fileType} .sftp-item[title="${fname}"]`)
  await delay(400)
  await client.keyboard.press('Delete')
  await delay(400)
  await client.keyboard.press('Enter')
  await delay(2500)

  // Verify folder is deleted
  await client.hasElem(`.session-current .file-list.${fileType} .sftp-item[title="${fname}"]`, false)
}
