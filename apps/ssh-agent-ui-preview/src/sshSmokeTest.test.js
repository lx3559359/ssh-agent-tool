import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSshSmokeTestSummaryText,
  buildSshSmokeTestReport,
  buildSshSmokeTestStepRows,
  formatSshSmokeStatus,
  getSshSmokeTestOutcome,
  summarizeSshSmokeTestSteps,
} from "./sshSmokeTest.js";

test("basic smoke test rows summarize pass fail and skipped steps in Chinese", () => {
  const steps = [
    { label: "连接 SSH 会话", status: "ok", message: "已连接" },
    { label: "SFTP 列目录", status: "skipped", message: "接口不可用" },
    { label: "Ctrl+C 中断", status: "failed", message: "中断失败" },
  ];

  assert.deepEqual(summarizeSshSmokeTestSteps(steps), { total: 3, ok: 1, failed: 1, skipped: 1 });
  assert.equal(formatSshSmokeStatus("ok"), "通过");
  assert.equal(formatSshSmokeStatus("skipped"), "跳过");
  assert.equal(formatSshSmokeStatus("failed"), "失败");

  const rows = buildSshSmokeTestStepRows({ serverName: "prod-web-01", steps, startedAt: "2026-07-07T14:20:00Z", finishedAt: "2026-07-07T14:21:00Z" });
  assert.match(rows[0], /prod-web-01/);
  assert.match(rows[0], /一键基础自检开始/);
  assert.match(rows.join("\n"), /\[通过\] 连接 SSH 会话：已连接/);
  assert.match(rows.join("\n"), /\[跳过\] SFTP 列目录：接口不可用/);
  assert.match(rows.at(-1), /基础自检完成：通过 1，失败 1，跳过 1，请查看失败处理建议/);
});

test("basic smoke test summary calls out skipped checks when there are no failures", () => {
  assert.equal(
    buildSshSmokeTestSummaryText({ ok: 3, failed: 0, skipped: 1 }),
    "基础自检完成：通过 3，失败 0，跳过 1，有跳过项，请在正式客户端连接真实服务器后复测",
  );
  assert.equal(
    buildSshSmokeTestSummaryText({ ok: 2, failed: 1, skipped: 1 }),
    "基础自检完成：通过 2，失败 1，跳过 1，请查看失败处理建议",
  );
  assert.equal(
    buildSshSmokeTestSummaryText({ ok: 4, failed: 0, skipped: 0 }),
    "基础自检完成：通过 4，失败 0，跳过 0",
  );
});

test("basic smoke test outcome marks skipped only runs as warning", () => {
  assert.deepEqual(getSshSmokeTestOutcome({ ok: 4, failed: 0, skipped: 0 }), {
    ok: true,
    status: "ok",
    level: "info",
  });
  assert.deepEqual(getSshSmokeTestOutcome({ ok: 3, failed: 0, skipped: 1 }), {
    ok: false,
    status: "warning",
    level: "warn",
  });
  assert.deepEqual(getSshSmokeTestOutcome({ ok: 2, failed: 1, skipped: 1 }), {
    ok: false,
    status: "failed",
    level: "warn",
  });
});

test("basic smoke test outcome treats zero executed checks as failed", () => {
  assert.deepEqual(getSshSmokeTestOutcome({ total: 0, ok: 0, failed: 0, skipped: 0 }), {
    ok: false,
    status: "failed",
    level: "warn",
  });
});

test("basic smoke test report states a clear final verdict", () => {
  const cleanReport = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    steps: [
      { label: "连接 SSH 会话", status: "ok", message: "已连接" },
      { label: "回车执行命令", status: "ok", message: "ssh-agent-smoke-ok" },
    ],
  });
  assert.match(cleanReport, /最终判定：通过/);

  const skippedReport = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    steps: [
      { label: "连接 SSH 会话", status: "ok", message: "已连接" },
      { label: "SFTP 临时文件读写", status: "skipped", message: "缺少接口" },
    ],
  });
  assert.match(skippedReport, /最终判定：需复测/);
  assert.match(skippedReport, /存在跳过项/);

  const failedReport = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    steps: [{ label: "连接 SSH 会话", status: "failed", message: "认证失败" }],
  });
  assert.match(failedReport, /最终判定：失败/);
  assert.match(failedReport, /存在失败项/);
});

test("basic smoke test report redacts secrets and keeps markdown table readable", () => {
  const report = buildSshSmokeTestReport({
    serverName: "prod-db-01",
    server: { ip: "10.0.1.31", port: "22", user: "root", credentialRef: "sshcred-secret" },
    startedAt: "2026-07-07T14:20:00Z",
    finishedAt: "2026-07-07T14:21:00Z",
    steps: [{ label: "回车执行命令", status: "ok", message: "ssh-agent-smoke-ok" }],
  });

  assert.match(report, /# 基础自检报告/);
  assert.match(report, /覆盖范围：SSH 会话、命令回车执行、Ctrl\+C 中断、SFTP 基础读写能力/);
  assert.match(report, /服务器：prod-db-01/);
  assert.match(report, /\| 回车执行命令 \| 通过 \| ssh-agent-smoke-ok \|/);
  assert.doesNotMatch(report, /sshcred-secret/);
  assert.match(report, /不包含密码、私钥、凭据引用或 API Key/);
});

test("basic smoke test report includes real SSH acceptance steps and failure guidance", () => {
  const report = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    server: { ip: "10.0.1.23", port: "22", user: "root", credentialRef: "sshcred-prod" },
    startedAt: "2026-07-07T14:20:00Z",
    finishedAt: "2026-07-07T14:21:00Z",
    steps: [
      { label: "连接 SSH 会话", status: "ok", message: "临时 SSH 会话已建立。" },
      { label: "回车执行命令", status: "failed", message: "命令发送失败。" },
      { label: "SFTP 临时文件读写", status: "skipped", message: "目标目录不可写。" },
    ],
  });

  assert.match(report, /## 真实服务器人工验收清单/);
  assert.match(report, /连接服务器后直接输入 `pwd` 或 `whoami`，按 Enter 应立即执行，不需要二次确认/);
  assert.match(report, /执行 `sleep 30` 后按 Ctrl\+C，应能中断远程命令并回到提示符/);
  assert.match(report, /SFTP 中上传、预览、下载并删除一个临时文本文件/);
  assert.match(report, /## 失败处理建议/);
  assert.match(report, /回车执行命令：检查 SSH 会话是否仍在线、终端输入焦点是否在命令框、会话日志里是否有发送失败记录/);
  assert.match(report, /## 跳过项说明/);
  assert.match(report, /SFTP 临时文件读写：目标目录不可写。/);
  assert.doesNotMatch(report, /SFTP 临时文件读写：检查当前远程目录权限，也可以切换到 `/);
  assert.doesNotMatch(report, /sshcred-prod/);
});

test("basic smoke test report tells trial users what evidence to export after a real SSH run", () => {
  const report = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    server: { ip: "10.0.1.23", port: "22", user: "root", credentialRef: "sshcred-prod" },
    startedAt: "2026-07-07T14:20:00Z",
    finishedAt: "2026-07-07T14:21:00Z",
    steps: [
      { label: "连接 SSH 会话", status: "ok", message: "临时 SSH 会话已建立。" },
      { label: "回车执行命令", status: "ok", message: "ssh-agent-smoke-ok" },
      { label: "Ctrl+C 中断", status: "ok", message: "Ctrl+C 后 SSH 会话仍可继续执行命令。" },
      { label: "SFTP 临时文件读写", status: "ok", message: "临时文件已创建、写入并读回校验。" },
    ],
  });

  assert.match(report, /## 交付开发者的排障证据/);
  assert.match(report, /导出基础自检报告/);
  assert.match(report, /导出诊断包/);
  assert.match(report, /复制 SSH 诊断摘要/);
  assert.match(report, /工具日志/);
  assert.match(report, /会话日志/);
  assert.match(report, /不要截图或粘贴密码、私钥、API Key/);
  assert.doesNotMatch(report, /sshcred-prod/);
});

test("basic smoke test report explains skipped checks separately from failures", () => {
  const report = buildSshSmokeTestReport({
    serverName: "prod-web-01",
    server: { ip: "10.0.1.23", port: "22", user: "root", credentialRef: "sshcred-prod" },
    startedAt: "2026-07-07T14:20:00Z",
    finishedAt: "2026-07-07T14:21:00Z",
    steps: [
      { label: "连接 SSH 会话", status: "ok", message: "临时 SSH 会话已建立。" },
      { label: "回车执行命令", status: "ok", message: "ssh-agent-smoke-ok" },
      { label: "SFTP 临时文件读写", status: "skipped", message: "当前环境没有完整的 SFTP 读写桥接接口。" },
    ],
  });

  assert.match(report, /## 跳过项说明/);
  assert.match(report, /跳过不等于失败/);
  assert.match(report, /SFTP 临时文件读写：当前环境没有完整的 SFTP 读写桥接接口。/);
  assert.match(report, /请在正式 Windows 客户端中连接真实服务器后重新运行一键基础自检/);
  assert.doesNotMatch(report, /sshcred-prod/);
});
