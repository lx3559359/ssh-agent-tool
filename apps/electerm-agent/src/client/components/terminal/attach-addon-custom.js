import { loadAttachAddon } from './xterm-loader.js'
import { recordPerformanceDuration } from '../../common/quality/quality-events.js'
import { createManagedTerminalTransport } from './managed-terminal-transport.js'

const terminalControlFlag = '__aigshellTerminalControl'
const managedPtySessionNoncePattern = /^[a-f0-9]{32}$/
const managedPtyFrameByteLimit = 3840
const managedPtyLifecycleByteLimit = 8192

function serializeShellIntegrationValue (value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\x3b')
}

export default class AttachAddonCustom {
  constructor (term, socket, isWindowsShell) {
    this.term = term
    this.socket = socket
    this.isWindowsShell = isWindowsShell
    this.outputSuppressed = false
    this.managedPtyTransport = null
    this.managedPtyEchoSuppressionActive = false
    this.managedPtySessionNonce = ''
    this.managedPtyExpectedCommand = ''
    this.managedPtyHoldSuppression = false
    this.managedPtyHidePromptText = false
    this.consumeManagedPtyCommandRecord = false
    this.managedPtyOutputStreamingActive = false
    this.suppressedData = []
    this.suppressTimeout = null
    this.onSuppressionEndCallback = null
    this.publishSuppressionRemainder = false
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionScanBytes = new Uint8Array()
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.managedPtyLifecycleBytes = new Uint8Array()
    this.managedPtyListenerBytes = new Uint8Array()
    this.managedPtyPromptReleaseBytes = new Uint8Array()
    this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    this.managedPtyPromptReleasePending = false
    this.managedPtyLifecycleOverflowed = false
    this.managedPtyLifecyclePending = false
    this.managedPtyLifecycleDiscarding = false
    this.pendingInput = []
    this.hasReceivedInitialData = false
    this.onInitialDataCallback = null
    this._bidirectional = true
    this._disposables = []
    this._socket = socket
    this.decoder = new TextDecoder('utf-8')
    this.passwordDecoder = new TextDecoder('utf-8')
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
    this.managedPtyOutputStreamingActive = false
    this.suppressionReleaseMarker = String(releaseMarker || '')
    this.suppressionScanText = ''
    this.suppressionScanBytes = new Uint8Array()
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.managedPtyLifecycleBytes = new Uint8Array()
    this.managedPtyListenerBytes = new Uint8Array()
    this.managedPtyPromptReleaseBytes = new Uint8Array()
    this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    this.managedPtyPromptReleasePending = false
    this.managedPtyLifecycleDiscarding = false
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
    this.managedPtyExpectedCommand = ''
    this.managedPtyHoldSuppression = false
    this.managedPtyHidePromptText = false
    this.consumeManagedPtyCommandRecord = false
    this.managedPtyOutputStreamingActive = false
    this.publishSuppressionRemainder = false
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionScanBytes = new Uint8Array()
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.managedPtyLifecycleBytes = new Uint8Array()
    this.managedPtyListenerBytes = new Uint8Array()
    this.managedPtyPromptReleaseBytes = new Uint8Array()
    this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    this.managedPtyPromptReleasePending = false
    this.managedPtyLifecycleDiscarding = false

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

  startCurrentShellIntegrationSuppression = (nonce, timeout, onEnd) => {
    const sessionNonce = String(nonce || '')
    if (!managedPtySessionNoncePattern.test(sessionNonce)) {
      throw new Error('Shell Integration session nonce is invalid')
    }
    const promptFrame =
      `${String.fromCharCode(27)}]633;A;${sessionNonce}` +
      String.fromCharCode(7)
    this.startOutputSuppression(timeout, onEnd, true, false, promptFrame)
    this.managedPtyEchoSuppressionActive = true
    this.managedPtySessionNonce = sessionNonce
    this.managedPtyExpectedCommand = ''
    this.managedPtyHoldSuppression = false
    this.managedPtyHidePromptText = true
    this.consumeManagedPtyCommandRecord = false
    return true
  }

  prepareManagedPtyEchoRecovery = () => {
    const nonce = this.managedPtySessionNonce
    if (!this.managedPtyEchoSuppressionActive ||
      !managedPtySessionNoncePattern.test(nonce)) return false
    this.suppressionReleaseMarker =
      `${String.fromCharCode(27)}]633;A;${nonce}${String.fromCharCode(7)}`
    this.managedPtyHoldSuppression = false
    this.consumeManagedPtyCommandRecord = false
    this.suppressionScanText = ''
    this.suppressionScanBytes = new Uint8Array()
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.managedPtyLifecycleBytes = new Uint8Array()
    this.managedPtyListenerBytes = new Uint8Array()
    this.managedPtyPromptReleaseBytes = new Uint8Array()
    this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    this.managedPtyPromptReleasePending = false
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

    this.managedPtyTransport = createManagedTerminalTransport({
      send: message => {
        const { action, ...fields } = message
        this._sendTerminalControl(action, fields)
      },
      recordAck: durationMs => {
        recordPerformanceDuration('managed_input_ack_ms', durationMs, {
          outcome: 'accepted'
        })
      }
    })
    this.managedPtyTransport.requestCapabilities()

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
        const control = JSON.parse(ev.data)
        if (control.action === 'zmodem-event' ||
          control.action === 'trzsz-event' ||
          control.action === 'xmodem-event') {
          return
        }
        if (control[terminalControlFlag] === true &&
          this.managedPtyTransport?.handleControlMessage(control)) return
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
      const releaseData = this.suppressionScanText.slice(markerIndex)
      this.suppressionScanText = ''
      return releaseData
    }
    this.suppressionScanText = this.suppressionScanText.slice(
      -(marker.length - 1)
    )
    return null
  }

  _findSuppressionReleaseBytes = (data) => {
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
    const markerBytes = new TextEncoder().encode(this.suppressionReleaseMarker)
    const scanBytes = new Uint8Array(this.suppressionScanBytes.length + bytes.length)
    scanBytes.set(this.suppressionScanBytes)
    scanBytes.set(bytes, this.suppressionScanBytes.length)

    let markerIndex = -1
    for (let index = 0; index <= scanBytes.length - markerBytes.length; index++) {
      let matches = true
      for (let markerOffset = 0; markerOffset < markerBytes.length; markerOffset++) {
        if (scanBytes[index + markerOffset] !== markerBytes[markerOffset]) {
          matches = false
          break
        }
      }
      if (matches) {
        markerIndex = index
        break
      }
    }
    if (markerIndex !== -1) {
      this.suppressionScanBytes = new Uint8Array()
      return scanBytes.slice(markerIndex)
    }
    this.suppressionScanBytes = scanBytes.slice(
      -(markerBytes.length - 1)
    )
    return null
  }

  _extractManagedPtyListenerData = data => {
    const incoming = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data)
    const scan = new Uint8Array(
      this.managedPtyListenerBytes.length + incoming.length
    )
    scan.set(this.managedPtyListenerBytes)
    scan.set(incoming, this.managedPtyListenerBytes.length)
    this.managedPtyListenerBytes = new Uint8Array()
    const prefix = new TextEncoder().encode(
      `${String.fromCharCode(27)}]633;`
    )
    const publishChunks = []
    let overflowed = false
    let cursor = 0
    const appendChunk = (start, end) => {
      if (end > start) publishChunks.push(scan.slice(start, end))
    }
    while (cursor < scan.length) {
      let start = -1
      for (let index = cursor; index <= scan.length - prefix.length; index++) {
        let matches = true
        for (let offset = 0; offset < prefix.length; offset++) {
          if (scan[index + offset] !== prefix[offset]) {
            matches = false
            break
          }
        }
        if (matches) {
          start = index
          break
        }
      }
      if (start === -1) {
        let keep = 0
        const maximum = Math.min(prefix.length - 1, scan.length - cursor)
        for (let length = maximum; length > 0; length--) {
          let matches = true
          for (let offset = 0; offset < length; offset++) {
            if (scan[scan.length - length + offset] !== prefix[offset]) {
              matches = false
              break
            }
          }
          if (matches) {
            keep = length
            break
          }
        }
        appendChunk(cursor, scan.length - keep)
        if (keep > 0) {
          this.managedPtyListenerBytes = scan.slice(scan.length - keep)
        }
        break
      }
      appendChunk(cursor, start)
      let end = -1
      for (let index = start + prefix.length; index < scan.length; index++) {
        if (scan[index] === 7) {
          end = index
          break
        }
      }
      if (end === -1) {
        const pending = scan.slice(start)
        if (pending.byteLength > managedPtyLifecycleByteLimit) {
          overflowed = true
        } else {
          this.managedPtyListenerBytes = pending
        }
        break
      }
      if (end + 1 - start > managedPtyLifecycleByteLimit) {
        overflowed = true
      } else {
        appendChunk(start, end + 1)
      }
      cursor = end + 1
    }
    const byteLength = publishChunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0
    )
    const publishData = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of publishChunks) {
      publishData.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { publishData, overflowed }
  }

  _extractManagedPtyLifecycleFrames = data => {
    this.managedPtyLifecycleOverflowed = false
    this.managedPtyLifecyclePending = false
    const incoming = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data)
    const scan = new Uint8Array(
      this.managedPtyLifecycleBytes.length + incoming.length
    )
    scan.set(this.managedPtyLifecycleBytes)
    scan.set(incoming, this.managedPtyLifecycleBytes.length)
    const prefix = new TextEncoder().encode(
      `${String.fromCharCode(27)}]633;`
    )
    const frames = []
    let cursor = 0
    while (cursor < scan.length) {
      let start = -1
      for (let index = cursor; index <= scan.length - prefix.length; index++) {
        let matches = true
        for (let offset = 0; offset < prefix.length; offset++) {
          if (scan[index + offset] !== prefix[offset]) {
            matches = false
            break
          }
        }
        if (matches) {
          start = index
          break
        }
      }
      if (start === -1) {
        this.managedPtyLifecycleBytes = scan.slice(
          Math.max(cursor, scan.length - (prefix.length - 1))
        )
        return frames
      }
      let end = -1
      for (let index = start + prefix.length; index < scan.length; index++) {
        if (scan[index] === 7) {
          end = index
          break
        }
      }
      if (end === -1) {
        const pending = scan.slice(start)
        if (pending.byteLength > managedPtyLifecycleByteLimit) {
          this.managedPtyLifecycleBytes = new Uint8Array()
          this.managedPtyLifecycleOverflowed = true
        } else {
          this.managedPtyLifecycleBytes = pending
          this.managedPtyLifecyclePending = true
        }
        return frames
      }
      if (end + 1 - start > managedPtyLifecycleByteLimit) {
        this.managedPtyLifecycleBytes = new Uint8Array()
        this.managedPtyLifecycleOverflowed = true
        cursor = end + 1
        continue
      }
      frames.push(new TextDecoder('utf-8').decode(scan.slice(start, end + 1)))
      cursor = end + 1
    }
    this.managedPtyLifecycleBytes = new Uint8Array()
    return frames
  }

  _isAuthenticatedManagedLifecycleFrame = frame => {
    const prefix = `${String.fromCharCode(27)}]633;`
    if (!String(frame).startsWith(prefix) || !String(frame).endsWith('\u0007')) {
      return false
    }
    const fields = String(frame).slice(prefix.length, -1).split(';')
    return fields.length >= 2 && fields[1] === this.managedPtySessionNonce
  }

  _writeManagedPtyHiddenOutput = data => {
    if (!data || data.length === 0) return
    const wasDiscarding = this.managedPtyLifecycleDiscarding
    const promptReleaseWasPending = this.managedPtyPromptReleasePending
    let releaseData = typeof data === 'string'
      ? this._findSuppressionReleaseData(data)
      : this._findSuppressionReleaseBytes(data)
    const listenerData = this._extractManagedPtyListenerData(data)
    const lifecycleFrames = this._extractManagedPtyLifecycleFrames(data)
    const lifecycleOverflowed = this.managedPtyLifecycleOverflowed ||
      listenerData.overflowed
    if (lifecycleOverflowed) {
      this.managedPtyLifecycleOverflowed = false
      this.managedPtyLifecycleDiscarding = true
      this.prepareManagedPtyEchoRecovery()
      releaseData = typeof data === 'string'
        ? this._findSuppressionReleaseData(data)
        : this._findSuppressionReleaseBytes(data)
    }
    if (this.managedPtyLifecycleDiscarding) {
      if (!lifecycleFrames.includes(this.suppressionReleaseMarker)) return
      this.managedPtyLifecycleDiscarding = false
    }
    if (promptReleaseWasPending) {
      const incomingBytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : new Uint8Array(data)
      const combined = new Uint8Array(
        this.managedPtyPromptReleaseBytes.length + incomingBytes.length
      )
      combined.set(this.managedPtyPromptReleaseBytes)
      combined.set(incomingBytes, this.managedPtyPromptReleaseBytes.length)
      if (combined.byteLength > managedPtyLifecycleByteLimit) {
        this.managedPtyPromptReleaseBytes = new Uint8Array()
        this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
        this.managedPtyPromptReleasePending = false
        this.managedPtyLifecycleDiscarding = true
        this.prepareManagedPtyEchoRecovery()
        return
      }
      this.managedPtyPromptReleaseBytes = combined
    }
    const promptFrame = `${String.fromCharCode(27)}]633;A;` +
      `${this.managedPtySessionNonce}${String.fromCharCode(7)}`
    const inputFrame = `${String.fromCharCode(27)}]633;B;` +
      `${this.managedPtySessionNonce}${String.fromCharCode(7)}`
    const forwardedPrePromptLifecycleFrames = new Set()
    const writePrePromptLifecycleFrames = () => {
      for (const frame of lifecycleFrames) {
        if (frame === promptFrame) break
        if (frame === inputFrame) continue
        if (!this._isAuthenticatedManagedLifecycleFrame(frame)) continue
        this.writeToTerminalDirect(frame)
        forwardedPrePromptLifecycleFrames.add(frame)
      }
    }
    const toBytes = value => {
      if (typeof value === 'string') return new TextEncoder().encode(value)
      if (value instanceof ArrayBuffer) return new Uint8Array(value)
      if (value instanceof Uint8Array) return value
      return new Uint8Array(value)
    }
    let promptReleaseReady = false
    const promptFrameIndex = lifecycleFrames.indexOf(promptFrame)
    const inputFrameAfterPromptIndex = promptFrameIndex === -1
      ? -1
      : lifecycleFrames.indexOf(inputFrame, promptFrameIndex + 1)
    if (releaseData !== null &&
      !this.managedPtyPromptReleasePending &&
      this.suppressionReleaseMarker === promptFrame &&
      promptFrameIndex !== -1) {
      const releaseBytes = toBytes(releaseData)
      const promptFrameLength = new TextEncoder().encode(promptFrame).length
      const promptReleaseBytes = releaseBytes.slice(promptFrameLength)
      if (promptReleaseBytes.byteLength > managedPtyLifecycleByteLimit) {
        this.managedPtyPromptReleaseBytes = new Uint8Array()
        this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
        this.managedPtyPromptReleasePending = false
        this.managedPtyLifecycleDiscarding = true
        this.prepareManagedPtyEchoRecovery()
        return
      }
      const promptBytes = new TextEncoder().encode(promptFrame)
      let promptIndex = -1
      for (let index = 0;
        index <= listenerData.publishData.length - promptBytes.length;
        index++) {
        let matches = true
        for (let offset = 0; offset < promptBytes.length; offset++) {
          if (listenerData.publishData[index + offset] !== promptBytes[offset]) {
            matches = false
            break
          }
        }
        if (matches) {
          promptIndex = index
          break
        }
      }
      this.managedPtyPromptListenerPrefixBytes = promptIndex > 0
        ? listenerData.publishData.slice(0, promptIndex)
        : new Uint8Array()
      this.managedPtyPromptReleaseBytes = promptReleaseBytes
      this.managedPtyPromptReleasePending = true
      if (this.publishSuppressionRemainder &&
        this.managedPtyOutputStreamingActive &&
        this.managedPtyPromptListenerPrefixBytes.length > 0) {
        this._publishRemoteOutput(this.managedPtyPromptListenerPrefixBytes)
        this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
      }
      writePrePromptLifecycleFrames()
      this.writeToTerminalDirect(promptFrame)
      if (inputFrameAfterPromptIndex === -1) {
        this.suppressionReleaseMarker = inputFrame
        this.suppressionScanText = ''
        this.suppressionScanBytes = new Uint8Array()
        this.suppressionDecoder = new TextDecoder('utf-8')
        return
      }
      releaseData = this.managedPtyPromptReleaseBytes
      promptReleaseReady = true
    } else if (promptReleaseWasPending &&
      lifecycleFrames.includes(inputFrame)) {
      releaseData = this.managedPtyPromptReleaseBytes
      promptReleaseReady = true
    } else if (promptReleaseWasPending) {
      return
    }
    if (this.managedPtyLifecyclePending && !promptReleaseReady) {
      writePrePromptLifecycleFrames()
      if (!promptReleaseWasPending && this.publishSuppressionRemainder &&
        this.managedPtyOutputStreamingActive &&
        listenerData.publishData.length > 0) {
        this._publishRemoteOutput(listenerData.publishData)
      }
      return
    }
    if (promptReleaseReady) {
      this.managedPtyPromptReleaseBytes = new Uint8Array()
      this.managedPtyPromptReleasePending = false
    }
    if (this.publishSuppressionRemainder &&
      this.managedPtyOutputStreamingActive && !lifecycleOverflowed) {
      let publishData = wasDiscarding
        ? toBytes(releaseData)
        : listenerData.publishData
      if (promptReleaseReady) {
        const promptBytes = new TextEncoder().encode(promptFrame)
        const prefixBytes = this.managedPtyPromptListenerPrefixBytes
        const releaseBytes = toBytes(releaseData)
        publishData = new Uint8Array(
          prefixBytes.length + promptBytes.length + releaseBytes.length
        )
        publishData.set(prefixBytes)
        publishData.set(promptBytes, prefixBytes.length)
        publishData.set(releaseBytes, prefixBytes.length + promptBytes.length)
      }
      if (publishData?.length > 0) this._publishRemoteOutput(publishData)
    }
    for (const frame of lifecycleFrames) {
      if (!this._isAuthenticatedManagedLifecycleFrame(frame)) continue
      if (forwardedPrePromptLifecycleFrames.has(frame)) continue
      if (promptReleaseReady &&
        (frame === promptFrame || frame === inputFrame)) continue
      if (frame === this.suppressionReleaseMarker) {
        if (this.managedPtyHoldSuppression) {
          this.writeToTerminalDirect(frame)
          continue
        }
        break
      }
      this.writeToTerminalDirect(frame)
    }
    if (releaseData === null) return
    if (this.publishSuppressionRemainder &&
      !this.managedPtyOutputStreamingActive) {
      let publishData = wasDiscarding
        ? toBytes(releaseData)
        : listenerData.publishData
      if (promptReleaseReady) {
        const promptBytes = new TextEncoder().encode(promptFrame)
        const prefixBytes = this.managedPtyPromptListenerPrefixBytes
        const releaseBytes = toBytes(releaseData)
        publishData = new Uint8Array(
          prefixBytes.length + promptBytes.length + releaseBytes.length
        )
        publishData.set(prefixBytes)
        publishData.set(promptBytes, prefixBytes.length)
        publishData.set(releaseBytes, prefixBytes.length + promptBytes.length)
      }
      if (publishData.length > 0) this._publishRemoteOutput(publishData)
    }
    if (promptReleaseReady) {
      this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    }
    let terminalReleaseData = releaseData
    if (promptReleaseReady && this.managedPtyHidePromptText) {
      const releaseBytes = toBytes(releaseData)
      const inputFrameBytes = new TextEncoder().encode(inputFrame)
      let inputFrameIndex = -1
      for (let index = 0;
        index <= releaseBytes.length - inputFrameBytes.length;
        index++) {
        let matches = true
        for (let offset = 0; offset < inputFrameBytes.length; offset++) {
          if (releaseBytes[index + offset] !== inputFrameBytes[offset]) {
            matches = false
            break
          }
        }
        if (matches) {
          inputFrameIndex = index
          break
        }
      }
      terminalReleaseData = inputFrameIndex === -1
        ? inputFrameBytes
        : releaseBytes.slice(inputFrameIndex)
    }
    if (this.managedPtyHoldSuppression) {
      this.suppressionScanText = ''
      this.suppressionScanBytes = new Uint8Array()
      this.suppressionDecoder = new TextDecoder('utf-8')
      this.managedPtyLifecycleBytes = new Uint8Array()
      this.managedPtyListenerBytes = new Uint8Array()
      this.managedPtyPromptReleaseBytes = new Uint8Array()
      this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
      this.managedPtyPromptReleasePending = false
      this.managedPtyOutputStreamingActive = false
      this.consumeManagedPtyCommandRecord = false
      if (promptReleaseReady && releaseData.length > 0) {
        this.writeToTerminalDirect(inputFrame)
      }
      return
    }
    this.onShellIntegrationDetected()
    if (terminalReleaseData.length > 0) {
      if (terminalReleaseData instanceof Uint8Array) {
        this._writeBinaryOutput(terminalReleaseData, false)
      } else {
        this.writeToTerminalDirect(terminalReleaseData)
      }
    }
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
        if (this.managedPtyEchoSuppressionActive &&
          !this.consumeManagedPtyCommandRecord) {
          this._writeManagedPtyHiddenOutput(data)
          return
        }
        const integrationData = typeof data === 'string'
          ? this._findSuppressionReleaseData(data)
          : this._findSuppressionReleaseBytes(data)
        if (integrationData === null &&
          this.managedPtyEchoSuppressionActive &&
          this.consumeManagedPtyCommandRecord) {
          this._extractManagedPtyLifecycleFrames(data)
          if (this.managedPtyLifecycleOverflowed) {
            this.managedPtyLifecycleOverflowed = false
            this.managedPtyLifecycleDiscarding = true
            this.prepareManagedPtyEchoRecovery()
            this._writeManagedPtyHiddenOutput(data)
          }
          return
        }
        if (integrationData !== null) {
          const publishRemainder = this.publishSuppressionRemainder
          const consumeCommandRecord = this.consumeManagedPtyCommandRecord
          const releaseMarker = this.suppressionReleaseMarker
          const expectedCommand = this.managedPtyExpectedCommand
          const sessionNonce = this.managedPtySessionNonce
          let releasedData = integrationData
          if (consumeCommandRecord) {
            this.term?.parent?.handleManagedPtyCommandObserved?.(
              expectedCommand,
              sessionNonce
            )
            const markerLength = integrationData instanceof Uint8Array
              ? new TextEncoder().encode(releaseMarker).length
              : releaseMarker.length
            releasedData = integrationData.slice(markerLength)
            this.consumeManagedPtyCommandRecord = false
            this.managedPtyOutputStreamingActive = true
            this.suppressionReleaseMarker =
              `${String.fromCharCode(27)}]633;A;${sessionNonce}` +
              String.fromCharCode(7)
            this.suppressionScanText = ''
            this.suppressionScanBytes = new Uint8Array()
            this.suppressionDecoder = new TextDecoder('utf-8')
            this.managedPtyLifecycleBytes = new Uint8Array()
            this.managedPtyListenerBytes = new Uint8Array()
            this.managedPtyPromptReleaseBytes = new Uint8Array()
            this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
            this.managedPtyPromptReleasePending = false
            if (releasedData.length > 0) {
              this._writeManagedPtyHiddenOutput(releasedData)
            }
            return
          }
          this.onShellIntegrationDetected()
          if (releasedData.length > 0) {
            if (releasedData instanceof Uint8Array) {
              this._writeBinaryOutput(releasedData, publishRemainder)
            } else {
              if (publishRemainder) this._publishRemoteOutput(releasedData)
              this.writeToTerminalDirect(releasedData)
            }
          }
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
        str = this.passwordDecoder.decode(
          data instanceof ArrayBuffer ? data : new Uint8Array(data),
          { stream: true }
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
    this._writeBinaryOutput(data)
  }

  _writeBinaryOutput = (data, publish = true) => {
    const { term } = this
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data)
    term?.parent?.notifyOnData()
    if (publish) this._publishRemoteOutput(bytes)
    const str = this.decoder.decode(bytes, { stream: true })
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

  _sendTerminalControl = (action, fields = {}) => {
    this._sendData(JSON.stringify({
      [terminalControlFlag]: true,
      action,
      ...fields
    }))
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

  submitManagedPtyCommand = (command, sessionNonce, options = {}) => {
    const nonce = String(sessionNonce || '')
    const hidePromptText = options.hidePromptText === true
    if (new TextEncoder().encode(String(command || '')).byteLength >
      managedPtyFrameByteLimit) {
      const error = new Error('受控 PTY 命令帧超过安全上限')
      error.code = 'MANAGED_PTY_FRAME_LIMIT'
      throw error
    }
    const continuingPlan = this.managedPtyEchoSuppressionActive &&
      this.managedPtySessionNonce === nonce &&
      this.managedPtyHidePromptText === hidePromptText &&
      (this.managedPtyHoldSuppression || options.cleanup === true)
    if (!String(command || '').trim() ||
      !managedPtySessionNoncePattern.test(nonce) ||
      (this.managedPtyEchoSuppressionActive && !continuingPlan)) return false
    const commandMarker = `${String.fromCharCode(27)}]633;E;${nonce};` +
      serializeShellIntegrationValue(command) + String.fromCharCode(7)
    if (continuingPlan) {
      this.suppressionReleaseMarker = commandMarker
      this.suppressionScanText = ''
      this.suppressionScanBytes = new Uint8Array()
      this.suppressionDecoder = new TextDecoder('utf-8')
      this.managedPtyLifecycleBytes = new Uint8Array()
      this.managedPtyListenerBytes = new Uint8Array()
      this.managedPtyPromptReleaseBytes = new Uint8Array()
      this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
      this.managedPtyPromptReleasePending = false
      this.managedPtyOutputStreamingActive = false
    } else {
      this.startOutputSuppression(null, null, true, true, commandMarker)
    }
    this.managedPtyEchoSuppressionActive = true
    this.managedPtySessionNonce = nonce
    this.managedPtyExpectedCommand = command
    this.managedPtyHoldSuppression = options.holdSuppression === true
    this.managedPtyHidePromptText = hidePromptText
    this.consumeManagedPtyCommandRecord = true
    try {
      if (!this.managedPtyTransport) {
        throw new Error('受控终端输入通道尚未初始化')
      }
      return this.managedPtyTransport.submit(command)
    } catch (error) {
      this.cancelManagedPtyEchoSuppression()
      throw error
    }
  }

  ensureManagedPtyTransportReady = () => {
    if (!this.managedPtyTransport) {
      throw new Error('受控终端输入通道尚未初始化')
    }
    return this.managedPtyTransport.ready()
  }

  interruptManagedPtyCommand = () => {
    if (!this.managedPtyTransport) return false
    return this.managedPtyTransport.interrupt()
  }

  sendToServer = (data) => {
    this._lastInputTime = Date.now()
    const managed = this.term?.parent?.handleManagedPtyInput?.(data)
    if (managed?.handled === true) {
      if (managed.queue === true) {
        this.pendingInput.push(data)
      }
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
    this.managedPtyTransport?.dispose()
    this.managedPtyTransport = null
    this._stopKeepalive()
    clearTimeout(this.suppressTimeout)
    this.suppressTimeout = null
    this.outputSuppressed = false
    this.managedPtyEchoSuppressionActive = false
    this.managedPtySessionNonce = ''
    this.managedPtyExpectedCommand = ''
    this.managedPtyHoldSuppression = false
    this.consumeManagedPtyCommandRecord = false
    this.managedPtyOutputStreamingActive = false
    this.suppressedData = []
    this.publishSuppressionRemainder = false
    this.onSuppressionEndCallback = null
    this.suppressionReleaseMarker = ''
    this.suppressionScanText = ''
    this.suppressionScanBytes = new Uint8Array()
    this.suppressionDecoder = new TextDecoder('utf-8')
    this.managedPtyLifecycleBytes = new Uint8Array()
    this.managedPtyListenerBytes = new Uint8Array()
    this.managedPtyPromptReleaseBytes = new Uint8Array()
    this.managedPtyPromptListenerPrefixBytes = new Uint8Array()
    this.managedPtyPromptReleasePending = false
    this.pendingInput = []
    clearTimeout(this._echoCheckTimer)
    this._echoCheckTimer = null
    this._pendingTerminalEnter = null
    this._terminalPastePending = false
    this._remoteOutputListeners.clear()
    this._remoteOutputDecoder = new TextDecoder('utf-8')
    this.passwordDecoder = new TextDecoder('utf-8')
    this.term = null
    this._disposables.forEach(d => d.dispose())
    this._disposables.length = 0
  }
}
