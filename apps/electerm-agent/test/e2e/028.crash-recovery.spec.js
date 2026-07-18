const { test, expect, _electron: electron } = require('@playwright/test')
const {
  cleanupQualityApp,
  forceKillQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')
const { startLocalSshServer } = require('./common/local-ssh-server')

function connectionCounters (server) {
  return {
    authenticationCount: server.state.authenticationCount,
    acceptedCount: server.state.acceptedCount,
    readyCount: server.state.readyCount,
    shellCount: server.state.shellCount
  }
}

test('abnormal exit restores dormant tabs and interrupted task summary without reconnecting', async () => {
  const sshServer = await startLocalSshServer()
  let firstRun
  let secondRun
  let profileRoot
  let firstRunKilled = false
  let primaryError

  try {
    firstRun = await launchQualityApp(electron)
    profileRoot = firstRun.profileRoot

    const saved = await firstRun.page.evaluate(async connection => {
      const recoverableTab = {
        id: 'recovery-ssh-tab',
        type: 'ssh',
        title: '待恢复的本地服务器',
        host: connection.host,
        port: connection.port,
        username: connection.username,
        pane: 'terminal',
        enableSsh: true,
        enableSftp: true,
        status: 'error',
        recoveryPending: true,
        connectionState: 'disconnected',
        autoReConnect: 0
      }
      const pendingAgentTask = {
        id: 'recovery-agent-task',
        mode: 'agent',
        pending: true,
        completionStatus: 'running',
        createdAt: new Date().toISOString()
      }
      window.store.tabs = [recoverableTab]
      window.store.activeTabId = recoverableTab.id
      window.store.aiChatHistory = [pendingAgentTask]
      return window.pre.runGlobalAsync('saveRecoverySnapshot', {
        schemaVersion: 1,
        layout: 'c1',
        activeTabId: recoverableTab.id,
        tabs: [recoverableTab],
        pendingTasks: [{
          id: pendingAgentTask.id,
          type: 'agent',
          status: 'running',
          title: '未完成的服务器诊断',
          startedAt: pendingAgentTask.createdAt
        }]
      })
    }, {
      host: sshServer.host,
      port: sshServer.port,
      username: sshServer.username
    })
    expect(saved).toBe(true)
    expect(connectionCounters(sshServer)).toEqual({
      authenticationCount: 0,
      acceptedCount: 0,
      readyCount: 0,
      shellCount: 0
    })

    await forceKillQualityApp(firstRun.electronApp)
    firstRunKilled = true

    secondRun = await launchQualityApp(electron, { profileRoot })
    expect(secondRun.profileRoot).toBe(profileRoot)

    const notice = secondRun.page.locator('.crash-recovery-notice')
    await expect(notice).toBeVisible({ timeout: 20000 })
    await expect(notice).toContainText('上次运行异常结束')
    await expect(notice).toContainText('可恢复 1 个标签')
    await expect(notice).toContainText('1 个任务已中断')

    await expect.poll(() => connectionCounters(sshServer), { timeout: 3000 }).toEqual({
      authenticationCount: 0,
      acceptedCount: 0,
      readyCount: 0,
      shellCount: 0
    })

    await notice.getByRole('button', { name: '恢复标签' }).click()
    await expect(notice).toContainText('已恢复 1 个标签，均处于待重新连接状态。')
    await expect.poll(() => secondRun.page.evaluate(() => {
      const tab = window.store.tabs.find(item => item.id === 'recovery-ssh-tab')
      return tab
        ? {
            title: tab.title,
            recoveryPending: tab.recoveryPending,
            connectionState: tab.connectionState,
            autoReConnect: tab.autoReConnect,
            hasSession: Boolean(window.refs.get('term-' + tab.id)?.session)
          }
        : null
    })).toEqual({
      title: '待恢复的本地服务器',
      recoveryPending: true,
      connectionState: 'disconnected',
      autoReConnect: 0,
      hasSession: false
    })

    await expect.poll(() => connectionCounters(sshServer), { timeout: 3000 }).toEqual({
      authenticationCount: 0,
      acceptedCount: 0,
      readyCount: 0,
      shellCount: 0
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (secondRun) {
      await cleanupQualityApp(secondRun.electronApp, secondRun.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    } else if (profileRoot) {
      await cleanupQualityApp(firstRunKilled ? null : firstRun?.electronApp, profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
    await sshServer.close().catch(() => {})
  }
})
