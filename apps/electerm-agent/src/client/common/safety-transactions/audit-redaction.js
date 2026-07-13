const redacted = '[REDACTED]'

function redactPrivateKeys (text) {
  return text.replace(
    /-----BEGIN ([^-\r\n]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gi,
    redacted
  )
}

export function redactAuditText (value) {
  let text = String(value ?? '')
  text = redactPrivateKeys(text)
  text = text.replace(
    /(\bAuthorization\s*[:=]\s*Bearer\s+)[^\s,;]+/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /(\b(?:X-API-Key|API[ _-]*Key)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /(\b(?:password|passphrase|token|secret)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret)=)[^&#\s]*/gi,
    `$1${redacted}`
  )
  text = text.replace(
    /(\b(?:ssh|sftp):\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
    `$1${redacted}$2`
  )
  text = text.replace(
    /(\bsshpass\s+-p\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
    `$1${redacted}`
  )
  return text
}
