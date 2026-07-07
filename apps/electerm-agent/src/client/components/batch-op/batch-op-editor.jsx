/**
 * Batch Operation Editor Component
 * Self-contained workflow editor: handles execute, external editors, and progress logs
 */
import React, { useCallback, useState, useEffect } from 'react'
import { Button, Flex } from 'antd'
import {
  PlayCircleOutlined
} from '@ant-design/icons'
import SimpleEditor from '../text-editor/simple-editor'
import EditWithCustomEditor from '../text-editor/edit-with-custom-editor'
import BatchOpAlert from './batch-op-alert'
import BatchOpLogs from './batch-op-logs'
import message from '../common/message'
import { refsStatic } from '../common/ref'
import generate from '../../common/uid'
import { safeGetItem, safeSetItem } from '../../common/safe-local-storage'

const batchOpEditorKey = 'batch-op-editor-content'
const workflowExample = `[
  {
    "name": "连接 SSH",
    "action": "connect",
    "params": {
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "authType": "password",
      "password": "your_password"
    }
  },
  {
    "name": "创建 5M 测试文件",
    "action": "command",
    "afterDelay": 500,
    "prevDelay": 500,
    "command": "fallocate -l 5M /tmp/test_5m_file.bin && rm -f /tmp/test_log.log && echo '[LOG] Created 5M test file at $(date)' >> /tmp/test_log.log"
  },
  {
    "name": "记录文件信息",
    "action": "command",
    "command": "ls -la /tmp/test_5m_file.bin >> /tmp/test_log.log 2>&1 && echo '[LOG] File size logged at $(date)' >> /tmp/test_log.log"
  },
  {
    "name": "下载 5M 文件",
    "action": "sftp_download",
    "afterDelay": 200,
    "remotePath": "/tmp/test_5m_file.bin",
    "localPath": "/tmp/test_5m_file.bin"
  },
  {
    "name": "记录下载结果",
    "action": "command",
    "afterDelay": 200,
    "command": "echo '[LOG] Download complete at $(date)' >> /tmp/test_log.log"
  },
  {
    "name": "删除远程测试文件",
    "action": "command",
    "afterDelay": 200,
    "command": "rm /tmp/test_5m_file.bin && echo '[LOG] Deleted remote 5M file at $(date)' >> /tmp/test_log.log"
  },
  {
    "name": "上传文件到远程服务器",
    "action": "sftp_upload",
    "afterDelay": 200,
    "localPath": "/tmp/test_5m_file.bin",
    "remotePath": "/tmp/test_5m_file_uploaded.bin"
  },
  {
    "name": "记录上传结果",
    "action": "command",
    "afterDelay": 200,
    "command": "echo '[LOG] Upload complete at $(date)' >> /tmp/test_log.log"
  },
  {
    "name": "校验并清理",
    "action": "command",
    "command": "ls -la /tmp/test_5m_file_uploaded.bin >> /tmp/test_log.log 2>&1 && rm -f /tmp/test_5m_file*.bin && echo '[LOG] Cleaned up at $(date)' >> /tmp/test_log.log"
  }
]`

function getDefaultValue (widget) {
  const saved = safeGetItem(batchOpEditorKey)
  if (saved) return saved
  return workflowExample
}

export default function BatchOpEditor ({ widget }) {
  const [value, setValue] = useState(() => getDefaultValue(widget))
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    const v = getDefaultValue(widget)
    if (v) setValue(v)
  }, [widget?.id])

  useEffect(() => {
    safeSetItem(batchOpEditorKey, value)
  }, [value])

  const handleExecute = async () => {
    if (!value || executing) return
    setExecuting(true)
    const runner = refsStatic.get('batch-op-runner')
    runner?.reset()
    refsStatic.get('batch-op-logs')?.setLogs({ steps: [], currentIndex: 0, status: 'running' })
    try {
      let workflows
      try {
        workflows = JSON.parse(value)
        if (!Array.isArray(workflows)) throw new Error('任务流必须是数组')
      } catch (e) {
        message.error('任务 JSON 无效：' + e.message)
        refsStatic.get('batch-op-logs')?.reset()
        return
      }
      await runner.executeWorkflow(workflows)
      message.success('任务执行完成')
    } catch (err) {
      if (err.message !== 'Workflow aborted') {
        message.error('任务执行失败：' + err.message)
      }
    } finally {
      setExecuting(false)
    }
  }

  const handleTemplate = useCallback(() => {
    setValue(workflowExample)
  }, [])

  const handleEditWithSystemEditor = useCallback(async () => {
    const id = generate()
    const tempPath = window.pre.resolve(window.pre.tempDir, `electerm-batch-op-${id}.json`)
    await window.fs.writeFile(tempPath, value)
    window.pre.runGlobalAsync('watchFile', tempPath)
    window.fs.openFile(tempPath).catch(window.store.onError)
    window.pre.showItemInFolder(tempPath)
    const onFileChange = (e, text) => {
      setValue(text)
      window.pre.ipcOffEvent('file-change', onFileChange)
      window.fs.unlink(tempPath).catch(console.log)
    }
    window.pre.ipcOnEvent('file-change', onFileChange)
  }, [value])

  const handleEditWithCustom = useCallback(async (editorCommand) => {
    const id = generate()
    const tempPath = window.pre.resolve(window.pre.tempDir, `electerm-batch-op-${id}.json`)
    await window.fs.writeFile(tempPath, value)
    window.pre.runGlobalAsync('watchFile', tempPath)
    await window.pre.runGlobalAsync('openFileWithEditor', tempPath, editorCommand)
    const onFileChange = (e, text) => {
      setValue(text)
      window.pre.ipcOffEvent('file-change', onFileChange)
      window.fs.unlink(tempPath).catch(console.log)
    }
    window.pre.ipcOnEvent('file-change', onFileChange)
  }, [value])

  function handleChange (e) {
    setValue(e.target.value)
  }

  return (
    <div className='batch-op-editor'>
      <BatchOpAlert />
      <Flex className='mg2y' gap='small'>
        <Button onClick={handleTemplate} type='dashed'>
          载入模板
        </Button>
        <Button
          onClick={handleExecute}
          type='primary'
          loading={executing}
          disabled={executing}
          icon={<PlayCircleOutlined />}
        >
          执行任务
        </Button>
      </Flex>
      <SimpleEditor
        value={value}
        onChange={handleChange}
      />
      {!window.et.isWebApp && (
        <div className='pd1t pd2b'>
          <Button
            type='primary'
            className='mg1r mg1b'
            onClick={handleEditWithSystemEditor}
          >
            {window.translate('editWithSystemEditor')}
          </Button>
          <EditWithCustomEditor
            loading={executing}
            editWithCustom={handleEditWithCustom}
          />
        </div>
      )}
      <BatchOpLogs />
    </div>
  )
}
