const githubReleaseApiUrl = 'https://api.github.com/repos/lx3559359/ssh-agent-tool/releases/latest'
const modelScopeRepo = 'lx3559359/ShellPilot-Updates'
const modelScopeResolveBaseUrl = `https://modelscope.cn/models/${modelScopeRepo}/resolve/master`
const modelScopeReleaseManifestName = 'shellpilot-release.json'
const modelScopeReleaseManifestUrl = `${modelScopeResolveBaseUrl}/${modelScopeReleaseManifestName}`

const githubFeedConfig = {
  provider: 'github',
  owner: 'lx3559359',
  repo: 'ssh-agent-tool',
  channel: 'latest'
}

const modelScopeFeedConfig = {
  provider: 'generic',
  url: modelScopeResolveBaseUrl,
  channel: 'latest'
}

function buildModelScopeAssetUrl (name) {
  return `${modelScopeResolveBaseUrl}/${encodeURIComponent(name)}`
}

function appendUpdateCacheBuster (url, now = Date.now()) {
  return `${url}${url.includes('?') ? '&' : '?'}_=${now}`
}

function getUpdateReleaseSources () {
  return [
    {
      id: 'modelscope',
      label: 'ModelScope 国内更新源',
      releaseApiUrl: modelScopeReleaseManifestUrl,
      feedConfig: modelScopeFeedConfig
    },
    {
      id: 'github',
      label: 'GitHub Releases',
      releaseApiUrl: githubReleaseApiUrl,
      feedConfig: githubFeedConfig
    }
  ]
}

module.exports = {
  appendUpdateCacheBuster,
  buildModelScopeAssetUrl,
  getUpdateReleaseSources,
  githubFeedConfig,
  githubReleaseApiUrl,
  modelScopeFeedConfig,
  modelScopeReleaseManifestName,
  modelScopeReleaseManifestUrl,
  modelScopeRepo,
  modelScopeResolveBaseUrl
}
