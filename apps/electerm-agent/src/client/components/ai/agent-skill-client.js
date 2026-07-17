function skillIpcError (payload = {}) {
  const error = new Error(payload.message || 'Agent Skill operation failed.')
  error.code = payload.code || 'SKILL_IPC_ERROR'
  error.validation = payload.validation
  return error
}

async function runAgentSkillCall (method, ...args) {
  const result = await window.pre.runGlobalAsync(method, ...args)
  if (!result?.ok) throw skillIpcError(result?.error)
  return result.value
}

export const listAgentSkills = () => runAgentSkillCall('listAgentSkills')
export const getAgentSkillMetadata = id => runAgentSkillCall('getAgentSkillMetadata', id)
export const readAgentSkillFile = (id, relativePath) => runAgentSkillCall('readAgentSkillFile', id, relativePath)
export const createAgentSkillDraft = files => runAgentSkillCall('createAgentSkillDraft', files)
export const updateAgentSkillDraftFile = (id, relativePath, content) => runAgentSkillCall('updateAgentSkillDraftFile', id, relativePath, content)
export const validateAgentSkillDraft = id => runAgentSkillCall('validateAgentSkillDraft', id)
export const enableAgentSkillDraft = (id, packageDigest) => runAgentSkillCall('enableAgentSkillDraft', id, packageDigest)
export const disableAgentSkill = id => runAgentSkillCall('disableAgentSkill', id)
export const rollbackAgentSkill = (id, packageDigest) => runAgentSkillCall('rollbackAgentSkill', id, packageDigest)
export const removeAgentSkill = id => runAgentSkillCall('removeAgentSkill', id)
export const importAgentSkill = sourcePath => runAgentSkillCall('importAgentSkill', sourcePath)

export const agentSkillClient = Object.freeze({
  listAgentSkills,
  getAgentSkillMetadata,
  readAgentSkillFile,
  createAgentSkillDraft,
  updateAgentSkillDraftFile,
  validateAgentSkillDraft,
  enableAgentSkillDraft,
  disableAgentSkill,
  rollbackAgentSkill,
  removeAgentSkill,
  importAgentSkill
})
