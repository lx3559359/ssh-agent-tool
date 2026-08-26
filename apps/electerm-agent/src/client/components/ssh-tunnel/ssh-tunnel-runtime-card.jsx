import { Button, Space, Tag } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  HistoryOutlined,
  LinkOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons'
import { copy } from '../../common/clipboard'
import { getTunnelFlowText } from './ssh-tunnel-definition.js'
import { getTunnelDiagnostic } from './ssh-tunnel-diagnostics.js'
import { getTunnelUsage } from './ssh-tunnel-usage.js'

const e = window.translate
const failureStates = new Set(['failed', 'port-conflict', 'session-lost'])

const statusPresentation = {
  passed: { icon: <CheckCircleOutlined />, label: 'shellpilotTunnelStagePassed' },
  limited: { icon: <ExclamationCircleOutlined />, label: 'shellpilotTunnelStageLimited' },
  failed: { icon: <CloseCircleOutlined />, label: 'shellpilotTunnelStageFailed' },
  unverified: { icon: <QuestionCircleOutlined />, label: 'shellpilotTunnelStageUnverified' },
  checking: { icon: <LoadingOutlined spin />, label: 'shellpilotTunnelStageChecking' }
}

function latestRuntimeFailure (entry = {}) {
  if (entry.latestFailure && typeof entry.latestFailure === 'object') {
    return entry.latestFailure
  }
  const history = [
    ...(Array.isArray(entry.events) ? entry.events : []),
    ...(Array.isArray(entry.history) ? entry.history : [])
  ]
  return history
    .filter(item => item && typeof item === 'object' && failureStates.has(item.state))
    .sort((left, right) => Number(right.at || 0) - Number(left.at || 0))[0] || null
}

function tunnelAvailability (entry) {
  if (failureStates.has(entry?.state)) return 'failed'
  if (entry?.testState === 'checking' || entry?.testState === 'testing') return 'checking'
  return entry?.lastTest?.verdict || 'unverified'
}

function tunnelName (entry) {
  return entry?.definition?.name || e('shellpilotTopbarSshTunnel')
}

function copyButton (text, label) {
  return (
    <Button
      size='small'
      icon={<CopyOutlined />}
      aria-label={label}
      disabled={!text}
      onClick={() => text && copy(text)}
    >
      {label}
    </Button>
  )
}

function AccessPanel ({ usage, onOpenGuide }) {
  const hasEndpoint = Boolean(usage.endpoint)
  const canOpenWeb = usage.canOpen === true && Boolean(usage.url)

  if (!hasEndpoint) {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--invalid'>
        <span>{e('shellpilotTunnelAccessTitle')}</span>
        <strong>{e('shellpilotTunnelAccessUnavailable')}</strong>
        <p>{e('shellpilotTunnelAccessUnavailableHint')}</p>
      </section>
    )
  }

  if (usage.kind === 'web') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--web'>
        <span>{e('shellpilotTunnelAccessTitle')}</span>
        <strong>{usage.endpoint}</strong>
        <code>{usage.url}</code>
        <p>{e('shellpilotTunnelGuideNoBrowserProxy')}</p>
        <Space wrap>
          <Button
            type='primary'
            size='small'
            icon={<LinkOutlined />}
            disabled={!canOpenWeb}
            onClick={() => {
              if (
                usage.canOpen === true && usage.url &&
                typeof window?.openLink === 'function'
              ) {
                window.openLink(usage.url)
              }
            }}
          >
            {e('shellpilotTunnelOpenInBrowser')}
          </Button>
          <Button
            size='small'
            icon={<CopyOutlined />}
            aria-label={e('shellpilotTunnelCopyEndpoint')}
            disabled={!usage.endpoint}
            onClick={() => usage.endpoint && copy(usage.endpoint)}
          >
            {e('shellpilotTunnelCopyEndpoint')}
          </Button>
          <Button
            size='small'
            icon={<CopyOutlined />}
            aria-label={e('shellpilotTunnelCopyUrl')}
            disabled={!usage.url}
            onClick={() => usage.url && copy(usage.url)}
          >
            {e('shellpilotTunnelCopyUrl')}
          </Button>
        </Space>
      </section>
    )
  }

  if (usage.kind === 'proxy') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--proxy'>
        <span>{e('shellpilotTunnelAccessTitle')}</span>
        <strong>SOCKS5 {usage.endpoint}</strong>
        <p>{e('shellpilotTunnelSocksRequiresAppProxy')}</p>
        <p>{e('shellpilotTunnelGuideSocksNoSystemProxy')}</p>
        <Space wrap>
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyProxyAddress'))}
          <Button
            size='small'
            icon={<ReadOutlined />}
            onClick={() => onOpenGuide?.('socks-browser')}
          >
            {e('shellpilotTunnelGuideSocksBrowser')}
          </Button>
        </Space>
      </section>
    )
  }

  if (usage.kind === 'database') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--database'>
        <span>{e('shellpilotTunnelDatabaseAccessTitle')}</span>
        <dl className='ssh-tunnel-access-fields'>
          <div><dt>{e('shellpilotTunnelAccessHost')}</dt><dd><code>{usage.host}</code></dd></div>
          <div><dt>{e('shellpilotTunnelAccessPort')}</dt><dd><code>{usage.port}</code></dd></div>
        </dl>
        <Space wrap>
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyEndpoint'))}
          <Button size='small' icon={<ReadOutlined />} onClick={() => onOpenGuide?.('how-to-access')}>
            {e('shellpilotTunnelGuideHowToAccess')}
          </Button>
        </Space>
      </section>
    )
  }

  if (usage.kind === 'remote') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--remote'>
        <span>{e('shellpilotTunnelRemoteAccessTitle')}</span>
        <strong>{usage.endpoint}</strong>
        <p>{e('shellpilotTunnelRemoteAccessFromServer')}</p>
        <Space wrap>
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyEndpoint'))}
          <Button size='small' icon={<ReadOutlined />} onClick={() => onOpenGuide?.('remote-safety')}>
            {e('shellpilotTunnelGuideRemoteSafety')}
          </Button>
        </Space>
      </section>
    )
  }

  return (
    <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--tcp'>
      <span>{e('shellpilotTunnelTcpAccessTitle')}</span>
      <strong>{usage.endpoint}</strong>
      <p>{e('shellpilotTunnelTcpAccessHint')}</p>
      {copyButton(usage.endpoint, e('shellpilotTunnelCopyEndpoint'))}
    </section>
  )
}

function StageGrid ({ stages }) {
  if (!stages.length) {
    return <p className='ssh-tunnel-stage-empty'>{e('shellpilotTunnelStagesNotTested')}</p>
  }
  return (
    <div className='ssh-tunnel-stage-grid'>
      {
        stages.map(stage => {
          const presentation = statusPresentation[stage.status] || statusPresentation.unverified
          const stageStatus = statusPresentation[stage.status] ? stage.status : 'unverified'
          return (
            <div
              className={`ssh-tunnel-stage ssh-tunnel-stage--${stageStatus}`}
              data-stage={stage.id}
              key={stage.id}
            >
              <span className='ssh-tunnel-stage-status'>
                <span aria-hidden='true'>{presentation.icon}</span>
                <strong>{e(presentation.label)}</strong>
              </span>
              <span>{stage.message || e('shellpilotTunnelStageNoDetail')}</span>
            </div>
          )
        })
      }
    </div>
  )
}

function DiagnosticPanel ({ diagnostic, onOpenGuide }) {
  if (!diagnostic) return null
  return (
    <section className={`ssh-tunnel-diagnostic ssh-tunnel-diagnostic--${diagnostic.severity}`}>
      <span>{e('shellpilotTunnelFailureNextStep')}</span>
      <strong>{e(diagnostic.titleKey)}</strong>
      <p>{e(diagnostic.summaryKey)}</p>
      {
        Array.isArray(diagnostic.steps) && diagnostic.steps.length
          ? (
            <ol>
              {diagnostic.steps.map((step, index) => <li key={`${step.key}-${index}`}>{e(step.key)}</li>)}
            </ol>
            )
          : null
      }
      {
        diagnostic.checksText || diagnostic.configExample
          ? (
            <div className='ssh-tunnel-diagnostic-split'>
              {
                diagnostic.checksText
                  ? (
                    <div className='ssh-tunnel-diagnostic-checks'>
                      <header>
                        <strong>{e('shellpilotTunnelDiagnosticChecks')}</strong>
                        <Button
                          type='text'
                          size='small'
                          icon={<CopyOutlined />}
                          aria-label={e('shellpilotTunnelCopyDiagnosticChecks')}
                          onClick={() => copy(diagnostic.checksText)}
                        />
                      </header>
                      <pre><code>{diagnostic.checksText}</code></pre>
                    </div>
                    )
                  : null
              }
              {
                diagnostic.configExample
                  ? (
                    <div className='ssh-tunnel-diagnostic-config'>
                      <header>
                        <strong>{e('shellpilotTunnelDiagnosticConfig')}</strong>
                        <Button
                          type='text'
                          size='small'
                          icon={<CopyOutlined />}
                          aria-label={e('shellpilotTunnelCopyDiagnosticConfig')}
                          onClick={() => copy(diagnostic.configExample)}
                        />
                      </header>
                      <pre><code>{diagnostic.configExample}</code></pre>
                    </div>
                    )
                  : null
              }
            </div>
            )
          : null
      }
      <Button size='small' icon={<ReadOutlined />} onClick={() => onOpenGuide?.(diagnostic.helpSection)}>
        {e('shellpilotTunnelOpenFixGuide')}
      </Button>
      <code className='ssh-tunnel-diagnostic-code'>{diagnostic.code}</code>
    </section>
  )
}

export default function SshTunnelRuntimeCard ({
  entry,
  busy,
  onTest,
  onEdit,
  onEditAndRestart,
  onStop,
  onOpenGuide,
  onShowHistory
}) {
  const usage = getTunnelUsage(entry?.definition || {})
  const latestFailure = latestRuntimeFailure(entry)
  const diagnostic = latestFailure
    ? getTunnelDiagnostic(latestFailure, entry?.definition)
    : null
  const availability = tunnelAvailability(entry)
  const availabilityPresentation = statusPresentation[availability] || statusPresentation.unverified
  const stages = Array.isArray(entry?.lastTest?.stages) ? entry.lastTest.stages : []
  const loading = busy === true || busy === entry?.id

  return (
    <article className={`ssh-tunnel-running-card ssh-tunnel-runtime-card ssh-tunnel-runtime-card--${availability}`}>
      <header className='ssh-tunnel-runtime-card-header'>
        <div>
          <strong>{tunnelName(entry)}</strong>
          <span>{getTunnelFlowText(entry?.definition || {})}</span>
        </div>
        <Tag
          icon={availabilityPresentation.icon}
          className={`ssh-tunnel-availability ssh-tunnel-availability--${availability}`}
          aria-label={e(availabilityPresentation.label)}
        >
          {e(availabilityPresentation.label)}
        </Tag>
      </header>

      <AccessPanel usage={usage} onOpenGuide={onOpenGuide} />
      <StageGrid stages={stages} />
      <DiagnosticPanel diagnostic={diagnostic} onOpenGuide={onOpenGuide} />

      <div className='ssh-tunnel-runtime-card-actions'>
        <Button size='small' icon={<ReloadOutlined />} loading={loading} onClick={() => onTest?.(entry?.id)}>
          {e('shellpilotTunnelTest')}
        </Button>
        <Button size='small' icon={<EditOutlined />} onClick={() => onEdit?.(entry)}>
          {e('shellpilotTunnelEdit')}
        </Button>
        <Button size='small' onClick={() => onEditAndRestart?.(entry)}>
          {e('shellpilotTunnelEditAndRestart')}
        </Button>
        <Button size='small' icon={<HistoryOutlined />} onClick={() => onShowHistory?.(entry)}>
          {e('shellpilotTunnelDisconnectHistory')}
        </Button>
        <Button size='small' danger icon={<StopOutlined />} loading={loading} onClick={() => onStop?.(entry?.id)}>
          {e('shellpilotTunnelStop')}
        </Button>
      </div>
    </article>
  )
}
