const redacted = '[REDACTED]'

function redactPrivateKeys (text) {
  return text.replace(
    /-----BEGIN ([^-\r\n]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gi,
    redacted
  )
}

function redactCredentialValues (text, pattern) {
  return text.replace(pattern, (match, prefix, doubleQuoted, singleQuoted) => {
    if (doubleQuoted !== undefined) return `${prefix}"${redacted}"`
    if (singleQuoted !== undefined) return `${prefix}'${redacted}'`
    return `${prefix}${redacted}`
  })
}

function redactJsonCredentialValues (text) {
  return text.replace(
    /("(?:password|token|apiKey|api_key|secret|passphrase|privateKey)"\s*:\s*)(?:"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/gi,
    `$1"${redacted}"`
  )
}

function redactAuthorizationValues (text) {
  const quotedPattern = /(\bAuthorization\s*[:=]\s*[A-Za-z][A-Za-z0-9_-]*\s+)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)')/gi
  const unquotedPattern = /(\bAuthorization\s*[:=]\s*[A-Za-z][A-Za-z0-9_-]*\s+)(?!["'])[^\r\n;]+/gi
  return redactCredentialValues(text, quotedPattern).replace(
    unquotedPattern,
    `$1${redacted}`
  )
}

export function redactAuditText (value) {
  let text = String(value ?? '')
  text = redactPrivateKeys(text)
  text = redactJsonCredentialValues(text)
  text = redactAuthorizationValues(text)
  text = redactCredentialValues(
    text,
    /(\bBearer\s+)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:X-API-Key|API[ _-]*Key)\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b[A-Za-z_][A-Za-z0-9_]*_API_KEY\s*=\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:password|passphrase|token|secret|SSHPASS)\b\s*[:=]\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = text.replace(
    /([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret)=)[^&#\s]*/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /(\b(?:ssh|sftp):\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
    `$1${redacted}$2`
  )
  text = redactCredentialValues(
    text,
    /(\bsshpass\s+(?:(?:-v|-e)\s+|(?:-f|-d|-P)\s+\S+\s+)*(?:-p(?:\s+|(?=\S))|--password(?:\s+|=)))(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^\s;&]+)/gi
  )
  return text
}
