import { useEffect, useState } from 'react'
import { Modal } from 'antd'

const e = window.translate

const sections = [
  { id: 'choose-type', label: e('shellpilotTunnelGuideChooseType') },
  { id: 'local-forward', label: e('shellpilotTunnelGuideLocalScenario') },
  { id: 'how-to-access', label: e('shellpilotTunnelGuideHowToAccess') },
  { id: 'socks-browser', label: e('shellpilotTunnelGuideSocksBrowser') },
  { id: 'remote-safety', label: e('shellpilotTunnelGuideRemoteSafety') },
  { id: 'errors', label: e('shellpilotTunnelGuideErrors') },
  { id: 'glossary', label: e('shellpilotTunnelGuideGlossary') }
]

const sectionIds = new Set(sections.map(item => item.id))
const errorHelpSections = new Set([
  'forwarding-prohibited',
  'destination-refused',
  'local-port-in-use',
  'test-timeout',
  'unknown'
])

function normalizeSection (section) {
  if (sectionIds.has(section)) return section
  return errorHelpSections.has(section) ? 'errors' : 'choose-type'
}

function GuideContent ({ section, context }) {
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
        <div className='ssh-tunnel-guide-callout ssh-tunnel-guide-callout--safe'>
          <strong>{e('shellpilotTunnelGuideWebAccess')}</strong>
          <p>{e('shellpilotTunnelGuideNoBrowserProxy')}</p>
          <code>https://127.0.0.1:16060</code>
        </div>
        <div className='ssh-tunnel-guide-callout'>
          <strong>{e('shellpilotTunnelGuideDatabaseAccess')}</strong>
          <p>{e('shellpilotTunnelGuideDatabaseHostPort')}</p>
          <code>host: 127.0.0.1, port: 16060</code>
        </div>
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
          <div><dt>{e('shellpilotTunnelGuideErrorPortInUse')}</dt><dd>{e('shellpilotTunnelGuideErrorPortInUseFix')}</dd></div>
          <div><dt>{e('shellpilotTunnelGuideErrorProhibited')}</dt><dd>{e('shellpilotTunnelGuideErrorProhibitedFix')}</dd></div>
          <div><dt>{e('shellpilotTunnelGuideErrorRefused')}</dt><dd>{e('shellpilotTunnelGuideErrorRefusedFix')}</dd></div>
          <div><dt>{e('shellpilotTunnelGuideErrorTimeout')}</dt><dd>{e('shellpilotTunnelGuideErrorTimeoutFix')}</dd></div>
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
  const [section, setSection] = useState(() => normalizeSection(activeSection))

  useEffect(() => {
    if (open) setSection(normalizeSection(activeSection))
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
          {sections.map(item => (
            <button
              type='button'
              key={item.id}
              className={section === item.id ? 'active' : ''}
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main className='ssh-tunnel-guide-content'>
          <GuideContent section={section} context={context} />
        </main>
      </div>
    </Modal>
  )
}
