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

export function redactAuditText (value) {
  let text = String(value ?? '')
  text = redactPrivateKeys(text)
  text = redactCredentialValues(
    text,
    /("(?:password|token|apiKey|api_key|secret|passphrase|privateKey)"\s*:\s*)(?:"((?:\\.|[^"\\])*)"|'([^'\r\n]*)'|[^,\s}\]]+)/gi
  )
  text = redactCredentialValues(
    text,
    /((?:\bAuthorization\s*[:=]\s*)?\bBearer\s+)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:X-API-Key|API[ _-]*Key)\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
  )
  text = redactCredentialValues(
    text,
    /(\b(?:password|passphrase|token|secret|SSHPASS)\b\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s,;&]+)/gi
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
    /(\bsshpass\s+(?:-p(?:\s+|(?=\S))|--password(?:\s+|=)))(?:"([^"\r\n]*)"|'([^'\r\n]*)'|[^\s;&]+)/gi
  )
  return text
}
