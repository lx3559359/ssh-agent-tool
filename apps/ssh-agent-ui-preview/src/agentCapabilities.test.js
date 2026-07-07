import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_AGENT_CAPABILITIES,
  addAgentCapability,
  buildCapabilityDraft,
  removeAgentCapability,
  setAgentCapabilityEnabled,
  mergeAgentCapabilities,
  parseMcpHeaderLines,
  validateAgentCapability,
} from "./agentCapabilities.js";

test("mergeAgentCapabilities keeps built-ins and adds valid custom capabilities", () => {
  const result = mergeAgentCapabilities([
    { type: "Skill", name: "Nginx 深度排查", description: "读取 nginx 配置和错误日志", entry: "skills/nginx.md" },
    { type: "MCP", name: "Grafana", endpoint: "http://127.0.0.1:3000/mcp" },
  ]);

  assert.equal(result[0].builtin, true);
  assert.ok(result.some((item) => item.name === "Linux 健康检查"));
  assert.ok(result.some((item) => item.type === "MCP" && item.name === "Grafana"));
});

test("addAgentCapability normalizes type specific fields and rejects duplicates", () => {
  const current = mergeAgentCapabilities([]);
  const added = addAgentCapability(current, {
    type: "CLI",
    name: "慢查询分析",
    entry: "mysql-slowlog --summary",
    permission: "审批后执行",
  });

  const cli = added.find((item) => item.name === "慢查询分析");
  assert.equal(cli.type, "CLI");
  assert.equal(cli.entry, "mysql-slowlog --summary");
  assert.equal(cli.permission, "审批后执行");

  assert.throws(
    () => addAgentCapability(added, { type: "CLI", name: "慢查询分析", entry: "again" }),
    /已存在/,
  );
});

test("buildCapabilityDraft maps user input into skill, mcp, and cli drafts", () => {
  assert.deepEqual(buildCapabilityDraft("Skill", "Linux 巡检"), {
    type: "Skill",
    name: "Linux 巡检",
    description: "自定义 Skill",
    entry: "Linux 巡检",
    permission: "只读",
  });
  assert.equal(buildCapabilityDraft("MCP", "Prometheus").endpoint, "Prometheus");
  assert.equal(buildCapabilityDraft("CLI", "ssh-ai diagnose").entry, "ssh-ai diagnose");
});

test("buildCapabilityDraft accepts a Skill JSON package with metadata", () => {
  const draft = buildCapabilityDraft("Skill", JSON.stringify({
    schema: "ssh-agent-tool.skill.v1",
    name: "Redis 延迟排查",
    description: "检查 Redis 慢命令、连接数和内存碎片率",
    entry: "skills/redis-latency.md",
    version: "1.2.0",
    tags: ["redis", "性能"],
    parameters: [
      { name: "database", description: "Redis 实例名称", required: true },
    ],
    commands: [
      { label: "慢命令", command: "redis-cli slowlog get 10" },
      { label: "内存", command: "redis-cli info memory" },
    ],
  }));

  assert.equal(draft.name, "Redis 延迟排查");
  assert.equal(draft.description, "检查 Redis 慢命令、连接数和内存碎片率");
  assert.equal(draft.entry, "skills/redis-latency.md");
  assert.equal(draft.version, "1.2.0");
  assert.deepEqual(draft.tags, ["redis", "性能"]);
  assert.deepEqual(draft.parameters, [
    { name: "database", description: "Redis 实例名称", required: true },
  ]);
  assert.deepEqual(draft.commands, [
    { label: "慢命令", command: "redis-cli slowlog get 10" },
    { label: "内存", command: "redis-cli info memory" },
  ]);
});

test("buildCapabilityDraft imports a Skill markdown file using the file name as the skill name", () => {
  const draft = buildCapabilityDraft("Skill", "# Redis 延迟排查\n\n检查慢命令和连接数。", {
    sourceFileName: "redis-latency.skill.md",
  });

  assert.equal(draft.type, "Skill");
  assert.equal(draft.name, "redis-latency");
  assert.equal(draft.entry, "redis-latency.skill.md");
  assert.equal(draft.description, "自定义 Skill：redis-latency");
  assert.equal(draft.docs, "# Redis 延迟排查\n\n检查慢命令和连接数。");
});

test("buildCapabilityDraft prefixes local CLI entries when execution target is local", () => {
  const localDraft = buildCapabilityDraft("CLI", "ssh-ai diagnose --json", { cliTarget: "local" });
  const sshDraft = buildCapabilityDraft("CLI", "df -hT", { cliTarget: "ssh" });

  assert.equal(localDraft.entry, "local:ssh-ai diagnose --json");
  assert.equal(localDraft.executionTarget, "local");
  assert.equal(sshDraft.entry, "df -hT");
  assert.equal(sshDraft.executionTarget, "ssh");
});

test("buildCapabilityDraft creates MCP capability with endpoint and header lines", () => {
  const draft = buildCapabilityDraft("MCP", "Internal MCP", {
    endpoint: "https://mcp.example.com/rpc",
    headersText: "Authorization: Bearer token\nX-Team: ops\ninvalid",
  });

  assert.equal(draft.name, "Internal MCP");
  assert.equal(draft.endpoint, "https://mcp.example.com/rpc");
  assert.deepEqual(draft.headers, [
    { name: "Authorization", value: "Bearer token", enabled: true, sensitive: true },
    { name: "X-Team", value: "ops", enabled: true },
  ]);
});

test("parseMcpHeaderLines ignores invalid and empty header rows", () => {
  assert.deepEqual(parseMcpHeaderLines("Authorization: Bearer token\n\nNoColon\nX-Env: prod"), [
    { name: "Authorization", value: "Bearer token", enabled: true, sensitive: true },
    { name: "X-Env", value: "prod", enabled: true },
  ]);
});

test("validateAgentCapability preserves enabled MCP headers", () => {
  const capability = validateAgentCapability({
    type: "MCP",
    name: "Internal MCP",
    endpoint: "https://mcp.example.com/rpc",
    headers: [
      { name: "Authorization", value: "Bearer token", enabled: true },
      { name: "X-Disabled", value: "nope", enabled: false },
      { name: " ", value: "ignored", enabled: true },
    ],
  });

  assert.deepEqual(capability.headers, [
    { name: "Authorization", value: "Bearer token", enabled: true, sensitive: true },
    { name: "X-Disabled", value: "nope", enabled: false },
  ]);
});

test("validateAgentCapability preserves Skill metadata for future extension", () => {
  const capability = validateAgentCapability({
    type: "Skill",
    name: "JVM 内存排查",
    entry: "skills/jvm-memory.md",
    version: "0.3.1",
    tags: "java, jvm，memory",
    parameters: [
      { name: "process", description: "Java 进程名", required: false },
      { name: "", description: "ignored" },
    ],
    commands: [
      { label: "JVM 进程", command: "jps -lv" },
      { label: "危险命令缺命令体" },
    ],
    docs: "检查 jstat、GC 日志和堆使用。",
  });

  assert.equal(capability.version, "0.3.1");
  assert.deepEqual(capability.tags, ["java", "jvm", "memory"]);
  assert.deepEqual(capability.parameters, [
    { name: "process", description: "Java 进程名", required: false },
  ]);
  assert.deepEqual(capability.commands, [
    { label: "JVM 进程", command: "jps -lv" },
  ]);
  assert.equal(capability.docs, "检查 jstat、GC 日志和堆使用。");
});

test("validateAgentCapability rejects unsupported types and empty names", () => {
  assert.throws(() => validateAgentCapability({ type: "HTTP", name: "X" }), /不支持/);
  assert.throws(() => validateAgentCapability({ type: "Skill", name: " " }), /名称/);
});

test("default capabilities include skill, mcp, and cli extension points", () => {
  assert.deepEqual(
    DEFAULT_AGENT_CAPABILITIES.map((item) => item.type),
    ["Skill", "Skill", "Skill", "MCP", "MCP", "CLI"],
  );
});

test("builtin CLI capability is described as an available approved runner", () => {
  const cli = DEFAULT_AGENT_CAPABILITIES.find((item) => item.id === "builtin-cli-ssh-ai");

  assert.equal(cli.type, "CLI");
  assert.equal(cli.status, "可用");
  assert.equal(cli.permission, "审批后执行");
  assert.match(cli.description, /审批执行队列/);
  assert.doesNotMatch(cli.description, /后续|占位|待完善/);
});

test("setAgentCapabilityEnabled toggles only custom capabilities", () => {
  const capabilities = mergeAgentCapabilities([
    { id: "custom-skill-nginx", type: "Skill", name: "Nginx 深度排查", entry: "skills/nginx.md" },
  ]);

  const disabled = setAgentCapabilityEnabled(capabilities, "custom-skill-nginx", false);
  const custom = disabled.find((item) => item.id === "custom-skill-nginx");
  const builtin = disabled.find((item) => item.builtin);

  assert.equal(custom.enabled, false);
  assert.equal(custom.status, "停用");
  assert.equal(builtin.enabled, true);
});

test("removeAgentCapability removes custom capabilities but keeps builtins", () => {
  const capabilities = mergeAgentCapabilities([
    { id: "custom-cli-slowlog", type: "CLI", name: "慢查询分析", entry: "mysql-slowlog --summary" },
  ]);
  const builtinId = DEFAULT_AGENT_CAPABILITIES[0].id;

  const afterCustomRemove = removeAgentCapability(capabilities, "custom-cli-slowlog");
  const afterBuiltinRemove = removeAgentCapability(afterCustomRemove, builtinId);

  assert.equal(afterCustomRemove.some((item) => item.id === "custom-cli-slowlog"), false);
  assert.equal(afterBuiltinRemove.some((item) => item.id === builtinId), true);
});
