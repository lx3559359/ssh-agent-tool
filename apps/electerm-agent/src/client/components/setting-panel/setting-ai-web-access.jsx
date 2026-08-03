import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Popconfirm, Space, Table, Tag } from 'antd'
import message from '../common/message'
import SettingSection from './setting-section'
import './setting.styl'

const e = window.translate

function unwrapResult (result) {
  if (!result?.ok) {
    const error = new Error(
      result?.error?.message || e('shellpilotAiWebOperationFailed')
    )
    error.code = result?.error?.code
    throw error
  }
  return result.value
}

function formatGrantTime (value) {
  if (!value) return e('shellpilotAiWebNeverUsed')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function formatAddressClass (value) {
  return value === 'loopback'
    ? e('shellpilotAiWebClassLoopback')
    : e('shellpilotAiWebClassPrivate')
}

export default function SettingAiWebAccess () {
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [operation, setOperation] = useState('')
  const mountedRef = useRef(true)

  const loadGrants = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const value = unwrapResult(
        await window.pre.runGlobalAsync('listAIWebGrants')
      )
      if (mountedRef.current) {
        setGrants(Array.isArray(value) ? value : [])
      }
    } catch (error) {
      message.error(error?.message || e('shellpilotAiWebOperationFailed'))
    } finally {
      if (mountedRef.current && !quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    loadGrants()
    return () => {
      mountedRef.current = false
    }
  }, [loadGrants])

  async function runOperation (key, task, successKey, refresh = false) {
    if (operation) return
    setOperation(key)
    try {
      unwrapResult(await task())
      if (refresh) await loadGrants({ quiet: true })
      message.success(e(successKey))
    } catch (error) {
      message.error(error?.message || e('shellpilotAiWebOperationFailed'))
    } finally {
      if (mountedRef.current) setOperation('')
    }
  }

  function revokeGrant (origin) {
    return runOperation(
      `revoke:${origin}`,
      () => window.pre.runGlobalAsync('revokeAIWebGrant', { origin }),
      'shellpilotAiWebGrantRevoked',
      true
    )
  }

  function clearGrants () {
    return runOperation(
      'clear-grants',
      () => window.pre.runGlobalAsync('clearAIWebGrants'),
      'shellpilotAiWebGrantsCleared',
      true
    )
  }

  function clearSessionData () {
    return runOperation(
      'clear-session',
      () => window.pre.runGlobalAsync('clearAIWebSessionData'),
      'shellpilotAiWebSessionCleared'
    )
  }

  const columns = [
    {
      title: e('shellpilotAiWebAccessOrigin'),
      dataIndex: 'origin',
      key: 'origin',
      render: value => <code className='sp-ai-web-grant-origin'>{value}</code>
    },
    {
      title: e('shellpilotAiWebGrantClass'),
      dataIndex: 'addressClass',
      key: 'addressClass',
      render: value => <Tag>{formatAddressClass(value)}</Tag>
    },
    {
      title: e('shellpilotAiWebGrantCreatedAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatGrantTime
    },
    {
      title: e('shellpilotAiWebGrantLastUsedAt'),
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: formatGrantTime
    },
    {
      title: e('shellpilotAiWebGrantActions'),
      key: 'actions',
      render: (_, grant) => (
        <Popconfirm
          title={e('shellpilotAiWebRevokeConfirm')}
          onConfirm={() => revokeGrant(grant.origin)}
          okText={e('ok')}
          cancelText={e('cancel')}
        >
          <Button
            danger
            size='small'
            disabled={Boolean(operation)}
            loading={operation === `revoke:${grant.origin}`}
          >
            {e('shellpilotAiWebRevoke')}
          </Button>
        </Popconfirm>
      )
    }
  ]

  return (
    <div className='sp-settings-form sp-ai-web-access-settings'>
      <SettingSection
        title={e('shellpilotAiWebAccessSettings')}
        description={e('shellpilotAiWebAccessSettingsDescription')}
      >
        <Space wrap className='sp-ai-web-access-toolbar'>
          <Popconfirm
            title={e('shellpilotAiWebClearGrantsConfirm')}
            onConfirm={clearGrants}
            okText={e('ok')}
            cancelText={e('cancel')}
          >
            <Button
              danger
              disabled={Boolean(operation) || !grants.length}
              loading={operation === 'clear-grants'}
            >
              {e('shellpilotAiWebClearGrants')}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={e('shellpilotAiWebClearSessionConfirm')}
            onConfirm={clearSessionData}
            okText={e('ok')}
            cancelText={e('cancel')}
          >
            <Button
              disabled={Boolean(operation)}
              loading={operation === 'clear-session'}
            >
              {e('shellpilotAiWebClearSession')}
            </Button>
          </Popconfirm>
        </Space>
        <Table
          rowKey='origin'
          columns={columns}
          dataSource={grants}
          loading={loading}
          pagination={false}
          size='small'
          scroll={{ x: 760 }}
          locale={{
            emptyText: <Empty description={e('shellpilotAiWebNoGrants')} />
          }}
        />
      </SettingSection>
    </div>
  )
}
