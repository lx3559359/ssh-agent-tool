import { loadAttachAddon } from './xterm-loader.js'

const terminalControlFlag = '__aigshellTerminalControl'
const managedPtySessionNoncePattern = /^[a-f0-9]{32}$/

export default class AttachAddonCustom {
  constructor (term, socket, isWindowsShell) {
    this.term = term
    this.socket = socket
    this.isWindowsShell = isWindowsShell
    this.outputSuppressed = false
    this.managedPtyEchoSuppressionActive = false
    this.managedPtySessionNonce = ''
    this.suppressedData = []
    this.suppressTimeout = null
    this.onSuppressionEndCallback = null
    this.publishSuppressionRemainder = false
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.pendingInput = []
    this.hasReceivedInitialData = false
    this.onInitialDataCallback = null
    this._bidirectional = true
    this._disposables = []
    this._socket = socket
    this.decoder = new TextDecoder('utf-8')
    this._lastDataTime = Date.now()
    this._lastInputTime = Date.now()
    this._keepaliveTimer = null
    this._keepaliveInterval = 3000
    this._lastOutputLine = ''
    this._passwordPromptDetected = false
    this._pendingEchoCheck = null
    this._echoCheckTimer = null
    this._pendingTerminalEnter = null
    this._terminalPastePending = false
    this._remoteOutputListeners = new Set()
    this._remoteOutputDecoder = new TextDecoder('utf-8')
  }

  _initBase = async () => {
    const AttachAddon = await loadAttachAddon()
    const base = new AttachAddon(this._socket, { bidirectional: this._bidirectional })
    this._sendData = base._sendData.bind(base)
  }

  onInitialData = (callback) => {
    if (this.hasReceivedInitialData) {
      callback()
    } else {
      this.onInitialDataCallback = callback
    }
  }

  onRemoteOutput = (listener) => {
    if (typeof listener !== 'function') {
      throw new TypeError('Remote output listener is required')
    }
    this._remoteOutputListeners.add(listener)
    return {
      dispose: () => this._remoteOutputListeners.delete(listener)
    }
  }

  _publishRemoteOutput = (value) => {
    let text
    if (typeof value === 'string') {
      text = value
    } else {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      text = this._remoteOutputDecoder.decode(bytes, { stream: true })
    }
    if (!text) return
    for (const listener of [...this._remoteOutputListeners]) listener(text)
  }

  startOutputSuppression = (
    timeout = 3000,
    onEnd = null,
    discardOnTimeout = false,
    publishRemainder = false,
    releaseMarker = ''
  ) => {
    if (this.suppressTimeout) clearTimeout(this.suppressTimeout)
    this.outputSuppressed = true
    this.suppressedData = []
    this.onSuppressionEndCallback = onEnd
    this.publishSuppressionRemainder = publishRemainder === true
    this.suppressionReleaseMarker = String(releaseMarker || '')
    this.suppressionScanText = ''
    this.suppressionDecoder = new TextDecoder('utf-8')
    const timeoutNumber = Number(timeout)
    if (Number.isFinite(timeoutNumber) && timeoutNumber > 0) {
      this.suppressTimeout = setTimeout(() => {
        if (!discardOnTimeout) {
          console.warn('[AttachAddon] Output suppression timeout reached, resuming')
        }
        this.stopOutputSuppression(discardOnTimeout)
      }, timeoutNumber)
    } else {
      this.suppressTimeout = null
    }
  }

  stopOutputSuppression = (discard = true) => {
    if (this.suppressTimeout) {
      clearTimeout(this.suppressTimeout)
      this.suppressTimeout = null
    }
    this.outputSuppressed = false
    this.managedPtyEchoSuppressionActive = false
    this.managedPtySessionNonce = ''
    this.publishSuppressionRemainder = false
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionDecoder = new TextDecoder('utf-8')

    if (!discard && this.suppressedData.length > 0) {
      for (const data of this.suppressedData) {
        this.writeToTerminalDirect(data)
      }
    }
    this.suppressedData = []

    if (this.onSuppressionEndCallback) {
      const callback = this.onSuppressionEndCallback
      this.onSuppressionEndCallback = null
      callback()
    }
    return this.flushPendingInput()
  }

  prepareManagedPtyEchoRecovery = () => {
    const nonce = this.managedPtySessionNonce
    if (!this.managedPtyEchoSuppressionActive ||
      !managedPtySessionNoncePattern.test(nonce)) return false
    this.suppressionReleaseMarker =
      `${String.fromCharCode(27)}]633;A;${nonce}${String.fromCharCode(7)}`
    this.suppressionScanText = ''
    this.suppressionDecoder = new TextDecoder('utf-8')
    return true
  }

  cancelManagedPtyEchoSuppression = () => {
    if (this.managedPtyEchoSuppressionActive) {
      this.stopOutputSuppression(true)
    }
    return true
  }

  flushPendingInput = async () => {
    const pendingInput = this.pendingInput.splice(0)
    for (const data of pendingInput) {
      await this.sendToServer(data)
    }
  }

  onShellIntegrationDetected = () => {
    if (this.outputSuppressed) {
      this.stopOutputSuppression(true)
    }
  }

  activate = async (terminal = this.term) => {
    await this._initBase()
    this.addSocketListener(this._socket, 'message', this.onMsg)

    if (terminal.textarea?.addEventListener) {
      terminal.textarea.addEventListener('paste', this._onTerminalPaste)
      this._disposables.push({
        dispose: () => terminal.textarea?.removeEventListener(
          'paste',
          this._onTerminalPaste
        )
      })
    }

    if (this._bidirectional) {
      this._disposables.push(terminal.onData((data) => this.sendToServer(data)))
      this._disposables.push(terminal.onBinary((data) => this.sendToServer(new Uint8Array(data))))
    }

    this._disposables.push(this.addSocketListener(this._socket, 'close', () => this.dispose()))
    this._disposables.push(this.addSocketListener(this._socket, 'error', () => this.dispose()))
  }

  onMsg = (ev) => {
    this._lastDataTime = Date.now()
    if (typeof ev.data === 'string') {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.action === 'zmodem-event' || msg.action === 'trzsz-event' || msg.action === 'xmodem-event') {
          return
        }
      } catch (e) {}
    }

    this.writeToTerminal(ev.data)
  }

  static passwordPromptPatterns = [
    /password\s*[:\]>]\s*$/i,
    /\[sudo\]\s*password\s+for\s+\S+\s*:\s*$/i,
    /enter\s+passphrase/i,
    /enter\s+password/i,
    /密码[：:]\s*$/,
    /パスワード[：:]\s*$/,
    /mot de passe\s*[:\]]\s*$/i,
    /passwort[:\]]\s*$/i,
    /contraseña[:\]]\s*$/i
  ]

  _checkPasswordPrompt = (str) => {
    // Extract last non-empty line from the output
    const lines = str.split(/\r?\n|\r/)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line) {
        this._lastOutputLine = line
        break
      }
    }
    return AttachAddonCustom.passwordPromptPatterns.some(
      p => p.test(this._lastOutputLine)
    )
  }

  isPasswordPromptDetected = () => {
    return this._passwordPromptDetected === true
  }

  _onEchoCheckTimeout = () => {
    // No echo received within timeout → confirms password mode
    this._pendingEchoCheck = null
  }

  _handleEchoDetection = (str) => {
    if (this._pendingEchoCheck) {
      // Server sent data back while we were waiting → echo is ON → not password
      if (str.includes(this._pendingEchoCheck.char)) {
        this._passwordPromptDetected = false
        clearTimeout(this._echoCheckTimer)
        this._pendingEchoCheck = null
        this._echoCheckTimer = null
        // Cancel the password dropdown if it was shown
        this.term?.parent?.onPasswordPromptCancelled?.()
      }
    }
  }

  checkForShellIntegration = (str) => {
    const ESC = String.fromCharCode(27)
    return str.includes(ESC + ']633;')
  }

  _decodeSuppressionData = (data) => {
    if (typeof data === 'string') return data
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
    return this.suppressionDecoder.decode(bytes, { stream: true })
  }

  _findSuppressionReleaseData = (str) => {
    const marker = this.suppressionReleaseMarker
    if (!marker) return null
    this.suppressionScanText += str
    const markerIndex = this.suppressionScanText.indexOf(marker)
    if (markerIndex !== -1) {
      return this.suppressionScanText.slice(markerIndex)
    }
    this.suppressionScanText = this.suppressionScanText.slice(
      -(marker.length - 1)
    )
    return null
  }

  writeToTerminalDirect = (data) => {
    const { term } = this
    if (term.parent?.onZmodem) {
      return
    }
    if (typeof data === 'string') {
      return term.write(data)
    }
    term?.write(data)
  }

  writeToTerminal = (data) => {
    const { term } = this
    if (term.parent?.onZmodem) {
      return
    }

    if (!this.hasReceivedInitialData) {
      this.hasReceivedInitialData = true
      if (this.onInitialDataCallback) {
        const callback = this.onInitialDataCallback
        this.onInitialDataCallback = null
        setTimeout(callback, 0)
      }
    }

    if (this.outputSuppressed) {
      if (this.suppressionReleaseMarker) {
        const integrationData = this._findSuppressionReleaseData(
          this._decodeSuppressionData(data)
        )
        if (integrationData !== null) {
          const publishRemainder = this.publishSuppressionRemainder
          this.onShellIntegrationDetected()
          if (publishRemainder) this._publishRemoteOutput(integrationData)
          this.writeToTerminalDirect(integrationData)
        }
        return
      }

      let str = data
      if (typeof data !== 'string') {
        const decoder = this.decoder || new TextDecoder('utf-8')
        try {
          str = decoder.decode(data instanceof ArrayBuffer ? data : new Uint8Array(data))
        } catch (e) {
          str = ''
        }
      }

      if (this.checkForShellIntegration(str)) {
        const marker = String.fromCharCode(27) + ']633;'
        const integrationData = str.slice(str.indexOf(marker))
        const publishRemainder = this.publishSuppressionRemainder
        this.onShellIntegrationDetected()
        if (integrationData) {
          if (publishRemainder) this._publishRemoteOutput(integrationData)
          this.writeToTerminalDirect(integrationData)
        }
        return
      }

      this.suppressedData.push(data)
      return
    }

    // Password prompt detection on output
    let str = data
    if (typeof data !== 'string') {
      try {
        str = this.decoder.decode(
          data instanceof ArrayBuffer ? data : new Uint8Array(data)
        )
      } catch (e) {
        str = ''
      }
    }
    this._handleEchoDetection(str)
    if (this._checkPasswordPrompt(str) && !this._passwordPromptDetected) {
      this._passwordPromptDetected = true
      // Show password dropdown immediately after terminal renders the prompt
      setTimeout(() => {
        this.term?.parent?.onPasswordPromptDetected?.()
      }, 100)
    }

    if (typeof data === 'string') {
      term?.parent?.notifyOnData()
      this._publishRemoteOutput(data)
      return term.write(data)
    }
    data = new Uint8Array(data)
    const fileReader = new FileReader()
    fileReader.addEventListener('load', this.onRead)
    fileReader.readAsArrayBuffer(new window.Blob([data]))
  }

  onRead = (ev) => {
    const data = ev.target.result
    const { term } = this
    term?.parent?.notifyOnData()
    this._publishRemoteOutput(data)
    const str = this.decoder.decode(data)
    term?.write(str)
  }

  _sendToServerDirect = (data) => {
    // Start echo detection when password prompt is suspected
    if (this._passwordPromptDetected && !this._pendingEchoCheck && data !== '\r' && data !== '\n' && data !== '\x03') {
      this._pendingEchoCheck = { char: data, time: Date.now() }
      clearTimeout(this._echoCheckTimer)
      this._echoCheckTimer = setTimeout(this._onEchoCheckTimeout, 200)
    }
    // Reset password state on Enter or Ctrl+C
    if (data === '\r' || data === '\n' || data === '\x03') {
      if (this._passwordPromptDetected) {
        this.term?.parent?.onPasswordPromptCancelled?.()
      }
      this._passwordPromptDetected = false
      this._lastOutputLine = ''
      this._pendingEchoCheck = null
      clearTimeout(this._echoCheckTimer)
      this._echoCheckTimer = null
    }
    this._sendData(data)
  }

  _onTerminalPaste = () => {
    this._terminalPastePending = true
  }

  submitSafetyCommand = (command, token) => {
    if (!String(command || '').trim() || !String(token || '').trim()) {
      return false
    }
    this._sendToServerDirect(`${command}\r`)
    return true
  }

  submitManagedPtyCommand = (command, sessionNonce) => {
    const nonce = String(sessionNonce || '')
    if (!String(command || '').trim() ||
      !managedPtySessionNoncePattern.test(nonce)) return false
    this.startOutputSuppression(
      null,
      null,
      true,
      true,
      `${String.fromCharCode(27)}]633;E;${nonce};`
    )
    this.managedPtyEchoSuppressionActive = true
    this.managedPtySessionNonce = nonce
    try {
      this._sendToServerDirect(`${command}\r`)
    } catch (error) {
      this.cancelManagedPtyEchoSuppression()
      throw error
    }
    return true
  }

  interruptManagedPtyCommand = () => {
    this._sendToServerDirect('\x03')
    return true
  }

  sendToServer = (data) => {
    this._lastInputTime = Date.now()
    const managed = this.term?.parent?.handleManagedPtyInput?.(data)
    if (managed?.handled === true) {
      return managed.send === true
        ? this._sendToServerDirect(data)
        : undefined
    }
    if (this.outputSuppressed) {
      this.pendingInput.push(data)
      return
    }
    const parent = this.term?.parent
    const isStandaloneEnter = data === '\r' || data === '\n'
    const isPaste = isStandaloneEnter && this._terminalPastePending
    if (!isStandaloneEnter && (this._pendingTerminalEnter ||
      parent?.hasPendingSafetyCommand?.() === true)) {
      this._pendingTerminalEnter = null
      parent?.onTerminalSafetyInputChanged?.()
    }
    if (isStandaloneEnter || data === '\x03' || data === '\x15' ||
      (typeof data === 'string' && /[\r\n]/.test(data))) {
      this._terminalPastePending = false
    }
    if (!isStandaloneEnter || typeof parent?.beforeTerminalEnter !== 'function') {
      return this._sendToServerDirect(data)
    }
    if (this._pendingTerminalEnter) return this._pendingTerminalEnter

    const context = {
      ...parent.getTerminalSafetyContext?.(),
      passwordMode: this._passwordPromptDetected,
      alternateBuffer: this.term?.buffer?.active?.type === 'alternate',
      isPaste
    }
    let decision
    try {
      decision = parent.beforeTerminalEnter(
        parent.getCurrentInput?.() || '',
        context
      )
    } catch (error) {
      parent.onTerminalSafetyError?.(error)
      return
    }

    if (!decision || typeof decision.then !== 'function') {
      if (decision?.sendNow === false) {
        if (decision.clear) this._sendToServerDirect('\x15')
        return
      }
      return this._sendToServerDirect(data)
    }

    const pending = Promise.resolve(decision)
      .then(result => {
        if (result?.sendNow) {
          if (result.releaseToken &&
            parent.consumeTerminalSafetyRelease?.(result.releaseToken) !== true) {
            return
          }
          this._sendToServerDirect('\r')
        } else if (result?.clear) {
          this._sendToServerDirect('\x15')
        }
      })
      .catch(error => {
        parent.onTerminalSafetyError?.(error)
      })
      .finally(() => {
        if (this._pendingTerminalEnter === pending) {
          this._pendingTerminalEnter = null
        }
      })
    this._pendingTerminalEnter = pending
    return pending
  }

  _startKeepalive = () => {
    this._stopKeepalive()
    this._keepaliveTimer = setInterval(this._checkKeepalive, this._keepaliveInterval)
  }

  _stopKeepalive = () => {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer)
      this._keepaliveTimer = null
    }
  }

  _checkKeepalive = () => {
    if (this.outputSuppressed) {
      return
    }
    const now = Date.now()
    const idleSinceData = now - this._lastDataTime
    const idleSinceInput = now - this._lastInputTime
    if (idleSinceData >= this._keepaliveInterval && idleSinceInput >= this._keepaliveInterval) {
      // Tell the server to write \n to the PTY so bash's read() wakes up and
      // resets the TMOUT alarm. The user has explicitly enabled keepalive and
      // accepts the side-effect of an occasional echoed newline / re-prompt.
      // Start output suppression to hide the echoed prompt.
      const sock = this._socket
      if (sock && sock.readyState === 1 /* OPEN */) {
        this.startOutputSuppression(500, null, true)
        sock.send(JSON.stringify({
          [terminalControlFlag]: true,
          action: 'keepalive'
        }))
      }
    }
  }

  setKeepalive = (enabled) => {
    if (enabled) {
      this._startKeepalive()
    } else {
      this._stopKeepalive()
    }
  }

  addSocketListener = (socket, type, handler) => {
    socket.addEventListener(type, handler)
    return {
      dispose: () => {
        if (!handler) {
          return
        }
        socket.removeEventListener(type, handler)
      }
    }
  }

  dispose = () => {
    this._stopKeepalive()
    clearTimeout(this.suppressTimeout)
    this.suppressTimeout = null
    this.outputSuppressed = false
    this.managedPtyEchoSuppressionActive = false
    this.managedPtySessionNonce = ''
    this.suppressedData = []
    this.publishSuppressionRemainder = false
    this.onSuppressionEndCallback = null
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.pendingInput = []
    clearTimeout(this._echoCheckTimer)
    this._echoCheckTimer = null
    this._pendingTerminalEnter = null
    this._terminalPastePending = false
    this._remoteOutputListeners.clear()
    this._remoteOutputDecoder = new TextDecoder('utf-8')
    this.term = null
    this._disposables.forEach(d => d.dispose())
    this._disposables.length = 0
  }
}
