/**
 * check latest release for update warn
 */

import fetch from './fetch-from-server'
import {
  packInfo
} from './constants'
import dayjs from 'dayjs'
import { getReleaseUpdate } from './update-version'

const releaseApiUrl = 'https://api.github.com/repos/lx3559359/ssh-agent-tool/releases/latest'

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
  const n = Date.now()
  const tail = url.includes('?') ? '' : '?_=' + n
  return fetchData(url + tail, {
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

export async function getLatestReleaseVersion (n) {
  const release = await getInfo(releaseApiUrl)
  return getReleaseUpdate(release, packInfo.version)
}

export async function getLatestReleaseInfo () {
  const release = await getInfo(releaseApiUrl)
  return release?.body
    ? {
        body: release.body,
        date: dayjs(release.published_at).format('YYYY-MM-DD')
      }
    : undefined
}
