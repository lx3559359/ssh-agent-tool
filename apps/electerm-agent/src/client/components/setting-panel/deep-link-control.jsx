import React, { useState, useEffect } from 'react'
import { Button, Tooltip, Tag, Space } from 'antd'
import message from '../common/message'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const e = window.translate

export default function DeepLinkControl () {
  const [loading, setLoading] = useState(false)
  const [registrationStatus, setRegistrationStatus] = useState(null)

  const checkRegistrationStatus = async () => {
    try {
      const status = await window.pre.runGlobalAsync('checkProtocolRegistration')
      setRegistrationStatus(status)
    } catch (error) {
      console.error('检查协议注册状态失败:', error)
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
        message.success('协议处理器已注册')
        await checkRegistrationStatus()
      } else {
        message.warning(e('deepLinkSkipped') || '已跳过注册：' + result.reason)
      }
    } catch (error) {
      message.error('协议处理器注册失败')
      console.error('协议注册失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUnregister = async () => {
    setLoading(true)
    try {
      await window.pre.runGlobalAsync('unregisterDeepLink')
      message.success('协议处理器已取消注册')
      await checkRegistrationStatus()
    } catch (error) {
      message.error('协议处理器取消注册失败')
      console.error('协议取消注册失败:', error)
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
    const tip = `注册 AIGShell 以打开协议链接（${protocols.join('://, ')}://）`

    return (
      <div>
        <div className='pd1b'>
          {tip}
        </div>

        {registrationStatus && (
          <>
            <div className='pd1b'>
              协议状态
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
