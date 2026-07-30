import { useMemo, useState } from 'react'
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
      className='quick-connect-wizard'
    >
      <Steps current={step} size='small' items={stepItems} />
      <div className='quick-connect-wizard-body'>
        {
          step === 0
            ? (
              <>
                <p>{e('shellpilotConnectionWizardHostHint')}</p>
                <Space.Compact className='width-100'>
                  <Select
                    value={values.protocol}
                    options={QUICK_CONNECT_PROTOCOLS}
                    onChange={value => updateValue('protocol', value)}
                    className='quick-connect-protocol'
                  />
                  <Input
                    autoFocus
                    value={values.host}
                    onChange={event => updateValue('host', event.target.value)}
                    placeholder={e('shellpilotQuickConnectHostPlaceholder')}
                  />
                  <Input
                    value={values.port}
                    onChange={event => updateValue('port', event.target.value)}
                    placeholder={e('shellpilotPort')}
                    className='quick-connect-port'
                  />
                </Space.Compact>
              </>
              )
            : null
        }
        {
          step === 1
            ? (
              <>
                <p>{e('shellpilotConnectionWizardAuthHint')}</p>
                <Input
                  value={values.username}
                  onChange={event => updateValue('username', event.target.value)}
                  placeholder={e('shellpilotOptionalUsername')}
                  className='mg1b'
                />
                {
                  isSsh
                    ? (
                      <Select
                        value={values.authType}
                        onChange={value => updateValue('authType', value)}
                        className='width-100 mg1b'
                        options={[
                          { value: 'password', label: e('shellpilotPassword') },
                          { value: 'privateKey', label: e('shellpilotPrivateKey') },
                          { value: 'profiles', label: e('shellpilotCredentialProfile') }
                        ]}
                      />
                      )
                    : null
                }
                {
                  !isSsh || values.authType === 'password'
                    ? (
                      <Input.Password
                        value={values.password}
                        onChange={event => updateValue('password', event.target.value)}
                        placeholder={e('shellpilotOptionalPassword')}
                      />
                      )
                    : null
                }
                {
                  isSsh && values.authType === 'privateKey'
                    ? (
                      <>
                        <Input.TextArea
                          value={values.privateKey}
                          onChange={event => updateValue('privateKey', event.target.value)}
                          placeholder={e('shellpilotPrivateKeyPlaceholder')}
                          autoSize={{ minRows: 4, maxRows: 7 }}
                          className='mg1b'
                        />
                        <Input.Password
                          value={values.passphrase}
                          onChange={event => updateValue('passphrase', event.target.value)}
                          placeholder={e('shellpilotOptionalPassphrase')}
                        />
                      </>
                      )
                    : null
                }
                {
                  isSsh && values.authType === 'profiles'
                    ? (
                      <Select
                        value={values.profile || undefined}
                        onChange={value => updateValue('profile', value)}
                        className='width-100'
                        placeholder={e('shellpilotSelectCredentialProfile')}
                        options={profileOptions}
                      />
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
                <Input
                  value={values.title}
                  onChange={event => updateValue('title', event.target.value)}
                  placeholder={e('shellpilotConnectionNamePlaceholder')}
                  className='mg1b'
                />
                <Checkbox
                  checked={values.saveAsBookmark}
                  onChange={event => updateValue('saveAsBookmark', event.target.checked)}
                >
                  {e('shellpilotSaveAsConnection')}
                </Checkbox>
                {values.saveAsBookmark
                  ? (
                    <div className='quick-connect-group-field'>
                      <label>
                        {e('shellpilotSelectServerGroup')}
                      </label>
                      <BookmarkGroupPicker
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
