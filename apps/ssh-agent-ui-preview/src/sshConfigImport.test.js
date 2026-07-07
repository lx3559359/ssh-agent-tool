import assert from "node:assert/strict";
import test from "node:test";

import { buildSshConfigImportPreview, mergeSshConfigHosts, mergeSshConfigPortForwardPresets } from "./sshConfigImport.js";

test("mergeSshConfigHosts creates custom servers from imported ssh config hosts", () => {
  const result = mergeSshConfigHosts(
    {},
    [
      {
        name: "prod-web",
        host: "10.0.1.23",
        user: "root",
        port: "2222",
        identityFile: "~/.ssh/prod_web_ed25519",
        identitiesOnly: "yes",
        proxyJump: "bastion",
        hostKeyAlias: "prod-web.internal",
      },
    ],
  );

  assert.deepEqual(result.importedNames, ["prod-web"]);
  assert.equal(result.servers["prod-web"].ip, "10.0.1.23");
  assert.equal(result.servers["prod-web"].user, "root");
  assert.equal(result.servers["prod-web"].port, "2222");
  assert.equal(result.servers["prod-web"].authType, "私钥");
  assert.equal(result.servers["prod-web"].identityFile, "~/.ssh/prod_web_ed25519");
  assert.equal(result.servers["prod-web"].identitiesOnly, true);
  assert.equal(result.servers["prod-web"].proxyJump, "bastion");
  assert.equal(result.servers["prod-web"].hostKeyAlias, "prod-web.internal");
  assert.ok(result.servers["prod-web"].evidence.some((item) => item.label === "hostKeyAlias" && item.value === "prod-web.internal"));
  assert.match(result.servers["prod-web"].note, /prod_web_ed25519/);
  assert.match(result.servers["prod-web"].note, /bastion/);
});

test("mergeSshConfigHosts maps OpenSSH timeout and connection attempts", () => {
  const result = mergeSshConfigHosts(
    {},
    [
      {
        name: "prod-web",
        host: "10.0.1.23",
        connectTimeout: "25",
        connectionAttempts: "4",
        serverAliveInterval: "45",
        serverAliveCountMax: "6",
      },
      {
        name: "dev",
        host: "10.0.2.15",
        connectTimeout: "1",
        connectionAttempts: "1",
        serverAliveInterval: "2",
        serverAliveCountMax: "99",
      },
    ],
  );

  assert.equal(result.servers["prod-web"].timeoutSeconds, 25);
  assert.equal(result.servers["prod-web"].retryCount, 3);
  assert.equal(result.servers["prod-web"].keepaliveSeconds, 45);
  assert.equal(result.servers["prod-web"].keepaliveCountMax, 6);
  assert.equal(result.servers["dev"].timeoutSeconds, 3);
  assert.equal(result.servers["dev"].retryCount, 0);
  assert.equal(result.servers["dev"].keepaliveSeconds, 10);
  assert.equal(result.servers["dev"].keepaliveCountMax, 10);
});

test("mergeSshConfigHosts preserves RemoteForward and DynamicForward entries for imported profiles", () => {
  const result = mergeSshConfigHosts(
    {},
    [
      {
        name: "prod-web",
        host: "10.0.1.23",
        remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
        dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
      },
    ],
  );

  assert.deepEqual(result.servers["prod-web"].remoteForwards, [
    { remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" },
  ]);
  assert.deepEqual(result.servers["prod-web"].dynamicForwards, [{ bindHost: "127.0.0.1", bindPort: "1080" }]);
  assert.deepEqual(
    result.servers["prod-web"].evidence.filter((item) => ["remoteForward", "dynamicForward"].includes(item.label)),
    [
      { label: "remoteForward", value: "1 个" },
      { label: "dynamicForward", value: "1 个" },
    ],
  );
});

test("mergeSshConfigHosts preserves ForwardAgent for imported profiles", () => {
  const result = mergeSshConfigHosts(
    {},
    [
      {
        name: "jump-app",
        host: "10.0.8.21",
        user: "deploy",
        forwardAgent: "yes",
      },
    ],
  );

  assert.equal(result.servers["jump-app"].forwardAgent, true);
  assert.ok(result.servers["jump-app"].evidence.some((item) => item.label === "forwardAgent" && item.value === "yes"));
});

test("mergeSshConfigHosts avoids names already used by built-in and custom servers", () => {
  const result = mergeSshConfigHosts(
    { "prod-web": { ip: "10.0.1.20" } },
    [{ name: "prod-web", host: "10.0.1.23", user: "root", port: "22" }],
    { "prod-web": { ip: "10.0.1.20" }, "prod-web-导入": { ip: "10.0.1.21" } },
  );

  assert.deepEqual(result.importedNames, ["prod-web-导入-2"]);
  assert.equal(result.servers["prod-web-导入-2"].ip, "10.0.1.23");
});

test("mergeSshConfigHosts skips invalid imported hosts", () => {
  const result = mergeSshConfigHosts({}, [{ name: "", host: "" }, null]);

  assert.equal(result.skipped, 2);
  assert.deepEqual(result.importedNames, []);
});

test("buildSshConfigImportPreview summarizes names skips and credential gaps", () => {
  const preview = buildSshConfigImportPreview(
    { "prod-web": { ip: "10.0.1.20" } },
    [
      { name: "prod-web", host: "10.0.1.23", identityFile: "~/.ssh/prod" },
      { name: "dev", host: "10.0.2.15" },
      { name: "", host: "" },
    ],
    { "prod-web": { ip: "10.0.1.20" } },
    { skipped: 1 },
  );

  assert.equal(preview.importableCount, 2);
  assert.equal(preview.skippedCount, 2);
  assert.equal(preview.needsCredentialCount, 1);
  assert.deepEqual(preview.importedNames, ["prod-web-导入", "dev"]);
  assert.match(preview.message, /将新增 2 台服务器/);
  assert.match(preview.message, /1 台需要导入后绑定密码或私钥/);
});
test("buildSshConfigImportPreview distinguishes key based hosts from missing credentials", () => {
  const preview = buildSshConfigImportPreview(
    {},
    [
      { name: "prod-web", host: "10.0.1.23", identityFile: "~/.ssh/prod", proxyJump: "bastion" },
      { name: "prod-db", host: "10.0.1.31" },
    ],
    {},
  );

  assert.equal(preview.importableCount, 2);
  assert.equal(preview.needsCredentialCount, 1);
  assert.deepEqual(preview.readiness, {
    ready: 1,
    missingAuth: 1,
    proxyJump: 1,
    identityFile: 1,
    forwardAgent: 0,
    remoteForward: 0,
    dynamicForward: 0,
  });
  assert.match(preview.message, /可直接测试 1 台/);
  assert.match(preview.message, /1 台需要导入后绑定密码或私钥/);
  assert.match(preview.message, /包含 ProxyJump 1 台/);
  assert.match(preview.message, /包含私钥路径 1 台/);
});

test("buildSshConfigImportPreview counts remote and dynamic forwards without turning them into local presets", () => {
  const preview = buildSshConfigImportPreview(
    {},
    [
      {
        name: "prod-web",
        host: "10.0.1.23",
        remoteForwards: [{ remoteHost: "127.0.0.1", remotePort: "22022", localHost: "127.0.0.1", localPort: "22" }],
        dynamicForwards: [{ bindHost: "127.0.0.1", bindPort: "1080" }],
      },
    ],
    {},
  );

  assert.equal(preview.readiness.remoteForward, 1);
  assert.equal(preview.readiness.dynamicForward, 1);
  assert.equal(preview.portForwardPresetCount, 0);
  assert.match(preview.message, /RemoteForward 1/);
  assert.match(preview.message, /DynamicForward 1/);
});

test("mergeSshConfigPortForwardPresets creates reusable presets from LocalForward entries", () => {
  const result = mergeSshConfigPortForwardPresets(
    [{ id: "existing", serverName: "prod-web", localPort: 18080 }],
    ["prod-web"],
    {
      "prod-web": {
        localForwards: [
          { localHost: "127.0.0.1", localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" },
          { localPort: "15432", remoteHost: "db.internal", remotePort: "5432" },
          { localHost: "0.0.0.0", localPort: "18081", remoteHost: "127.0.0.1", remotePort: "80" },
        ],
      },
    },
  );

  assert.equal(result.presets.length, 2);
  assert.deepEqual(result.importedNames, ["prod-web 15432 -> db.internal:5432"]);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.presets[1], {
    id: "sshconfig-prod-web-15432-db.internal-5432",
    serverName: "prod-web",
    name: "prod-web 15432 -> db.internal:5432",
    localHost: "127.0.0.1",
    localPort: 15432,
    remoteHost: "db.internal",
    remotePort: 5432,
  });
});

test("buildSshConfigImportPreview reports imported LocalForward presets", () => {
  const preview = buildSshConfigImportPreview(
    {},
    [
      {
        name: "prod-web",
        host: "10.0.1.23",
        localForwards: [{ localPort: "18080", remoteHost: "127.0.0.1", remotePort: "80" }],
      },
    ],
    {},
  );

  assert.equal(preview.portForwardPresetCount, 1);
  assert.deepEqual(preview.portForwardPresetNames, ["prod-web 18080 -> 127.0.0.1:80"]);
  assert.match(preview.message, /端口转发预设 1 个/);
});
