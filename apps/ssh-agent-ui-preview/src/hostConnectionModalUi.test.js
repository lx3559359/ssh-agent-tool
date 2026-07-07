import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function newHostModalSource() {
  const start = app.indexOf("function NewHostModal");
  const end = app.indexOf("export function App", start);
  assert.notEqual(start, -1, "NewHostModal should exist");
  assert.notEqual(end, -1, "App should follow NewHostModal");
  return app.slice(start, end);
}

test("new host modal keeps SSH test feedback visible before saving", () => {
  const source = newHostModalSource();

  assert.match(source, /hostTestStatus/);
  assert.match(source, /testingHostConnection/);
  assert.match(source, /testHostBeforeSave/);
  assert.match(source, /validateServerConnectionForm/);
  assert.match(source, /await onTestConnection\?\.\(form\)/);
  assert.match(source, /保存前测试|\\u4fdd\\u5b58\\u524d\\u6d4b\\u8bd5/);
  assert.match(source, /正在测试连接/);
  assert.match(source, /连接测试通过/);
  assert.match(source, /连接测试失败/);
  assert.match(source, /host-test-status/);
  assert.match(source, /disabled=\{testingHostConnection\}/);
});

test("new host modal exposes HostKeyAlias as an advanced SSH field", () => {
  const source = newHostModalSource();

  assert.match(source, /hostKeyAlias:\s*""/);
  assert.match(source, /HostKeyAlias/);
  assert.match(source, /value=\{form\.hostKeyAlias \|\| ""\}/);
  assert.match(source, /update\("hostKeyAlias", event\.target\.value\)/);
});

test("new host modal exposes ForwardAgent as an advanced SSH toggle", () => {
  const source = newHostModalSource();

  assert.match(source, /forwardAgent:\s*false/);
  assert.match(source, /ForwardAgent/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /checked=\{!!form\.forwardAgent\}/);
  assert.match(source, /update\("forwardAgent", event\.target\.checked\)/);
});

test("new host modal exposes SSH timeout retry and keepalive controls", () => {
  const source = newHostModalSource();

  assert.match(source, /timeoutSeconds:\s*"10"/);
  assert.match(source, /retryCount:\s*"0"/);
  assert.match(source, /keepaliveSeconds:\s*"30"/);
  assert.match(source, /keepaliveCountMax:\s*"3"/);
  assert.match(source, /value=\{form\.timeoutSeconds \|\| "10"\}/);
  assert.match(source, /value=\{form\.retryCount \|\| "0"\}/);
  assert.match(source, /value=\{form\.keepaliveSeconds \|\| "30"\}/);
  assert.match(source, /value=\{form\.keepaliveCountMax \|\| "3"\}/);
  assert.match(source, /update\("timeoutSeconds", event\.target\.value\)/);
  assert.match(source, /update\("retryCount", event\.target\.value\)/);
  assert.match(source, /update\("keepaliveSeconds", event\.target\.value\)/);
  assert.match(source, /update\("keepaliveCountMax", event\.target\.value\)/);
});

test("new host modal exposes default directory and note fields", () => {
  const source = newHostModalSource();

  assert.match(source, /cwd:\s*""/);
  assert.match(source, /note:\s*""/);
  assert.match(source, /value=\{form\.cwd \|\| ""\}/);
  assert.match(source, /value=\{form\.note \|\| ""\}/);
  assert.match(source, /update\("cwd", event\.target\.value\)/);
  assert.match(source, /update\("note", event\.target\.value\)/);
});

test("settings grids keep host connection fields readable", () => {
  assert.match(styles, /\.settings-grid\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.settings-grid\.three\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});
