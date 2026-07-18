import { lazy, Suspense } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'

const AIChat = lazy(() => import('./ai-chat'))

export default function AIChatEntry (props) {
  return (
    <LazyModuleBoundary moduleName='AI 助手' fallback={null}>
      <Suspense fallback={null}>
        <AIChat {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}
