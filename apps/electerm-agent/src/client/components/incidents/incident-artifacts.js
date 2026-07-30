import { artifactClient as defaultArtifactClient } from '../artifacts/artifact-client.js'
import { createIncidentReviewArtifactDraft } from './incident-capture.js'

const incidentReviewFormats = Object.freeze(['md', 'docx', 'pdf', 'html'])

export async function createIncidentReviewArtifact ({
  incident,
  artifactClient = defaultArtifactClient,
  appendTimelineEvent
} = {}) {
  if (!incident?.id) throw new Error('请先选择正式故障档案')
  const draft = createIncidentReviewArtifactDraft(incident)
  const created = await artifactClient.createArtifact(draft, {
    source: 'incident-archive',
    incidentId: incident.id,
    endpointRef: incident.endpointRef || ''
  })
  await artifactClient.generateArtifact(
    created.id,
    created.version,
    incidentReviewFormats
  )
  const artifact = await artifactClient.getArtifact(created.id)
  if (typeof appendTimelineEvent === 'function') {
    await appendTimelineEvent(incident.id, {
      kind: 'artifact',
      source: 'artifact',
      sourceRef: artifact.id,
      title: `已生成复盘报告：${artifact.title || draft.title}`,
      body: '可在成果中心预览、轻量修改并导出 MD、DOCX、PDF 或 HTML。',
      metadata: {
        artifactId: artifact.id,
        artifactVersion: Number(artifact.version) || 1,
        formats: [...incidentReviewFormats]
      }
    })
  }
  return artifact
}
