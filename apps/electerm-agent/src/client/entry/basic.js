/**
 * init app data then write main script to html body
 */
import '../css/basic.styl'
import '../css/mobile.styl'
import { get as _get } from 'lodash-es'
import '../common/pre'
import { resolveShellPilotTranslation } from '../common/shellpilot-i18n-overrides.js'

const { isDev } = window.et
const version = process.env.VER || window.pre.packInfo.version

async function loadWorker () {
  return new Promise((resolve) => {
    const url = !isDev ? `js/worker-${version}.js` : 'js/worker.js'
    window.worker = new window.Worker(url)
    function onInit (e) {
      if (!e || !e.data) {
        return false
      }
      const {
        action
      } = e.data
      if (action === 'worker-init') {
        window.worker.removeEventListener('message', onInit)
        resolve(1)
      }
    }
    window.worker.addEventListener('message', onInit)
  })
}

async function load () {
  window.capitalizeFirstLetter = (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1)
  }
  function loadScript () {
    const rcs = document.createElement('script')
    const url = !isDev ? `js/electerm-${version}.js` : 'js/electerm.js'
    rcs.src = url
    rcs.type = 'module'
    rcs.onload = () => {
      const loadingEl = document.getElementById('content-loading')
      if (loadingEl) {
        document.body.removeChild(loadingEl)
      }
    }
    document.body.appendChild(rcs)
  }
  window.getLang = (lang = window.store?.config.language || 'zh_cn') => {
    return _get(window.langMap, `[${lang}].lang`)
  }
  window.translate = txt => {
    const langId = window.store?.previewLanguage || window.store?.config.language || 'zh_cn'
    const lang = window.getLang(langId)
    const english = window.getLang('en_us')
    const value = resolveShellPilotTranslation(
      txt,
      langId,
      _get(lang, `[${txt}]`),
      _get(english, `[${txt}]`),
      txt
    )
    return window.capitalizeFirstLetter(value)
  }
  await loadWorker()
  loadScript()
}

// window.addEventListener('load', load)
load()
