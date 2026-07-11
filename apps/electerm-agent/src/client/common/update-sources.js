export const githubReleaseApiUrl = 'https://api.github.com/repos/lx3559359/ssh-agent-tool/releases/latest'
export const modelScopeRepo = 'lx3559359/ShellPilot-Updates'
export const modelScopeResolveBaseUrl = `https://modelscope.cn/models/${modelScopeRepo}/resolve/master`
export const modelScopeReleaseManifestName = 'shellpilot-release.json'
export const modelScopeReleaseManifestUrl = `${modelScopeResolveBaseUrl}/${modelScopeReleaseManifestName}`

export const githubFeedConfig = {
  provider: 'github',
  owner: 'lx3559359',
  repo: 'ssh-agent-tool',
  channel: 'latest'
}

export const modelScopeFeedConfig = {
  provider: 'generic',
  url: modelScopeResolveBaseUrl,
  channel: 'latest'
}

export function buildModelScopeAssetUrl (name) {
  return `${modelScopeResolveBaseUrl}/${encodeURIComponent(name)}`
}

export function appendUpdateCacheBuster (url, now = Date.now()) {
  return `${url}${url.includes('?') ? '&' : '?'}_=${now}`
}

export function getUpdateReleaseSources () {
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
