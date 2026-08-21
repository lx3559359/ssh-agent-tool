export function createFrameBatchedMount ({
  onMount,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window)
}) {
  const mounted = new Set()
  const pending = []
  let frameId = null
  let active = false

  function scheduleNext () {
    if (!active || frameId !== null || pending.length === 0) return
    frameId = requestFrame(() => {
      frameId = null
      if (!active) return
      const index = pending.shift()
      mounted.add(index)
      onMount(index)
      scheduleNext()
    })
  }

  return {
    start (initial = []) {
      if (active) return
      active = true
      initial.forEach(index => mounted.add(index))
      scheduleNext()
    },
    request (index) {
      if (!active || mounted.has(index) || pending.includes(index)) return
      pending.push(index)
      scheduleNext()
    },
    cancel () {
      active = false
      pending.splice(0)
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
    }
  }
}
