import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMAND_POLICY_ACTIONS,
  evaluateCommandPolicy,
  shouldRequireSecondApproval,
} from "./commandPolicy.js";

test("evaluateCommandPolicy allows common readonly diagnostics", () => {
  for (const command of ["uptime", "df -hT", "free -h", "tail -n 200 /var/log/nginx/error.log", "grep error app.log", "journalctl -u nginx --no-pager -n 100"]) {
    const result = evaluateCommandPolicy(command);
    assert.equal(result.action, COMMAND_POLICY_ACTIONS.allow);
    assert.equal(result.risk, "低");
  }
});

test("evaluateCommandPolicy blocks destructive commands", () => {
  for (const command of ["rm -rf /", "mkfs.ext4 /dev/sdb", "dd if=/dev/zero of=/dev/sda", "chmod -R 777 /", "echo bad > /etc/passwd"]) {
    const result = evaluateCommandPolicy(command);
    assert.equal(result.action, COMMAND_POLICY_ACTIONS.block);
    assert.equal(result.risk, "高");
    assert.match(result.message, /已阻断/);
  }
});

test("evaluateCommandPolicy requires second approval for service mutations", () => {
  for (const command of ["sudo systemctl restart nginx", "systemctl stop mysqld", "docker restart app", "kubectl delete pod demo"]) {
    const result = evaluateCommandPolicy(command);
    assert.equal(result.action, COMMAND_POLICY_ACTIONS.review);
    assert.equal(result.risk, "中");
    assert.equal(shouldRequireSecondApproval(result), true);
  }
});

test("evaluateCommandPolicy handles chained commands conservatively", () => {
  assert.equal(evaluateCommandPolicy("df -hT && rm -rf /tmp/demo").action, COMMAND_POLICY_ACTIONS.block);
  assert.equal(evaluateCommandPolicy("uptime; systemctl restart nginx").action, COMMAND_POLICY_ACTIONS.review);
});

test("evaluateCommandPolicy rejects empty commands", () => {
  const result = evaluateCommandPolicy(" ");
  assert.equal(result.action, COMMAND_POLICY_ACTIONS.block);
  assert.match(result.message, /为空/);
});
