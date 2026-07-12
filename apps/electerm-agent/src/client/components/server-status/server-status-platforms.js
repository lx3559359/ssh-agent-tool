const unhealthyStates = new Set(['failed', 'dead', 'exited', 'unhealthy'])
const warningStates = new Set(['inactive', 'stopped', 'degraded', 'restarting', 'paused', 'created'])
const healthyStates = new Set(['active', 'running', 'up', 'healthy'])
const genericPrefixes = new Set([
  'app', 'application', 'daemon', 'docker', 'service', 'system', 'systemd'
])
const broadPaths = new Set([
  '/', '/data', '/opt', '/srv', '/usr', '/usr/local', '/var', '/var/lib', '/www', '/www/server'
])
const matcherKeys = [
  'servicePrefixes',
  'serviceNames',
  'pathPrefixes',
  'composeProjects'
]
const unsafePattern = /[*?[\]{}()^$\\]|\.\*/

export const knownPlatformRules = Object.freeze([
  {
    id: 'gitlab',
    name: 'GitLab',
    servicePrefixes: ['gitlab-'],
    pathPrefixes: ['/opt/gitlab']
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    servicePrefixes: ['kube-', 'k3s-', 'microk8s-'],
    serviceNames: ['kubelet.service', 'k3s.service', 'rke2-server.service', 'rke2-agent.service']
  },
  {
    id: 'zabbix',
    name: 'Zabbix',
    servicePrefixes: ['zabbix-'],
    pathPrefixes: ['/usr/local/zabbix']
  },
  {
    id: '1panel',
    name: '1Panel',
    serviceNames: ['1panel.service'],
    pathPrefixes: ['/opt/1panel']
  },
  {
    id: 'baota',
    name: '\u5b9d\u5854\u9762\u677f',
    serviceNames: ['bt.service'],
    pathPrefixes: ['/www/server/panel']
  },
  {
    id: 'harbor',
    name: 'Harbor',
    composeProjects: ['harbor'],
    pathPrefixes: ['/opt/harbor']
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    serviceNames: ['jenkins.service'],
    pathPrefixes: ['/var/lib/jenkins']
  }
])

function clone (value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function cleanString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueSorted (values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function normalizePath (value) {
  const path = cleanString(value).replace(/\\/g, '/').replace(/\/+$/, '')
  return path || '/'
}

function assertSafeTextMatcher (value, kind) {
  const pattern = cleanString(value).toLowerCase()
  const hasControlCharacter = [...pattern].some(character => character.charCodeAt(0) < 32)
  const prefixCore = pattern.replace(/[._-]+$/, '')
  const prefixTooShort = kind === 'servicePrefixes' && prefixCore.length < 3
  if (!pattern || pattern.length < 2 || prefixTooShort || hasControlCharacter || unsafePattern.test(pattern)) {
    throw new TypeError(`Invalid ${kind} matcher`)
  }
  if (genericPrefixes.has(pattern.replace(/[._-]+$/, ''))) {
    throw new TypeError(`Broad ${kind} matcher`)
  }
  return pattern
}

function normalizePathMatcher (value) {
  const pattern = normalizePath(value)
  const segments = pattern.split('/').filter(Boolean)
  if (!pattern.startsWith('/') || segments.length < 2 || broadPaths.has(pattern) || unsafePattern.test(pattern)) {
    throw new TypeError('Broad path matcher')
  }
  return pattern
}

function normalizeMatcherList (values, kind) {
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new TypeError(`Invalid ${kind} matcher list`)
  const normalized = values.map(value => {
    return kind === 'pathPrefixes'
      ? normalizePathMatcher(value)
      : assertSafeTextMatcher(value, kind)
  })
  return uniqueSorted(normalized)
}

export function normalizePlatformRules (rules = []) {
  if (!Array.isArray(rules)) throw new TypeError('Invalid custom platform rules')
  const ids = new Set()
  return rules.map(rule => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new TypeError('Invalid custom platform rule')
    }
    const id = cleanString(rule.id).toLowerCase()
    const name = cleanString(rule.name)
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) || name.length < 2 || name.length > 80) {
      throw new TypeError('Invalid custom platform rule identity')
    }
    if (ids.has(id)) throw new TypeError('Invalid duplicate custom platform rule')
    ids.add(id)

    const normalized = { id, name }
    let matcherCount = 0
    for (const key of matcherKeys) {
      normalized[key] = normalizeMatcherList(rule[key], key)
      matcherCount += normalized[key].length
    }
    if (!matcherCount) throw new TypeError('Invalid custom platform rule: matcher required')
    return normalized
  })
}

function labelsObject (labels) {
  if (!labels) return {}
  if (!Array.isArray(labels)) return { ...labels }
  return Object.fromEntries(labels.map(label => {
    const text = cleanString(label)
    const separator = text.indexOf('=')
    return separator < 0
      ? [text, '']
      : [text.slice(0, separator), text.slice(separator + 1)]
  }).filter(([key]) => key))
}

function composeProject (container) {
  return cleanString(
    container.composeProject ||
    labelsObject(container.labels)['com.docker.compose.project']
  ).toLowerCase()
}

function composeWorkingDirectory (container) {
  const labels = labelsObject(container.labels)
  const value = container.composeWorkingDirectory || labels['com.docker.compose.project.working_dir']
  return value ? normalizePath(value) : ''
}

function serviceText (service) {
  return [
    service.execStart,
    service.workingDirectory,
    service.fragmentPath,
    service.unitFile,
    service.path
  ].map(cleanString).join(' ')
}

function serviceInstallPaths (service) {
  const text = serviceText(service)
  const paths = []
  const pattern = /(?:^|[\s='"])((?:\/opt|\/srv|\/data|\/usr\/local)\/[a-zA-Z0-9._-]+)/g
  let match
  while ((match = pattern.exec(text))) paths.push(normalizePath(match[1]))
  return uniqueSorted(paths)
}

function pathMatches (service, prefixes) {
  const text = serviceText(service)
  return prefixes.find(prefix => text === prefix || text.includes(`${prefix}/`)) || ''
}

function serviceMatchesRule (service, rule) {
  const name = cleanString(service.name || service.unit).toLowerCase()
  const exact = rule.serviceNames.includes(name)
  const prefix = rule.servicePrefixes.find(item => name.startsWith(item)) || ''
  const path = pathMatches(service, rule.pathPrefixes)
  return exact || prefix || path ? { exact, prefix, path } : null
}

function containerMatchesRule (container, rule) {
  const project = composeProject(container)
  return project && rule.composeProjects.includes(project) ? { project } : null
}

function stateOf (item) {
  return cleanString(item.activeState || item.state || item.status).toLowerCase().split(/[\s(]/)[0]
}

function groupStatus (services, containers) {
  const states = [...services, ...containers].map(stateOf).filter(Boolean)
  if (states.some(state => unhealthyStates.has(state))) return 'critical'
  if (states.some(state => warningStates.has(state))) return 'warning'
  if (states.length && states.every(state => healthyStates.has(state))) return 'healthy'
  return 'unknown'
}

function sortedItems (items) {
  return [...items].sort((left, right) => {
    return cleanString(left.name || left.unit || left.id)
      .localeCompare(cleanString(right.name || right.unit || right.id), 'en')
  }).map(clone)
}

function createGroup ({ id, name, confidence, services = [], containers = [], installPaths = [], evidence = [] }) {
  const sortedServices = sortedItems(services)
  const sortedContainers = sortedItems(containers)
  return {
    id,
    name,
    confidence,
    status: groupStatus(sortedServices, sortedContainers),
    services: sortedServices,
    containers: sortedContainers,
    installPaths: uniqueSorted(installPaths),
    evidence
  }
}

function addRuleGroups (groups, services, containers, assignedServices, assignedContainers, rules, kind) {
  for (const rule of rules) {
    const matchedServices = []
    const matchedContainers = []
    const paths = []
    const evidence = [{ type: kind === 'custom' ? 'custom-rule' : 'known-rule', value: rule.id }]

    services.forEach((service, index) => {
      if (assignedServices.has(index)) return
      const match = serviceMatchesRule(service, rule)
      if (!match) return
      matchedServices.push(service)
      assignedServices.add(index)
      if (match.path) paths.push(match.path)
    })
    containers.forEach((container, index) => {
      if (assignedContainers.has(index)) return
      const match = containerMatchesRule(container, rule)
      if (!match) return
      matchedContainers.push(container)
      assignedContainers.add(index)
    })
    if (!matchedServices.length && !matchedContainers.length) continue

    for (const path of uniqueSorted(paths)) evidence.push({ type: 'install-path', value: path })
    groups.push(createGroup({
      id: `${kind}:${rule.id}`,
      name: rule.name,
      confidence: 'high',
      services: matchedServices,
      containers: matchedContainers,
      installPaths: paths,
      evidence
    }))
  }
}

function addComposeGroups (groups, containers, assignedContainers) {
  const projects = new Map()
  containers.forEach((container, index) => {
    if (assignedContainers.has(index)) return
    const project = composeProject(container)
    if (!project) return
    if (!projects.has(project)) projects.set(project, [])
    projects.get(project).push({ container, index })
  })

  for (const project of [...projects.keys()].sort()) {
    const entries = projects.get(project)
    const workingDirectories = uniqueSorted(entries.map(entry => composeWorkingDirectory(entry.container)).filter(Boolean))
    entries.forEach(entry => assignedContainers.add(entry.index))
    groups.push(createGroup({
      id: `compose:${project}`,
      name: project,
      confidence: 'high',
      containers: entries.map(entry => entry.container),
      installPaths: workingDirectories,
      evidence: [
        { type: 'docker-compose-project', value: project, count: entries.length },
        ...workingDirectories.map(value => ({ type: 'compose-working-directory', value }))
      ]
    }))
  }
}

function addSharedPathGroups (groups, services, assignedServices) {
  const candidates = new Map()
  services.forEach((service, index) => {
    if (assignedServices.has(index)) return
    for (const path of serviceInstallPaths(service)) {
      if (!candidates.has(path)) candidates.set(path, [])
      candidates.get(path).push({ service, index })
    }
  })

  for (const path of [...candidates.keys()].sort()) {
    const entries = candidates.get(path).filter(entry => !assignedServices.has(entry.index))
    if (entries.length < 2) continue
    entries.forEach(entry => assignedServices.add(entry.index))
    const platformName = path.split('/').filter(Boolean).at(-1)
    groups.push(createGroup({
      id: `path:${path}`,
      name: `${platformName} \u5e73\u53f0`,
      confidence: 'medium',
      services: entries.map(entry => entry.service),
      installPaths: [path],
      evidence: [{ type: 'shared-install-path', value: path, count: entries.length }]
    }))
  }
}

function servicePrefix (service) {
  const name = cleanString(service.name || service.unit).toLowerCase().replace(/\.service$/, '')
  const prefix = name.split(/[-_.@]/)[0]
  return prefix.length >= 3 && !genericPrefixes.has(prefix) ? prefix : ''
}

function addPrefixGroups (groups, services, assignedServices) {
  const candidates = new Map()
  services.forEach((service, index) => {
    if (assignedServices.has(index)) return
    const prefix = servicePrefix(service)
    if (!prefix) return
    if (!candidates.has(prefix)) candidates.set(prefix, [])
    candidates.get(prefix).push({ service, index })
  })

  for (const prefix of [...candidates.keys()].sort()) {
    const entries = candidates.get(prefix).filter(entry => !assignedServices.has(entry.index))
    if (entries.length < 2) continue
    entries.forEach(entry => assignedServices.add(entry.index))
    groups.push(createGroup({
      id: `prefix:${prefix}`,
      name: `${prefix} \u670d\u52a1\u7ec4`,
      confidence: 'medium',
      services: entries.map(entry => entry.service),
      evidence: [{ type: 'service-prefix', value: prefix, count: entries.length }]
    }))
  }
}

export function identifyServerPlatforms (inventory = {}, options = {}) {
  const services = Array.isArray(inventory.services) ? inventory.services : []
  const containers = Array.isArray(inventory.containers) ? inventory.containers : []
  const customRules = normalizePlatformRules(options.customRules || [])
  const normalizedKnownRules = normalizePlatformRules(knownPlatformRules)
  const assignedServices = new Set()
  const assignedContainers = new Set()
  const groups = []

  addRuleGroups(groups, services, containers, assignedServices, assignedContainers, customRules, 'custom')
  addRuleGroups(groups, services, containers, assignedServices, assignedContainers, normalizedKnownRules, 'known')
  addComposeGroups(groups, containers, assignedContainers)
  addSharedPathGroups(groups, services, assignedServices)
  addPrefixGroups(groups, services, assignedServices)

  const otherServices = services.filter((service, index) => !assignedServices.has(index))
  if (otherServices.length) {
    groups.push(createGroup({
      id: 'system:other',
      name: '\u5176\u4ed6\u7cfb\u7edf\u670d\u52a1',
      confidence: 'low',
      services: otherServices,
      evidence: [{ type: 'fallback', value: 'unmatched-system-services', count: otherServices.length }]
    }))
  }

  return groups
}

export const groupServerPlatforms = identifyServerPlatforms
