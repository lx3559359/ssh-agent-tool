import React, { useState, useEffect } from 'react'
import { Button, Tooltip, Tag, Space } from 'antd'
import message from '../common/message'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { formatShellPilotTranslation } from '../../common/shellpilot-i18n-overrides.js'

const e = window.translate
const tf = (key, replacements) => formatShellPilotTranslation(e, key, replacements)

export default function DeepLinkControl () {
  const [loading, setLoading] = useState(false)
  const [registrationStatus, setRegistrationStatus] = useState(null)

  const checkRegistrationStatus = async () => {
    try {
      const status = await window.pre.runGlobalAsync('checkProtocolRegistration')
      setRegistrationStatus(status)
    } catch (error) {
      console.error('Protocol registration status check failed:', error)
    }
  }

  useEffect(() => {
    checkRegistrationStatus()
  }, [])

  const handleRegister = async () => {
    setLoading(true)
    try {
      const result = await window.pre.runGlobalAsync('registerDeepLink', true)
      if (result.registered) {
        message.success(e('shellpilotProtocolRegistered'))
        await checkRegistrationStatus()
      } else {
        message.warning(tf('shellpilotDeepLinkSkipped', { detail: result.reason }))
      }
    } catch (error) {
      message.error(e('shellpilotProtocolRegistrationFailed'))
      console.error('Protocol registration failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUnregister = async () => {
    setLoading(true)
    try {
      await window.pre.runGlobalAsync('unregisterDeepLink')
      message.success(e('shellpilotProtocolUnregistered'))
      await checkRegistrationStatus()
    } catch (error) {
      message.error(e('shellpilotProtocolUnregisterFailed'))
      console.error('Protocol unregistration failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const isAnyProtocolRegistered = () => {
    if (!registrationStatus) return false
    return Object.values(registrationStatus).some(status => status === true)
  }

  const isAllProtocolsRegistered = () => {
    if (!registrationStatus) return false
    return Object.values(registrationStatus).every(status => status === true)
  }

  const renderTooltipContent = () => {
    const protocols = ['ssh', 'telnet', 'rdp', 'vnc', 'serial', 'spice', 'aigshell', 'electerm', 'ftp']
    const tip = tf('shellpilotProtocolTip', {
      protocols: `${protocols.join('://, ')}://`
    })

    return (
      <div>
        <div className='pd1b'>
          {tip}
        </div>

        {registrationStatus && (
          <>
            <div className='pd1b'>
              {e('shellpilotProtocolStatus')}
            </div>
            <div className='pd1b'>
              <Space size='small' wrap>
                {protocols.map(protocol => {
                  const isRegistered = registrationStatus[protocol]
                  return (
                    <Tag
                      key={protocol}
                      variant='solid'
                      icon={isRegistered ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                      color={isRegistered ? 'success' : 'default'}
                    >
                      {protocol}://
                    </Tag>
                  )
                })}
              </Space>
            </div>
          </>
        )}
      </div>
    )
  }

  const isRegistered = isAnyProtocolRegistered()
  const isAllRegistered = isAllProtocolsRegistered()

  return (
    <div className='pd2b'>
      <Tooltip
        title={renderTooltipContent()}
      >
        <Space>
          {
            !isAllRegistered && (
              <Button
                type='primary'
                onClick={handleRegister}
                loading={loading}
              >
                {e('registerDeepLink')}
              </Button>
            )
          }
          {
            isRegistered && (
              <Button
                color='danger'
                variant='solid'
                onClick={handleUnregister}
                loading={loading}
              >
                {e('unregisterDeepLink')}
              </Button>
            )
          }
        </Space>
      </Tooltip>
    </div>
  )
}
