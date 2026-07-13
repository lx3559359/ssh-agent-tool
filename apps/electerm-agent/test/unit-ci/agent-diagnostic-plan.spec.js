const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const diagnosticPlanUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../src/client/components/ai/diagnostic-plan.js'
)).href

function validPlan (overrides = {}) {
  return {
    summary: 'Nginx 服务启动失败，需要核对状态和近期日志。',
    steps: [{
      id: 'status',
      title: '读取服务状态',
      purpose: '确认 systemd 报告的失败原因',
      command: 'systemctl status nginx.service --no-pager',
      timeoutMs: 15000,
      readOnly: true
    }],
    expectedSignals: ['ActiveState 和最近一次退出码'],
    stopConditions: ['端点发生变化或命令超时'],
    ...overrides
  }
}

test('parses one pure JSON object or one json fence and rejects surrounding text', async () => {
  const { parseDiagnosticPlan } = await import(diagnosticPlanUrl)
  const json = JSON.stringify(validPlan())

  assert.equal(parseDiagnosticPlan(json).steps[0].risk, 'readonly')
  assert.equal(parseDiagnosticPlan(`\`\`\`json\n${json}\n\`\`\``).summary, validPlan().summary)
  assert.throws(
    () => parseDiagnosticPlan(`以下是计划：\n${json}`),
    /严格 JSON/
  )
  assert.throws(
    () => parseDiagnosticPlan(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``),
    /严格 JSON/
  )
  assert.throws(
    () => parseDiagnosticPlan(`${json}\n${JSON.stringify({ command: 'rm -rf /' })}`),
    /JSON|格式/
  )
})

test('validates bounded readonly steps and ignores a model supplied readOnly claim', async () => {
  const { validateDiagnosticPlan } = await import(diagnosticPlanUrl)
  const endpoint = {
    host: 'Prod.Example.com.',
    port: '2222',
    username: 'deploy',
    tabId: 'tab-1',
    pid: 'terminal-9',
    password: 'must-not-persist'
  }
  const plan = validateDiagnosticPlan(validPlan(), { endpoint })

  assert.equal(plan.steps.length, 1)
  assert.equal(plan.steps[0].readOnly, true)
  assert.equal(plan.steps[0].risk, 'readonly')
  assert.equal(plan.endpointKey, 'deploy@prod.example.com:2222')
  assert.deepEqual(plan.endpoint, {
    host: 'prod.example.com',
    port: 2222,
    username: 'deploy',
    tabId: 'tab-1',
    pid: 'terminal-9'
  })
  assert.doesNotMatch(JSON.stringify(plan), /must-not-persist/)

  const secondsPlan = validateDiagnosticPlan(validPlan({
    steps: [{
      title: '读取服务状态',
      purpose: '允许模型省略本地生成的步骤 id',
      command: '/usr/bin/systemctl status nginx.service --no-pager',
      timeout: 15
    }]
  }), { endpoint })
  assert.equal(secondsPlan.steps[0].id, 'diagnostic-1')
  assert.equal(secondsPlan.steps[0].timeoutMs, 15000)

  for (const command of [
    'systemctl restart nginx.service',
    'unknown-diagnostic --all',
    'cat $(printf /etc/passwd)',
    'cat /var/log/app.log\nsystemctl restart nginx.service',
    'cat /var/log/app.log --password=plain-secret'
  ]) {
    assert.throws(
      () => validateDiagnosticPlan(validPlan({
        steps: [{
          id: 'claimed-safe',
          title: '模型声称只读',
          purpose: '验证本地仍会重新分类',
          command,
          timeoutMs: 10000,
          readOnly: true
        }]
      })),
      /只读|换行|凭据/
    )
  }
})

test('rejects duplicate ids and plan size timeout and text boundaries', async () => {
  const { validateDiagnosticPlan } = await import(diagnosticPlanUrl)
  const baseStep = validPlan().steps[0]

  assert.throws(() => validateDiagnosticPlan(validPlan({ steps: [] })), /1.*10/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: Array.from({ length: 11 }, (_, index) => ({
      ...baseStep,
      id: `step-${index}`
    }))
  })), /1.*10/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [baseStep, { ...baseStep }]
  })), /重复/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [{ ...baseStep, title: ' ' }]
  })), /title|标题/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [{ ...baseStep, purpose: '' }]
  })), /purpose|目的/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [{ ...baseStep, timeoutMs: 999 }]
  })), /1000.*60000/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [{ ...baseStep, timeoutMs: 60001 }]
  })), /1000.*60000/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    expectedSignals: Array.from({ length: 11 }, (_, index) => `signal-${index}`)
  })), /expectedSignals|预期信号/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    expectedSignals: []
  })), /expectedSignals|预期信号/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    stopConditions: []
  })), /stopConditions|停止条件/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    stopConditions: ['x'.repeat(501)]
  })), /stopConditions|停止条件/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    summary: '诊'.repeat(1001)
  })), /summary|长度/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [{ ...baseStep, timeoutMs: undefined, timeout: 1.5 }]
  })), /整数秒|超时/)
  assert.throws(() => validateDiagnosticPlan(validPlan({
    steps: [
      { ...baseStep, id: 'one' },
      { ...baseStep, id: 'two' }
    ]
  })), /重复/)
})

test('builds a redacted prompt containing only the selected abnormal target context', async () => {
  const {
    buildTargetedDiagnosticContext,
    buildTargetedDiagnosticPrompt
  } = await import(diagnosticPlanUrl)
  const snapshot = {
    endpoint: {
      host: 'prod.example.com',
      port: 22,
      username: 'root',
      password: 'ssh-password'
    },
    services: [
      {
        name: 'nginx.service',
        activeState: 'failed',
        description: 'Nginx reverse proxy',
        mainPid: 4321,
        workingDirectory: '/srv/nginx',
        fragmentPath: '/etc/systemd/system/nginx.service',
        recentLogs: ['nginx: bind() failed', 'token=related-secret']
      },
      {
        name: 'redis.service',
        activeState: 'failed',
        description: 'UNRELATED-REDIS',
        recentLogs: ['redis-password=unrelated-secret']
      }
    ],
    network: {
      listeningPorts: [
        { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'nginx', pid: 4321 },
        { protocol: 'tcp', address: '127.0.0.1', port: 6379, process: 'redis', pid: 991 }
      ]
    },
    resources: {
      processes: [
        { pid: 4321, command: 'nginx', cpuPercent: 3 },
        { pid: 991, command: 'redis-server UNRELATED-PROCESS' }
      ]
    },
    containers: [
      { name: 'nginx-proxy', status: 'Exited (1)', image: 'nginx:stable', ports: '0.0.0.0:80->80/tcp' },
      { name: 'redis-cache', status: 'Exited (1)', image: 'redis:latest' }
    ],
    alerts: [
      { code: 'service-failed', status: 'critical', target: 'nginx.service', message: 'nginx.service 运行失败' },
      { code: 'service-failed', status: 'critical', target: 'redis.service', message: 'UNRELATED-ALERT' }
    ],
    probes: [{
      id: 'services',
      rawOutput: 'nginx.service failed bind() denied\nredis.service UNRELATED-PROBE'
    }],
    apiKey: 'api-key-must-not-leak'
  }
  const target = { type: 'service', id: 'nginx.service' }
  const context = buildTargetedDiagnosticContext({ snapshot, target })
  const prompt = buildTargetedDiagnosticPrompt({ snapshot, target })
  const serialized = JSON.stringify(context)

  assert.equal(context.target.name, 'nginx.service')
  assert.match(serialized, /bind\(\) failed/)
  assert.match(serialized, /"port":80/)
  assert.match(serialized, /"pid":4321/)
  assert.match(serialized, /nginx:stable/)
  assert.match(serialized, /nginx\.service 运行失败/)
  assert.match(serialized, /\[REDACTED\]/)
  assert.doesNotMatch(serialized, /ssh-password|api-key-must-not-leak|related-secret/)
  assert.doesNotMatch(serialized, /UNRELATED|6379|redis-password|redis:latest/)
  assert.match(prompt, /summary/)
  assert.match(prompt, /expectedSignals/)
  assert.match(prompt, /stopConditions/)
  assert.match(prompt, /只能返回一个 JSON 对象/)
})

test('redacts credentials embedded in diagnostic commands and final reports', async () => {
  const {
    buildTargetedDiagnosticContext,
    buildDiagnosticResultPrompt
  } = await import(diagnosticPlanUrl)
  const snapshot = {
    endpoint: { host: 'prod.example.com', port: 22, username: 'root' },
    services: [{
      name: 'app.service',
      activeState: 'failed',
      execStart: '/usr/bin/app --api-key sk-context-1234567890abcdefghijklmnop --password context-pass'
    }],
    resources: {
      processes: [{
        pid: 919,
        command: '/usr/bin/app --token process-token --status'
      }]
    },
    alerts: [{
      status: 'critical',
      target: 'app.service',
      message: 'provider returned sk-alert-abcdefghijklmnop'
    }]
  }
  const context = buildTargetedDiagnosticContext({
    snapshot,
    target: { type: 'service', id: 'app.service' }
  })
  const report = buildDiagnosticResultPrompt({
    plan: validPlan(),
    task: {
      status: 'failed',
      error: 'backend sk-error-abcdefghijklmnop',
      steps: [{
        title: '读取状态',
        purpose: '收集证据',
        command: '/usr/bin/app --api-key sk-report-1234567890abcdefghijklmnop --password report-pass',
        output: 'token=output-token and sk-output-abcdefghijklmnop',
        error: '--token step-error-token'
      }]
    }
  })
  const serialized = JSON.stringify(context)

  for (const secret of [
    'sk-context', 'context-pass', 'process-token', 'sk-alert',
    'sk-error', 'sk-report', 'report-pass', 'output-token',
    'sk-output', 'step-error-token'
  ]) {
    assert.doesNotMatch(`${serialized}\n${report}`, new RegExp(secret), secret)
  }
  assert.match(serialized, /\[REDACTED\]/)
  assert.match(report, /\[REDACTED\]/)
  assert.ok(report.length <= 12000)
})

test('matches related diagnostic identities on token boundaries only', async () => {
  const { buildTargetedDiagnosticContext } = await import(diagnosticPlanUrl)
  const context = buildTargetedDiagnosticContext({
    snapshot: {
      endpoint: { host: 'prod.example.com', port: 22, username: 'root' },
      services: [{ name: 'app.service', activeState: 'failed' }],
      resources: {
        processes: [
          { pid: 10, command: '/usr/bin/app --status' },
          { pid: 11, command: '/usr/sbin/apparmor_parser --status' }
        ]
      },
      containers: [
        { name: 'app-worker', image: 'app:latest', status: 'Exited (1)' },
        { name: 'apparmor-helper', image: 'apparmor:latest', status: 'Exited (1)' }
      ],
      alerts: [
        { status: 'critical', target: 'app.service', message: 'app failed' },
        { status: 'critical', target: 'apparmor', message: 'apparmor failed' }
      ]
    },
    target: { type: 'service', id: 'app.service' }
  })
  const serialized = JSON.stringify(context)

  assert.match(serialized, /\/usr\/bin\/app --status/)
  assert.match(serialized, /app-worker/)
  assert.match(serialized, /app:latest/)
  assert.doesNotMatch(serialized, /apparmor/)
})

test('extracts only mapped Docker and Podman ports from container port fields', async () => {
  const { buildTargetedDiagnosticContext } = await import(diagnosticPlanUrl)
  const context = buildTargetedDiagnosticContext({
    snapshot: {
      endpoint: { host: 'prod.example.com', port: 22, username: 'root' },
      containers: [{
        name: 'web-gateway',
        status: 'Exited (1)',
        ports: [
          '192.168.1.20:8080->80/tcp',
          ':::443->443/tcp',
          '0.0.0.0:80->80/tcp',
          '80/tcp'
        ]
      }],
      network: {
        listeningPorts: [20, 168, 192, 8080, 80, 443].map(port => ({
          port,
          pid: port,
          process: `listener-${port}`
        }))
      },
      resources: {
        processes: [20, 168, 192, 8080, 80, 443].map(port => ({
          port,
          pid: 1000 + port,
          command: `/usr/bin/listener-${port}`
        }))
      }
    },
    target: { type: 'container', name: 'web-gateway' }
  })

  assert.deepEqual(context.listeningPorts.map(item => item.port), [8080, 80, 443])
  assert.deepEqual(context.processes.map(item => item.port), [8080, 80, 443])
  assert.equal(context.processes.some(item => [20, 168, 192].includes(item.port)), false)
})

test('accepts a long sk-prefixed systemd unit but rejects a real provider key', async () => {
  const { validateDiagnosticPlan } = await import(diagnosticPlanUrl)
  const endpoint = { host: 'prod.example.com', port: 22, username: 'root' }
  const accepted = validateDiagnosticPlan(validPlan({
    steps: [{
      title: '读取服务状态',
      purpose: '确认服务状态',
      command: '/usr/bin/systemctl status sk-observability-agent-production.service --no-pager',
      timeout: 10
    }]
  }), { endpoint })

  assert.equal(accepted.steps[0].risk, 'readonly')
  assert.throws(
    () => validateDiagnosticPlan(validPlan({
      steps: [{
        title: '泄露凭据',
        purpose: '不应接受真实密钥',
        command: '/usr/bin/printf sk-ProJ-A1B2C3D4E5F6G7H8I9J0KLMNOP',
        timeout: 10
      }]
    }), { endpoint }),
    /凭据|敏感|拒绝/
  )
})

test('keeps an oversized targeted prompt bounded with complete JSON context', async () => {
  const { buildTargetedDiagnosticPrompt } = await import(diagnosticPlanUrl)
  const repeated = '诊断上下文'.repeat(800)
  const target = {
    type: 'platform',
    data: {
      name: 'oversized-platform',
      status: 'critical',
      description: repeated,
      services: Array.from({ length: 10 }, (_, index) => ({
        name: `oversized-${index}.service`,
        status: 'failed',
        description: repeated,
        workingDirectory: `/srv/oversized-${index}`,
        fragmentPath: `/etc/systemd/system/oversized-${index}.service`
      }))
    }
  }
  const prompt = buildTargetedDiagnosticPrompt({
    snapshot: {
      endpoint: { host: 'prod.example.com', port: 22, username: 'root' },
      alerts: [],
      network: {},
      resources: {}
    },
    target
  })
  const contextJson = prompt.split('单目标上下文：\n')[1]

  assert.ok(prompt.length <= 20000)
  assert.doesNotThrow(() => JSON.parse(contextJson))
})

test('derives warning or critical severity before showing diagnostic buttons', async () => {
  const {
    deriveDiagnosticSeverity,
    isDiagnosticTargetAbnormal
  } = await import(diagnosticPlanUrl)
  const cases = [
    [{ severity: 'warning' }, 'warning'],
    [{ status: 'critical' }, 'critical'],
    [{ activeState: 'failed' }, 'critical'],
    [{ status: 'unhealthy' }, 'critical'],
    [{ state: 'dead' }, 'critical'],
    [{ status: 'Exited (1)' }, 'critical'],
    [{ status: 'Up 2 minutes (unhealthy)' }, 'critical'],
    [{ state: 'inactive' }, 'warning'],
    [{ status: 'stopped' }, 'warning'],
    [{ status: 'degraded' }, 'warning'],
    [{ status: 'restarting' }, 'warning'],
    [{ status: 'paused' }, 'warning'],
    [{ status: 'Created' }, null],
    [{ status: 'unknown' }, null],
    [{ status: 'healthy' }, null],
    [{ activeState: 'active' }, null],
    [{ state: 'running' }, null],
    [{ status: 'Up 2 hours' }, null],
    [{ status: 'an-arbitrary-error-string' }, null],
    [{}, null]
  ]

  for (const [item, severity] of cases) {
    assert.equal(deriveDiagnosticSeverity(item), severity, JSON.stringify(item))
    assert.equal(
      isDiagnosticTargetAbnormal(item),
      severity === 'warning' || severity === 'critical',
      JSON.stringify(item)
    )
  }
})

test('final diagnostic result prompt is bounded redacted and does not request automatic sending', async () => {
  const { buildDiagnosticResultPrompt } = await import(diagnosticPlanUrl)
  const prompt = buildDiagnosticResultPrompt({
    plan: validPlan(),
    task: {
      status: 'partially-completed',
      error: 'token=result-secret endpoint changed',
      steps: [
        {
          id: 'status',
          title: '读取状态',
          status: 'completed',
          command: '/usr/bin/systemctl status nginx.service',
          output: 'ActiveState=failed password=evidence-secret',
          audit: [{ code: 0 }]
        },
        {
          id: 'logs',
          title: '读取日志',
          status: 'failed',
          command: '/usr/bin/journalctl -u nginx.service',
          error: '服务器会话端点不一致'
        }
      ]
    }
  })

  assert.match(prompt, /只读诊断结果/)
  assert.match(prompt, /部分完成|partially-completed/)
  assert.match(prompt, /停止条件/)
  assert.match(prompt, /未自动判定/)
  assert.match(prompt, /"code": 0/)
  assert.match(prompt, /\[REDACTED\]/)
  assert.doesNotMatch(prompt, /result-secret|evidence-secret/)
  assert.ok(prompt.length <= 12000)
})
