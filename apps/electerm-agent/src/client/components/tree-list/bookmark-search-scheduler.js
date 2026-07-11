export function createBookmarkSearchScheduler ({
  onSearch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  delay = 150
}) {
  let timer = null
  let disposed = false

  return {
    schedule (term) {
      if (disposed) {
        return
      }
      if (timer !== null) {
        clearTimer(timer)
      }
      timer = setTimer(() => {
        timer = null
        if (!disposed) {
          onSearch(term)
        }
      }, delay)
    },
    cancel () {
      disposed = true
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
    }
  }
}
