import { artifactClient } from '../artifacts/artifact-client'

const ARTIFACT_TOOL_NAMES = new Set([
  'create_artifact',
  'update_artifact',
  'regenerate_artifact',
  'export_artifact'
])

const draftSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    type: {
      type: 'string',
      enum: [
        'diagnostic-report',
        'inspection-report',
        'asset-inventory',
        'change-record',
        'security-report',
        'incident-review',
        'custom-document',
        'custom-spreadsheet'
      ]
    },
    title: { type: 'string', maxLength: 160 },
    server: { type: 'string', maxLength: 160 },
    summary: { type: 'string', maxLength: 16000 },
    sections: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 160 },
          content: { type: 'string', maxLength: 32000 }
        },
        required: ['title', 'content'],
        additionalProperties: false
      }
    },
    tables: {
      type: 'array',
      maxItems: 32,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 160 },
          columns: {
            type: 'array',
            maxItems: 64,
            items: { type: 'string', maxLength: 32000 }
          },
          rows: {
            type: 'array',
            maxItems: 2000,
            items: {
              type: 'array',
              maxItems: 64,
              items: { type: 'string', maxLength: 32000 }
            }
          }
        },
        required: ['title', 'columns', 'rows'],
        additionalProperties: false
      }
    },
    risks: {
      type: 'array',
      maxItems: 200,
      items: { type: 'string', maxLength: 32000 }
    },
    recommendations: {
      type: 'array',
      maxItems: 200,
      items: { type: 'string', maxLength: 32000 }
    }
  },
  required: [
    'schemaVersion',
    'type',
    'title',
    'server',
    'summary',
    'sections',
    'tables',
    'risks',
    'recommendations'
  ],
  additionalProperties: false
}

const formatsSchema = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: {
    type: 'string',
    enum: ['md', 'csv', 'docx', 'xlsx', 'pdf', 'html']
  }
}

export const artifactAgentTools = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'create_artifact',
      description: '根据当前对话创建可预览、编辑和导出的文档或表格成果，不执行 SSH 命令。',
      parameters: {
        type: 'object',
        properties: {
          draft: draftSchema,
          formats: formatsSchema
        },
        required: ['draft', 'formats'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_artifact',
      description: '更新已有成果的结构化源数据并创建新版本，不修改服务器文件。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
          patch: { ...draftSchema, required: [] }
        },
        required: ['artifactId', 'patch'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'regenerate_artifact',
      description: '将已有成果重新生成指定格式。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
          formats: formatsSchema
        },
        required: ['artifactId', 'formats'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_artifact',
      description: '打开系统保存窗口，让用户自行选择成果的本地保存位置。',
      parameters: {
        type: 'object',
        properties: {
          artifactId: { type: 'string' },
          format: {
            type: 'string',
            enum: ['md', 'csv', 'docx', 'xlsx', 'pdf', 'html']
          }
        },
        required: ['artifactId', 'format'],
        additionalProperties: false
      }
    }
  }
])

function abortError () {
  const error = new Error('Agent request cancelled')
  error.name = 'AbortError'
  return error
}

async function waitForArtifactOperation (operation, runtime = {}) {
  if (runtime.signal?.aborted) throw abortError()
  if (!runtime.signal) return operation
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    runtime.signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(operation).then(
      value => {
        runtime.signal.removeEventListener('abort', onAbort)
        if (runtime.signal.aborted) reject(abortError())
        else resolve(value)
      },
      error => {
        runtime.signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function artifactSummary (artifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    version: artifact.version,
    formats: artifact.versions
      ?.find(item => item.version === artifact.version)
      ?.formats || []
  }
}

function trackArtifact (runtime, artifactId) {
  if (!runtime.createdArtifactIds) {
    runtime.createdArtifactIds = new Set()
  }
  runtime.createdArtifactIds.add(artifactId)
}

export function isArtifactAgentTool (name) {
  return ARTIFACT_TOOL_NAMES.has(name)
}

export async function executeArtifactAgentTool (
  toolName,
  args,
  runtime = {}
) {
  if (!isArtifactAgentTool(toolName)) {
    throw new Error(`未知成果工具：${toolName}`)
  }
  if (toolName === 'create_artifact') {
    const artifact = await waitForArtifactOperation(
      artifactClient.createArtifact(args.draft, {
        source: 'ai-agent',
        traceId: runtime.traceContext?.traceId || ''
      }),
      runtime
    )
    trackArtifact(runtime, artifact.id)
    await waitForArtifactOperation(
      artifactClient.generateArtifact(
        artifact.id,
        artifact.version,
        args.formats
      ),
      runtime
    )
    return artifactSummary(await artifactClient.getArtifact(artifact.id))
  }
  const artifact = await waitForArtifactOperation(
    artifactClient.getArtifact(args.artifactId),
    runtime
  )
  if (toolName === 'update_artifact') {
    const updated = await waitForArtifactOperation(
      artifactClient.createArtifactVersion(
        artifact.id,
        { ...artifact.source, ...args.patch }
      ),
      runtime
    )
    trackArtifact(runtime, updated.id)
    return artifactSummary(updated)
  }
  if (toolName === 'regenerate_artifact') {
    await waitForArtifactOperation(
      artifactClient.generateArtifact(
        artifact.id,
        artifact.version,
        args.formats
      ),
      runtime
    )
    trackArtifact(runtime, artifact.id)
    return artifactSummary(await artifactClient.getArtifact(artifact.id))
  }
  const result = await waitForArtifactOperation(
    artifactClient.saveArtifactFile(
      artifact.id,
      artifact.version,
      args.format
    ),
    runtime
  )
  trackArtifact(runtime, artifact.id)
  return { artifactId: artifact.id, ...result }
}
