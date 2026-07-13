/**
 * CommandTrackerAddon - Tracks the current command in the terminal
 *
 * This addon uses Shell Integration via OSC 633 escape sequences for reliable
 * command tracking. The shell emits special sequences that tell us:
 * - OSC 633 ; A ; <sessionNonce> - Prompt started
 * - OSC 633 ; B ; <sessionNonce> - Command input started (ready for typing)
 * - OSC 633 ; C ; <sessionNonce> - Command execution started (output begins)
 * - OSC 633 ; D ; <sessionNonce> ; <exitCode> - Command finished
 * - OSC 633 ; E ; <sessionNonce> ; <command> - Command being executed
 * - OSC 633 ; P ; <sessionNonce> ; Cwd=<path> - Current directory
 *
 * This properly handles:
 * - Command history (arrow up/down)
 * - Tab completion
 * - Paste operations
 * - Shell-side editing (readline, vi-mode)
 * - Multi-line commands
 * - Any custom prompt
 */

function createSessionNonce () {
  const bytes = new Uint8Array(16)
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random source is unavailable for terminal tracking.')
  }
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class CommandTrackerAddon {
  constructor () {
    this.terminal = undefined
    this._disposables = []

    // Shell integration state
    this.currentCommand = '' // Command being typed
    this.executedCommand = '' // Last executed command
    this.lastExitCode = null
    this.cwd = ''
    this.shellIntegrationActive = false
    this.shellPhase = 'inactive'
    this._inputAnchor = null

    // Event callbacks for shell integration events
    this._onPromptStarted = null // Called when OSC 633;A is received
    this._onCommandExecuted = null // Called when OSC 633;E is received
    this._onCommandFinished = null // Called when OSC 633;D is received
    this._onCwdChanged = null // Called when OSC 633;P;Cwd= is received
    this._expectedSubmissions = []
    this._submissionSequence = 0
    this._inputGeneration = 0
    this._oscSequence = 0
    this._sessionNonce = ''
  }

  /**
   * Register callback for when a command is executed (received via OSC 633;E)
   * @param {function} callback - Called with (command: string)
   */
  onCommandExecuted (callback) {
    this._onCommandExecuted = callback
  }

  /**
   * Register callback for a fresh shell prompt (received via OSC 633;A).
   * @param {function} callback - Called when the prompt starts
   */
  onPromptStarted (callback) {
    this._onPromptStarted = callback
  }

  /**
   * Register callback for a command and its OSC 633 exit code.
   * @param {function} callback - Called with ({ command, exitCode })
   */
  onCommandFinished (callback) {
    this._onCommandFinished = callback
  }

  /**
   * Register callback for when CWD changes (received via OSC 633;P;Cwd=)
   * @param {function} callback - Called with (cwd: string)
   */
  onCwdChanged (callback) {
    this._onCwdChanged = callback
  }

  activate (terminal) {
    this.terminal = terminal

    // Register OSC 633 handler for shell integration
    // OSC 633 is the VS Code / modern terminal shell integration protocol
    if (terminal.parser && terminal.parser.registerOscHandler) {
      const oscHandler = terminal.parser.registerOscHandler(633, (data) => {
        return this._handleOsc633(data)
      })
      this._disposables.push(oscHandler)
    }
  }

  dispose () {
    this.terminal = null
    this.shellPhase = 'inactive'
    this._inputAnchor = null
    this._expectedSubmissions = []
    this._sessionNonce = ''
    if (this._disposables) {
      this._disposables.forEach(d => d.dispose())
      this._disposables.length = 0
    }
  }

  /**
   * Handle OSC 633 shell integration sequences
   * @param {string} data - The OSC data after "633;"
   * @returns {boolean} Whether the sequence was handled
   */
  _handleOsc633 (data) {
    if (!data) return false

    // Parse the sequence: first char is the command type
    const command = data.charAt(0)
    const args = data.length > 1 ? data.substring(2) : '' // Skip "X;" part
    if (!['A', 'B', 'C', 'D', 'E', 'P'].includes(command)) return false
    const separator = args.indexOf(';')
    const nonce = separator === -1 ? args : args.slice(0, separator)
    if (!this._sessionNonce || nonce !== this._sessionNonce) return true
    const payload = separator === -1 ? '' : args.slice(separator + 1)
    this._oscSequence += 1

    switch (command) {
      case 'A': // Prompt started
        this._completeArmedSubmission(null, true)
        this.shellIntegrationActive = true
        this.shellPhase = 'prompt'
        this._inputAnchor = null
        // Reset current command when new prompt appears
        this.currentCommand = ''
        this._onPromptStarted?.()
        return true

      case 'B': // Command input started (after prompt)
        this.shellIntegrationActive = true
        this.shellPhase = 'input'
        this._inputGeneration += 1
        this._captureInputAnchor()
        return true

      case 'C': // Command execution started
        this.shellPhase = 'executing'
        this._inputAnchor = null
        this._markExpectedSubmissionObserved()
        return true

      case 'D': { // Command finished
        this.shellPhase = 'finished'
        this._inputAnchor = null
        // Parse exit code if provided
        this.lastExitCode = /^-?\d+$/.test(payload)
          ? parseInt(payload, 10)
          : null
        this._completeArmedSubmission(this.lastExitCode, true)
        return true
      }

      case 'E': // Command line
        this.shellPhase = 'executing'
        this._inputAnchor = null
        // The actual command being executed
        this.executedCommand = this._deserializeOscValue(payload)
        this.currentCommand = this.executedCommand
        this._markExpectedSubmissionObserved()
        // Call the callback if registered
        if (this._onCommandExecuted && this.executedCommand) {
          this._onCommandExecuted(this.executedCommand)
        }
        return true

      case 'P': // Property (e.g., Cwd=<path>)
        this._handleProperty(payload)
        return true
    }
  }

  /**
   * Handle OSC 633 ; P property sequences
   * @param {string} data - Property data like "Cwd=/path/to/dir"
   */
  _handleProperty (data) {
    const eqIndex = data.indexOf('=')
    if (eqIndex === -1) return

    const key = data.substring(0, eqIndex)
    const value = this._deserializeOscValue(data.substring(eqIndex + 1))

    switch (key) {
      case 'Cwd': {
        const oldCwd = this.cwd
        this.cwd = value
        // Call the callback if registered and CWD actually changed
        if (this._onCwdChanged && oldCwd !== value) {
          this._onCwdChanged(value)
        }
        break
      }
      // Add more properties as needed
    }
  }

  /**
   * Deserialize OSC 633 escaped values
   * Handles: \\ -> \, \x3b -> ;
   * @param {string} value - Escaped value
   * @returns {string} Unescaped value
   */
  _deserializeOscValue (value) {
    if (!value) return ''
    return value
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\\/g, '\\')
  }

  beginSession (nonce = createSessionNonce()) {
    if (!/^[a-f0-9]{32}$/.test(String(nonce))) {
      throw new Error('Terminal tracking session nonce is invalid.')
    }
    this._sessionNonce = String(nonce)
    this.currentCommand = ''
    this.executedCommand = ''
    this.lastExitCode = null
    this.shellIntegrationActive = false
    this.shellPhase = 'inactive'
    this._inputAnchor = null
    this._expectedSubmissions = []
    this._inputGeneration = 0
    this._oscSequence = 0
    return this._sessionNonce
  }

  getSessionNonce () {
    return this._sessionNonce
  }

  _captureInputAnchor () {
    const buffer = this.terminal?.buffer?.active
    const row = Number(buffer?.baseY) + Number(buffer?.cursorY)
    const column = Number(buffer?.cursorX)
    if (!buffer || !Number.isInteger(row) || !Number.isInteger(column) ||
      column < 0 || column > Number(this.terminal?.cols)) {
      this._inputAnchor = null
      return
    }
    this._inputAnchor = { buffer, row, column }
  }

  _getLineEndColumn (line, cursorColumn) {
    const endColumn = cursorColumn
    if (typeof line.getCell === 'function') {
      for (let column = Number(this.terminal?.cols) - 1; column >= 0; column -= 1) {
        const cell = line.getCell(column)
        if (cell && (cell.getCode?.() || cell.getChars?.())) {
          return Math.max(endColumn, column + 1)
        }
      }
      return endColumn
    }
    const visibleEnd = line.translateToString(true, 0).length
    return endColumn >= visibleEnd ? endColumn : undefined
  }

  getCurrentCommandInput () {
    if (!this.isCommandInputActive() || !this._inputAnchor) return undefined
    const buffer = this.terminal?.buffer?.active
    if (!buffer || buffer !== this._inputAnchor.buffer) return undefined
    const cursorRow = Number(buffer.baseY) + Number(buffer.cursorY)
    const startRow = this._inputAnchor.row
    if (!Number.isInteger(cursorRow) || cursorRow < startRow) return undefined
    if (!buffer.getLine(startRow)) return undefined

    for (let row = startRow + 1; row <= cursorRow; row += 1) {
      if (buffer.getLine(row)?.isWrapped !== true) return undefined
    }

    let endRow = cursorRow
    while (buffer.getLine(endRow + 1)?.isWrapped === true) {
      endRow += 1
      if (endRow - startRow > 4096) return undefined
    }

    let command = ''
    for (let row = startRow; row <= endRow; row += 1) {
      const line = buffer.getLine(row)
      if (!line) return undefined
      const startColumn = row === startRow ? this._inputAnchor.column : 0
      if (row === endRow) {
        const cursorColumn = row === cursorRow ? Number(buffer.cursorX) : 0
        const endColumn = this._getLineEndColumn(line, cursorColumn)
        if (!Number.isInteger(endColumn)) return undefined
        command += line.translateToString(false, startColumn, endColumn)
      } else {
        command += line.translateToString(false, startColumn)
      }
    }
    return command
  }

  hasReliableCommandInput () {
    return this.getCurrentCommandInput() !== undefined
  }

  isCommandInputActive () {
    return this.shellPhase === 'input'
  }

  expectSubmission (command) {
    const text = String(command || '')
    const current = this.getCurrentCommandInput()
    if (!this._sessionNonce || !text.trim() || current === undefined ||
      current !== text ||
      this._expectedSubmissions.length) {
      return undefined
    }
    const token = `terminal-submission-${++this._submissionSequence}`
    this._expectedSubmissions.push({
      token,
      command: text,
      inputGeneration: this._inputGeneration,
      armed: false,
      executionObserved: false,
      armedAtSequence: 0
    })
    return token
  }

  expectExternalSubmission (command) {
    const text = String(command || '')
    const current = this.getCurrentCommandInput()
    if (!this._sessionNonce || !text.trim() || current !== '' ||
      this._expectedSubmissions.length) {
      return undefined
    }
    const token = `terminal-submission-${++this._submissionSequence}`
    this._expectedSubmissions.push({
      token,
      command: text,
      inputGeneration: this._inputGeneration,
      external: true,
      armed: false,
      executionObserved: false,
      armedAtSequence: 0
    })
    return token
  }

  markExpectedSubmissionReleased (token) {
    const expected = this._expectedSubmissions.find(
      submission => submission.token === token
    )
    const current = this.getCurrentCommandInput()
    const inputMatches = expected?.external
      ? current === ''
      : current === expected?.command
    if (!expected || expected.armed || !this.isCommandInputActive() ||
      expected.inputGeneration !== this._inputGeneration || !inputMatches) {
      return false
    }
    expected.armed = true
    expected.armedAtSequence = this._oscSequence
    return true
  }

  cancelExpectedSubmission (token) {
    const index = this._expectedSubmissions.findIndex(
      submission => submission.token === token
    )
    if (index === -1) return false
    this._expectedSubmissions.splice(index, 1)
    return true
  }

  hasExpectedSubmission (token) {
    return this._expectedSubmissions.some(
      submission => submission.token === token
    )
  }

  _markExpectedSubmissionObserved () {
    const expected = this._expectedSubmissions.find(
      submission => submission.armed &&
        submission.inputGeneration === this._inputGeneration &&
        submission.armedAtSequence < this._oscSequence
    )
    if (expected) expected.executionObserved = true
  }

  _completeArmedSubmission (exitCode, allowWithoutExecution) {
    const expectedIndex = this._expectedSubmissions.findIndex(
      submission => submission.armed &&
        submission.inputGeneration === this._inputGeneration &&
        submission.armedAtSequence < this._oscSequence &&
        (allowWithoutExecution || submission.executionObserved)
    )
    if (expectedIndex === -1) return false
    const expected = this._expectedSubmissions.splice(expectedIndex, 1)[0]
    this._onCommandFinished?.({
      token: expected.token,
      command: expected.command,
      exitCode
    })
    return true
  }

  /**
   * Get the current command (from shell integration)
   */
  getCurrentCommand () {
    return this.executedCommand || this.currentCommand || ''
  }

  /**
   * Get the last exit code (if available via shell integration)
   */
  getLastExitCode () {
    return this.lastExitCode
  }

  /**
   * Get current working directory (if available via shell integration)
   */
  getCwd () {
    return this.cwd
  }

  /**
   * Check if shell integration is active
   */
  hasShellIntegration () {
    return this.shellIntegrationActive
  }
}
