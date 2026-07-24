const profiles = Object.freeze({
  debian: Object.freeze({
    family: 'debian',
    level: 'A',
    packageManager: 'apt'
  }),
  rhel: Object.freeze({
    family: 'rhel',
    level: 'A',
    packageManager: 'dnf'
  }),
  openeuler: Object.freeze({
    family: 'openeuler',
    level: 'A',
    packageManager: 'dnf'
  }),
  unknown: Object.freeze({
    family: 'unknown',
    level: 'C',
    packageManager: ''
  })
})

const explicitFamilies = Object.freeze({
  alibaba: 'rhel',
  alinux: 'rhel',
  almalinux: 'rhel',
  anolis: 'rhel',
  centos: 'rhel',
  debian: 'debian',
  euleros: 'openeuler',
  kylin: 'rhel',
  opencloudos: 'rhel',
  openeuler: 'openeuler',
  rocky: 'rhel',
  tencentos: 'rhel',
  ubuntu: 'debian',
  uos: 'debian'
})

function normalizeId (value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findLikeFamily (idLike) {
  const values = String(idLike || '')
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeId)
    .filter(Boolean)
  if (values.some(id => id === 'debian' || id === 'ubuntu')) return 'debian'
  if (values.some(id => ['rhel', 'fedora', 'centos'].includes(id))) return 'rhel'
  return ''
}

export function getCompatibilityProfile ({ id, idLike } = {}) {
  const normalizedId = normalizeId(id)
  const family = explicitFamilies[normalizedId] || findLikeFamily(idLike)
  if (!family) return { ...profiles.unknown }
  return { ...profiles[family] }
}
