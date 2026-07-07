export async function runBookmarkUploadWithWatchers ({
  file,
  upload,
  watchers = [],
  showError,
  waitAfterUpload = async () => {}
}) {
  for (const watcher of watchers) {
    watcher?.stop?.()
  }

  try {
    await upload(file)
  } catch (err) {
    showError?.(err?.message || String(err))
  } finally {
    await waitAfterUpload()
    for (const watcher of watchers) {
      watcher?.start?.()
    }
  }

  return false
}
