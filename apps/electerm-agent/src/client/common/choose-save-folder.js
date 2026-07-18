export async function chooseSaveDirectory (opts) {
  const openDialog = window.api?.openDialog
  if (typeof openDialog !== 'function') {
    throw new Error('The save-folder dialog is unavailable in this environment.')
  }
  const savePaths = await openDialog({
    title: 'Choose a folder to save file(s)',
    message: 'Choose a folder to save file(s)',
    properties: [
      'openDirectory',
      'showHiddenFiles',
      'createDirectory',
      'noResolveAliases',
      'treatPackageAsDirectory',
      'dontAddToRecent'
    ],
    ...opts
  })
  if (!savePaths || !savePaths.length) {
    return undefined
  }
  return savePaths[0]
}
