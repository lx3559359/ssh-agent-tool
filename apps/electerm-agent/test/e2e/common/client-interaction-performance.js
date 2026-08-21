function percentile (values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return 0
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  )
  return sorted[index]
}

function maxOrZero (values) {
  return values.length ? Math.max(...values) : 0
}

function summarizeInteractionSamples (samples) {
  return {
    sampleCount: samples.length,
    totalP95Ms: percentile(samples.map(sample => sample.totalMs), 0.95),
    stableFrameMaxMs: maxOrZero(samples.map(sample => sample.stableFrameMs)),
    maxLongTaskMs: maxOrZero(samples.map(sample => sample.maxLongTaskMs || 0))
  }
}

async function measureInputLatency (page, {
  selector,
  text
}) {
  await page.evaluate(({ selector }) => {
    const input = document.querySelector(selector)
    if (!input) throw new Error(`Missing input: ${selector}`)
    const previous = window.__shellpilotInputLatencyProbe
    if (previous?.input && previous?.listener) {
      previous.input.removeEventListener('input', previous.listener, true)
    }
    const state = {
      input,
      listener: null,
      pending: 0,
      samples: []
    }
    state.listener = () => {
      const started = performance.now()
      state.pending += 1
      requestAnimationFrame(() => {
        const presentedAt = performance.now()
        requestAnimationFrame(() => {
          state.samples.push(presentedAt - started)
          state.pending -= 1
        })
      })
    }
    input.addEventListener('input', state.listener, true)
    window.__shellpilotInputLatencyProbe = state
  }, { selector })

  const input = page.locator(selector)
  let driverTimeout = ''
  try {
    await input.pressSequentially(text, { timeout: 15000 })
  } catch (error) {
    if (!/timeout/i.test(`${error?.name || ''} ${error?.message || ''}`)) {
      throw error
    }
    driverTimeout = String(error.message || error)
  }
  await page.waitForFunction(() => {
    const state = window.__shellpilotInputLatencyProbe
    return state?.pending === 0
  })

  return page.evaluate(({ selector, driverTimeout }) => {
    const state = window.__shellpilotInputLatencyProbe
    const input = document.querySelector(selector)
    return {
      samples: [...state.samples],
      value: input?.value || '',
      driverTimeout,
      documentHasFocus: document.hasFocus(),
      visibilityState: document.visibilityState
    }
  }, { selector, driverTimeout })
}

async function measureStoreInteraction (page, {
  action,
  selector,
  readySelector = selector,
  readyCount = 1,
  timeoutMs = 3000
}) {
  return page.evaluate(async ({
    action,
    selector,
    readySelector,
    readyCount,
    timeoutMs
  }) => {
    const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    const visible = element => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
    }
    const longTasks = []
    const longTaskSupported = Boolean(
      window.PerformanceObserver &&
      window.PerformanceObserver.supportedEntryTypes?.includes('longtask')
    )
    let observer = null
    let milestoneObserver = null
    const collectLongTasks = entries => {
      for (const entry of entries) {
        longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration
        })
      }
    }
    if (longTaskSupported) {
      observer = new window.PerformanceObserver(list => {
        collectLongTasks(list.getEntries())
      })
      observer.observe({ type: 'longtask' })
    }

    try {
      const started = performance.now()
      const milestoneSelectors = action === 'open-settings'
        ? {
            shell: '.setting-wrap .setting-tabs',
            hotkey: '.sp-setting-section-startup .edit-shortcut-button',
            session: '.sp-setting-startup-session',
            numbers: '.sp-setting-startup-numbers',
            language: '.setting-header-language-select',
            network: '.sp-setting-section-network:not(.sp-setting-section-placeholder)',
            interface: '.sp-setting-section-interface:not(.sp-setting-section-placeholder)',
            advanced: '.sp-setting-section-advanced:not(.sp-setting-section-placeholder)'
          }
        : {}
      const milestoneOffsetsMs = {}
      const recordMilestones = () => {
        for (const [name, milestoneSelector] of Object.entries(milestoneSelectors)) {
          if (
            milestoneOffsetsMs[name] === undefined &&
            document.querySelector(milestoneSelector)
          ) {
            milestoneOffsetsMs[name] = performance.now() - started
          }
        }
      }
      milestoneObserver = action === 'open-settings'
        ? new window.MutationObserver(recordMilestones)
        : null
      milestoneObserver?.observe(document.documentElement, {
        childList: true,
        subtree: true
      })
      if (action === 'open-ai') window.store.handleOpenAIPanel()
      else if (action === 'switch-ai') window.store.handleOpenAIPanel()
      else if (action === 'open-settings') window.store.openSetting()
      else throw new Error(`Unsupported interaction action: ${action}`)
      recordMilestones()
      const actionCompleted = performance.now()

      while (!visible(document.querySelector(selector))) {
        if (performance.now() - started > timeoutMs) {
          throw new Error(`Interaction timed out before visible: ${action}`)
        }
        await waitFrame()
      }
      const visibleAt = performance.now()

      while (document.querySelectorAll(readySelector).length < readyCount) {
        if (performance.now() - started > timeoutMs) {
          throw new Error(`Interaction timed out before ready: ${action}`)
        }
        await waitFrame()
      }
      const contentReadyAt = performance.now()
      await waitFrame()
      await waitFrame()
      const stableAt = performance.now()

      if (observer) collectLongTasks(observer.takeRecords())
      recordMilestones()
      milestoneObserver?.disconnect()
      const measuredLongTasks = longTasks.filter(entry => (
        entry.startTime >= started && entry.startTime <= stableAt
      )).map(entry => ({
        ...entry,
        startOffsetMs: entry.startTime - started
      }))
      return {
        totalMs: stableAt - started,
        actionMs: actionCompleted - started,
        visibleMs: visibleAt - actionCompleted,
        contentReadyMs: contentReadyAt - visibleAt,
        stableFrameMs: stableAt - visibleAt,
        milestoneOffsetsMs,
        longTaskSupported,
        longTasks: measuredLongTasks,
        maxLongTaskMs: measuredLongTasks.length
          ? Math.max(...measuredLongTasks.map(entry => entry.duration))
          : 0
      }
    } finally {
      observer?.disconnect()
      milestoneObserver?.disconnect()
    }
  }, { action, selector, readySelector, readyCount, timeoutMs })
}

async function waitForStableFrames (page, frameCount = 2) {
  await page.evaluate(async (frameCount) => {
    const waitFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
    for (let index = 0; index < frameCount; index += 1) {
      await waitFrame()
    }
  }, frameCount)
}

module.exports = {
  measureInputLatency,
  measureStoreInteraction,
  percentile,
  summarizeInteractionSamples,
  waitForStableFrames
}
