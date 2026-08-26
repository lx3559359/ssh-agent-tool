import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'
import { getTunnelGuideData } from './ssh-tunnel-usage.js'

const e = window.translate

export const guideSections = [
  { id: 'choose-type', labelKey: 'shellpilotTunnelGuideChooseType' },
  { id: 'local-forward', labelKey: 'shellpilotTunnelGuideLocalScenario' },
  { id: 'how-to-access', labelKey: 'shellpilotTunnelGuideHowToAccess' },
  { id: 'socks-browser', labelKey: 'shellpilotTunnelGuideSocksBrowser' },
  { id: 'remote-safety', labelKey: 'shellpilotTunnelGuideRemoteSafety' },
  { id: 'errors', labelKey: 'shellpilotTunnelGuideErrors' },
  { id: 'glossary', labelKey: 'shellpilotTunnelGuideGlossary' }
]

const sectionIds = new Set(guideSections.map(item => item.id))
const errorFocusByHelpSection = {
  'forwarding-prohibited': 'forwarding-prohibited',
  'destination-refused': 'destination-refused',
  'local-port-in-use': 'port-conflict',
  'port-conflict': 'port-conflict',
  'test-timeout': 'timeout',
  timeout: 'timeout',
  unknown: 'unknown'
}
const errorFocusByCode = {
  SSH_TUNNEL_FORWARDING_PROHIBITED: 'forwarding-prohibited',
  SSH_TUNNEL_DESTINATION_REFUSED: 'destination-refused',
  SSH_TUNNEL_PORT_IN_USE: 'port-conflict',
  EADDRINUSE: 'port-conflict',
  SSH_TUNNEL_TEST_TIMEOUT: 'timeout',
  SSH_TUNNEL_UNKNOWN: 'unknown'
}
const errorHelpSections = new Set([
  ...Object.keys(errorFocusByHelpSection)
])

export function normalizeSection (section) {
  if (sectionIds.has(section)) return section
  return errorHelpSections.has(section) ? 'errors' : 'choose-type'
}

export function focusErrorFor (requestedSection, context = {}) {
  return (
    errorFocusByHelpSection[requestedSection] ||
    errorFocusByHelpSection[context?.helpSection] ||
    errorFocusByCode[context?.errorCode] ||
    null
  )
}

export function currentTunnelTypeFor (context = {}) {
  return (
    context?.tunnelType ||
    context?.definition?.sshTunnel ||
    context?.definition?.type ||
    ''
  )
}

function GuideContent ({ section, context, focusError }) {
  const currentTunnelType = currentTunnelTypeFor(context)
  const guideData = getTunnelGuideData(context)
  if (section === 'local-forward') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <span className='ssh-tunnel-guide-kicker'>{e('shellpilotTunnelGuideLocalScenario')}</span>
        <h3>{e('shellpilotTunnelGuideLocalTitle')}</h3>
        <code className='ssh-tunnel-guide-flow'>127.0.0.1:16060 → SSH → server 127.0.0.1:6060</code>
        <ol>
          <li>{e('shellpilotTunnelGuideLocalListenHost')}</li>
          <li>{e('shellpilotTunnelGuideLocalListenPort')}</li>
          <li>{e('shellpilotTunnelGuideRemoteTargetHost')}</li>
          <li>{e('shellpilotTunnelGuideRemoteTargetPort')}</li>
          <li>{e('shellpilotTunnelGuideStartAndWait')}</li>
        </ol>
      </section>
    )
  }

  if (section === 'how-to-access') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <h3>{e('shellpilotTunnelGuideHowToAccess')}</h3>
        <p>{e('shellpilotTunnelGuideNoBrowserProxy')}</p>
        <div className='ssh-tunnel-guide-topic-grid ssh-tunnel-guide-web-profiles'>
          <article>
            <strong>{e('shellpilotTunnelGuideHttpProfile')}</strong>
            <code>http://127.0.0.1:16060</code>
          </article>
          <article>
            <strong>{e('shellpilotTunnelGuideHttpsProfile')}</strong>
            <code>https://127.0.0.1:16060</code>
          </article>
        </div>
        <h4>{e('shellpilotTunnelGuideDatabaseAccess')}</h4>
        <p>{e('shellpilotTunnelGuideDatabaseHostPort')}</p>
        <dl className='ssh-tunnel-guide-profile-list'>
          <div><dt>{e('shellpilotTunnelGuideMySqlProfile')}</dt><dd><code>host: 127.0.0.1, port: 16060</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuidePostgreSqlProfile')}</dt><dd><code>host: 127.0.0.1, port: 16060</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideRedisProfile')}</dt><dd><code>host: 127.0.0.1, port: 16060</code></dd></div>
        </dl>
      </section>
    )
  }

  if (section === 'socks-browser') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <h3>{e('shellpilotTunnelGuideSocksBrowser')}</h3>
        {
          guideData.socks.isExample
            ? <p className='ssh-tunnel-guide-context'>{e('shellpilotTunnelGuideExampleValues')}</p>
            : null
        }
        <code className='ssh-tunnel-guide-flow'>
          {formatShellPilotTranslation(e, 'shellpilotTunnelGuideSocksFlow', { endpoint: guideData.socks.endpoint })}
        </code>
        <dl className='ssh-tunnel-guide-profile-list'>
          <div><dt>{e('shellpilotTunnelGuideSocksLocalHost')}</dt><dd><code>{guideData.socks.bindHost}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideSocksLocalPort')}</dt><dd><code>{guideData.socks.bindPort}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideSocksConnectAddress')}</dt><dd><code>{guideData.socks.endpoint}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideSocksNoRemoteTarget')}</dt><dd>{e('shellpilotTunnelGuideSocksNoRemoteTargetValue')}</dd></div>
        </dl>
        {
          guideData.socks.usesWildcardBind
            ? <p>{e('shellpilotTunnelSocksWildcardExposureHint')}</p>
            : null
        }
        <ol>
          <li>{e('shellpilotTunnelGuideSocksStartProof')}</li>
          <li>
            {formatShellPilotTranslation(e, 'shellpilotTunnelGuideSocksConfigureApps', {
              host: guideData.socks.host,
              port: guideData.socks.port
            })}
          </li>
          <li>{e('shellpilotTunnelGuideSocksFirstFailure')}</li>
        </ol>
        <div className='ssh-tunnel-guide-topic-grid'>
          <article>
            <strong>{e('shellpilotTunnelGuideFirefox')}</strong>
            <p>
              {formatShellPilotTranslation(e, 'shellpilotTunnelGuideFirefoxSteps', {
                host: guideData.socks.host,
                port: guideData.socks.port
              })}
            </p>
          </article>
          <article>
            <strong>{e('shellpilotTunnelGuideChromium')}</strong>
            <p>{e('shellpilotTunnelGuideChromiumSteps')}</p>
            <strong>{e('shellpilotTunnelGuideChromeCommand')}</strong>
            <code>{guideData.socks.chromeCommand}</code>
            <strong>{e('shellpilotTunnelGuideEdgeCommand')}</strong>
            <code>{guideData.socks.edgeCommand}</code>
          </article>
          <article>
            <strong>{e('shellpilotTunnelGuideOtherApps')}</strong>
            <p>
              {formatShellPilotTranslation(e, 'shellpilotTunnelGuideOtherAppsSteps', {
                host: guideData.socks.host,
                port: guideData.socks.port
              })}
            </p>
          </article>
        </div>
        <div className='ssh-tunnel-guide-callout ssh-tunnel-guide-callout--warning'>
          <strong>{e('shellpilotTunnelGuideProxyDns')}</strong>
          <p>{e('shellpilotTunnelGuideSocksNoSystemProxy')}</p>
        </div>
      </section>
    )
  }

  if (section === 'remote-safety') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <h3>{e('shellpilotTunnelGuideRemoteSafety')}</h3>
        <p>{e('shellpilotTunnelGuideRemoteAccessMeaning')}</p>
        {
          guideData.remote.isExample
            ? <p className='ssh-tunnel-guide-context'>{e('shellpilotTunnelGuideExampleValues')}</p>
            : null
        }
        <dl className='ssh-tunnel-guide-profile-list'>
          <div><dt>{e('shellpilotTunnelGuideRemoteServerHost')}</dt><dd><code>{guideData.remote.bindHost}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideRemoteServerPort')}</dt><dd><code>{guideData.remote.bindPort}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideRemoteClientTargetHost')}</dt><dd><code>{guideData.remote.targetHost}</code></dd></div>
          <div><dt>{e('shellpilotTunnelGuideRemoteClientTargetPort')}</dt><dd><code>{guideData.remote.targetPort}</code></dd></div>
        </dl>
        <p>
          {formatShellPilotTranslation(e, 'shellpilotTunnelGuideRemoteFlow', {
            bindEndpoint: guideData.remote.bindEndpoint,
            targetEndpoint: guideData.remote.targetEndpoint
          })}
        </p>
        <p>{e('shellpilotTunnelRemoteServerLocalAddress')}: <code>{guideData.remote.endpoint}</code></p>
        {
          guideData.remote.requiresServerAddressForExternalAccess
            ? <p>{e('shellpilotTunnelRemoteWildcardExternalHint')}</p>
            : null
        }
        <ol>
          <li>{e('shellpilotTunnelGuideRemoteStartProof')}</li>
          <li>{e('shellpilotTunnelGuideRemoteExternalAccess')}</li>
          <li>{e('shellpilotTunnelGuideRemoteFirstFailure')}</li>
        </ol>
        <ul>
          <li>{e('shellpilotTunnelGuideGatewayPorts')}</li>
          <li>{e('shellpilotTunnelGuideRemoteFirewall')}</li>
          <li>{e('shellpilotTunnelGuideRemoteAuthentication')}</li>
          <li>{e('shellpilotTunnelGuideRemoteLoopbackFirst')}</li>
        </ul>
      </section>
    )
  }

  if (section === 'errors') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <h3>{e('shellpilotTunnelGuideErrors')}</h3>
        {context?.errorCode ? <code className='ssh-tunnel-guide-context-code'>{String(context.errorCode)}</code> : null}
        <dl className='ssh-tunnel-guide-error-list'>
          <div data-error='port-conflict' className={focusError === 'port-conflict' ? 'active' : ''}>
            <dt>{e('shellpilotTunnelGuideErrorPortInUse')}</dt><dd>{e('shellpilotTunnelGuideErrorPortInUseFix')}</dd>
          </div>
          <div data-error='forwarding-prohibited' className={focusError === 'forwarding-prohibited' ? 'active' : ''}>
            <dt>{e('shellpilotTunnelGuideErrorProhibited')}</dt><dd>{e('shellpilotTunnelGuideErrorProhibitedFix')}</dd>
          </div>
          <div data-error='destination-refused' className={focusError === 'destination-refused' ? 'active' : ''}>
            <dt>{e('shellpilotTunnelGuideErrorRefused')}</dt><dd>{e('shellpilotTunnelGuideErrorRefusedFix')}</dd>
          </div>
          <div data-error='timeout' className={focusError === 'timeout' ? 'active' : ''}>
            <dt>{e('shellpilotTunnelGuideErrorTimeout')}</dt><dd>{e('shellpilotTunnelGuideErrorTimeoutFix')}</dd>
          </div>
          <div data-error='unknown' className={focusError === 'unknown' ? 'active' : ''}>
            <dt>{e('shellpilotTunnelGuideErrorUnknown')}</dt>
            <dd>
              <p>{e('shellpilotTunnelGuideErrorUnknownCause')}</p>
              <p>{e('shellpilotTunnelGuideErrorUnknownFix')}</p>
            </dd>
          </div>
          <div><dt>{e('shellpilotTunnelGuideErrorCertificate')}</dt><dd>{e('shellpilotTunnelGuideErrorCertificateFix')}</dd></div>
        </dl>
      </section>
    )
  }

  if (section === 'glossary') {
    return (
      <section className='ssh-tunnel-guide-section'>
        <h3>{e('shellpilotTunnelGuideGlossary')}</h3>
        <dl className='ssh-tunnel-guide-glossary'>
          <div><dt><code>127.0.0.1</code></dt><dd>{e('shellpilotTunnelGuideGlossaryLoopback')}</dd></div>
          <div><dt><code>0.0.0.0</code></dt><dd>{e('shellpilotTunnelGuideGlossaryAllInterfaces')}</dd></div>
          <div><dt><code>SOCKS5</code></dt><dd>{e('shellpilotTunnelGuideGlossarySocks')}</dd></div>
          <div><dt><code>GatewayPorts</code></dt><dd>{e('shellpilotTunnelGuideGlossaryGatewayPorts')}</dd></div>
        </dl>
      </section>
    )
  }

  return (
    <section className='ssh-tunnel-guide-section'>
      <span className='ssh-tunnel-guide-kicker'>{e('shellpilotTunnelGuideChooseType')}</span>
      <h3>{e('shellpilotTunnelGuideChooseInThreeSeconds')}</h3>
      <div className='ssh-tunnel-guide-scenarios'>
        <article>
          <strong>{e('shellpilotTunnelGuideScenarioServerService')}</strong>
          <p>{e('shellpilotTunnelGuideChooseLocal')}</p>
        </article>
        <article>
          <strong>{e('shellpilotTunnelGuideScenarioProxyTraffic')}</strong>
          <p>{e('shellpilotTunnelGuideChooseDynamic')}</p>
        </article>
        <article>
          <strong>{e('shellpilotTunnelGuideScenarioServerToLocal')}</strong>
          <p>{e('shellpilotTunnelGuideChooseRemote')}</p>
        </article>
      </div>
      {currentTunnelType ? <p className='ssh-tunnel-guide-context'>{e('shellpilotTunnelGuideCurrentType')}: {String(currentTunnelType)}</p> : null}
    </section>
  )
}

export default function SshTunnelGuideModal ({
  open,
  activeSection = 'choose-type',
  context = {},
  onClose
}) {
  const [requestedSection, setRequestedSection] = useState(() => activeSection)
  const section = normalizeSection(requestedSection)
  const focusError = focusErrorFor(requestedSection, context)

  useEffect(() => {
    if (open) setRequestedSection(activeSection)
  }, [activeSection, open])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      closable
      footer={null}
      width={900}
      title={e('shellpilotTunnelGuideTitle')}
      className='ssh-tunnel-guide-modal'
    >
      <div className='ssh-tunnel-guide-layout'>
        <nav className='ssh-tunnel-guide-nav' aria-label={e('shellpilotTunnelGuideDirectory')}>
          {guideSections.map(item => (
            <button
              type='button'
              key={item.id}
              className={section === item.id ? 'active' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setRequestedSection(item.id)}
            >
              {e(item.labelKey)}
            </button>
          ))}
        </nav>
        <main className='ssh-tunnel-guide-content'>
          <GuideContent section={section} context={context} focusError={focusError} />
        </main>
      </div>
    </Modal>
  )
}
