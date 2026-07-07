import assert from "node:assert/strict";
import test from "node:test";

import { buildSftpOverwriteCancelledResult, buildSftpOverwriteConfirmMessage, isSftpOverwriteConflict } from "./sftpOverwrite.js";

test("isSftpOverwriteConflict detects existing local or remote file failures", () => {
  assert.equal(isSftpOverwriteConflict({ ok: false, message: "本地文件已存在：C:/tmp/app.log。" }), true);
  assert.equal(isSftpOverwriteConflict({ ok: false, message: "目标文件已存在：/etc/nginx/nginx.conf。" }), true);
  assert.equal(isSftpOverwriteConflict({ ok: true, message: "目标文件已存在但已覆盖" }), false);
  assert.equal(isSftpOverwriteConflict({ ok: false, message: "Permission denied" }), false);
});

test("buildSftpOverwriteConfirmMessage creates a clear overwrite prompt", () => {
  const message = buildSftpOverwriteConfirmMessage({
    remotePath: "/etc/nginx/nginx.conf",
    localPath: "C:/tmp/nginx.conf",
    message: "目标文件已存在。",
  }, "upload");

  assert.match(message, /文件已存在/);
  assert.match(message, /是否覆盖/);
  assert.match(message, /\/etc\/nginx\/nginx\.conf/);
  assert.match(message, /C:\/tmp\/nginx\.conf/);
});

test("buildSftpOverwriteCancelledResult keeps cancellation distinct from transfer failure", () => {
  const result = buildSftpOverwriteCancelledResult({
    remotePath: "/etc/nginx/nginx.conf",
    localPath: "C:/tmp/nginx.conf",
    message: "目标文件已存在",
  }, "download");

  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.status, "cancelled");
  assert.equal(result.remotePath, "/etc/nginx/nginx.conf");
  assert.equal(result.localPath, "C:/tmp/nginx.conf");
  assert.match(result.message, /已取消覆盖/);
  assert.match(result.message, /下载/);
});
