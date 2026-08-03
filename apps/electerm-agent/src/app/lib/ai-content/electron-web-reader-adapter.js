const path = require('node:path')

const READER_PARTITION = 'persist:shellpilot-ai-web'
const TOOLBAR_HEIGHT = 56
const ACTION_REGISTRIES = new WeakMap()

function escapeHtml (value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildRemoteViewOptions () {
  return {
    webPreferences: {
      partition: READER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  }
}

function buildShellWindowOptions (preload, parent) {
  return {
    width: 1100,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    parent,
    modal: false,
    title: 'ShellPilot AI Web Reader',
    autoHideMenuBar: true,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  }
}

function buildToolbarHtml (origin) {
  const safeOrigin = escapeHtml(origin)
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; style-src \'unsafe-inline\'; ',
    'script-src \'unsafe-inline\';">',
    '<style>',
    '*{box-sizing:border-box}body{margin:0;font:13px system-ui;',
    'background:#f5f7fb;color:#172033;overflow:hidden}',
    '.bar{height:56px;display:flex;align-items:center;gap:12px;',
    'padding:10px 14px;border-bottom:1px solid #d9deea;',
    'background:#fff}.origin{min-width:0;flex:1}.origin strong{display:block;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#status{color:#667085;font-size:12px}button{border:1px solid #c8cfdd;',
    'border-radius:8px;background:#fff;padding:8px 13px;cursor:pointer}',
    'button.primary{background:#1769e0;border-color:#1769e0;color:#fff}',
    '</style></head><body><div class="bar">',
    '<div class="origin"><strong>',
    safeOrigin,
    '</strong><span id="status">Loading page…</span></div>',
    '<button type="button" onclick="shellPilotWebReader.cancel()">',
    'Cancel / 取消</button>',
    '<button type="button" class="primary" ',
    'onclick="shellPilotWebReader.complete()">',
    'Read Current Page / 读取当前页面</button>',
    '</div></body></html>'
  ].join('')
}

function getActionRegistry (ipcMain) {
  let registry = ACTION_REGISTRIES.get(ipcMain)
  if (registry) return registry
  registry = new Map()
  ipcMain.on('ai-web-reader-action', (event, action) => {
    if (!['complete', 'cancel'].includes(action)) return
    registry.get(event.sender.id)?.(action)
  })
  ACTION_REGISTRIES.set(ipcMain, registry)
  return registry
}

function createElectronWebReaderAdapter ({
  electron,
  parentWindow,
  preloadPath
} = {}) {
  const runtime = electron || require('electron')
  const {
    BrowserWindow,
    WebContentsView,
    ipcMain,
    session
  } = runtime
  const isolatedSession = session.fromPartition(READER_PARTITION)
  const actionRegistry = getActionRegistry(ipcMain)
  const readerPreload = preloadPath || path.resolve(
    __dirname,
    '../../preload/ai-web-reader-preload.js'
  )

  function createShell ({ origin } = {}) {
    const window = new BrowserWindow(
      buildShellWindowOptions(readerPreload, parentWindow)
    )
    const view = new WebContentsView(buildRemoteViewOptions())
    const shellWebContentsId = window.webContents.id
    let actionHandler
    let closing = false
    let closed = false

    function resizeView () {
      if (closed || window.isDestroyed()) return
      const bounds = window.getContentBounds()
      view.setBounds({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height - TOOLBAR_HEIGHT)
      })
    }

    window.contentView.addChildView(view)
    resizeView()
    window.on('resize', resizeView)
    window.on('closed', () => {
      closed = true
      actionRegistry.delete(shellWebContentsId)
      if (!closing) actionHandler?.('cancel')
    })

    const ready = window.loadURL(
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(buildToolbarHtml(origin))
    )

    return {
      session: isolatedSession,
      remote: view.webContents,
      ready,

      show () {
        if (!window.isDestroyed()) window.show()
      },

      focus () {
        if (!window.isDestroyed()) window.focus()
      },

      updateStatus (status) {
        if (window.isDestroyed()) return
        const value = JSON.stringify(String(status || ''))
        window.webContents.executeJavaScript(
          'document.getElementById("status").textContent = ' + value
        ).catch(() => {})
      },

      onAction (handler) {
        actionHandler = handler
        actionRegistry.set(shellWebContentsId, handler)
        return () => {
          if (actionRegistry.get(shellWebContentsId) === handler) {
            actionRegistry.delete(shellWebContentsId)
          }
          if (actionHandler === handler) actionHandler = null
        }
      },

      close () {
        if (closing || closed) return
        closing = true
        actionRegistry.delete(shellWebContentsId)
        window.removeListener('resize', resizeView)
        try {
          window.contentView.removeChildView(view)
        } catch {}
        if (!view.webContents.isDestroyed()) {
          view.webContents.close()
        }
        if (!window.isDestroyed()) window.destroy()
        closed = true
      }
    }
  }

  return {
    createShell,
    getSession: () => isolatedSession,
    async clearSessionData () {
      await isolatedSession.clearStorageData()
      await isolatedSession.clearCache()
    }
  }
}

module.exports = {
  READER_PARTITION,
  buildRemoteViewOptions,
  buildShellWindowOptions,
  buildToolbarHtml,
  createElectronWebReaderAdapter
}
