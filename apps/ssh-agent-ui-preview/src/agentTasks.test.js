import assert from "node:assert/strict";
import test from "node:test";

import {
  approveAgentTask,
  addAgentReportArchiveEntry,
  buildAgentInspectionReport,
  buildAgentReportArchiveEntry,
  buildAgentReportArchiveExport,
  buildAgentReportFileName,
  buildAgentTask,
  buildSshDiagnosticAgentTask,
  cancelAgentTask,
  completeAgentTask,
  filterAgentTasks,
  filterAgentReportArchives,
  getPendingAgentTasks,
  queueAgentTask,
  removeAgentReportArchiveEntry,
  summarizeAgentTasks,
} from "./agentTasks.js";

const serverContext = {
  serverName: "prod-web-01",
  fileName: "/var/log/nginx/error.log",
  createdAt: "2026-06-26T01:02:03.000Z",
};

test("buildAgentTask attaches safe SSH context to Skill tasks", () => {
  const task = buildAgentTask(
    {
      type: "Skill",
      name: "Custom log scan",
      entry: "skills/custom-log-scan.md",
      commands: [{ label: "Scan file", command: "tail -n 50 {{file}}" }],
    },
    {
      ...serverContext,
      server: {
        ip: "10.0.1.23",
        port: "2222",
        user: "root",
        cwd: "/var/www/app",
        group: "prod",
        password: "DoNotLeak",
        privateKey: "DoNotLeakKey",
      },
    },
  );

  assert.deepEqual(task.serverContext, {
    server: "prod-web-01",
    host: "10.0.1.23",
    ip: "10.0.1.23",
    port: "2222",
    user: "root",
    cwd: "/var/www/app",
    group: "prod",
    file: "/var/log/nginx/error.log",
  });
  assert.doesNotMatch(JSON.stringify(task), /DoNotLeak/);
});

test("buildAgentTask creates an approval-gated CLI task with command", () => {
  const task = buildAgentTask(
    {
      type: "CLI",
      name: "慢查询分析",
      entry: "mysql-slowlog --summary",
      permission: "审批后执行",
    },
    serverContext,
  );

  assert.equal(task.status, "待审批");
  assert.equal(task.capabilityType, "CLI");
  assert.equal(task.command, "mysql-slowlog --summary");
  assert.equal(task.targetServer, "prod-web-01");
  assert.equal(task.targetFile, "/var/log/nginx/error.log");
  assert.equal(task.risk, "中");
});

test("buildAgentTask creates readonly skill and mcp tasks", () => {
  const skillTask = buildAgentTask({
    type: "Skill",
    name: "Linux 健康检查",
    entry: "skills/linux-health.md",
    permission: "只读",
    commands: [{ label: "负载", command: "uptime" }],
  }, serverContext);
  const mcpTask = buildAgentTask({ type: "MCP", name: "Prometheus", endpoint: "mcp://prometheus" }, serverContext);

  assert.equal(skillTask.risk, "低");
  assert.equal(skillTask.command, "");
  assert.equal(skillTask.entry, "skills/linux-health.md");
  assert.deepEqual(skillTask.commands, [{ label: "负载", command: "uptime" }]);
  assert.equal(mcpTask.endpoint, "mcp://prometheus");
  assert.equal(mcpTask.title, "调用 Prometheus");
});

test("buildSshDiagnosticAgentTask creates readonly CLI task from SSH diagnostics", () => {
  const task = buildSshDiagnosticAgentTask(
    {
      kind: "timeout",
      title: "SSH 连接超时",
      commands: ["Test-NetConnection 10.0.1.23 -Port 22", "ssh -vvv root@10.0.1.23 -p 22"],
      nextSteps: ["检查安全组", "检查 sshd 端口"],
    },
    {
      serverName: "prod-web-01",
      server: { ip: "10.0.1.23", port: "22", user: "root", credentialRef: "sshcred-prod", password: "DoNotLeak" },
      createdAt: "2026-06-26T01:02:03.000Z",
    },
  );

  assert.equal(task.capabilityType, "CLI");
  assert.equal(task.capabilityName, "SSH 连接诊断");
  assert.equal(task.targetServer, "prod-web-01");
  assert.equal(task.permission, "只读");
  assert.equal(task.risk, "低");
  assert.equal(task.command, "local:ssh-agent-tool diagnose-ssh --host 10.0.1.23 --port 22 --kind timeout");
  assert.match(task.description, /SSH 连接超时/);
  assert.doesNotMatch(JSON.stringify(task), /sshcred-prod|DoNotLeak/);
});

test("queueAgentTask avoids duplicate pending tasks for same server and capability", () => {
  const task = buildAgentTask({ type: "Skill", name: "Linux 健康检查" }, serverContext);
  const first = queueAgentTask([], task);
  const second = queueAgentTask(first, task);

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});

test("approveAgentTask and completeAgentTask move task status forward", () => {
  const task = buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, serverContext);
  const approved = approveAgentTask([task], task.id, "2026-06-26T01:02:03.000Z");
  assert.equal(approved[0].status, "已审批");
  assert.equal(approved[0].approvedAt, "2026-06-26T01:02:03.000Z");

  const completed = completeAgentTask(approved, task.id, "已写入终端", "2026-06-26T01:02:03.000Z");
  assert.equal(completed[0].status, "已完成");
  assert.equal(completed[0].result, "已写入终端");
});

test("getPendingAgentTasks returns only tasks waiting for approval", () => {
  const pending = buildAgentTask({ type: "Skill", name: "Linux 健康检查" }, serverContext);
  const approved = approveAgentTask([buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, serverContext)], "task-cli-磁盘检查-prod-web-01");

  assert.deepEqual(getPendingAgentTasks([pending, ...approved]).map((item) => item.status), ["待审批"]);
});

test("cancelAgentTask records cancellation and removes task from pending approvals", () => {
  const task = buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, serverContext);
  const cancelled = cancelAgentTask([task], task.id, "用户取消", "2026-06-26T01:03:00.000Z");

  assert.equal(cancelled[0].status, "已取消");
  assert.equal(cancelled[0].result, "用户取消");
  assert.equal(cancelled[0].cancelledAt, "2026-06-26T01:03:00.000Z");
  assert.deepEqual(getPendingAgentTasks(cancelled), []);
  assert.deepEqual(summarizeAgentTasks(cancelled), {
    total: 1,
    pending: 0,
    approved: 0,
    completed: 0,
    cancelled: 1,
    byType: { Skill: 0, MCP: 0, CLI: 1 },
  });
});

test("cancelAgentTask does not rewrite completed task history", () => {
  const task = buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, serverContext);
  const completed = completeAgentTask([task], task.id, "已完成", "2026-06-26T01:03:00.000Z");
  const next = cancelAgentTask(completed, task.id, "用户取消", "2026-06-26T01:04:00.000Z");

  assert.equal(next[0].status, "已完成");
  assert.equal(next[0].result, "已完成");
  assert.equal(next[0].cancelledAt, undefined);
});

test("filterAgentTasks filters history by server type status and query", () => {
  const skill = buildAgentTask({ type: "Skill", name: "Linux 健康检查" }, serverContext);
  const cli = completeAgentTask(
    approveAgentTask([buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, { ...serverContext, serverName: "prod-db-01" })], "task-cli-磁盘检查-prod-db-01"),
    "task-cli-磁盘检查-prod-db-01",
    "磁盘使用率 87%",
  )[0];
  const mcp = approveAgentTask(
    [buildAgentTask({ type: "MCP", name: "Prometheus", endpoint: "mcp://prometheus" }, { ...serverContext, serverName: "prod-web-01" })],
    "task-mcp-Prometheus-prod-web-01",
  )[0];

  assert.deepEqual(filterAgentTasks([skill, cli, mcp], { server: "prod-web-01", capabilityType: "MCP" }).map((item) => item.capabilityName), ["Prometheus"]);
  assert.deepEqual(filterAgentTasks([skill, cli, mcp], { status: cli.status }).map((item) => item.capabilityName), ["磁盘检查"]);
  assert.deepEqual(filterAgentTasks([skill, cli, mcp], { query: "87%" }).map((item) => item.capabilityName), ["磁盘检查"]);
});

test("summarizeAgentTasks counts status and capability types", () => {
  const skill = buildAgentTask({ type: "Skill", name: "Linux 健康检查" }, serverContext);
  const cli = completeAgentTask(
    approveAgentTask([buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, serverContext)], "task-cli-磁盘检查-prod-web-01"),
    "task-cli-磁盘检查-prod-web-01",
    "完成",
  )[0];
  const mcp = approveAgentTask([buildAgentTask({ type: "MCP", name: "Prometheus" }, serverContext)], "task-mcp-Prometheus-prod-web-01")[0];

  assert.deepEqual(summarizeAgentTasks([skill, cli, mcp]), {
    total: 3,
    pending: 1,
    approved: 1,
    completed: 1,
    cancelled: 0,
    byType: { Skill: 1, MCP: 1, CLI: 1 },
  });
});

test("buildAgentInspectionReport groups task results by server", () => {
  const pending = buildAgentTask({ type: "Skill", name: "Linux 健康检查" }, serverContext);
  const completed = completeAgentTask(
    approveAgentTask([buildAgentTask({ type: "CLI", name: "磁盘检查", entry: "df -hT" }, { ...serverContext, serverName: "prod-db-01" })], "task-cli-磁盘检查-prod-db-01"),
    "task-cli-磁盘检查-prod-db-01",
    "磁盘使用率 87%，需要关注。",
  )[0];

  const report = buildAgentInspectionReport([pending, completed], {
    "prod-web-01": { ip: "10.0.1.23", group: "生产环境", state: "在线" },
    "prod-db-01": { ip: "10.0.1.31", group: "生产环境", state: "警告" },
  });

  assert.match(report, /# Agent 巡检报告/);
  assert.match(report, /总任务 2，待审批 1，已审批 0，已完成 1/);
  assert.match(report, /## prod-db-01/);
  assert.match(report, /磁盘使用率 87%，需要关注。/);
});

test("buildAgentInspectionReport explains when there are no tasks", () => {
  const report = buildAgentInspectionReport([], {});

  assert.match(report, /暂无 Agent 巡检任务/);
});

test("buildAgentReportFileName creates a safe markdown filename", () => {
  const fileName = buildAgentReportFileName({
    title: "生产环境 / Nginx 巡检",
    now: new Date("2026-06-26T02:30:45.000Z"),
  });

  assert.equal(fileName, "ssh-agent-inspection-20260626-023045-生产环境-Nginx-巡检.md");
});

test("buildAgentReportArchiveEntry stores report metadata and content", () => {
  const entry = buildAgentReportArchiveEntry({
    title: "生产巡检",
    report: "# Agent 巡检报告\n\n内容",
    taskCount: 3,
    createdAt: "2026-06-26T02:30:45.000Z",
  });

  assert.equal(entry.title, "生产巡检");
  assert.equal(entry.taskCount, 3);
  assert.equal(entry.content, "# Agent 巡检报告\n\n内容");
  assert.equal(entry.fileName, "ssh-agent-inspection-20260626-023045-生产巡检.md");
  assert.equal(entry.createdAt, "2026-06-26T02:30:45.000Z");
});

test("addAgentReportArchiveEntry prepends archives and limits history", () => {
  const current = [
    { id: "old-1", createdAt: "2026-06-26T01:00:00.000Z" },
    { id: "old-2", createdAt: "2026-06-26T00:00:00.000Z" },
  ];
  const entry = buildAgentReportArchiveEntry({
    title: "最新巡检",
    report: "内容",
    taskCount: 1,
    createdAt: "2026-06-26T02:00:00.000Z",
  });

  const next = addAgentReportArchiveEntry(current, entry, 2);

  assert.deepEqual(next.map((item) => item.id), [entry.id, "old-1"]);
});

test("filterAgentReportArchives searches title filename and content", () => {
  const archives = [
    buildAgentReportArchiveEntry({
      title: "生产 Nginx 巡检",
      report: "upstream 连接拒绝",
      taskCount: 2,
      createdAt: "2026-06-26T02:00:00.000Z",
    }),
    buildAgentReportArchiveEntry({
      title: "测试 Docker 巡检",
      report: "容器运行正常",
      taskCount: 1,
      createdAt: "2026-06-26T01:00:00.000Z",
    }),
  ];

  assert.deepEqual(filterAgentReportArchives(archives, "upstream").map((item) => item.title), ["生产 Nginx 巡检"]);
  assert.deepEqual(filterAgentReportArchives(archives, "docker").map((item) => item.title), ["测试 Docker 巡检"]);
});

test("removeAgentReportArchiveEntry removes only the selected archive", () => {
  const archives = [
    { id: "keep", title: "保留", content: "" },
    { id: "delete", title: "删除", content: "" },
  ];

  assert.deepEqual(removeAgentReportArchiveEntry(archives, "delete").map((item) => item.id), ["keep"]);
});

test("buildAgentReportArchiveExport serializes archive list with schema metadata", () => {
  const archives = [
    buildAgentReportArchiveEntry({
      title: "生产巡检",
      report: "内容",
      taskCount: 1,
      createdAt: "2026-06-26T02:00:00.000Z",
    }),
  ];

  const payload = JSON.parse(buildAgentReportArchiveExport(archives, { exportedAt: "2026-06-26T03:00:00.000Z" }));

  assert.equal(payload.schema, "ssh-agent-report-archive-v1");
  assert.equal(payload.exportedAt, "2026-06-26T03:00:00.000Z");
  assert.equal(payload.archives[0].title, "生产巡检");
});
