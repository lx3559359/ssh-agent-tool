import ReactMarkdown from 'react-markdown'
import Link from './external-link'
import './markdown.styl'

const markdownComponents = {
  a: ({ href = '', children }) => <Link to={href}>{children}</Link>
}

export default function Markdown ({ text = '' }) {
  return (
    <div className='markdown-wrap'>
      <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
    </div>
  )
}
