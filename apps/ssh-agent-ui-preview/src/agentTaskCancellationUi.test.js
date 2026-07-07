import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function cancelRunningAgentTaskSource() {
  const start = appSource.indexOf("async function cancelRunningAgentTask(task)");
  const end = appSource.indexOf("function startLayoutResize", start);
  assert.notEqual(start, -1, "cancelRunningAgentTask should exist");
  assert.notEqual(end, -1, "startLayoutResize should follow cancelRunningAgentTask");
  return appSource.slice(start, end);
}

test("running Agent task cancellation records a user cancellation result", () => {
  const source = cancelRunningAgentTaskSource();

  assert.match(source, /markAgentTaskCancelled\(current,\s*task\.id,\s*"用户取消"\)/);
  assert.doesNotMatch(source, /markAgentTaskCancelled\(current,\s*task\.id,\s*"操作已完成"\)/);
  assert.match(source, /showNotice\("取消 Agent 任务失败："/);
  assert.doesNotMatch(source, /showNotice\("诊断包已导出"/);
  assert.match(source, /showNotice\("已取消 Agent 任务："/);
});
