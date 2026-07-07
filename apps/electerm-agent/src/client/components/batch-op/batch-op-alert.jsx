import React from 'react'
import { Alert } from 'antd'
import ExternalLink from '../common/external-link'

const batchOpWikiLink = 'https://github.com/electerm/electerm/wiki/batch-operation'

export default function BatchOpAlert () {
  const description = (
    <>
      <p>支持动作：<code>connect, command, sftp_upload, sftp_download</code></p>
      <p>用于把连接服务器、执行命令、上传下载文件编排成可重复执行的任务流。</p>
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
