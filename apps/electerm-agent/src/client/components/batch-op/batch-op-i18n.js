import {
  formatShellPilotTranslation,
  getShellPilotTranslation
} from '../../common/shellpilot-i18n-overrides.js'

const workflowTemplate = [
  {
    nameKey: 'shellpilotBatchStepConnectSsh',
    action: 'connect',
    params: {
      host: '192.168.1.100',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'your_password'
    }
  },
  {
    nameKey: 'shellpilotBatchStepCreateTestFile',
    action: 'command',
    afterDelay: 500,
    prevDelay: 500,
    command: "fallocate -l 5M /tmp/test_5m_file.bin && rm -f /tmp/test_log.log && echo '[LOG] Created 5M test file at $(date)' >> /tmp/test_log.log"
  },
  {
    nameKey: 'shellpilotBatchStepRecordFileInfo',
    action: 'command',
    command: "ls -la /tmp/test_5m_file.bin >> /tmp/test_log.log 2>&1 && echo '[LOG] File size logged at $(date)' >> /tmp/test_log.log"
  },
  {
    nameKey: 'shellpilotBatchStepDownloadTestFile',
    action: 'sftp_download',
    afterDelay: 200,
    remotePath: '/tmp/test_5m_file.bin',
    localPath: '/tmp/test_5m_file.bin'
  },
  {
    nameKey: 'shellpilotBatchStepRecordDownload',
    action: 'command',
    afterDelay: 200,
    command: "echo '[LOG] Download complete at $(date)' >> /tmp/test_log.log"
  },
  {
    nameKey: 'shellpilotBatchStepDeleteRemoteFile',
    action: 'command',
    afterDelay: 200,
    command: "rm /tmp/test_5m_file.bin && echo '[LOG] Deleted remote 5M file at $(date)' >> /tmp/test_log.log"
  },
  {
    nameKey: 'shellpilotBatchStepUploadRemoteFile',
    action: 'sftp_upload',
    afterDelay: 200,
    localPath: '/tmp/test_5m_file.bin',
    remotePath: '/tmp/test_5m_file_uploaded.bin'
  },
  {
    nameKey: 'shellpilotBatchStepRecordUpload',
    action: 'command',
    afterDelay: 200,
    command: "echo '[LOG] Upload complete at $(date)' >> /tmp/test_log.log"
  },
  {
    nameKey: 'shellpilotBatchStepVerifyCleanup',
    action: 'command',
    command: "ls -la /tmp/test_5m_file_uploaded.bin >> /tmp/test_log.log 2>&1 && rm -f /tmp/test_5m_file*.bin && echo '[LOG] Cleaned up at $(date)' >> /tmp/test_log.log"
  }
]

export function formatBatchOpMessage (key, replacements = {}, translate) {
  return formatShellPilotTranslation(translate, key, replacements)
}

export function createWorkflowExample (translatorOrLang) {
  const translate = typeof translatorOrLang === 'string'
    ? key => getShellPilotTranslation(key, translatorOrLang)
    : translatorOrLang
  const workflow = workflowTemplate.map(({ nameKey, ...step }) => ({
    name: formatShellPilotTranslation(translate, nameKey),
    ...step
  }))
  return JSON.stringify(workflow, null, 2)
}
