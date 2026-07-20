import { lazy, Suspense } from 'react'
import LazyModuleBoundary from '../common/lazy-module-boundary'

const AIChat = lazy(() => import('./ai-chat'))
const e = window.translate

export default function AIChatEntry (props) {
  return (
    <LazyModuleBoundary moduleName={e('shellpilotAiAssistantModule')} fallback={null}>
      <Suspense fallback={null}>
        <AIChat {...props} />
      </Suspense>
    </LazyModuleBoundary>
  )
}
