import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSftpTerminalCommand,
  chooseSftpSelectionAfterRefresh,
  formatSftpPreviewMeta,
  getParentSftpPath,
  normalizeSftpPath,
  quoteSftpPathForShell,
  resolveShellWorkingDirectory,
  resolveSftpChildPath,
} from "./sftpNavigation.js";

test("normalizeSftpPath keeps remote paths stable", () => {
  assert.equal(normalizeSftpPath("/var/www/app/"), "/var/www/app");
  assert.equal(normalizeSftpPath("\\var\\log\\nginx"), "/var/log/nginx");
  assert.equal(normalizeSftpPath(""), ".");
});

test("resolveSftpChildPath joins child folders without Windows separators", () => {
  assert.equal(resolveSftpChildPath("/var/www/app", "logs"), "/var/www/app/logs");
  assert.equal(resolveSftpChildPath("/", "etc"), "/etc");
  assert.equal(resolveSftpChildPath(".", "tmp"), "tmp");
});

test("getParentSftpPath returns safe remote parents", () => {
  assert.equal(getParentSftpPath("/var/www/app"), "/var/www");
  assert.equal(getParentSftpPath("/var"), "/");
  assert.equal(getParentSftpPath("/"), "/");
  assert.equal(getParentSftpPath("tmp/logs"), "tmp");
});

test("formatSftpPreviewMeta describes remote text previews in Chinese", () => {
  assert.equal(
    formatSftpPreviewMeta({ remotePath: "/etc/nginx/nginx.conf", size: 2048, encoding: "utf-8" }),
    "/etc/nginx/nginx.conf · 2.0 KB · 编码：UTF-8",
  );
  assert.equal(
    formatSftpPreviewMeta({ remotePath: "/var/log/app.log", size: 1024, encoding: "gb18030" }),
    "/var/log/app.log · 1.0 KB · 编码：GB18030",
  );
  assert.equal(
    formatSftpPreviewMeta({ remotePath: "/var/log/app.log", size: 2, encoding: "utf-16" }),
    "/var/log/app.log · 2 B · 编码：UTF-16",
  );
  assert.equal(formatSftpPreviewMeta({ remotePath: "", size: 0 }), "未选择文件 · 0 B");
});

test("formatSftpPreviewMeta formats dashed UTF-16 endian names for SFTP preview", () => {
  const littleEndianMeta = formatSftpPreviewMeta({ remotePath: "/var/log/windows.log", size: 48, encoding: "utf-16-le" });
  const bigEndianMeta = formatSftpPreviewMeta({ remotePath: "/var/log/appliance.log", size: 48, encoding: "utf-16-be" });

  assert.match(littleEndianMeta, /UTF-16 LE/);
  assert.match(bigEndianMeta, /UTF-16 BE/);
  assert.doesNotMatch(littleEndianMeta, /utf-16-le/);
  assert.doesNotMatch(bigEndianMeta, /utf-16-be/);
});

test("chooseSftpSelectionAfterRefresh prefers the changed remote path", () => {
  const items = [
    { type: "folder", name: "logs", path: "/var/www/app/logs" },
    { type: "file", name: "app.log", path: "/var/www/app/app.log" },
    { type: "file", name: "deploy.sh", path: "/var/www/app/deploy.sh" },
  ];

  assert.deepEqual(
    chooseSftpSelectionAfterRefresh(items, "/var/www/app/deploy.sh"),
    { type: "file", name: "deploy.sh", path: "/var/www/app/deploy.sh" },
  );
  assert.deepEqual(chooseSftpSelectionAfterRefresh(items, "/var/www/app/missing.txt"), items[0]);
  assert.equal(chooseSftpSelectionAfterRefresh([], "/var/www/app/deploy.sh"), null);
});

test("quoteSftpPathForShell safely quotes remote paths for terminal insertion", () => {
  assert.equal(quoteSftpPathForShell("/var/log/nginx/error.log"), "/var/log/nginx/error.log");
  assert.equal(quoteSftpPathForShell("/var/www/my app/app.log"), "'/var/www/my app/app.log'");
  assert.equal(quoteSftpPathForShell("/tmp/it's.log"), "'/tmp/it'\\''s.log'");
  assert.equal(quoteSftpPathForShell(""), ".");
});

test("buildSftpTerminalCommand creates safe common SSH commands from remote paths", () => {
  assert.equal(buildSftpTerminalCommand("list", "/var/www/my app"), "ls -lah '/var/www/my app'");
  assert.equal(buildSftpTerminalCommand("cd", "/var/www/my app"), "cd '/var/www/my app'");
  assert.equal(buildSftpTerminalCommand("tail", "/var/log/nginx/error.log"), "tail -n 200 /var/log/nginx/error.log");
  assert.equal(buildSftpTerminalCommand("cat", "/tmp/it's.log"), "cat '/tmp/it'\\''s.log'");
  assert.equal(buildSftpTerminalCommand("unknown", "/tmp/a.log"), "/tmp/a.log");
});

test("resolveShellWorkingDirectory tracks simple cd commands", () => {
  assert.equal(resolveShellWorkingDirectory("cd /data/releases", "/var/www/app", "/home/root"), "/data/releases");
  assert.equal(resolveShellWorkingDirectory("cd logs", "/var/www/app", "/home/root"), "/var/www/app/logs");
  assert.equal(resolveShellWorkingDirectory("cd ..", "/var/www/app", "/home/root"), "/var/www");
  assert.equal(resolveShellWorkingDirectory("cd ../shared", "/var/www/app", "/home/root"), "/var/www/shared");
  assert.equal(resolveShellWorkingDirectory("cd ~", "/var/www/app", "/home/root"), "/home/root");
  assert.equal(resolveShellWorkingDirectory("cd", "/var/www/app", "/home/root"), "/home/root");
  assert.equal(resolveShellWorkingDirectory("ls -lah", "/var/www/app", "/home/root"), null);
  assert.equal(resolveShellWorkingDirectory("cd /tmp && rm -rf app", "/var/www/app", "/home/root"), null);
});
