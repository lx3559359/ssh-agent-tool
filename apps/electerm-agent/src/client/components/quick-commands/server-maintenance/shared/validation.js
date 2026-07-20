const typeLabels = {
  hostname: '主机名',
  service: '服务名',
  interface: '网卡名称',
  path: '路径',
  cron: 'Cron 表达式',
  port: '端口',
  ipv4: 'IPv4 地址',
  cidr: 'CIDR',
  'packet-filter': '抓包过滤器',
  number: '数字',
  enum: '选项',
  'hostname-or-ip': '主机名或 IP 地址',
  url: 'URL',
  'ipv4-list': 'IPv4 地址列表',
  'file-mode': '文件权限',
  account: '账号',
  'template-text': '文本'
}

const maintenanceCommandPrefix = 'builtin-server-'

const cronMacros = new Set([
  '@reboot',
  '@hourly',
  '@daily',
  '@weekly',
  '@monthly',
  '@yearly',
  '@annually',
  '@midnight'
])

const cronMonthNames = new Map([
  ['JAN', 1],
  ['FEB', 2],
  ['MAR', 3],
  ['APR', 4],
  ['MAY', 5],
  ['JUN', 6],
  ['JUL', 7],
  ['AUG', 8],
  ['SEP', 9],
  ['OCT', 10],
  ['NOV', 11],
  ['DEC', 12]
])

const cronWeekdayNames = new Map([
  ['SUN', 0],
  ['MON', 1],
  ['TUE', 2],
  ['WED', 3],
  ['THU', 4],
  ['FRI', 5],
  ['SAT', 6]
])

function toStringValue (value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function displayLabel (type, options) {
  return options.label || typeLabels[type] || '参数'
}

function hasUnclosedQuotes (value) {
  let quote = ''
  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (quote === "'") {
      if (character === "'") quote = ''
      continue
    }
    if (quote === '"') {
      if (character === '\\') {
        index += 1
      } else if (character === '"') {
        quote = ''
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
    } else if (character === '\\') {
      index += 1
    }
  }
  return Boolean(quote)
}

function validateStructuralSafety (value, label) {
  if (/[\r\n\0]/.test(value)) {
    return `${label}不能包含换行或 NUL 字符`
  }
  if (hasUnclosedQuotes(value)) {
    return `${label}包含未闭合引号`
  }
  return ''
}

function isIpv4 (value) {
  const parts = value.split('.')
  return parts.length === 4 && parts.every(part => {
    return /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255
  })
}

function countIpv6Groups (section) {
  if (!section) return 0
  const groups = section.split(':')
  let count = 0
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]
    if (!group) return -1
    if (group.includes('.')) {
      if (index !== groups.length - 1 || !isIpv4(group)) return -1
      count += 2
    } else {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return -1
      count += 1
    }
  }
  return count
}

function isIpv6 (value) {
  if (!value.includes(':') || !/^[0-9a-f:.]+$/i.test(value)) return false
  const compressed = value.includes('::')
  const sections = value.split('::')
  if (sections.length > 2) return false
  if (compressed && sections[0].includes('.')) return false
  const leftGroups = countIpv6Groups(sections[0])
  const rightGroups = countIpv6Groups(sections[1] || '')
  if (leftGroups < 0 || rightGroups < 0) return false
  const total = leftGroups + rightGroups
  return compressed ? total < 8 : total === 8
}

function isHostnameOrIp (value) {
  if (value.includes('.') && /^[0-9.]+$/.test(value)) {
    return isIpv4(value)
  }
  return isHostname(value) || isIpv4(value) || isIpv6(value)
}

function isHostname (value) {
  const hostname = value.endsWith('.') ? value.slice(0, -1) : value
  if (!hostname || hostname.length > 253) return false
  return hostname.split('.').every(label => {
    return label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
  })
}

function parseCronNumber (value, names) {
  const upperValue = value.toUpperCase()
  if (names?.has(upperValue)) return names.get(upperValue)
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}

function isCronPart (part, min, max, names) {
  const stepParts = part.split('/')
  if (stepParts.length > 2) return false
  if (stepParts.length === 2) {
    const step = Number(stepParts[1])
    if (!/^\d+$/.test(stepParts[1]) || step < 1 || step > max - min + 1) return false
  }
  const range = stepParts[0]
  if (range === '*') return true
  const rangeParts = range.split('-')
  if (rangeParts.length > 2) return false
  const values = rangeParts.map(value => parseCronNumber(value, names))
  if (values.some(value => value === null || value < min || value > max)) return false
  return values.length === 1 || values[0] <= values[1]
}

function isCronField (field, min, max, names) {
  return field.split(',').every(part => part && isCronPart(part, min, max, names))
}

function isCronExpression (value) {
  if (cronMacros.has(value.toLowerCase())) return true
  const fields = value.split(/\s+/)
  if (fields.length !== 5) return false
  return isCronField(fields[0], 0, 59) &&
    isCronField(fields[1], 0, 23) &&
    isCronField(fields[2], 1, 31) &&
    isCronField(fields[3], 1, 12, cronMonthNames) &&
    isCronField(fields[4], 0, 7, cronWeekdayNames)
}

function isCidr (value, requiredIpVersion) {
  const parts = value.split('/')
  if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) return false
  const prefix = Number(parts[1])
  if (requiredIpVersion !== 6 && isIpv4(parts[0])) return prefix <= 32
  if (requiredIpVersion !== 4 && isIpv6(parts[0])) return prefix <= 128
  return false
}

function isPacketFilter (value) {
  if (/[;&|`$\\<>#]/.test(value)) return false
  if (!/^[a-zA-Z0-9_.:/\s'"()[\]=!+*-]+$/.test(value)) return false
  return !value.split(/\s+/).some(token => token.startsWith('-'))
}

function isHttpUrl (value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (error) {
    return false
  }
}

function validateNumber (value, options, label) {
  if (!/^-?\d+$/.test(value)) return `${label}必须是整数`
  const number = Number(value)
  if (options.min !== undefined && number < Number(options.min)) {
    return `${label}不能小于 ${options.min}`
  }
  if (options.max !== undefined && number > Number(options.max)) {
    return `${label}不能大于 ${options.max}`
  }
  return ''
}

function validateEnum (value, options, label) {
  const allowed = (options.options || []).map(option => String(option.value))
  return allowed.includes(value) ? '' : `${label}不是允许的选项`
}

function validateNormalizedValue (normalizedType, value, options, label) {
  if (options.required && !value) return `${label}不能为空`
  if (!value) return ''

  if (normalizedType === 'hostname') {
    return isHostname(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'service') {
    return value.length <= 255 && /^[a-zA-Z0-9_.@:-]+$/.test(value)
      ? ''
      : `${label}格式不正确`
  }
  if (normalizedType === 'interface') {
    return /^[a-zA-Z0-9_.:-]+$/.test(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'path') {
    return /^\/[a-zA-Z0-9_./@:+-]*$/.test(value)
      ? ''
      : `${label}必须是安全的绝对路径`
  }
  if (normalizedType === 'cron') {
    return isCronExpression(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'port') {
    return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535
      ? ''
      : `${label}必须是 1-65535`
  }
  if (normalizedType === 'ipv4') {
    return isIpv4(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'cidr') {
    return isCidr(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'ipv4-cidr') {
    return isCidr(value, 4) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'ipv6-cidr') {
    return isCidr(value, 6) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'packet-filter') {
    return isPacketFilter(value) ? '' : `${label}包含不安全或不支持的语法`
  }
  if (normalizedType === 'number' || normalizedType === 'integer') {
    return validateNumber(value, options, label)
  }
  if (normalizedType === 'enum') {
    return validateEnum(value, options, label)
  }
  if (normalizedType === 'hostname-or-ip') {
    return isHostnameOrIp(value)
      ? ''
      : `${label}格式不正确`
  }
  if (normalizedType === 'url') {
    return isHttpUrl(value) ? '' : `${label}必须是有效的 HTTP 或 HTTPS 地址`
  }
  if (normalizedType === 'ipv4-list') {
    return value.split(',').every(item => isIpv4(item.trim()))
      ? ''
      : `${label}必须是用逗号分隔的 IPv4 地址`
  }
  if (normalizedType === 'file-mode') {
    return /^(?:[0-7]{3}|[0-7]{4})$/.test(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'account') {
    return /^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(value) ? '' : `${label}格式不正确`
  }
  if (normalizedType === 'text') {
    return /[;&|`$\\<>]/.test(value) ? `${label}包含危险的 Shell 语法` : ''
  }
  if (normalizedType === 'template-text') {
    return ''
  }
  if (!normalizedType) return ''
  return `${label}使用了不支持的校验类型`
}

function normalizeValueByType (type, value) {
  if (type === 'ipv4-list') {
    return value.split(',').map(item => item.trim()).join(',')
  }
  return value
}

function validateDoubleQuotedTemplateSafety (value, label) {
  return /["$`\\]/.test(value)
    ? `${label}包含不能安全写入命令模板的字符`
    : ''
}

export function isServerMaintenanceQuickCommand (item = {}) {
  return typeof item.id === 'string' && item.id.startsWith(maintenanceCommandPrefix)
}

const validationTypeByParamName = new Map([
  ['端口', 'port'],
  ['目标端口', 'port'],
  ['TLS端口', 'port'],
  ['过滤端口', 'port'],
  ['新IP/CIDR', 'cidr'],
  ['网关', 'ipv4'],
  ['过滤IP', 'ipv4'],
  ['DNS服务器', 'ipv4'],
  ['DNS', 'ipv4-list'],
  ['日志路径', 'path'],
  ['分析目录', 'path'],
  ['目标路径', 'path'],
  ['抓包文件', 'path'],
  ['回滚脚本', 'path'],
  ['域名', 'hostname'],
  ['证书域名', 'hostname'],
  ['目标地址', 'hostname-or-ip'],
  ['请求地址', 'url'],
  ['权限模式', 'file-mode'],
  ['所有者', 'account'],
  ['所属组', 'account'],
  ['关键词', 'template-text'],
  ['进程关键字', 'template-text'],
  ['自定义过滤', 'packet-filter']
])

export function inferQuickCommandParamValidation (item = {}, param = {}) {
  if (param.validationType) return param.validationType
  if (!isServerMaintenanceQuickCommand(item)) return ''
  if (param.type === 'select') return 'enum'
  if (param.type === 'number') return 'number'
  if (param.type === 'service-target') return 'service'
  if (param.type === 'network-interface') return 'interface'
  return validationTypeByParamName.get(param.name) || ''
}

export function validateAndNormalizeValue (type, rawValue, options = {}) {
  const originalValue = toStringValue(rawValue)
  const normalizedType = type === 'absolute-path' ? 'path' : type
  const label = displayLabel(normalizedType, options)
  const structuralError = validateStructuralSafety(originalValue, label)
  const value = normalizeValueByType(normalizedType, originalValue.trim())
  const templateError = options.doubleQuotedTemplate
    ? validateDoubleQuotedTemplateSafety(value, label)
    : ''
  return {
    value,
    error: structuralError || templateError || validateNormalizedValue(
      normalizedType,
      value,
      options,
      label
    )
  }
}

export function validateValue (type, rawValue, options = {}) {
  return validateAndNormalizeValue(type, rawValue, options).error
}

export function quoteShellValue (value) {
  const singleQuote = String.fromCharCode(39)
  const escapedSingleQuote = `${singleQuote}\\${singleQuote}${singleQuote}`
  return `${singleQuote}${toStringValue(value).split(singleQuote).join(escapedSingleQuote)}${singleQuote}`
}

export function validateAndNormalizeQuickCommandParams (item = {}, values = {}) {
  const errors = {}
  const isMaintenance = isServerMaintenanceQuickCommand(item)
  const normalizedValues = isMaintenance ? {} : { ...(values || {}) }

  for (const param of item.params || []) {
    const validationType = inferQuickCommandParamValidation(item, param)
    if (!validationType) {
      if (isMaintenance && item.mutatesServer) {
        errors[param.name] = `${param.label || param.name || '参数'}无法识别安全校验策略`
      }
      continue
    }
    const rawValue = values?.[param.name]
    if (Array.isArray(rawValue)) {
      if (param.required && rawValue.length === 0) {
        errors[param.name] = `${param.label || param.name || '参数'}不能为空`
        normalizedValues[param.name] = []
        continue
      }
      const normalizedItems = []
      for (const itemValue of rawValue) {
        const result = validateAndNormalizeValue(validationType, itemValue, {
          ...param,
          required: param.required,
          doubleQuotedTemplate: isMaintenance
        })
        normalizedItems.push(result.value)
        if (result.error && !errors[param.name]) {
          errors[param.name] = result.error
          break
        }
      }
      normalizedValues[param.name] = normalizedItems
      continue
    }
    const result = validateAndNormalizeValue(validationType, rawValue, {
      ...param,
      doubleQuotedTemplate: isMaintenance
    })
    normalizedValues[param.name] = result.value
    if (result.error) errors[param.name] = result.error
  }

  return { errors, values: normalizedValues }
}

export function validateQuickCommandParams (item = {}, values = {}) {
  return validateAndNormalizeQuickCommandParams(item, values).errors
}
