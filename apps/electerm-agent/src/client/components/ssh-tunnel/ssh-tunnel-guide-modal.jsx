import { useEffect, useState } from 'react'
import { Modal } from 'antd'

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
  timeout: 'timeout'
}
const errorFocusByCode = {
  SSH_TUNNEL_FORWARDING_PROHIBITED: 'forwarding-prohibited',
  SSH_TUNNEL_DESTINATION_REFUSED: 'destination-refused',
  SSH_TUNNEL_PORT_IN_USE: 'port-conflict',
  EADDRINUSE: 'port-conflict',
  SSH_TUNNEL_TEST_TIMEOUT: 'timeout'
}
const errorHelpSections = new Set([
  ...Object.keys(errorFocusByHelpSection),
  'unknown'
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

function GuideContent ({ section, context, focusError }) {
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
        <div className='ssh-tunnel-guide-topic-grid'>
          <article>
            <strong>{e('shellpilotTunnelGuideFirefox')}</strong>
            <p>{e('shellpilotTunnelGuideFirefoxSteps')}</p>
          </article>
          <article>
            <strong>{e('shellpilotTunnelGuideChromium')}</strong>
            <p>{e('shellpilotTunnelGuideChromiumSteps')}</p>
          </article>
          <article>
            <strong>{e('shellpilotTunnelGuideOtherApps')}</strong>
            <p>{e('shellpilotTunnelGuideOtherAppsSteps')}</p>
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
      {context?.tunnelType ? <p className='ssh-tunnel-guide-context'>{e('shellpilotTunnelGuideCurrentType')}: {String(context.tunnelType)}</p> : null}
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
