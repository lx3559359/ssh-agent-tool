export const updateApprovalManifestName = 'aigshell-update.json'

export function findUpdateApprovalAsset (release) {
  return (release?.assets || [])
    .find(asset => asset.name === updateApprovalManifestName && asset.browser_download_url)
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
