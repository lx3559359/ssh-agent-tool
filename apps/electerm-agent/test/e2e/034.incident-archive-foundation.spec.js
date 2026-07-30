const { promises: fs } = require('node:fs')
const path = require('node:path')
const { _electron: electron, expect, test } = require('@playwright/test')
const {
  cleanupQualityApp,
  launchQualityApp
} = require('./common/quality-e2e-app')

const screenshotDir = path.resolve(
  process.cwd(),
  'test-results',
  'incident-archive'
)

const blankFilters = Object.freeze({
  query: '',
  endpointRef: '',
  state: [],
  severity: [],
  serviceTags: [],
  customTags: [],
  favoriteOnly: false,
  updatedFrom: null,
  updatedTo: null,
  page: 1,
  pageSize: 20
})

test.setTimeout(3 * 60 * 1000)

async function dismissStartupModals (page) {
  const modal = page.locator('.custom-modal-container:visible')
  for (let attempt = 0; attempt < 4 && await modal.count(); attempt += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    if (!await modal.count()) break
    const close = modal.locator('.custom-modal-close:visible').last()
    if (await close.count()) await close.click()
  }
}

async function openIncidentWorkspace (page) {
  await page.evaluate(() => window.store.openIncidentArchiveWorkspace())
  const workspace = page.locator('.incident-workspace-active')
  await expect(workspace).toBeVisible()
  return workspace
}

async function createIncident (page, overrides = {}) {
  return page.evaluate(async draft => {
    const incident = await window.store.createIncidentArchive({
      title: 'Nginx gateway timeout',
      endpointRef: 'server-prod-01',
      severity: 'high',
      serviceTags: ['nginx', 'gateway'],
      customTags: ['production', 'customer-impact'],
      summary: 'Requests return 504 because the upstream times out.',
      rootCause: 'The upstream worker pool is exhausted.',
      resolution: 'Increase the worker pool and restart gracefully.',
      isFavorite: true,
      isPinned: false,
      ...draft
    })
    return {
      id: incident.id,
      state: incident.state,
      title: incident.title
    }
  }, overrides)
}

async function loadWithFilters (page, filters) {
  return page.evaluate(async ({ base, next }) => {
    const result = await window.store.loadIncidentArchives({
      ...base,
      ...next
    })
    return {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      items: result.items.map(item => ({
        id: item.id,
        title: item.title,
        state: item.state,
        severity: item.severity
      }))
    }
  }, { base: blankFilters, next: filters })
}

async function setWindowSize (electronApp, page, width, height) {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const target = BrowserWindow.getAllWindows()[0]
    target.webContents.setZoomFactor(1)
    target.setContentSize(size.width, size.height)
  }, { width, height })
  await page.waitForTimeout(180)
}

async function setTheme (page, theme) {
  await page.evaluate(value => window.store.setTheme(value), theme)
  await expect.poll(
    () => page.evaluate(() => window.store.config.theme)
  ).toBe(theme)
}

async function closeWithoutDeletingProfile (run) {
  await run.electronApp.close()
  await new Promise(resolve => setTimeout(resolve, 250))
}

test('incident archive completes lifecycle, backup restore, and preserves terminal refs', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)
    await page.locator('.add-new-tab-btn').click()
    await page.locator('.term-wrap:visible').waitFor({ timeout: 20000 })
    const terminalBefore = await page.evaluate(() => {
      const tabId = window.store.activeTabId
      return {
        tabId,
        hasTerminal: window.refs.has('term-' + tabId),
        hasTab: window.refsTabs.has('tab-' + tabId)
      }
    })
    expect(terminalBefore.hasTerminal).toBe(true)
    expect(terminalBefore.hasTab).toBe(true)
    const workspace = await openIncidentWorkspace(page)

    const created = await createIncident(page)
    await expect(workspace).toContainText(created.title)
    await expect(page.locator('.incident-detail-panel')).toContainText(
      created.title
    )

    const lifecycle = await page.evaluate(async () => {
      const states = []
      for (const input of [
        { state: 'verifying' },
        { state: 'resolved', verificationStatus: 'passed_manual' },
        { state: 'archived' },
        { state: 'investigating' }
      ]) {
        const result = await window.store.transitionActiveIncident(input)
        states.push({
          state: result.state,
          verificationStatus: result.verificationStatus
        })
      }
      return states
    })
    expect(lifecycle).toEqual([
      { state: 'verifying', verificationStatus: 'pending' },
      { state: 'resolved', verificationStatus: 'passed_manual' },
      { state: 'archived', verificationStatus: 'passed_manual' },
      { state: 'investigating', verificationStatus: 'pending' }
    ])

    const backupResult = await page.evaluate(async () => {
      const storage = await window.store.createIncidentBackup()
      const backup = storage.backups[0]
      await window.store.updateActiveIncident({
        title: 'Title changed after backup'
      })
      const changedTitle = window.store.activeIncident.title
      const restored = await window.store.restoreIncidentBackup(
        backup.filename,
        'RESTORE'
      )
      const result = await window.store.loadIncidentArchives({
        query: 'Nginx gateway timeout',
        page: 1,
        pageSize: 20
      })
      return {
        backupCount: storage.backupCount,
        changedTitle,
        restored,
        restoredTitle: result.items[0]?.title || ''
      }
    })
    expect(backupResult.backupCount).toBeGreaterThan(0)
    expect(backupResult.changedTitle).toBe('Title changed after backup')
    expect(backupResult.restored).toBeTruthy()
    expect(backupResult.restoredTitle).toBe('Nginx gateway timeout')

    expect(await page.evaluate(tabId => ({
      hasTerminal: window.refs.has('term-' + tabId),
      tabMounted: window.refsTabs.has('tab-' + tabId)
    }), terminalBefore.tabId)).toEqual({
      hasTerminal: true,
      tabMounted: true
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})

test('incident archive persists, searches every text field, filters, and opens from home', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    let page = run.page
    await dismissStartupModals(page)
    await openIncidentWorkspace(page)

    const primary = await createIncident(page, {
      title: 'Needle title outage',
      summary: 'Summary marker alpha',
      endpointRef: 'server-search-01'
    })
    await page.evaluate(async primaryId => {
      for (let index = 0; index < 24; index += 1) {
        await window.store.createIncidentArchive({
          title: `Paged incident ${String(index).padStart(2, '0')}`,
          endpointRef: index % 2 ? 'server-page-a' : 'server-page-b',
          severity: index % 2 ? 'low' : 'medium',
          serviceTags: ['batch-service'],
          customTags: [index % 2 ? 'odd' : 'even'],
          summary: `Pagination fixture ${index}`,
          isFavorite: index % 3 === 0
        })
      }
      await window.store.selectIncidentArchive(primaryId)
      await window.store.addActiveIncidentNote('Note marker omega')
      await window.store.transitionActiveIncident({
        state: 'unresolved',
        verificationStatus: 'mitigated'
      })
    }, primary.id)

    const filterResults = {
      title: await loadWithFilters(page, { query: 'Needle title' }),
      summary: await loadWithFilters(page, { query: 'Summary marker' }),
      note: await loadWithFilters(page, { query: 'Note marker' }),
      server: await loadWithFilters(page, {
        endpointRef: 'server-search-01'
      }),
      state: await loadWithFilters(page, { state: ['unresolved'] }),
      severity: await loadWithFilters(page, { severity: ['high'] }),
      service: await loadWithFilters(page, {
        serviceTags: ['batch-service']
      }),
      custom: await loadWithFilters(page, { customTags: ['odd'] }),
      favorite: await loadWithFilters(page, { favoriteOnly: true }),
      date: await loadWithFilters(page, {
        updatedFrom: Date.now() - 60_000,
        updatedTo: Date.now() + 60_000
      }),
      pageTwo: await loadWithFilters(page, { page: 2, pageSize: 20 })
    }
    for (const key of ['title', 'summary', 'note', 'server', 'state', 'severity']) {
      expect(filterResults[key].items.map(item => item.id)).toContain(primary.id)
    }
    expect(filterResults.service.total).toBe(24)
    expect(filterResults.custom.total).toBe(12)
    expect(filterResults.favorite.total).toBeGreaterThanOrEqual(9)
    expect(filterResults.date.total).toBeGreaterThanOrEqual(25)
    expect(filterResults.pageTwo.page).toBe(2)
    expect(filterResults.pageTwo.items.length).toBe(5)

    const profileRoot = run.profileRoot
    await closeWithoutDeletingProfile(run)
    run = await launchQualityApp(electron, { profileRoot })
    page = run.page
    await dismissStartupModals(page)

    const persisted = await page.evaluate(async id => {
      window.store.openIncidentArchiveWorkspace(id)
      const incident = await window.store.selectIncidentArchive(id)
      return {
        id: incident.id,
        title: incident.title,
        state: incident.state,
        notes: incident.notes.map(note => note.body)
      }
    }, primary.id)
    expect(persisted).toEqual({
      id: primary.id,
      title: 'Needle title outage',
      state: 'unresolved',
      notes: ['Note marker omega']
    })

    await page.evaluate(async () => {
      await window.store.loadIncidentSummary()
      window.store.closeIncidentArchiveWorkspace()
    })
    const homeSummary = page.locator('.incident-home-summary')
    await expect(homeSummary).toBeVisible()
    await expect(homeSummary).toContainText('Needle title outage')
    await homeSummary.getByRole('button', {
      name: /Needle title outage/
    }).click()
    await expect(page.locator('.incident-workspace-active')).toBeVisible()
    await expect(page.locator('.incident-detail-panel')).toContainText(
      'Needle title outage'
    )
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})

test('incident candidate remains pending until the user confirms the formal record', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)
    const candidate = await page.evaluate(async () => {
      return window.store.captureIncidentCandidate({
        fingerprint: 'e2e:candidate:nginx',
        source: 'fleet-status',
        title: 'Nginx service requires review',
        endpointRef: 'server-candidate-01',
        severity: 'high',
        summary: 'The service state was reported as failed.',
        evidence: {
          service: 'nginx',
          state: 'failed'
        }
      })
    })
    expect(candidate.status).toBe('pending')

    const workspace = await openIncidentWorkspace(page)
    await workspace.locator('.incident-workspace-actions button').first().click()
    const candidateWorkspace = page.locator('.incident-candidate-workspace')
    await expect(candidateWorkspace).toBeVisible()
    await expect(candidateWorkspace).toContainText(candidate.title)
    await fs.mkdir(screenshotDir, { recursive: true })
    await page.screenshot({
      path: path.join(screenshotDir, 'candidate-review.png'),
      animations: 'disabled',
      caret: 'hide',
      scale: 'css'
    })

    const review = page.locator('.incident-candidate-review')
    await review.locator('textarea').fill(
      'Confirmed impact after reviewing the collected evidence.'
    )
    await review.locator('footer .ant-btn-primary').click()

    const detail = page.locator('.incident-detail-panel')
    await expect(detail).toContainText(candidate.title)
    await expect(detail).toContainText(
      'Confirmed impact after reviewing the collected evidence.'
    )
    expect(await page.evaluate(() => ({
      pending: window.store.incidentCandidateTotal,
      activeTitle: window.store.activeIncident?.title,
      timelineSources: (
        window.store.activeIncident?.timelineEvents || []
      ).map(item => item.source)
    }))).toEqual({
      pending: 0,
      activeTitle: candidate.title,
      timelineSources: ['fleet-status']
    })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})

test('incident archive remains usable across themes, desktop sizes, and narrow layout', async () => {
  let run
  let primaryError
  try {
    run = await launchQualityApp(electron)
    const page = run.page
    await dismissStartupModals(page)
    await openIncidentWorkspace(page)
    const incident = await createIncident(page, {
      title: 'Visual regression incident',
      summary: 'Long incident summary. '.repeat(120),
      rootCause: 'Root cause evidence. '.repeat(80),
      resolution: 'Resolution steps. '.repeat(80)
    })
    await page.evaluate(async () => {
      for (let index = 0; index < 18; index += 1) {
        await window.store.addActiveIncidentNote(
          `Investigation note ${index + 1}: ${'evidence '.repeat(20)}`
        )
      }
      window.store.incidentError = 'Incident error contrast check'
    })
    await expect(page.locator('.incident-workspace-error')).toBeVisible()
    await fs.mkdir(screenshotDir, { recursive: true })

    const cases = [
      { width: 1366, height: 768, theme: 'default', label: '1366-dark' },
      {
        width: 1366,
        height: 768,
        theme: 'defaultLight',
        label: '1366-light'
      },
      { width: 1920, height: 1080, theme: 'default', label: '1920-dark' },
      {
        width: 1920,
        height: 1080,
        theme: 'defaultLight',
        label: '1920-light'
      }
    ]

    for (const viewport of cases) {
      await setTheme(page, viewport.theme)
      await setWindowSize(
        run.electronApp,
        page,
        viewport.width,
        viewport.height
      )
      const workspace = page.locator('.incident-workspace-active')
      await expect(workspace).toContainText(/故障档案|Incident archives/)
      await expect(page.locator('.incident-detail-panel')).toContainText(
        'Visual regression incident'
      )
      const metrics = await page.evaluate(() => {
        const workspace = document.querySelector('.incident-workspace-active')
        const list = document.querySelector('.incident-list-scroll')
        const detail = document.querySelector('.incident-detail-panel')
        const alert = document.querySelector('.incident-workspace-error')
        const alertStyle = window.getComputedStyle(alert)
        const workspaceRect = workspace.getBoundingClientRect()
        const topLayer = document.elementFromPoint(
          workspaceRect.left + workspaceRect.width / 2,
          workspaceRect.top + 20
        )
        return {
          viewportWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
          workspaceWidth: workspace.getBoundingClientRect().width,
          workspaceIsTopLayer: Boolean(
            topLayer && workspace.contains(topLayer)
          ),
          listOverflowY: window.getComputedStyle(list).overflowY,
          detailOverflowY: window.getComputedStyle(detail).overflowY,
          detailScrollHeight: detail.scrollHeight,
          detailClientHeight: detail.clientHeight,
          alertColor: alertStyle.color,
          alertBackground: alertStyle.backgroundColor
        }
      })
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(
        metrics.viewportWidth + 1
      )
      expect(metrics.workspaceWidth).toBeGreaterThan(900)
      expect(metrics.workspaceIsTopLayer).toBe(true)
      expect(metrics.listOverflowY).toBe('auto')
      expect(metrics.detailOverflowY).toBe('auto')
      expect(metrics.detailScrollHeight).toBeGreaterThan(
        metrics.detailClientHeight
      )
      expect(metrics.alertColor).not.toBe(metrics.alertBackground)
      await page.screenshot({
        path: path.join(screenshotDir, `${viewport.label}.png`),
        animations: 'disabled',
        caret: 'hide',
        scale: 'css'
      })
    }

    await setTheme(page, 'defaultLight')
    await setWindowSize(run.electronApp, page, 820, 700)
    await expect(page.locator('.incident-mobile-back')).toBeVisible()
    await page.locator('.incident-mobile-back').click()
    await expect(page.locator('.incident-list-panel')).toBeVisible()
    await page.locator('.incident-list-item', {
      hasText: incident.title
    }).click()
    await expect(page.locator('.incident-detail-panel')).toContainText(
      incident.title
    )
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (run) {
      await cleanupQualityApp(run.electronApp, run.profileRoot).catch(error => {
        if (!primaryError) throw error
      })
    }
  }
})
