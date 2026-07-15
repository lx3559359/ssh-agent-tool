const { app, BrowserWindow } = require('electron')

let window

app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 590,
    height: 400,
    useContentSize: true,
    frame: false,
    show: false
  })
  return window.loadURL('about:blank')
})

app.on('window-all-closed', () => app.quit())
