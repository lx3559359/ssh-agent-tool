const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const helperPath = path.resolve(
  __dirname,
  '../e2e/common/client-interaction-performance.js'
)
const {
  percentile,
  summarizeInteractionSamples
} = require(helperPath)

test('interaction summaries use nearest-rank P95 and retain worst frame work', () => {
  const samples = Array.from({ length: 10 }, (_, index) => ({
    totalMs: 60 + index * 5,
    stableFrameMs: 20 + index,
    maxLongTaskMs: index === 7 ? 88 : 0
  }))

  assert.equal(percentile(samples.map(sample => sample.totalMs), 0.95), 105)
  assert.deepEqual(summarizeInteractionSamples(samples), {
    sampleCount: 10,
    totalP95Ms: 105,
    stableFrameMaxMs: 29,
    maxLongTaskMs: 88
  })
})

test('store interaction measurement observes long tasks and waits for ready content', () => {
  const source = fs.readFileSync(helperPath, 'utf8')

  assert.match(source, /PerformanceObserver\.supportedEntryTypes/)
  assert.match(source, /observer\.observe\(\{ type: 'longtask' \}\)/)
  assert.match(source, /observer\.takeRecords\(\)/)
  assert.match(source, /readySelector/)
  assert.match(source, /readyCount/)
  assert.match(source, /stableFrameMs: stableAt - visibleAt/)
})
