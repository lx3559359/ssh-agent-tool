const PDF_TIMEOUT_MS = 30_000

function createTimeout (milliseconds) {
  let timeout
  const promise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('PDF generation timed out.')
      error.code = 'ARTIFACT_PDF_TIMEOUT'
      reject(error)
    }, milliseconds)
  })
  return {
    promise,
    clear: () => clearTimeout(timeout)
  }
}

async function printHtml (html, options = {}) {
  const { BrowserWindow } = require('electron')
  let window
  const timeout = createTimeout(PDF_TIMEOUT_MS)
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })
    await Promise.race([
      window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
      ),
      timeout.promise
    ])
    return await Promise.race([
      window.webContents.printToPDF({
        pageSize: options.pageSize || 'A4',
        printBackground: options.printBackground !== false,
        margins: options.margins || {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        }
      }),
      timeout.promise
    ])
  } finally {
    timeout.clear()
    if (window && !window.isDestroyed()) window.destroy()
  }
}

module.exports = {
  printHtml
}
