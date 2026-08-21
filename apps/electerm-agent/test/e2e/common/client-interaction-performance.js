function percentile (values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return 0
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1)
  )
  return sorted[index]
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
  timeoutMs = 3000
}) {
  return page.evaluate(async ({ action, selector, timeoutMs }) => {
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
    const started = performance.now()
    if (action === 'open-ai') window.store.handleOpenAIPanel()
    else if (action === 'switch-ai') window.store.handleOpenAIPanel()
    else if (action === 'open-settings') window.store.openSetting()
    else throw new Error(`Unsupported interaction action: ${action}`)
    const actionCompleted = performance.now()

    while (!visible(document.querySelector(selector))) {
      if (performance.now() - started > timeoutMs) {
        throw new Error(`Interaction timed out: ${action}`)
      }
      await waitFrame()
    }
    const visibleAt = performance.now()
    await waitFrame()
    await waitFrame()
    const stableAt = performance.now()
    return {
      totalMs: stableAt - started,
      actionMs: actionCompleted - started,
      visibleMs: visibleAt - actionCompleted,
      stableFrameMs: stableAt - visibleAt
    }
  }, { action, selector, timeoutMs })
}

module.exports = {
  measureInputLatency,
  measureStoreInteraction,
  percentile
}
