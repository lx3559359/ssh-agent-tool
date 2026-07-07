import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCommandPolicy } from "./commandPolicy.js";
import {
  buildAgentApprovalDecision,
  buildAgentRuntimeRequest,
  buildCliRunnerPlan,
  buildMcpRunnerPlan,
  buildSkillRunnerDispatch,
  buildSkillRunnerPlan,
  formatCliRunnerResultTerminalLines,
  formatCliRunnerTerminalLines,
  formatMcpHttpResultTerminalLines,
  formatMcpRunnerTerminalLines,
  formatSkillRunnerTerminalLines,
} from "./agentExecution.js";

function buildTask(overrides = {}) {
  return {
    id: "task-cli-disk-prod-web-01",
    capabilityType: "CLI",
    capabilityName: "磁盘检查",
    title: "准备 CLI：磁盘检查",
    targetServer: "prod-web-01",
    command: "df -hT",
    ...overrides,
  };
}

test("buildAgentApprovalDecision blocks destructive CLI tasks", () => {
  const task = buildTask({ command: "rm -rf /var/log/nginx/*" });
  const decision = buildAgentApprovalDecision(task, evaluateCommandPolicy(task.command));

  assert.equal(decision.action, "block");
  assert.equal(decision.command, task.command);
  assert.equal(decision.result, decision.policy.message);
  assert.deepEqual(decision.auditEvent, {
    type: "command_blocked",
    server: "prod-web-01",
    actor: "agent",
    command: task.command,
    message: decision.policy.message,
    status: "blocked",
  });
});

test("buildAgentApprovalDecision stages reviewed CLI tasks for terminal confirmation", () => {
  const task = buildTask({ command: "systemctl restart nginx" });
  const decision = buildAgentApprovalDecision(task, evaluateCommandPolicy(task.command));

  assert.equal(decision.action, "stage_command");
  assert.equal(decision.requiresSecondApproval, true);
  assert.equal(decision.result, "已写入 SSH 终端输入框");
  assert.equal(decision.notice, "已写入终端，但发送前仍需二次确认：systemctl restart nginx");
});

test("buildAgentApprovalDecision stages readonly CLI tasks without extra approval", () => {
  const task = buildTask({ command: "df -hT" });
  const decision = buildAgentApprovalDecision(task, evaluateCommandPolicy(task.command));

  assert.equal(decision.action, "stage_command");
  assert.equal(decision.requiresSecondApproval, false);
  assert.equal(decision.notice, "已审批并写入终端命令：df -hT");
});

test("buildAgentApprovalDecision queues local CLI tasks for runner", () => {
  const task = buildTask({ command: "local:ssh-ai diagnose --json" });
  const decision = buildAgentApprovalDecision(task, evaluateCommandPolicy("ssh-ai diagnose --json"));

  assert.equal(decision.action, "queue_runner");
  assert.equal(decision.runtimeRequest.kind, "cli");
  assert.equal(decision.runtimeRequest.command, "ssh-ai diagnose --json");
  assert.equal(decision.auditEvent.type, "agent_cli_queued");
});

test("buildAgentApprovalDecision sends SSH diagnostic tasks to local CLI runner", () => {
  const task = buildTask({
    capabilityName: "SSH 连接诊断",
    command: "local:ssh-agent-tool diagnose-ssh --host 10.0.1.23 --port 22 --kind timeout",
    diagnosticsKind: "timeout",
  });
  const decision = buildAgentApprovalDecision(task, evaluateCommandPolicy(task.command));

  assert.equal(decision.action, "queue_runner");
  assert.equal(decision.runtimeRequest.kind, "cli");
  assert.equal(decision.runtimeRequest.command, "ssh-agent-tool diagnose-ssh --host 10.0.1.23 --port 22 --kind timeout");
  assert.equal(decision.auditEvent.type, "agent_cli_queued");
});

test("buildAgentApprovalDecision queues Skill tasks for a runner", () => {
  const task = buildTask({
    capabilityType: "Skill",
    capabilityName: "Linux 健康检查",
    title: "运行 Linux 健康检查",
    command: "",
    entry: "skills/linux-health.md",
    targetFile: "/var/log/nginx/error.log",
  });
  const decision = buildAgentApprovalDecision(task);

  assert.equal(decision.action, "queue_runner");
  assert.equal(decision.result, "已进入 Skill Runner 队列：skills/linux-health.md");
  assert.deepEqual(decision.runtimeRequest, {
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Linux 健康检查",
    entry: "skills/linux-health.md",
    targetFile: "/var/log/nginx/error.log",
    status: "queued",
  });
  assert.deepEqual(decision.auditEvent, {
    type: "agent_skill_queued",
    server: "prod-web-01",
    actor: "agent",
    capability: "Linux 健康检查",
    entry: "skills/linux-health.md",
    status: "queued",
  });
});

test("buildAgentApprovalDecision queues MCP tasks for a connector", () => {
  const task = buildTask({
    capabilityType: "MCP",
    capabilityName: "Prometheus",
    title: "调用 Prometheus",
    command: "",
    endpoint: "mcp://prometheus",
  });
  const decision = buildAgentApprovalDecision(task);

  assert.equal(decision.action, "queue_runner");
  assert.equal(decision.result, "已进入 MCP 调用队列：mcp://prometheus");
  assert.deepEqual(decision.runtimeRequest, {
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "Prometheus",
    endpoint: "mcp://prometheus",
    headers: [],
    targetFile: "",
    status: "queued",
  });
});

test("buildAgentRuntimeRequest returns null for unsupported tasks", () => {
  assert.equal(buildAgentRuntimeRequest(buildTask({ capabilityType: "Unknown" })), null);
});

test("buildAgentRuntimeRequest carries MCP headers into runner request", () => {
  const request = buildAgentRuntimeRequest(buildTask({
    capabilityType: "MCP",
    capabilityName: "Internal MCP",
    endpoint: "https://mcp.example.com/rpc",
    headers: [{ name: "Authorization", value: "Bearer token", enabled: true }],
  }));

  assert.deepEqual(request.headers, [{ name: "Authorization", value: "Bearer token", enabled: true }]);
});

test("buildCliRunnerPlan allows local CLI commands and blocks unsafe shell characters", () => {
  const plan = buildCliRunnerPlan({
    kind: "cli",
    server: "prod-web-01",
    capabilityName: "ssh-ai diagnose",
    command: "ssh-ai diagnose --json",
  });
  const blocked = buildCliRunnerPlan({
    kind: "cli",
    server: "prod-web-01",
    capabilityName: "bad",
    command: "ssh-ai diagnose; rm -rf /",
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.command, "ssh-ai diagnose --json");
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockedCount, 1);
});

test("formatCliRunnerTerminalLines and result lines render local CLI execution", () => {
  const plan = buildCliRunnerPlan({
    kind: "cli",
    server: "prod-web-01",
    capabilityName: "ssh-ai diagnose",
    command: "ssh-ai diagnose --json",
  });

  assert.deepEqual(formatCliRunnerTerminalLines(plan).slice(0, 3), [
    "[prod-web-01]$ # Agent CLI Runner：ssh-ai diagnose",
    "# CLI「ssh-ai diagnose」准备执行本地命令。",
    "local$ ssh-ai diagnose --json",
  ]);
  assert.deepEqual(formatCliRunnerResultTerminalLines(plan, { ok: true, stdout: "ok", stderr: "", returnCode: 0 }).slice(0, 3), [
    "[prod-web-01]$ # CLI Runner 结果：ssh-ai diagnose",
    "# returnCode=0 status=ok",
    "ok",
  ]);
});

test("buildAgentRuntimeRequest carries custom Skill command templates", () => {
  const request = buildAgentRuntimeRequest(buildTask({
    capabilityType: "Skill",
    capabilityName: "Redis 延迟排查",
    entry: "skills/redis-latency.md",
    commands: [
      { label: "慢命令", command: "redis-cli slowlog get 10" },
      { label: "内存", command: "redis-cli info memory" },
    ],
  }));

  assert.deepEqual(request.commands, [
    { label: "慢命令", command: "redis-cli slowlog get 10" },
    { label: "内存", command: "redis-cli info memory" },
  ]);
});

test("buildAgentRuntimeRequest carries Skill SSH context without secrets", () => {
  const request = buildAgentRuntimeRequest(buildTask({
    capabilityType: "Skill",
    capabilityName: "Custom log scan",
    entry: "skills/custom-log-scan.md",
    targetFile: "/var/log/nginx/error.log",
    serverContext: {
      server: "prod-web-01",
      host: "10.0.1.23",
      ip: "10.0.1.23",
      port: "2222",
      user: "root",
      cwd: "/var/www/app",
      group: "prod",
      file: "/var/log/nginx/error.log",
      password: "DoNotLeak",
    },
  }));

  assert.deepEqual(request.serverContext, {
    server: "prod-web-01",
    host: "10.0.1.23",
    ip: "10.0.1.23",
    port: "2222",
    user: "root",
    cwd: "/var/www/app",
    group: "prod",
    file: "/var/log/nginx/error.log",
  });
  assert.doesNotMatch(JSON.stringify(request), /DoNotLeak/);
});

test("buildSkillRunnerPlan maps built in skill to readonly command plan", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Linux 健康检查",
    entry: "skills/linux-health.md",
    targetFile: "/var/log/nginx/error.log",
  }, evaluateCommandPolicy);

  assert.equal(plan.ready, true);
  assert.equal(plan.server, "prod-web-01");
  assert.equal(plan.commands.length >= 4, true);
  assert.equal(plan.commands.every((item) => item.policy.action === "allow"), true);
  assert.deepEqual(plan.commands[0], {
    label: "系统负载",
    command: "uptime",
    policy: evaluateCommandPolicy("uptime"),
  });
  assert.match(plan.summary, /Linux 健康检查/);
});

test("buildSkillRunnerPlan marks unknown skill as not ready", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "自定义脚本",
    entry: "skills/custom.md",
  }, evaluateCommandPolicy);

  assert.equal(plan.ready, false);
  assert.equal(plan.commands.length, 0);
  assert.match(plan.summary, /暂未配置/);
});

test("buildSkillRunnerPlan uses custom Skill command templates from runtime request", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Redis 延迟排查",
    entry: "skills/redis-latency.md",
    commands: [
      { label: "慢命令", command: "redis-cli slowlog get 10" },
      { label: "内存", command: "redis-cli info memory" },
    ],
  }, evaluateCommandPolicy);

  assert.equal(plan.ready, true);
  assert.equal(plan.commands.length, 2);
  assert.deepEqual(plan.commands.map((item) => item.command), ["redis-cli slowlog get 10", "redis-cli info memory"]);
  assert.equal(plan.summary, "Skill「Redis 延迟排查」已生成 2 条只读 SSH 诊断命令。");
});

test("buildSkillRunnerPlan renders custom Skill command variables safely", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Custom log scan",
    entry: "skills/custom-log-scan.md",
    serverContext: {
      host: "10.0.1.23",
      port: "2222",
      user: "root",
      cwd: "/var/www/app",
      file: "/var/log/nginx/error'quoted.log",
    },
    commands: [
      { label: "Tail selected file", command: "tail -n 50 {{file}}" },
      { label: "Current directory", command: "pwd {{cwd}}" },
      { label: "Remote login", command: "ssh {{user}}@{{host}} -p {{port}}" },
    ],
  }, evaluateCommandPolicy);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.commands.map((item) => item.command), [
    "tail -n 50 '/var/log/nginx/error'\\''quoted.log'",
    "pwd '/var/www/app'",
    "ssh 'root'@'10.0.1.23' -p '2222'",
  ]);
  assert.equal(plan.commands[0].policy.action, "allow");
});

test("buildSkillRunnerPlan refuses unsafe skill command templates", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "破坏性测试",
    entry: "skills/linux-health.md",
  }, evaluateCommandPolicy, {
    templates: {
      "skills/linux-health.md": [{ label: "危险命令", command: "rm -rf /var/log/nginx/*" }],
    },
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.blockedCount, 1);
  assert.equal(plan.commands[0].policy.action, "block");
});

test("formatSkillRunnerTerminalLines renders command plan for the SSH terminal", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Linux 健康检查",
    entry: "skills/linux-health.md",
  }, evaluateCommandPolicy);

  assert.deepEqual(formatSkillRunnerTerminalLines(plan).slice(0, 4), [
    "[prod-web-01]$ # Agent Skill Runner：Linux 健康检查",
    "# Skill「Linux 健康检查」已生成 5 条只读 SSH 诊断命令。",
    "# 1. 系统负载",
    "uptime",
  ]);
});

test("buildSkillRunnerDispatch executes safe plans when a session and sender exist", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Linux 健康检查",
    entry: "skills/linux-health.md",
  }, evaluateCommandPolicy);
  const dispatch = buildSkillRunnerDispatch(plan, { sessionId: "session-1", canSend: true });

  assert.equal(dispatch.mode, "execute");
  assert.equal(dispatch.sessionId, "session-1");
  assert.deepEqual(dispatch.commands.map((item) => item.command).slice(0, 2), ["uptime", "free -h"]);
});

test("buildSkillRunnerDispatch stages the first command without an active session", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "Linux 健康检查",
    entry: "skills/linux-health.md",
  }, evaluateCommandPolicy);
  const dispatch = buildSkillRunnerDispatch(plan, { sessionId: "", canSend: true });

  assert.equal(dispatch.mode, "stage_first");
  assert.equal(dispatch.firstCommand, "uptime");
  assert.equal(dispatch.reason, "no_active_session");
});

test("buildSkillRunnerDispatch blocks unsafe plans", () => {
  const plan = buildSkillRunnerPlan({
    kind: "skill",
    server: "prod-web-01",
    capabilityName: "破坏性测试",
    entry: "skills/linux-health.md",
  }, evaluateCommandPolicy, {
    templates: {
      "skills/linux-health.md": [{ label: "危险命令", command: "rm -rf /var/log/nginx/*" }],
    },
  });
  const dispatch = buildSkillRunnerDispatch(plan, { sessionId: "session-1", canSend: true });

  assert.equal(dispatch.mode, "blocked");
  assert.equal(dispatch.reason, "skill_plan_not_ready");
  assert.equal(dispatch.commands.length, 0);
});

test("buildMcpRunnerPlan maps Prometheus endpoint to readonly metric queries", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "Prometheus",
    endpoint: "mcp://prometheus",
    targetFile: "/var/log/nginx/error.log",
  }, {
    host: "10.0.1.23",
    group: "生产环境",
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.connector, "prometheus");
  assert.equal(plan.transport, "builtin");
  assert.deepEqual(plan.requests.map((item) => item.tool), ["query_range", "query", "query"]);
  assert.equal(plan.requests[0].params.query.includes("10.0.1.23"), true);
  assert.match(plan.summary, /Prometheus/);
});

test("buildMcpRunnerPlan maps CMDB endpoint to asset lookup requests", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "CMDB",
    endpoint: "mcp://cmdb",
  }, {
    host: "10.0.1.23",
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.connector, "cmdb");
  assert.equal(plan.transport, "builtin");
  assert.deepEqual(plan.requests.map((item) => item.tool), ["get_host", "list_dependencies"]);
});

test("buildMcpRunnerPlan marks unknown endpoint as not ready", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "Grafana",
    endpoint: "mcp://grafana",
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.requests.length, 0);
  assert.match(plan.summary, /暂未配置/);
});

test("buildMcpRunnerPlan builds generic JSON-RPC plan for HTTP MCP endpoints", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "自建 MCP",
    endpoint: "https://mcp.example.com/mcp",
    headers: [{ name: "Authorization", value: "Bearer token", enabled: true }],
  }, {
    host: "10.0.1.23",
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.connector, "http-jsonrpc");
  assert.equal(plan.transport, "http");
  assert.deepEqual(plan.headers, [{ name: "Authorization", value: "Bearer token", enabled: true }]);
  assert.deepEqual(plan.requests.map((item) => item.method), ["initialize", "tools/list", "resources/list"]);
  assert.equal(plan.requests[0].params.clientInfo.name, "SSH Agent Tool");
  assert.equal(plan.requests[0].params.clientInfo.version, "stable");
  assert.equal(plan.summary, "MCP「自建 MCP」已生成 3 个 HTTP JSON-RPC 调用请求。");
});

test("formatMcpRunnerTerminalLines renders MCP request plan", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "CMDB",
    endpoint: "mcp://cmdb",
  }, {
    host: "10.0.1.23",
  });

  assert.deepEqual(formatMcpRunnerTerminalLines(plan).slice(0, 4), [
    "[prod-web-01]$ # Agent MCP Runner：CMDB",
    "# MCP「CMDB」已生成 2 个只读调用请求。",
    "# 1. 主机资产",
    "cmdb.get_host {\"host\":\"10.0.1.23\",\"name\":\"prod-web-01\"}",
  ]);
});

test("formatMcpRunnerTerminalLines renders HTTP JSON-RPC MCP requests", () => {
  const plan = buildMcpRunnerPlan({
    kind: "mcp",
    server: "prod-web-01",
    capabilityName: "自建 MCP",
    endpoint: "https://mcp.example.com/mcp",
  });

  assert.deepEqual(formatMcpRunnerTerminalLines(plan).slice(0, 4), [
    "[prod-web-01]$ # Agent MCP Runner：自建 MCP",
    "# MCP「自建 MCP」已生成 3 个 HTTP JSON-RPC 调用请求。",
    "# 1. 初始化连接",
    "POST https://mcp.example.com/mcp {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"clientInfo\":{\"name\":\"SSH Agent Tool\",\"version\":\"stable\"},\"capabilities\":{}}}",
  ]);
});

test("formatMcpHttpResultTerminalLines renders MCP HTTP execution result", () => {
  const lines = formatMcpHttpResultTerminalLines({
    server: "prod-web-01",
    capabilityName: "Custom MCP",
  }, {
    message: "MCP HTTP calls completed: 1/2 succeeded.",
    results: [
      { ok: true, label: "List tools", method: "tools/list", status: 200, response: { result: { tools: [] } }, message: "ok" },
      { ok: false, label: "List resources", method: "resources/list", status: 500, response: { error: "boom" }, message: "Server Error" },
    ],
  });

  assert.equal(lines[0], "[prod-web-01]$ # MCP HTTP 调用结果：Custom MCP");
  assert.equal(lines[1], "# MCP HTTP calls completed: 1/2 succeeded.");
  assert.equal(lines[2], "# 1. List tools 成功 status=200");
  assert.equal(lines[4], "# 2. List resources 失败 status=500");
  assert.equal(lines[5], "# Server Error");
  assert.equal(lines[6], "{\"error\":\"boom\"}");
});
