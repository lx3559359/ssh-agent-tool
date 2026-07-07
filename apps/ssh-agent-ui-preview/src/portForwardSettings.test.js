import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoStartLocalForwardConfigs,
  buildPortForwardCommandPreview,
  buildPortForwardLocalUrl,
  normalizePortForwardConfig,
  removePortForwardPreset,
  upsertPortForwardPreset,
} from "./portForwardSettings.js";

const server = {
  ip: "10.0.1.23",
  port: "2222",
  user: "root",
};

test("normalizePortForwardConfig accepts localhost forwards and normalizes ports", () => {
  const result = normalizePortForwardConfig({
    name: "Nginx 管理页",
    localPort: "18080",
    remoteHost: "127.0.0.1",
    remotePort: "80",
  });

  assert.deepEqual(result, {
    name: "Nginx 管理页",
    localHost: "127.0.0.1",
    localPort: 18080,
    remoteHost: "127.0.0.1",
    remotePort: 80,
  });
});

test("buildAutoStartLocalForwardConfigs maps saved server local forwards for SSH connect", () => {
  const result = buildAutoStartLocalForwardConfigs({
    localForwards: [
      { localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" },
      { localHost: "0.0.0.0", localPort: "18081", remoteHost: "127.0.0.1", remotePort: "8080" },
      { localPort: "", remoteHost: "127.0.0.1", remotePort: "443" },
    ],
  });

  assert.deepEqual(result, [
    { name: "自动转发 18080 -> 127.0.0.1:80", localHost: "127.0.0.1", localPort: 18080, remoteHost: "127.0.0.1", remotePort: 80 },
  ]);
});

test("normalizePortForwardConfig rejects unsafe bind addresses and invalid ports", () => {
  assert.throws(
    () =>
      normalizePortForwardConfig({
        localHost: "0.0.0.0",
        localPort: "0",
        remoteHost: "",
        remotePort: "70000",
      }),
    /远程地址不能为空/,
  );
});

test("normalizePortForwardConfig uses readable Chinese validation messages", () => {
  assert.throws(
    () =>
      normalizePortForwardConfig({
        localPort: "0",
        remoteHost: "127.0.0.1",
        remotePort: "70000",
      }),
    /本地端口必须在 1-65535 之间；远程端口必须在 1-65535 之间/,
  );
  assert.throws(
    () =>
      normalizePortForwardConfig({
        localHost: "0.0.0.0",
        localPort: "18080",
        remoteHost: "127.0.0.1",
        remotePort: "80",
      }),
    /监听地址只允许 127.0.0.1，避免端口暴露到局域网/,
  );
});

test("buildPortForwardCommandPreview creates a safe ssh command preview", () => {
  const config = normalizePortForwardConfig({
    localPort: "18080",
    remoteHost: "127.0.0.1",
    remotePort: "80",
  });

  assert.equal(
    buildPortForwardCommandPreview(config, server),
    "ssh -N -L 127.0.0.1:18080:127.0.0.1:80 root@10.0.1.23 -p 2222",
  );
});

test("buildPortForwardLocalUrl creates a copyable localhost access url", () => {
  assert.equal(
    buildPortForwardLocalUrl({ localHost: "127.0.0.1", localPort: "18080" }),
    "http://127.0.0.1:18080/",
  );
  assert.equal(
    buildPortForwardLocalUrl({ localHost: "localhost", localPort: 3000 }),
    "http://127.0.0.1:3000/",
  );
  assert.equal(buildPortForwardLocalUrl({ localPort: "" }), "");
});

test("upsertPortForwardPreset stores reusable per-server presets without secrets", () => {
  const presets = upsertPortForwardPreset(
    [],
    {
      name: "Nginx 管理页",
      localPort: "18080",
      remoteHost: "127.0.0.1",
      remotePort: "80",
      password: "DoNotSave",
    },
    "prod-web",
  );
  const updated = upsertPortForwardPreset(
    presets,
    {
      id: presets[0].id,
      name: "Nginx 管理页",
      localPort: "18081",
      remoteHost: "127.0.0.1",
      remotePort: "8080",
    },
    "prod-web",
  );

  assert.equal(updated.length, 1);
  assert.equal(updated[0].serverName, "prod-web");
  assert.equal(updated[0].localPort, 18081);
  assert.doesNotMatch(JSON.stringify(updated), /DoNotSave|password/i);
});

test("removePortForwardPreset removes only selected preset", () => {
  const presets = [
    { id: "keep", serverName: "prod-web" },
    { id: "delete", serverName: "prod-web" },
  ];

  assert.deepEqual(removePortForwardPreset(presets, "delete").map((item) => item.id), ["keep"]);
});
