import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import {
  CloudDownloadOutlined,
  DatabaseOutlined,
  ReloadOutlined
} from '@ant-design/icons'

const e = window.translate

function formatBytes (value) {
  const bytes = Number(value) || 0
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  return `${(bytes / (1024 ** exponent)).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}

function formatTime (value) {
  if (!value) return e('none')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export default function IncidentStorageModal ({ store }) {
  const [selectedBackup, setSelectedBackup] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const open = Boolean(store.incidentStorageOpen)
  const storage = store.incidentStorage
  const backups = (storage?.backups || []).slice(0, 5)
  const canRestore = confirmation === 'RESTORE'

  useEffect(() => {
    if (!open) return
    store.loadIncidentStorage()
  }, [open])

  const close = () => {
    store.incidentStorageOpen = false
    setSelectedBackup('')
    setConfirmation('')
  }

  const beginRestore = filename => {
    setSelectedBackup(filename)
    setConfirmation('')
  }

  const restore = async () => {
    if (confirmation !== 'RESTORE' || !selectedBackup) return
    const result = await store.restoreIncidentBackup(
      selectedBackup,
      confirmation
    )
    if (result) close()
  }

  return (
    <Modal
      width={680}
      open={open}
      title={e('shellpilotIncidentStorage')}
      footer={null}
      destroyOnHidden
      onCancel={close}
    >
      <div className='incident-storage-summary'>
        <div>
          <span>{e('shellpilotIncidentDatabaseSize')}</span>
          <strong>{formatBytes(storage?.databaseBytes)}</strong>
        </div>
        <div>
          <span>{e('shellpilotIncidentWalSize')}</span>
          <strong>{formatBytes(storage?.walBytes)}</strong>
        </div>
        <div>
          <span>{e('shellpilotIncidentBackupSize')}</span>
          <strong>{formatBytes(storage?.backupBytes)}</strong>
        </div>
        <div>
          <span>{e('shellpilotIncidentBackupCount')}</span>
          <strong>{storage?.backupCount || 0}</strong>
        </div>
      </div>

      <div className='incident-storage-toolbar'>
        <span>
          {e('shellpilotIncidentLatestBackup')}：
          {formatTime(storage?.latestBackupAt)}
        </span>
        <Button
          icon={<DatabaseOutlined />}
          loading={store.incidentSaving}
          onClick={() => store.createIncidentBackup()}
        >
          {e('shellpilotIncidentBackupNow')}
        </Button>
      </div>

      <div className='incident-backup-list'>
        {backups.length
          ? backups.map(backup => (
            <div key={backup.filename} className='incident-backup-row'>
              <span>
                <strong>{backup.filename}</strong>
                <small>
                  {formatTime(backup.createdAt)} · {formatBytes(backup.bytes)}
                </small>
              </span>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={() => beginRestore(backup.filename)}
              >
                {e('shellpilotIncidentRestore')}
              </Button>
            </div>
          ))
          : (
            <div className='incident-storage-empty'>
              {e('shellpilotIncidentNoBackups')}
            </div>
            )}
      </div>

      {selectedBackup && (
        <div className='incident-restore-confirmation'>
          <Alert
            type='warning'
            showIcon
            message={e('shellpilotIncidentRestoreWarning')}
            description={selectedBackup}
          />
          <label>
            <span>{e('shellpilotIncidentRestoreConfirmation')}</span>
            <Input
              value={confirmation}
              placeholder={e('shellpilotIncidentRestoreToken')}
              onChange={event => setConfirmation(event.target.value)}
            />
          </label>
          <div>
            <Button
              icon={<ReloadOutlined />}
              danger
              disabled={!canRestore}
              loading={store.incidentSaving}
              onClick={restore}
            >
              {e('shellpilotIncidentConfirmRestore')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
