const {
  contextBridge,
  ipcRenderer
} = require('electron')

contextBridge.exposeInMainWorld('shellPilotWebReader', {
  complete: () => ipcRenderer.send(
    'ai-web-reader-action',
    'complete'
  ),
  cancel: () => ipcRenderer.send(
    'ai-web-reader-action',
    'cancel'
  )
})
