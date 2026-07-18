import React from 'react'
import { Alert } from 'antd'
import ExternalLink from '../common/external-link'

const batchOpWikiLink = 'https://github.com/lx3559359/ssh-agent-tool/blob/master/docs/USER_GUIDE_ZH.md'

export default function BatchOpAlert () {
  const e = window.translate
  const description = (
    <>
      <p>{e('shellpilotBatchActionsSupported')} <code>connect, command, sftp_upload, sftp_download</code></p>
      <p>{e('shellpilotBatchDescription')}</p>
      <div><ExternalLink to={batchOpWikiLink}>{batchOpWikiLink}</ExternalLink></div>
    </>
  )

  return (
    <Alert
      description={description}
      type='info'
      showIcon
      className='mg1b'
    />
  )
}
