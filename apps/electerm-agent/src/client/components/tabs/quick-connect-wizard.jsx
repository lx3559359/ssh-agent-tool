import { useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Input,
  Modal,
  Select,
  Space,
  Steps
} from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  LinkOutlined
} from '@ant-design/icons'
import message from '../common/message'
import testConnection from '../../common/test-connection'
import {
  buildQuickConnectBookmark,
  buildQuickConnectOptions,
  QUICK_CONNECT_DEFAULT_PORTS,
  QUICK_CONNECT_PROTOCOLS
} from './quick-connect-options.js'
import BookmarkGroupPicker from '../bookmark-form/common/bookmark-group-picker'
import './quick-connect.styl'

const e = window.translate

function getInitialValues () {
  return {
    protocol: 'ssh',
    host: '',
    port: '22',
    username: '',
    password: '',
    authType: 'password',
    privateKey: '',
    passphrase: '',
    profile: '',
    title: '',
    saveAsBookmark: true,
    selectedGroupId: window.store.getLastBookmarkGroup?.() || 'default'
  }
}

export default function QuickConnectWizard ({ open, onClose, batch }) {
  const hostInputRef = useRef(null)
  const [step, setStep] = useState(0)
  const [values, setValues] = useState(getInitialValues)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const isSsh = values.protocol === 'ssh'
  const profileOptions = useMemo(() => {
    return (window.store.profiles || []).map(item => ({
      value: item.id,
      label: item.name || item.id
    }))
  }, [])

  function updateValue (key, value) {
    const next = { ...values, [key]: value }
    if (key === 'protocol') {
      next.port = String(QUICK_CONNECT_DEFAULT_PORTS[value] || '')
      if (value !== 'ssh') next.authType = 'password'
    }
    setValues(next)
    setTestResult(null)
  }

  function getOptions () {
    if (!String(values.host || '').trim()) {
      message.warning(e('shellpilotQuickConnectHostRequired'))
      return null
    }
    const options = buildQuickConnectOptions(values)
    if (!options) {
      message.warning(e('shellpilotQuickConnectInvalidHostPort'))
      return null
    }
    return options
  }

  function goNext () {
    if (step === 0 && !getOptions()) return
    setStep(current => Math.min(2, current + 1))
  }

  async function handleTest () {
    const options = getOptions()
    if (!options) return
    setTesting(true)
    setTestResult(null)
    try {
      await testConnection(options)
      setTestResult({ type: 'success', text: e('shellpilotConnectionTestSucceeded') })
    } catch (error) {
      const detail = String(error?.message || '').trim()
      setTestResult({
        type: 'error',
        text: detail
          ? `${e('connectionFailed')}: ${detail}`
          : e('connectionFailed')
      })
    } finally {
      setTesting(false)
    }
  }

  function handleConnect () {
    const options = getOptions()
    if (!options) return
    if (values.saveAsBookmark) {
      const bookmark = buildQuickConnectBookmark(options)
      window.store.saveBookmarkInGroup(
        bookmark,
        values.selectedGroupId
      )
    }
    window.store.addTab({
      ...options,
      from: 'connectionWizard',
      batch
    })
    onClose?.()
    setStep(0)
    setValues(getInitialValues())
    setTestResult(null)
  }

  function openAdvancedSettings () {
    onClose?.()
    window.store.openAdvancedSsh?.()
  }

  function handleAfterOpenChange (isOpen) {
    if (isOpen && step === 0) {
      hostInputRef.current?.focus({ preventScroll: true })
    }
  }

  const stepItems = [
    { title: e('shellpilotConnectionWizardHostStep') },
    { title: e('shellpilotConnectionWizardAuthStep') },
    { title: e('shellpilotConnectionWizardConfirmStep') }
  ]

  return (
    <Modal
      open={open}
      title={e('shellpilotConnectionWizardTitle')}
      footer={null}
      width={660}
      destroyOnClose={false}
      onCancel={onClose}
      afterOpenChange={handleAfterOpenChange}
      className='quick-connect-wizard'
    >
      <Steps current={step} size='small' items={stepItems} />
      <div className='quick-connect-wizard-body'>
        {
          step === 0
            ? (
              <>
                <p id='shellpilot-connect-host-help'>{e('shellpilotConnectionWizardHostHint')}</p>
                <div className='quick-connect-endpoint-fields'>
                  <div className='quick-connect-field quick-connect-protocol-field'>
                    <label htmlFor='shellpilot-connect-protocol'>
                      {e('type')} <span>{e('shellpilotRequired')}</span>
                    </label>
                    <Select
                      id='shellpilot-connect-protocol'
                      aria-describedby='shellpilot-connect-host-help'
                      aria-required='true'
                      value={values.protocol}
                      options={QUICK_CONNECT_PROTOCOLS}
                      onChange={value => updateValue('protocol', value)}
                      className='quick-connect-protocol'
                    />
                  </div>
                  <div className='quick-connect-field quick-connect-host-field'>
                    <label htmlFor='shellpilot-connect-host'>
                      {e('shellpilotQuickConnectServer')} <span>{e('shellpilotRequired')}</span>
                    </label>
                    <Input
                      ref={hostInputRef}
                      id='shellpilot-connect-host'
                      aria-describedby='shellpilot-connect-host-help'
                      aria-required='true'
                      autoFocus
                      value={values.host}
                      onChange={event => updateValue('host', event.target.value)}
                      placeholder={e('shellpilotQuickConnectHostPlaceholder')}
                    />
                  </div>
                  <div className='quick-connect-field quick-connect-port-field'>
                    <label htmlFor='shellpilot-connect-port'>
                      {e('shellpilotPort')} <span>{e('shellpilotRequired')}</span>
                    </label>
                    <Input
                      id='shellpilot-connect-port'
                      aria-describedby='shellpilot-connect-host-help'
                      aria-required='true'
                      value={values.port}
                      onChange={event => updateValue('port', event.target.value)}
                      placeholder={e('shellpilotPort')}
                      className='quick-connect-port'
                    />
                  </div>
                </div>
              </>
              )
            : null
        }
        {
          step === 1
            ? (
              <>
                <p id='shellpilot-connect-auth-help'>{e('shellpilotConnectionWizardAuthHint')}</p>
                <div className='quick-connect-field'>
                  <label htmlFor='shellpilot-connect-username'>
                    {e('username')} <span>{e('shellpilotOptional')}</span>
                  </label>
                  <Input
                    id='shellpilot-connect-username'
                    aria-describedby='shellpilot-connect-auth-help'
                    value={values.username}
                    onChange={event => updateValue('username', event.target.value)}
                    placeholder={e('shellpilotOptionalUsername')}
                  />
                </div>
                {
                  isSsh
                    ? (
                      <div className='quick-connect-field'>
                        <label htmlFor='shellpilot-connect-auth-type'>
                          {e('shellpilotAuthenticationMethod')} <span>{e('shellpilotRequired')}</span>
                        </label>
                        <Select
                          id='shellpilot-connect-auth-type'
                          aria-describedby='shellpilot-connect-auth-help'
                          aria-required='true'
                          value={values.authType}
                          onChange={value => updateValue('authType', value)}
                          className='width-100'
                          options={[
                            { value: 'password', label: e('shellpilotPassword') },
                            { value: 'privateKey', label: e('shellpilotPrivateKey') },
                            { value: 'profiles', label: e('shellpilotCredentialProfile') }
                          ]}
                        />
                      </div>
                      )
                    : null
                }
                {
                  !isSsh || values.authType === 'password'
                    ? (
                      <div className='quick-connect-field'>
                        <label htmlFor='shellpilot-connect-password'>
                          {e('shellpilotPassword')} <span>{e('shellpilotOptional')}</span>
                        </label>
                        <Input.Password
                          id='shellpilot-connect-password'
                          aria-describedby='shellpilot-connect-auth-help'
                          value={values.password}
                          onChange={event => updateValue('password', event.target.value)}
                          placeholder={e('shellpilotOptionalPassword')}
                        />
                      </div>
                      )
                    : null
                }
                {
                  isSsh && values.authType === 'privateKey'
                    ? (
                      <>
                        <div className='quick-connect-field'>
                          <label htmlFor='shellpilot-connect-private-key'>
                            {e('shellpilotPrivateKey')} <span>{e('shellpilotRequired')}</span>
                          </label>
                          <Input.TextArea
                            id='shellpilot-connect-private-key'
                            aria-describedby='shellpilot-connect-auth-help'
                            aria-required='true'
                            value={values.privateKey}
                            onChange={event => updateValue('privateKey', event.target.value)}
                            placeholder={e('shellpilotPrivateKeyPlaceholder')}
                            autoSize={{ minRows: 4, maxRows: 7 }}
                          />
                        </div>
                        <div className='quick-connect-field'>
                          <label htmlFor='shellpilot-connect-passphrase'>
                            {e('shellpilotOptionalPassphrase')} <span>{e('shellpilotOptional')}</span>
                          </label>
                          <Input.Password
                            id='shellpilot-connect-passphrase'
                            aria-describedby='shellpilot-connect-auth-help'
                            value={values.passphrase}
                            onChange={event => updateValue('passphrase', event.target.value)}
                            placeholder={e('shellpilotOptionalPassphrase')}
                          />
                        </div>
                      </>
                      )
                    : null
                }
                {
                  isSsh && values.authType === 'profiles'
                    ? (
                      <div className='quick-connect-field'>
                        <label htmlFor='shellpilot-connect-profile'>
                          {e('shellpilotCredentialProfile')} <span>{e('shellpilotRequired')}</span>
                        </label>
                        <Select
                          id='shellpilot-connect-profile'
                          aria-describedby='shellpilot-connect-auth-help'
                          aria-required='true'
                          value={values.profile || undefined}
                          onChange={value => updateValue('profile', value)}
                          className='width-100'
                          placeholder={e('shellpilotSelectCredentialProfile')}
                          options={profileOptions}
                        />
                      </div>
                      )
                    : null
                }
              </>
              )
            : null
        }
        {
          step === 2
            ? (
              <>
                <p>{e('shellpilotConnectionWizardConfirmHint')}</p>
                <div className='quick-connect-wizard-summary'>
                  <strong>{values.username ? `${values.username}@` : ''}{values.host || '-'}</strong>
                  <span>{values.protocol.toUpperCase()} : {values.port || '-'}</span>
                </div>
                {testResult ? <Alert type={testResult.type} showIcon message={testResult.text} className='mg1y' /> : null}
              </>
              )
            : null
        }
        <Collapse
          ghost
          className='quick-connect-wizard-advanced'
          items={[{
            key: 'advanced',
            label: e('shellpilotConnectionWizardAdvanced'),
            children: (
              <>
                <div className='quick-connect-field'>
                  <label htmlFor='shellpilot-connect-title'>
                    {e('name')} <span>{e('shellpilotOptional')}</span>
                  </label>
                  <Input
                    id='shellpilot-connect-title'
                    value={values.title}
                    onChange={event => updateValue('title', event.target.value)}
                    placeholder={e('shellpilotConnectionNamePlaceholder')}
                  />
                </div>
                <div className='quick-connect-save-field'>
                  <label htmlFor='shellpilot-connect-save'>
                    {e('shellpilotSaveAsConnection')} <span>{e('shellpilotRecommended')}</span>
                  </label>
                  <Checkbox
                    id='shellpilot-connect-save'
                    aria-describedby='shellpilot-connect-persistence-help'
                    checked={values.saveAsBookmark}
                    onChange={event => updateValue('saveAsBookmark', event.target.checked)}
                  />
                  <p id='shellpilot-connect-persistence-help'>
                    {e('shellpilotQuickConnectLocalPersistence')}
                  </p>
                </div>
                {values.saveAsBookmark
                  ? (
                    <div className='quick-connect-group-field'>
                      <label htmlFor='shellpilot-connect-group'>
                        {e('shellpilotSelectServerGroup')} <span>{e('shellpilotOptional')}</span>
                      </label>
                      <BookmarkGroupPicker
                        id='shellpilot-connect-group'
                        aria-describedby='shellpilot-connect-persistence-help'
                        value={values.selectedGroupId}
                        onChange={value => updateValue(
                          'selectedGroupId',
                          value
                        )}
                      />
                    </div>
                    )
                  : null}
                <Button type='link' size='small' icon={<LinkOutlined />} onClick={openAdvancedSettings}>
                  {e('shellpilotConnectionWizardOpenAdvanced')}
                </Button>
              </>
            )
          }]}
        />
      </div>
      <footer className='quick-connect-wizard-footer'>
        <Button disabled={step === 0} icon={<ArrowLeftOutlined />} onClick={() => setStep(current => Math.max(0, current - 1))}>
          {e('shellpilotConnectionWizardPrevious')}
        </Button>
        <Space>
          {step < 2 ? <Button type='primary' icon={<ArrowRightOutlined />} onClick={goNext}>{e('shellpilotConnectionWizardNext')}</Button> : null}
          {step === 2 ? <Button loading={testing} onClick={handleTest}>{e('shellpilotConnectionWizardTestFirst')}</Button> : null}
          {step === 2 ? <Button type='primary' icon={<ArrowRightOutlined />} onClick={handleConnect}>{e('connect')}</Button> : null}
        </Space>
      </footer>
    </Modal>
  )
}
