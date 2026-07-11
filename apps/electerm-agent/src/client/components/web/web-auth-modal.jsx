import React, { useState, useCallback } from 'react'
import { Input, Button } from 'antd'
import Modal from '../common/modal'

export default function WebAuthModal ({ authRequest, onAuthSubmit, onAuthCancel }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = useCallback(() => {
    onAuthSubmit(username, password)
    setUsername('')
    setPassword('')
  }, [onAuthSubmit, username, password])

  const handleCancel = useCallback(() => {
    onAuthCancel()
    setUsername('')
    setPassword('')
  }, [onAuthCancel])

  return (
    <Modal
      open={!!authRequest}
      title='需要身份认证'
      width={400}
      onCancel={handleCancel}
      footer={null}
    >
      <div className='pd1y'>
        <p>
          <b>{authRequest?.host}</b> 需要身份认证
          {authRequest?.realm ? `（${authRequest.realm}）` : ''}
        </p>
        <div className='pd1b'>
          <div className='pd1b'>账号</div>
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder='请输入账号'
            autoFocus
          />
        </div>
        <div className='pd1b'>
          <div className='pd1b'>密码</div>
          <Input.Password
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder='请输入密码'
            onPressEnter={handleSubmit}
          />
        </div>
        <div className='pd1t alignright'>
          <Button className='mg1r' onClick={handleCancel}>取消</Button>
          <Button type='primary' onClick={handleSubmit}>登录</Button>
        </div>
      </div>
    </Modal>
  )
}
