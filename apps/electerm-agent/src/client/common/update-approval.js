export const updateApprovalManifestName = 'shellpilot-update.json'
export const legacyUpdateApprovalManifestName = 'aigshell-update.json'

export function findUpdateApprovalAsset (release) {
  const assets = release?.assets || []
  return assets.find(asset => asset.name === updateApprovalManifestName && asset.browser_download_url) ||
    assets.find(asset => asset.name === legacyUpdateApprovalManifestName && asset.browser_download_url)
}

export async function attachUpdateApprovalManifest (release, fetchManifest) {
  const asset = findUpdateApprovalAsset(release)
  if (!asset) {
    return release
  }
  try {
    const updateApproval = await fetchManifest(asset.browser_download_url)
    return {
      ...release,
      updateApproval
    }
  } catch (error) {
    return release
  }
}
