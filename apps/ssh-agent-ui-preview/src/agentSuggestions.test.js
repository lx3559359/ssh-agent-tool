import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentAttachmentContext,
  buildAgentSftpPreviewContext,
  buildAgentSuggestionPrompt,
  buildAgentTerminalContext,
  parseAgentActionSuggestions,
} from "./agentSuggestions.js";

test("parseAgentActionSuggestions extracts skill mcp and cli actions from model JSON block", () => {
  const text = [
    "建议先做只读排查。",
    "```json",
    JSON.stringify({
      agentActions: [
        { type: "Skill", name: "Linux 健康检查", entry: "skills/linux-health.md", reason: "先看系统负载" },
        { type: "MCP", name: "Prometheus", endpoint: "mcp://prometheus", reason: "查询指标" },
        { type: "CLI", name: "查看 Nginx 错误日志", command: "tail -n 200 /var/log/nginx/error.log", reason: "读取错误日志" },
      ],
    }),
    "```",
  ].join("\n");

  const suggestions = parseAgentActionSuggestions(text);

  assert.deepEqual(suggestions.map((item) => ({
    type: item.type,
    name: item.name,
    entry: item.entry,
    endpoint: item.endpoint,
    reason: item.reason,
  })), [
    { type: "Skill", name: "Linux 健康检查", entry: "skills/linux-health.md", endpoint: "", reason: "先看系统负载" },
    { type: "MCP", name: "Prometheus", entry: "", endpoint: "mcp://prometheus", reason: "查询指标" },
    { type: "CLI", name: "查看 Nginx 错误日志", entry: "tail -n 200 /var/log/nginx/error.log", endpoint: "", reason: "读取错误日志" },
  ]);
});

test("parseAgentActionSuggestions ignores unsupported or dangerous action payloads", () => {
  const text = JSON.stringify({
    agentActions: [
      { type: "Browser", name: "打开网页" },
      { type: "CLI", name: "删除日志", command: "rm -rf /var/log/*" },
      { type: "CLI", name: "安全读取", command: "df -hT" },
      { type: "MCP", name: "" },
    ],
  });

  const suggestions = parseAgentActionSuggestions(text);

  assert.deepEqual(suggestions.map((item) => item.name), ["安全读取"]);
});

test("buildAgentSuggestionPrompt tells the model how to propose queueable actions", () => {
  const prompt = buildAgentSuggestionPrompt([
    { type: "Skill", name: "Linux 健康检查", entry: "skills/linux-health.md" },
    { type: "MCP", name: "Prometheus", endpoint: "mcp://prometheus" },
  ]);

  assert.match(prompt, /你是这个 SSH 工具内置的 Agent/);
  assert.match(prompt, /agentActions/);
  assert.match(prompt, /Skill/);
  assert.match(prompt, /MCP/);
  assert.match(prompt, /CLI/);
  assert.match(prompt, /Linux 健康检查/);
});

test("buildAgentTerminalContext includes recent terminal lines and redacts secrets", () => {
  const context = buildAgentTerminalContext([
    "[prod-web-01]$ uptime",
    "load average: 0.42, 0.35, 0.28",
    "password=SuperSecret123",
    "Authorization: Bearer real-token",
    "[prod-web-01]$ tail -n 20 /var/log/nginx/error.log",
    "connect() failed (111: Connection refused) while connecting to upstream",
  ], { maxLines: 4, maxChars: 220 });

  assert.match(context, /最近 SSH 终端输出/);
  assert.match(context, /tail -n 20/);
  assert.match(context, /Connection refused/);
  assert.doesNotMatch(context, /SuperSecret123|real-token/);
  assert.match(context, /已脱敏/);
  assert.doesNotMatch(context, /load average/);
});

test("buildAgentSftpPreviewContext includes selected text preview and redacts secrets", () => {
  const context = buildAgentSftpPreviewContext({
    remotePath: "/etc/nginx/nginx.conf",
    content: [
      "server {",
      "  proxy_pass http://127.0.0.1:9000;",
      "  proxy_set_header Authorization Bearer real-token;",
      "  error_log /var/log/nginx/error.log;",
      "}",
    ].join("\n"),
    size: 128,
    encoding: "utf-8",
  }, { maxLines: 4, maxChars: 260 });

  assert.match(context, /当前 SFTP 预览文件/);
  assert.match(context, /\/etc\/nginx\/nginx.conf/);
  assert.match(context, /proxy_pass/);
  assert.match(context, /error_log/);
  assert.doesNotMatch(context, /real-token/);
  assert.match(context, /已脱敏/);
});

test("buildAgentAttachmentContext redacts uploaded and referenced attachment content", () => {
  const context = buildAgentAttachmentContext([
    {
      type: "terminal",
      name: "当前 SSH 输出",
      content: [
        "curl -H 'Authorization: Bearer real-token' https://api.example.com",
        "password=SuperSecret123",
        "nginx error log",
      ].join("\n"),
    },
    {
      type: "file",
      name: ".env",
      content: [
        "API_KEY=sk-real-secret",
        "APP_ENV=prod",
      ].join("\n"),
    },
  ], { maxLines: 8, maxChars: 500 });

  assert.match(context, /用户上传或引用的附件/);
  assert.match(context, /当前 SSH 输出/);
  assert.match(context, /\.env/);
  assert.match(context, /nginx error log/);
  assert.match(context, /APP_ENV=prod/);
  assert.doesNotMatch(context, /real-token|SuperSecret123|sk-real-secret/);
  assert.match(context, /已脱敏/);
});
