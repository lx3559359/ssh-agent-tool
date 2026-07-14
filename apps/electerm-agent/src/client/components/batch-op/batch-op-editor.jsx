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
import {
  createWorkflowExample,
  formatBatchOpMessage
} from './batch-op-i18n.js'

const batchOpEditorKey = 'batch-op-editor-content'
function getDefaultValue (widget, translate) {
  const saved = safeGetItem(batchOpEditorKey)
  if (saved) return saved
  return createWorkflowExample(translate)
}

export default function BatchOpEditor ({ widget, languageVersion }) {
  const e = window.translate
  const [value, setValue] = useState(() => getDefaultValue(widget, e))
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    const v = getDefaultValue(widget, window.translate)
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
        if (!Array.isArray(workflows)) throw new Error(e('shellpilotBatchWorkflowArrayRequired'))
      } catch (err) {
        message.error(formatBatchOpMessage('shellpilotBatchInvalidJson', { detail: err.message }, e))
        refsStatic.get('batch-op-logs')?.reset()
        return
      }
      await runner.executeWorkflow(workflows)
      message.success(e('shellpilotBatchExecutionComplete'))
    } catch (err) {
      if (err.message !== 'Workflow aborted') {
        message.error(formatBatchOpMessage('shellpilotBatchExecutionFailed', { detail: err.message }, e))
      }
    } finally {
      setExecuting(false)
    }
  }

  const handleTemplate = useCallback(() => {
    setValue(createWorkflowExample(window.translate))
  }, [languageVersion])

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
    <div className='batch-op-editor' data-language-version={languageVersion}>
      <BatchOpAlert />
      <Flex className='mg2y' gap='small'>
        <Button onClick={handleTemplate} type='dashed'>
          {e('shellpilotBatchLoadTemplate')}
        </Button>
        <Button
          onClick={handleExecute}
          type='primary'
          loading={executing}
          disabled={executing}
          icon={<PlayCircleOutlined />}
        >
          {e('shellpilotBatchExecuteTask')}
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
      <BatchOpLogs languageVersion={languageVersion} />
    </div>
  )
}
