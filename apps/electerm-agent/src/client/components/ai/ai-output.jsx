import { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { copy } from '../../common/clipboard'
import Link from '../common/external-link'
import { Tag } from 'antd'
import { CopyOutlined, PlayCircleOutlined } from '@ant-design/icons'
import getBrand from './get-brand'
import { confirmAndRunAICommand } from './ai-ssh-context'

const e = window.translate

export default function AIOutput ({ item }) {
  const outputRef = useRef(null)
  const {
    response,
    baseURLAI,
    nameAI,
    modelAI
  } = item

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [response])

  if (!response) {
    return null
  }

  const { brand, brandUrl } = getBrand(baseURLAI)

  const renderCode = (props) => {
    const { node, className = '', children, ...rest } = props
    const code = String(children).replace(/\n$/, '')
    const inline = !className.includes('language-')
    if (inline) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }

    const copyToClipboard = () => {
      copy(code)
    }

    const runInTerminal = async () => {
      await confirmAndRunAICommand({
        code,
        store: window.store
      })
    }

    return (
      <div className='code-block'>
        <div className='code-block-actions alignright'>
          <CopyOutlined
            className='code-action-icon pointer iblock'
            onClick={copyToClipboard}
            title={e('copy')}
          />
          <PlayCircleOutlined
            className='code-action-icon pointer mg1l iblock'
            onClick={runInTerminal}
          />
        </div>
        <pre>
          <code className={className} {...rest}>
            {children}
          </code>
        </pre>
      </div>
    )
  }

  function renderBrand () {
    if (!brand) {
      return null
    }
    const nameLabel = nameAI || modelAI
    const label = nameLabel ? `${brand}:${nameLabel}` : brand
    return (
      <div className='pd1y'>
        <Link to={brandUrl}>
          <Tag>{label}</Tag>
        </Link>
      </div>
    )
  }

  const mdProps = {
    children: response,
    components: {
      code: renderCode
    }
  }

  return (
    <div className='ai-stream-output' ref={outputRef}>
      <div className='pd1'>
        {renderBrand()}
        <ReactMarkdown {...mdProps} />
      </div>
    </div>
  )
}
