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
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import { getTunnelFlowText } from './ssh-tunnel-definition.js'
import { getTunnelDiagnostic } from './ssh-tunnel-diagnostics.js'
import { getTunnelUsage } from './ssh-tunnel-usage.js'

const e = window.translate
const failureStates = new Set(['failed', 'port-conflict', 'session-lost'])

const stagePresentation = {
  passed: { icon: <CheckCircleOutlined />, label: 'shellpilotTunnelStagePassed' },
  limited: { icon: <ExclamationCircleOutlined />, label: 'shellpilotTunnelStageLimited' },
  failed: { icon: <CloseCircleOutlined />, label: 'shellpilotTunnelStageFailed' },
  unverified: { icon: <QuestionCircleOutlined />, label: 'shellpilotTunnelStageUnverified' }
}

const availabilityPresentation = {
  passed: { icon: <CheckCircleOutlined />, label: 'shellpilotTunnelAvailabilityPassed' },
  checking: { icon: <LoadingOutlined spin />, label: 'shellpilotTunnelAvailabilityChecking' },
  limited: { icon: <ExclamationCircleOutlined />, label: 'shellpilotTunnelAvailabilityLimited' },
  failed: { icon: <CloseCircleOutlined />, label: 'shellpilotTunnelAvailabilityFailed' },
  unverified: { icon: <QuestionCircleOutlined />, label: 'shellpilotTunnelAvailabilityUnverified' }
}

const diagnosticValueKeyByToken = {
  'global-baseline': 'sshTunnel.diagnostic.value.globalBaseline',
  'local-listener': 'sshTunnel.diagnostic.value.localListener',
  'ssh-forwarding': 'sshTunnel.diagnostic.value.sshForwarding',
  'target-service': 'sshTunnel.diagnostic.value.targetService',
  proxy: 'sshTunnel.diagnostic.value.proxy',
  unknown: 'sshTunnel.diagnostic.value.unknown',
  'local-host': 'sshTunnel.diagnostic.value.localHost',
  'local-port': 'sshTunnel.diagnostic.value.localPort',
  'remote-host': 'sshTunnel.diagnostic.value.remoteHost',
  'remote-port': 'sshTunnel.diagnostic.value.remotePort'
}

export function localizedDiagnosticValues (values = {}, translate = e) {
  const separatorKey = 'sshTunnel.diagnostic.value.listSeparator'
  const translatedSeparator = translate(separatorKey)
  const separator = translatedSeparator && translatedSeparator !== separatorKey
    ? translatedSeparator
    : ', '
  const localize = (name, value) => {
    const shouldTranslate = name === 'scope' || name === 'layer' || name === 'fields'
    if (Array.isArray(value)) {
      return value.map(item => localize(name, item)).join(separator)
    }
    const key = shouldTranslate && typeof value === 'string'
      ? diagnosticValueKeyByToken[value]
      : undefined
    if (!key) return value
    const translated = translate(key)
    return translated && translated !== key ? translated : value
  }
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, localize(name, value)])
  )
}

export function availabilityFor (entry = {}) {
  if (failureStates.has(entry?.state)) return 'failed'
  if (entry?.testState === 'checking' || entry?.testState === 'testing') return 'checking'
  return entry?.lastTest?.verdict || 'unverified'
}

export function currentFailureFor (entry = {}) {
  const availability = availabilityFor(entry)
  if (availability !== 'limited' && availability !== 'failed') return null

  const lastTest = entry?.lastTest && typeof entry.lastTest === 'object'
    ? entry.lastTest
    : null
  if (Array.isArray(lastTest?.stages)) {
    const decisiveStatuses = [lastTest.verdict, availability]
      .filter((status, index, statuses) => {
        return (
          (status === 'limited' || status === 'failed') &&
          statuses.indexOf(status) === index
        )
      })
    const decisiveStage = decisiveStatuses
      .map(status => lastTest.stages.find(stage => {
        return stage && typeof stage === 'object' && stage.status === status
      }))
      .find(Boolean)
    if (decisiveStage) {
      return {
        code: decisiveStage.code,
        message: decisiveStage.message,
        stage: decisiveStage.id
      }
    }
  }

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

export function guideSectionFor (usage = {}, diagnostic = null) {
  if (diagnostic?.helpSection) return diagnostic.helpSection
  if (usage.kind === 'proxy') return 'socks-browser'
  if (usage.kind === 'remote') return 'remote-safety'
  return 'how-to-access'
}

export function guideRequestFor (usage = {}, diagnostic = null, definition = {}) {
  return {
    section: guideSectionFor(usage, diagnostic),
    context: {
      definition,
      errorCode: diagnostic?.code,
      helpSection: diagnostic?.helpSection,
      tunnelType: definition?.sshTunnel || definition?.type
    }
  }
}

export function openGuide (onOpenGuide, request = {}) {
  if (typeof onOpenGuide !== 'function') return
  onOpenGuide(request.section, request.context)
}

export function canOpenWebFor (usage = {}, runtimeWindow) {
  return Boolean(
    usage.canOpen === true && usage.url &&
    typeof runtimeWindow?.openLink === 'function'
  )
}

export function canCopyFor (text, runtimeWindow) {
  return Boolean(text) && typeof runtimeWindow?.pre?.writeClipboard === 'function'
}

export async function copyTextSafely (text, runtimeWindow, copyFunction) {
  if (!canCopyFor(text, runtimeWindow) || typeof copyFunction !== 'function') {
    return false
  }
  try {
    await copyFunction(text)
    return true
  } catch {
    return false
  }
}

function tunnelName (entry) {
  return entry?.definition?.name || e('shellpilotTopbarSshTunnel')
}

function copyButton (text, label) {
  const runtimeWindow = typeof window === 'undefined' ? null : window
  const canCopy = canCopyFor(text, runtimeWindow)
  return (
    <Button
      size='small'
      icon={<CopyOutlined />}
      aria-label={label}
      disabled={!canCopy}
      onClick={() => {
        copyTextSafely(text, runtimeWindow, copy)
      }}
    >
      {label}
    </Button>
  )
}

function AccessPanel ({ usage, definition, onOpenGuide }) {
  const hasEndpoint = Boolean(usage.endpoint)
  const runtimeWindow = typeof window === 'undefined' ? null : window
  const canOpenWeb = canOpenWebFor(usage, runtimeWindow)

  if (!hasEndpoint) {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--invalid'>
        <span>{e('shellpilotTunnelHowToUse')}</span>
        <strong>{e('shellpilotTunnelAccessUnavailable')}</strong>
        <p>{e('shellpilotTunnelAccessUnavailableHint')}</p>
      </section>
    )
  }

  if (usage.kind === 'web') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--web'>
        <span>{e('shellpilotTunnelHowToUse')}</span>
        <strong>{usage.endpoint}</strong>
        <code>{usage.url}</code>
        <p>{e('shellpilotTunnelNoBrowserProxy')}</p>
        <Space wrap>
          <Button
            type='primary'
            size='small'
            icon={<LinkOutlined />}
            disabled={!canOpenWeb}
            onClick={() => {
              if (canOpenWeb) runtimeWindow.openLink(usage.url)
            }}
          >
            {e('shellpilotTunnelOpenBrowser')}
          </Button>
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyAddress'))}
          {copyButton(usage.url, e('shellpilotTunnelCopyUrl'))}
        </Space>
      </section>
    )
  }

  if (usage.kind === 'proxy') {
    return (
      <section className='ssh-tunnel-access-panel ssh-tunnel-access-panel--proxy'>
        <span>{e('shellpilotTunnelHowToUse')}</span>
        <strong>SOCKS5 {usage.endpoint}</strong>
        <p>{e('shellpilotTunnelNeedsSocksProxy')}</p>
        <p>{e('shellpilotTunnelGuideSocksNoSystemProxy')}</p>
        <Space wrap>
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyProxyAddress'))}
          <Button
            size='small'
            icon={<ReadOutlined />}
            onClick={() => openGuide(onOpenGuide, guideRequestFor(usage, null, definition))}
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
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyAddress'))}
          <Button size='small' icon={<ReadOutlined />} onClick={() => openGuide(onOpenGuide, guideRequestFor(usage, null, definition))}>
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
          {copyButton(usage.endpoint, e('shellpilotTunnelCopyAddress'))}
          <Button size='small' icon={<ReadOutlined />} onClick={() => openGuide(onOpenGuide, guideRequestFor(usage, null, definition))}>
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
      {copyButton(usage.endpoint, e('shellpilotTunnelCopyAddress'))}
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
          const presentation = stagePresentation[stage.status] || stagePresentation.unverified
          const stageStatus = stagePresentation[stage.status] ? stage.status : 'unverified'
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

function DiagnosticPanel ({ diagnostic, definition, onOpenGuide }) {
  if (!diagnostic) return null
  const runtimeWindow = typeof window === 'undefined' ? null : window
  return (
    <section className={`ssh-tunnel-diagnostic ssh-tunnel-diagnostic--${diagnostic.severity}`}>
      <span>{e('shellpilotTunnelFailureNextStep')}</span>
      <strong>{e(diagnostic.titleKey)}</strong>
      <p>{e(diagnostic.summaryKey)}</p>
      {
        Array.isArray(diagnostic.steps) && diagnostic.steps.length
          ? (
            <ol>
              {diagnostic.steps.map((step, index) => (
                <li key={`${step.key}-${index}`}>
                  {formatShellPilotTranslation(e, step.key, localizedDiagnosticValues(step.values))}
                </li>
              ))}
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
                          aria-label={e('shellpilotTunnelCopyChecks')}
                          disabled={!canCopyFor(diagnostic.checksText, runtimeWindow)}
                          onClick={() => {
                            copyTextSafely(diagnostic.checksText, runtimeWindow, copy)
                          }}
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
                          disabled={!canCopyFor(diagnostic.configExample, runtimeWindow)}
                          onClick={() => {
                            copyTextSafely(diagnostic.configExample, runtimeWindow, copy)
                          }}
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
      <Button
        size='small'
        icon={<ReadOutlined />}
        onClick={() => openGuide(onOpenGuide, guideRequestFor({}, diagnostic, definition))}
      >
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
  const currentFailure = currentFailureFor(entry)
  const diagnostic = currentFailure
    ? getTunnelDiagnostic(currentFailure, entry?.definition)
    : null
  const availability = availabilityFor(entry)
  const presentation = availabilityPresentation[availability] || availabilityPresentation.unverified
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
          icon={presentation.icon}
          className={`ssh-tunnel-availability ssh-tunnel-availability--${availability}`}
          aria-label={e(presentation.label)}
        >
          {e(presentation.label)}
        </Tag>
      </header>

      <AccessPanel usage={usage} definition={entry?.definition} onOpenGuide={onOpenGuide} />
      <StageGrid stages={stages} />
      <DiagnosticPanel diagnostic={diagnostic} definition={entry?.definition} onOpenGuide={onOpenGuide} />

      <div className='ssh-tunnel-runtime-card-actions'>
        <Button
          size='small'
          icon={<ReadOutlined />}
          className='ssh-tunnel-runtime-guide-button'
          onClick={() => openGuide(onOpenGuide, guideRequestFor(usage, diagnostic, entry?.definition))}
        >
          {e('shellpilotTunnelFullGuide')}
        </Button>
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
