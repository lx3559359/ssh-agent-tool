/**
 * Client-side Shell Integration Commands
 *
 * These are minimal shell integration commands that can be sent directly
 * to a local or remote shell from the frontend after connection.
 * They enable OSC 633 command tracking without needing server-side file sourcing.
 *
 * OSC 633 Protocol:
 * - OSC 633 ; A ; <sessionNonce> - Prompt started
 * - OSC 633 ; B ; <sessionNonce> - Command input started
 * - OSC 633 ; C ; <sessionNonce> - Command execution started
 * - OSC 633 ; D ; <sessionNonce> ; <exitCode> - Command finished
 * - OSC 633 ; E ; <sessionNonce> ; <command> - Command being executed
 * - OSC 633 ; P ; <sessionNonce> ; Cwd=<path> - Current directory
 */

/* eslint-disable no-template-curly-in-string, no-useless-escape */
function requireSessionNonce (nonce) {
  const value = String(nonce || '')
  if (!/^[a-f0-9]{32}$/.test(value)) {
    throw new Error('Terminal shell integration nonce is invalid.')
  }
  return value
}

/**
 * Get inline shell integration command for bash (one-liner format)
 * Properly formatted for semicolon joining
 */
function getBashInlineIntegration (sessionNonce) {
  const nonce = requireSessionNonce(sessionNonce)
  // Each statement is complete and can be joined with semicolons
  return [
    'if [[ $- == *i* ]]',
    `then __e_nonce='${nonce}'`,
    'if [[ -z "${ELECTERM_SHELL_INTEGRATION:-}" ]]',
    'then export ELECTERM_SHELL_INTEGRATION=1',
    '__e_esc() { local v="$1"; v="${v//\\\\/\\\\\\\\}"; v="${v//;/\\\\x3b}"; printf \'%s\' "$v"; }',
    '__e_pre() { [[ "$BASH_COMMAND" == "$PROMPT_COMMAND" ]] && return; [[ "$BASH_COMMAND" == "__e_"* ]] && return; [[ "${__e_in:-0}" == "0" ]] && { __e_in=1; printf \'\\e]633;E;%s;%s\\a\\e]633;C;%s\\a\' "$__e_nonce" "$(__e_esc "$BASH_COMMAND")" "$__e_nonce"; }; }',
    '__e_cmd() { local c="$?"; [[ "${__e_in:-0}" == "1" ]] && { printf \'\\e]633;D;%s;%s\\a\' "$__e_nonce" "$c"; __e_in=0; }; printf \'\\e]633;P;%s;Cwd=%s\\a\\e]633;A;%s\\a\' "$__e_nonce" "$(__e_esc "$PWD")" "$__e_nonce"; return "$c"; }',
    'trap \'__e_pre\' DEBUG',
    'PROMPT_COMMAND="__e_cmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
    'PS1="${PS1}\\[\\e]633;B;${__e_nonce}\\a\\]"',
    'fi',
    'fi'
  ].join('; ')
}

/**
 * Get inline shell integration command for zsh (one-liner format)
 * Properly formatted for semicolon joining
 */
function getZshInlineIntegration (sessionNonce) {
  const nonce = requireSessionNonce(sessionNonce)
  // Each statement is complete and can be joined with semicolons
  // Note: 'then' must have a space/newline before the next command, not semicolon
  return [
    'if [[ -o interactive ]]',
    `then __e_nonce='${nonce}'`,
    'if [[ -z "${ELECTERM_SHELL_INTEGRATION:-}" ]]',
    'then export ELECTERM_SHELL_INTEGRATION=1',
    '__e_esc() { local v="$1"; v="${v//\\\\/\\\\\\\\}"; v="${v//;/\\\\x3b}"; builtin printf \'%s\' "$v"; }',
    '__e_preexec() { __e_cmd="$1"; builtin printf \'\\e]633;E;%s;%s\\a\\e]633;C;%s\\a\' "$__e_nonce" "$(__e_esc "$1")" "$__e_nonce"; }',
    '__e_precmd() { local c="$?"; [[ -n "$__e_cmd" ]] && builtin printf \'\\e]633;D;%s;%s\\a\' "$__e_nonce" "$c"; __e_cmd=""; builtin printf \'\\e]633;P;%s;Cwd=%s\\a\\e]633;A;%s\\a\' "$__e_nonce" "$(__e_esc "$PWD")" "$__e_nonce"; }',
    'autoload -Uz add-zsh-hook',
    'add-zsh-hook precmd __e_precmd',
    'add-zsh-hook preexec __e_preexec',
    'PROMPT="${PROMPT}%{\\e]633;B;${__e_nonce}\\a%}"',
    'fi',
    'fi'
  ].join('; ')
}

/**
 * Get inline shell integration command for fish (one-liner format)
 */
function getFishInlineIntegration (sessionNonce) {
  const nonce = requireSessionNonce(sessionNonce)
  return [
    'if status is-interactive',
    `set -g __e_nonce '${nonce}'`,
    'if not set -q ELECTERM_SHELL_INTEGRATION',
    'set -g ELECTERM_SHELL_INTEGRATION 1',
    'function __e_esc; echo $argv | string replace -a \'\\\\\' \'\\\\\\\\\' | string replace -a \';\' \'\\\\x3b\'; end',
    'functions -c fish_prompt __e_original_fish_prompt',
    'function fish_prompt; printf \'\\e]633;A;%s\\a\\e]633;P;%s;Cwd=%s\\a\' "$__e_nonce" "$__e_nonce" (__e_esc "$PWD"); __e_original_fish_prompt; printf \'\\e]633;B;%s\\a\' "$__e_nonce"; end',
    'function __e_preexec --on-event fish_preexec; printf \'\\e]633;E;%s;%s\\a\\e]633;C;%s\\a\' "$__e_nonce" (__e_esc "$argv") "$__e_nonce"; end',
    'function __e_postexec --on-event fish_postexec; printf \'\\e]633;D;%s;%s\\a\' "$__e_nonce" $status; end',
    'end',
    'end'
  ].join('; ')
}

/**
 * Get inline shell integration command for sh/ash (one-liner format)
 * Uses PS1 injection as sh/ash lack PROMPT_COMMAND or advanced traps.
 */
function getShInlineIntegration () {
  return [
    'if [ -z "$ELECTERM_SHELL_INTEGRATION" ]',
    'then export ELECTERM_SHELL_INTEGRATION=1',
    '__e_esc() { printf "%s" "$1" | sed "s/\\\\/\\\\\\\\/g; s/;/\\\\x3b/g"; }',
    // We wrap the current PS1 with OSC 633 sequences.
    // \033]633;P;Cwd=... \007 marks the directory
    // \033]633;A \007 marks the start of the prompt
    'export PS1="\\e]633;P;Cwd=$(__e_esc "$PWD")\\a\\e]633;A\\a${PS1:-# }\\e]633;B\\a"',
    'fi'
  ].join('; ')
}

export function detectShellType (shellStr) {
  if (shellStr.includes('bash')) {
    return 'bash'
  } else if (shellStr.includes('zsh')) {
    return 'zsh'
  } else if (shellStr.includes('fish')) {
    return 'fish'
  } else {
    return 'sh'
  }
}

/**
 * Get shell integration command based on detected shell type
 * @param {string} shellType - 'bash', 'zsh', or 'fish'
 * @param {string} sessionNonce - Ephemeral completion authentication nonce
 * @returns {string} Shell integration command to send
 */
export function getInlineShellIntegration (shellType, sessionNonce) {
  switch (shellType) {
    case 'bash':
      return getBashInlineIntegration(sessionNonce)
    case 'zsh':
      return getZshInlineIntegration(sessionNonce)
    case 'fish':
      return getFishInlineIntegration(sessionNonce)
    default:
      // Try bash as default for sh-compatible shells
      return getShInlineIntegration()
  }
}

/**
 * Wrap shell integration command for execution
 * Now simplified since output suppression is handled at the attach addon level
 * @param {string} cmd - Shell integration command
 * @param {string} shellType - Shell type (unused, kept for API compatibility)
 * @returns {string} Command ready to send to terminal
 */
export function wrapSilent (cmd, shellType) {
  // Escape single quotes for embedding in single-quoted string
  const escaped = cmd.replace(/'/g, "'\\''")
  // The leading space prevents the command from being saved to history
  // The eval wrapper ensures proper execution
  return ` eval '${escaped}' 2>/dev/null\r`
}

/**
 * Get complete shell integration command ready to send
 * @param {string} shellType - 'bash', 'zsh', or 'fish'
 * @param {string} sessionNonce - Ephemeral completion authentication nonce
 * @returns {string} Complete command to send to terminal
 */
export function getShellIntegrationCommand (shellType = 'bash', sessionNonce) {
  const cmd = getInlineShellIntegration(shellType, sessionNonce)
  return wrapSilent(cmd, shellType)
}

export function shouldInjectShellIntegration (options = {}) {
  const featureNeedsIntegration = options.showCmdSuggestions === true ||
    options.sftpPathFollowSsh === true
  const supportedSession = options.isSsh === true ||
    (options.isLocal === true && options.isWindows !== true)
  return featureNeedsIntegration && supportedSession
}

export async function detectRemoteShell (pid) {
  // SSH exec runs under the account shell, so prefer the configured shell path
  // instead of probing for any shell binary installed on the host.
  const cmd = 'printf "%s\n" "$SHELL"'

  const { runCmd } = await import('./terminal-apis.js')
  const r = await runCmd(pid, cmd)
    .catch((err) => {
      console.error('detectRemoteShell error', err)
      return 'sh'
    })

  const shell = r.trim().toLowerCase()

  if (!shell) {
    return 'sh'
  }

  return detectShellType(shell)
}
