/**
 * check latest release for update warn
 */

import fetch from './fetch-from-server'
import {
  isArm,
  packInfo
} from './constants'
import dayjs from 'dayjs'
import {
  getReleaseUpdate,
  getReleaseUpdateStatus
} from './update-version'
import { attachUpdateApprovalManifest } from './update-approval'
import {
  appendUpdateCacheBuster,
  getUpdateReleaseSources
} from './update-sources'

async function fetchData (url, options) {
  const data = {
    action: 'fetch',
    options: {
      ...options,
      url,
      timeout: 15000
    },
    proxy: window.store.getProxySetting()
  }
  return fetch(data)
}

function getInfo (url) {
  return fetchData(appendUpdateCacheBuster(url), {
    action: 'get-update-info',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Safari/537.36'
    },
    timeout: 1000 * 60 * 5
  })
    .catch(() => {
      return null
    })
}

async function getApprovedReleaseInfo () {
  for (const source of getUpdateReleaseSources(getConfiguredUpdateSource())) {
    const release = await getInfo(source.releaseApiUrl)
    const approvedRelease = await attachUpdateApprovalManifest(release, getInfo)
    if (approvedRelease?.tag_name) {
      return {
        ...approvedRelease,
        updateSource: source.id,
        updateSourceLabel: source.label
      }
    }
  }
  return null
}

function getConfiguredUpdateSource () {
  return window.store?.config?.updateSource || 'auto'
}

function getConfiguredUpdateChannel () {
  return window.store?.config?.updateChannel === 'beta' ? 'beta' : 'stable'
}

export async function getLatestReleaseVersion (n) {
  const release = await getApprovedReleaseInfo()
  const updateChannel = getConfiguredUpdateChannel()
  return getReleaseUpdate(release, packInfo.version, {
    arch: isArm ? 'arm64' : 'x64',
    requireWindowsAssets: true,
    requireApprovalManifest: true,
    allowPrerelease: updateChannel === 'beta',
    updateChannel
  })
}

export async function getLatestReleaseStatus () {
  const release = await getApprovedReleaseInfo()
  const updateChannel = getConfiguredUpdateChannel()
  const status = getReleaseUpdateStatus(release, packInfo.version, {
    arch: isArm ? 'arm64' : 'x64',
    requireWindowsAssets: true,
    requireApprovalManifest: true,
    allowPrerelease: updateChannel === 'beta',
    updateChannel
  })
  return {
    ...status,
    tag_name: status.tag_name || release?.tag_name || '',
    html_url: status.html_url || release?.html_url || '',
    body: release?.body || '',
    date: release?.published_at
      ? dayjs(release.published_at).format('YYYY-MM-DD')
      : ''
  }
}

export async function getLatestReleaseInfo () {
  const release = await getApprovedReleaseInfo()
  return release?.body
    ? {
        body: release.body,
        date: dayjs(release.published_at).format('YYYY-MM-DD')
      }
    : undefined
}
