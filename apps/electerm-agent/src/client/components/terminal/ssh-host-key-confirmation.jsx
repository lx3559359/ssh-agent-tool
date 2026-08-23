import { Button } from 'antd'
import React from 'react'
import { copy as copyToClipboard } from '../../common/clipboard'
import './ssh-host-key-confirmation.styl'

export default function SshHostKeyConfirmation ({
  details,
  instructions = [],
  translate
}) {
  if (!details) {
    return (
      <div className='ssh-host-key-confirmation-instructions'>
        {instructions.map((note, index) => (
          <pre key={note + index}>{note}</pre>
        ))}
      </div>
    )
  }

  return (
    <div className={`ssh-host-key-confirmation${details.hostKeyChanged ? ' is-changed' : ''}`}>
      {details.hostKeyChanged && (
        <div className='ssh-host-key-warning' role='alert'>
          {translate('shellpilotHostKeyChangedWarning')}
        </div>
      )}
      <dl>
        <dt>{translate('shellpilotHostKeyTarget')}</dt>
        <dd><code>{details.target}</code></dd>
        <dt>{translate('shellpilotHostKeyType')}</dt>
        <dd><code>{details.keyType}</code></dd>
        <dt>{translate('shellpilotHostFingerprint')}</dt>
        <dd className='ssh-host-key-copy-row'>
          <code>{details.fingerprint}</code>
          <Button
            size='small'
            onClick={() => copyToClipboard(details.fingerprint)}
          >
            {translate('shellpilotCopyHostFingerprint')}
          </Button>
        </dd>
        <dt>known_hosts</dt>
        <dd className='ssh-host-key-copy-row'>
          <code>{details.knownHostsPath}</code>
          <Button
            size='small'
            onClick={() => copyToClipboard(details.knownHostsPath)}
          >
            {translate('shellpilotCopyKnownHostsPath')}
          </Button>
        </dd>
      </dl>
    </div>
  )
}
