function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function summarizeSshSmokeTestSteps(steps = []) {
  const summary = { total: 0, ok: 0, failed: 0, skipped: 0 };
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    summary.total += 1;
    const status = safeText(step?.status, "failed");
    if (status === "ok") summary.ok += 1;
    else if (status === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  });
  return summary;
}

export function buildSshSmokeTestSummaryText(summary = {}) {
  const ok = Number(summary?.ok || 0);
  const failed = Number(summary?.failed || 0);
  const skipped = Number(summary?.skipped || 0);
  const base = `基础自检完成：通过 ${ok}，失败 ${failed}，跳过 ${skipped}`;
  if (failed > 0) return `${base}，请查看失败处理建议`;
  if (skipped > 0) return `${base}，有跳过项，请在正式客户端连接真实服务器后复测`;
  return base;
}

export function getSshSmokeTestOutcome(summary = {}) {
  const ok = Number(summary?.ok || 0);
  const failed = Number(summary?.failed || 0);
  const skipped = Number(summary?.skipped || 0);
  const total = summary?.total == null ? ok + failed + skipped : Number(summary.total || 0);
  if (total <= 0) return { ok: false, status: "failed", level: "warn" };
  if (failed > 0) return { ok: false, status: "failed", level: "warn" };
  if (skipped > 0) return { ok: false, status: "warning", level: "warn" };
  return { ok: true, status: "ok", level: "info" };
}

export function formatSshSmokeStatus(status) {
  if (status === "ok") return "通过";
  if (status === "skipped") return "跳过";
  return "失败";
}

export function formatSshSmokeOutcome(summary = {}) {
  const outcome = getSshSmokeTestOutcome(summary);
  if (outcome.status === "ok") return "最终判定：通过";
  if (outcome.status === "warning") return "最终判定：需复测（存在跳过项）";
  return "最终判定：失败（存在失败项）";
}

export function buildSshSmokeTestStepRows({ serverName = "", steps = [], startedAt = "", finishedAt = "" } = {}) {
  const name = safeText(serverName, "当前服务器");
  const rows = [`[${name}]$ # 一键基础自检开始${startedAt ? `：${startedAt}` : ""}`];
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    const label = safeText(step?.label, "未命名步骤");
    const message = safeText(step?.message, "");
    rows.push(`# [${formatSshSmokeStatus(step?.status)}] ${label}${message ? `：${message}` : ""}`);
  });
  const summary = summarizeSshSmokeTestSteps(steps);
  rows.push(`# ${buildSshSmokeTestSummaryText(summary)}${finishedAt ? `，完成时间 ${finishedAt}` : ""}`);
  return rows;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function buildSmokeFailureAdvice(step = {}) {
  const label = safeText(step?.label, "");
  const status = safeText(step?.status, "failed");
  if (status === "ok") return "";
  if (status === "skipped") return "";
  if (label.includes("连接") || label.includes("认证")) {
    return `${label}：检查 IP、端口、网络连通性、用户名、密码/私钥、主机指纹信任和防火墙策略。`;
  }
  if (label.includes("回车") || label.includes("命令")) {
    return `${label}：检查 SSH 会话是否仍在线、终端输入焦点是否在命令框、会话日志里是否有发送失败记录。`;
  }
  if (label.includes("Ctrl+C") || label.includes("中断")) {
    return `${label}：检查远程命令是否已启动，确认会话没有断开；必要时使用“强制断开会话”后重连。`;
  }
  if (label.includes("SFTP")) {
    return `${label}：检查当前远程目录权限，也可以切换到 \`/tmp\` 后重试上传、预览、下载和删除临时文件。`;
  }
  return `${label || "未命名步骤"}：打开会话日志和工具日志，导出诊断包后继续排查。`;
}

function buildSmokeFailureAdviceLines(steps = []) {
  const advice = (Array.isArray(steps) ? steps : [])
    .map((step) => buildSmokeFailureAdvice(step))
    .filter(Boolean);
  if (!advice.length) {
    return [
      "## 失败处理建议",
      "",
      "- 本次基础自检未发现失败项。若真实服务器仍异常，请导出会话日志、工具日志和诊断包继续排查。",
    ];
  }
  return ["## 失败处理建议", "", ...advice.map((item) => `- ${item}`)];
}

function buildSmokeSkippedLines(steps = []) {
  const skipped = (Array.isArray(steps) ? steps : [])
    .filter((step) => safeText(step?.status, "") === "skipped")
    .map((step) => {
      const label = safeText(step?.label, "未命名步骤");
      const message = safeText(step?.message, "该项未执行。");
      return `- ${label}：${message}`;
    });
  if (!skipped.length) return [];
  return [
    "## 跳过项说明",
    "",
    "- 跳过不等于失败，通常表示当前环境缺少对应桥接接口、权限或前置条件。",
    ...skipped,
    "- 请在正式 Windows 客户端中连接真实服务器后重新运行一键基础自检，再判断该功能是否可用。",
    "",
  ];
}

export function buildSshSmokeTestReport({ serverName = "", server = {}, steps = [], startedAt = "", finishedAt = "" } = {}) {
  const name = safeText(serverName, "当前服务器");
  const summary = summarizeSshSmokeTestSteps(steps);
  const lines = [
    "# 基础自检报告",
    "",
    `服务器：${name}`,
    `地址：${safeText(server.ip || server.host, "")}`,
    `端口：${safeText(server.port, "22")}`,
    `用户：${safeText(server.user, "root")}`,
    `开始时间：${safeText(startedAt, "-")}`,
    `完成时间：${safeText(finishedAt, "-")}`,
    "",
    "覆盖范围：SSH 会话、命令回车执行、Ctrl+C 中断、SFTP 基础读写能力",
    "",
    `结果：通过 ${summary.ok}，失败 ${summary.failed}，跳过 ${summary.skipped}`,
    formatSshSmokeOutcome(summary),
    "",
    "| 步骤 | 状态 | 说明 |",
    "| --- | --- | --- |",
  ];
  (Array.isArray(steps) ? steps : []).forEach((step) => {
    lines.push(`| ${markdownCell(step?.label || "未命名步骤")} | ${formatSshSmokeStatus(step?.status)} | ${markdownCell(step?.message || "")} |`);
  });
  lines.push(
    "",
    "## 真实服务器人工验收清单",
    "",
    "- 连接服务器后直接输入 `pwd` 或 `whoami`，按 Enter 应立即执行，不需要二次确认。",
    "- 执行 `sleep 30` 后按 Ctrl+C，应能中断远程命令并回到提示符。",
    "- 连续执行 `echo ssh-agent-ok`、`df -h`、`free -h`，终端不应白屏、拉长或卡死。",
    "- SFTP 中上传、预览、下载并删除一个临时文本文件。",
    "- 右键终端或服务器，确认会话日志、工具日志、复制排障摘要和导出诊断包可以正常使用。",
    "",
    "## 交付开发者的排障证据",
    "",
    "- 点击顶部 `导出基础自检报告`，保留本次验收步骤、结果和时间。",
    "- 点击 `导出诊断包`，包含工具日志、会话日志、启动自检和运行环境信息。",
    "- 在终端右键使用 `复制 SSH 诊断摘要`，便于快速定位连接、输入或中断问题。",
    "- 若需要截图，只截界面状态和错误提示；不要截图或粘贴密码、私钥、API Key。",
    "",
    ...buildSmokeSkippedLines(steps),
    ...buildSmokeFailureAdviceLines(steps),
    "",
    "说明：报告不包含密码、私钥、凭据引用或 API Key。"
  );
  return lines.join("\n");
}
