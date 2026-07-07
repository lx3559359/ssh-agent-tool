import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function newHostModalSource() {
  const start = app.indexOf("function NewHostModal");
  const end = app.indexOf("export function App", start);
  assert.notEqual(start, -1, "NewHostModal should exist");
  assert.notEqual(end, -1, "App should follow NewHostModal");
  return app.slice(start, end);
}

function authCenterModalSource() {
  const start = app.indexOf("function AuthCenterModal");
  const end = app.indexOf("function NewHostModal", start);
  assert.notEqual(start, -1, "AuthCenterModal should exist");
  assert.notEqual(end, -1, "NewHostModal should be after AuthCenterModal");
  return app.slice(start, end);
}

test("new host modal uses Chinese SSH auth values and labels", () => {
  const source = newHostModalSource();

  assert.match(source, /authType:\s*"密码"/);
  assert.match(source, /<option value="密码">密码<\/option>/);
  assert.match(source, /<option value="私钥">私钥<\/option>/);
  assert.match(source, /form\.authType === "私钥"/);
  assert.doesNotMatch(source, />Password<\/option>/);
  assert.doesNotMatch(source, />Private Key<\/option>/);
});

test("auth center modal renders auth model summary and guidance", () => {
  const source = authCenterModalSource();

  assert.match(source, /const authModel = buildAuthCenterModel\(serverName,\s*server \|\| \{\}\)/);
  assert.match(source, /auth-center-modal/);
  assert.match(source, /authModel\.summaryItems\.map\(\(item\) =>/);
  assert.match(source, /className="auth-summary-grid"/);
  assert.match(source, /className=\{`auth-summary-value \$\{item\.tone \|\| ""\}`\}/);
  assert.match(source, /authModel\.guidance\.map\(\(item,\s*index\) =>/);
  assert.match(source, /className="auth-guidance"/);
});

test("auth center modal exposes repair-first credential actions", () => {
  const source = authCenterModalSource();

  assert.match(source, /\{authModel\.primaryAction\.label\}/);
  assert.match(source, /\{isTesting \? "\\u6d4b\\u8bd5\\u4e2d\.\.\." : authModel\.secondaryAction\.label\}/);
  assert.match(source, /"\\u8865\\u5f55\\u6216\\u66f4\\u6362\\u5bc6\\u7801/);
  assert.match(source, /"\\u79fb\\u9664\\u672c\\u673a\\u51ed\\u636e"/);
});

test("host editor preserves HostKeyAlias through edit and reconnect detection", () => {
  assert.match(app, /hostKeyAlias:\s*server\?\.hostKeyAlias \|\| ""/);
  assert.match(app, /hostKeyAlias:\s*String\(form\.hostKeyAlias \|\| ""\)\.trim\(\)/);
  assert.match(app, /String\(form\?\.hostKeyAlias \|\| ""\)\.trim\(\) !== String\(existingServer\?\.hostKeyAlias \|\| ""\)\.trim\(\)/);
});

test("host editor preserves ForwardAgent through edit and reconnect detection", () => {
  assert.match(app, /forwardAgent:\s*Boolean\(server\?\.forwardAgent\)/);
  assert.match(app, /forwardAgent:\s*Boolean\(form\.forwardAgent\)/);
  assert.match(app, /Boolean\(form\?\.forwardAgent\) !== Boolean\(existingServer\?\.forwardAgent\)/);
});

test("host editor reconnects when SSH timeout retry or keepalive changes", () => {
  assert.match(app, /String\(form\?\.timeoutSeconds \|\| "10"\)\.trim\(\) !== String\(existingServer\?\.timeoutSeconds \|\| "10"\)\.trim\(\)/);
  assert.match(app, /String\(form\?\.retryCount \|\| "0"\)\.trim\(\) !== String\(existingServer\?\.retryCount \|\| "0"\)\.trim\(\)/);
  assert.match(app, /String\(form\?\.keepaliveSeconds \|\| "30"\)\.trim\(\) !== String\(existingServer\?\.keepaliveSeconds \|\| "30"\)\.trim\(\)/);
  assert.match(app, /String\(form\?\.keepaliveCountMax \|\| "3"\)\.trim\(\) !== String\(existingServer\?\.keepaliveCountMax \|\| "3"\)\.trim\(\)/);
});

test("host editor preserves default directory and reconnects when it changes", () => {
  assert.match(app, /cwd:\s*server\?\.cwd \|\| `\/home\/\$\{user\}`/);
  assert.match(app, /note:\s*server\?\.note \|\| ""/);
  assert.match(app, /String\(form\?\.cwd \|\| ""\)\.trim\(\) !== String\(existingServer\?\.cwd \|\| ""\)\.trim\(\)/);
});
