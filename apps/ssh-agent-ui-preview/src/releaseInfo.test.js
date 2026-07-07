import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseFingerprintText,
  buildReleaseDiagnosticsSummary,
  buildSupportTroubleshootingText,
  buildStartupDiagnosisText,
  buildUpdateCheckRequest,
  buildUpdateCheckStatus,
  compareReleaseVersions,
} from "./releaseInfo.js";

test("buildReleaseFingerprintText creates a concise cross-machine package fingerprint", () => {
  const text = buildReleaseFingerprintText(
    {
      appName: "SSH Agent \u5de5\u5177",
      version: "20260704",
      packageFile: "\u8bf7\u53d1\u8fd9\u4e2a-\u6700\u65b0\u7248Windows\u5ba2\u6237\u7aef.zip",
      packageSha256: "A".repeat(64),
      standaloneExeSha256: "B".repeat(64),
      frontendAssets: {
        script: "assets/index-current.js",
        scriptSha256: "C".repeat(64),
      },
    },
    {
      executable: "D:\\tools\\SSH-Agent-Tool.exe",
      startupIdentity: {
        runtimeScript: "assets/index-old.js",
        runtimeScriptSha256: "D".repeat(64),
        frontendMatchesManifest: false,
      },
    },
  );

  assert.match(text, /SSH Agent \u5de5\u5177\u7248\u672c\u6307\u7eb9/);
  assert.match(text, /\u7248\u672c\uff1a20260704/);
  assert.match(text, /\u5206\u53d1\u6587\u4ef6\uff1a\u8bf7\u53d1\u8fd9\u4e2a-\u6700\u65b0\u7248Windows\u5ba2\u6237\u7aef\.zip/);
  assert.match(text, new RegExp(`ZIP SHA256\uff1a${"A".repeat(64)}`));
  assert.match(text, new RegExp(`EXE SHA256\uff1a${"B".repeat(64)}`));
  assert.match(text, /运行前端资源：assets\/index-old\.js/);
  assert.match(text, /清单前端资源：assets\/index-current\.js/);
  assert.match(text, /\u8d44\u6e90\u4e00\u81f4\uff1a\u5426/);
  assert.match(text, /\u5904\u7406\u5efa\u8bae\uff1a\u5220\u9664\u65e7\u89e3\u538b\u76ee\u5f55\u548c\u65e7\u5feb\u6377\u65b9\u5f0f/);
  assert.doesNotMatch(text, /undefined|null|\[object Object\]/);
});

test("buildUpdateCheckRequest explains missing update source in readable Chinese", () => {
  const request = buildUpdateCheckRequest({ version: "20260629", updateCheckUrl: "" });

  assert.equal(request.ok, false);
  assert.equal(request.state, "not_configured");
  assert.match(request.message, /未配置远程更新源/);
  assert.match(request.message, /版本信息/);
  assert.match(request.message, /未配置远程更新源/);
  assert.doesNotMatch(request.message, /鏈|鏇|鐗|褰/);
});

test("buildUpdateCheckRequest accepts http update manifest urls", () => {
  const request = buildUpdateCheckRequest({
    version: "20260629",
    updateCheckUrl: "https://updates.example.com/ssh-agent/latest.json",
  });

  assert.equal(request.ok, true);
  assert.equal(request.url, "https://updates.example.com/ssh-agent/latest.json");
});

test("buildReleaseDiagnosticsSummary includes package and frontend fingerprints for support", () => {
  const summary = buildReleaseDiagnosticsSummary(
    {
      appName: "SSH Agent 工具",
      version: "20260703",
      packageName: "SSH-Agent-Tool-20260703",
      packageFile: "SSH-Agent-Tool-20260703.zip",
      packageSha256: "A".repeat(64),
      sha256: "EXE123",
      currentPackageUrl: "https://updates.example.com/SSH-Agent-Tool-20260703.zip",
      updateCheckUrl: "https://updates.example.com/latest.json",
    },
    {
      executable: "D:\\tools\\SSH-Agent-Tool.exe",
      executableDirectory: "D:\\tools",
      toolLogDir: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\logs",
      frontendAssets: {
        script: "assets/index-new.js",
        scriptSha256: "SCRIPT123",
      },
      startupIdentity: {
        ok: true,
        runtimeScript: "assets/index-new.js",
        runtimeScriptSha256: "SCRIPT123",
        frontendMatchesManifest: false,
      },
      startupFailureLog: {
        path: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\startup-failure.log",
      },
    },
    {
      recommendedClientText: "双击 SSH-Agent-Tool.exe",
      clientModeText: "正式 EXE 运行中",
      consoleModeText: "普通图形客户端",
      launcherStatusText: "未发现 BAT/CMD/PowerShell 启动脚本",
      webView2Text: "已安装 / 120",
    },
  );

  assert.match(summary, /应用：SSH Agent 工具/);
  assert.match(summary, /版本：20260703/);
  assert.match(summary, /发布包：SSH-Agent-Tool-20260703/);
  assert.match(summary, /程序目录：D:\\tools/);
  assert.match(summary, /EXE SHA256：EXE123/);
  assert.match(summary, new RegExp(`ZIP SHA256：${"A".repeat(64)}`));
  assert.match(summary, /前端资源：assets\/index-new\.js/);
  assert.match(summary, /前端资源 SHA256：SCRIPT123/);
  assert.match(summary, /资源一致：否/);
  assert.match(summary, /更新源：https:\/\/updates\.example\.com\/latest\.json/);
  assert.match(summary, /启动失败日志：C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\startup-failure\.log/);
  assert.doesNotMatch(summary, /undefined|null|\[object Object\]/);
});

test("buildReleaseDiagnosticsSummary gives actionable startup diagnosis for copied support info", () => {
  const webviewMissing = buildReleaseDiagnosticsSummary(
    { appName: "SSH Agent 工具", version: "20260703" },
    {
      webView2Runtime: {
        available: false,
        message: "未检测到 Microsoft Edge WebView2 Runtime。",
      },
      startupFailureLog: {
        exists: true,
        path: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\logs\\startup-failure-latest.log",
      },
    },
  );

  assert.match(webviewMissing, /\u8bca\u65ad\u7ed3\u8bba\uff1a\u672a\u68c0\u6d4b\u5230 WebView2 Runtime/);
  assert.match(webviewMissing, /startup-failure-latest\.log/);

  const assetMismatch = buildReleaseDiagnosticsSummary(
    { appName: "SSH Agent 工具", version: "20260703" },
    {
      startupIdentity: {
        ok: false,
        frontendMatchesManifest: false,
        runtimeScript: "assets/index-old.js",
        runtimeScriptSha256: "OLD123",
      },
    },
  );

  assert.match(assetMismatch, /\u8bca\u65ad\u7ed3\u8bba\uff1a\u524d\u7aef\u8d44\u6e90\u4e0e\u7248\u672c\u6e05\u5355\u4e0d\u4e00\u81f4/);
  assert.match(assetMismatch, /\u8bf7\u91cd\u65b0\u4f7f\u7528\u6700\u65b0\u7248 ZIP \u89e3\u538b\u5b8c\u6574\u76ee\u5f55\u540e\u8fd0\u884c/);
});

test("release support summaries include client entry diagnostics", () => {
  const runtime = {
    executable: "C:\\Users\\me\\AppData\\Local\\Temp\\zip-preview\\SSH-Agent-Tool.exe",
    executableDirectory: "C:\\Users\\me\\AppData\\Local\\Temp\\zip-preview",
    clientEntry: {
      ok: false,
      message: "检测到 EXE 正在临时目录运行，请完整解压最新版 ZIP 后双击 SSH-Agent-Tool.exe。",
      recommendedEntry: "完整解压最新版 Windows 客户端 ZIP 后，双击解压目录根部的 SSH-Agent-Tool.exe",
    },
  };

  const summary = buildReleaseDiagnosticsSummary({ version: "20260703" }, runtime);
  const troubleshooting = buildSupportTroubleshootingText({ version: "20260703" }, runtime);

  assert.match(summary, /客户端入口：检测到 EXE 正在临时目录运行/);
  assert.match(summary, /推荐入口：完整解压最新版 Windows 客户端 ZIP/);
  assert.match(summary, /诊断结论：检测到 EXE 正在临时目录运行/);
  assert.match(troubleshooting, /客户端入口：检测到 EXE 正在临时目录运行/);
  assert.match(troubleshooting, /推荐入口：完整解压最新版 Windows 客户端 ZIP/);
  assert.doesNotMatch(summary + troubleshooting, /undefined|null|\[object Object\]/);
});

test("buildReleaseDiagnosticsSummary shows runtime and manifest frontend fingerprints side by side", () => {
  const summary = buildReleaseDiagnosticsSummary(
    {
      appName: "SSH Agent \u5de5\u5177",
      version: "20260703",
      frontendAssets: {
        script: "assets/index-current.js",
        scriptSha256: "CURRENT123",
      },
    },
    {
      startupIdentity: {
        frontendMatchesManifest: false,
        runtimeScript: "assets/index-old.js",
        runtimeScriptSha256: "OLD123",
        manifestScript: "assets/index-current.js",
        manifestScriptSha256: "CURRENT123",
      },
    },
  );

  assert.match(summary, /\u524d\u7aef\u8d44\u6e90\uff1aassets\/index-old\.js/);
  assert.match(summary, /\u524d\u7aef\u8d44\u6e90 SHA256\uff1aOLD123/);
  assert.match(summary, /\u6e05\u5355\u524d\u7aef\u8d44\u6e90\uff1aassets\/index-current\.js/);
  assert.match(summary, /\u6e05\u5355\u524d\u7aef\u8d44\u6e90 SHA256\uff1aCURRENT123/);
  assert.match(summary, /\u8d44\u6e90\u4e00\u81f4\uff1a\u5426/);
});

test("buildReleaseDiagnosticsSummary infers frontend resource mismatch from script names", () => {
  const summary = buildReleaseDiagnosticsSummary(
    {
      version: "20260704",
      frontendAssets: {
        script: "assets/index-current.js",
        scriptSha256: "CURRENT123",
      },
    },
    {
      startupIdentity: {
        runtimeScript: "assets/index-old.js",
        runtimeScriptSha256: "OLD123",
      },
    },
  );

  assert.match(summary, /\u524d\u7aef\u8d44\u6e90\uff1aassets\/index-old\.js/);
  assert.match(summary, /\u6e05\u5355\u524d\u7aef\u8d44\u6e90\uff1aassets\/index-current\.js/);
  assert.match(summary, /\u8d44\u6e90\u4e00\u81f4\uff1a\u5426/);
});

test("startup diagnosis infers frontend mismatch from script names when explicit flag is missing", () => {
  const diagnosis = buildStartupDiagnosisText({
    startupIdentity: {
      runtimeScript: "assets/index-old.js",
      manifestScript: "assets/index-current.js",
    },
  });

  assert.match(diagnosis, /\u524d\u7aef\u8d44\u6e90\u4e0e\u7248\u672c\u6e05\u5355\u4e0d\u4e00\u81f4/);
  assert.match(diagnosis, /\u6700\u65b0\u7248 ZIP/);
});

test("buildSupportTroubleshootingText creates a shareable old-package checklist", () => {
  const text = buildSupportTroubleshootingText(
    {
      version: "20260703",
      packageSha256: "A".repeat(64),
      sha256: "EXE123",
      frontendAssets: {
        script: "assets/index-current.js",
        scriptSha256: "CURRENT123",
      },
    },
    {
      executable: "D:\\tools\\SSH-Agent-Tool.exe",
      executableDirectory: "D:\\tools",
      toolLogDir: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\logs",
      startupFailureLog: {
        path: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\logs\\startup-failure-latest.log",
        knownSignature: "index-old.js",
      },
      startupIdentity: {
        frontendMatchesManifest: false,
        runtimeScript: "assets/index-old.js",
        runtimeScriptSha256: "OLD123",
        manifestScript: "assets/index-current.js",
        manifestScriptSha256: "CURRENT123",
      },
    },
  );

  assert.match(text, /SSH Agent 工具排查说明/);
  assert.match(text, /当前版本：20260703/);
  assert.match(text, /程序目录：D:\\tools/);
  assert.match(text, /运行前端资源：assets\/index-old\.js/);
  assert.match(text, /正确前端资源：assets\/index-current\.js/);
  assert.match(text, /正确前端资源 SHA256：CURRENT123/);
  assert.match(text, /资源一致：否/);
  assert.match(text, new RegExp(`ZIP SHA256：${"A".repeat(64)}`));
  assert.match(text, /EXE SHA256：EXE123/);
  assert.match(text, /删除旧解压目录和旧桌面快捷方式/);
  assert.match(text, /解压到一个全新的空目录/);
  assert.match(text, /不要覆盖解压到旧目录/);
  assert.match(text, /不要继续使用旧桌面快捷方式/);
  assert.match(text, /第一次启动请直接双击新解压目录里的 SSH-Agent-Tool\.exe/);
  assert.match(text, /重新解压最新版 ZIP/);
  assert.match(text, /startup-failure-latest\.log/);
  assert.doesNotMatch(text, /undefined|null|\[object Object\]/);
});

test("buildStartupDiagnosisText identifies known stale frontend white screen signatures", () => {
  const diagnosis = buildStartupDiagnosisText({
    startupFailureLog: {
      exists: true,
      knownIssue: "stale_frontend_bundle",
      knownSignature: "ReferenceError: Power is not defined",
    },
  });

  assert.match(diagnosis, /旧版前端资源|旧安装包/);
  assert.match(diagnosis, /最新版 ZIP/);
  assert.match(diagnosis, /旧解压目录/);
  assert.match(diagnosis, /旧桌面快捷方式/);
  assert.match(diagnosis, /SSH-Agent-Tool\.exe/);

  const summary = buildReleaseDiagnosticsSummary(
    { appName: "SSH Agent 工具", version: "20260703" },
    {
      startupFailureLog: {
        exists: true,
        path: "C:\\Users\\me\\AppData\\Roaming\\SSHAgentTool\\logs\\startup-failure-latest.log",
        knownIssue: "stale_frontend_bundle",
        knownSignature: "index-BCGy_mkD.js",
      },
    },
  );

  assert.match(summary, /诊断结论：.*旧版前端资源|诊断结论：.*旧安装包/);
  assert.match(summary, /startup-failure-latest\.log/);
});

test("startup diagnosis gives a direct WebView2 install link for copied Windows clients", () => {
  const diagnosis = buildStartupDiagnosisText({
    webView2Runtime: {
      available: false,
      message: "未检测到 Microsoft Edge WebView2 Runtime。",
    },
  });

  assert.match(diagnosis, /WebView2 Runtime/);
  assert.match(diagnosis, /https:\/\/go\.microsoft\.com\/fwlink\/\?LinkId=2124703/);

  const text = buildSupportTroubleshootingText(
    { version: "20260703" },
    {
      webView2Runtime: {
        available: false,
        message: "未检测到 Microsoft Edge WebView2 Runtime。",
      },
    },
  );

  assert.match(text, /WebView2 Runtime/);
  assert.match(text, /https:\/\/go\.microsoft\.com\/fwlink\/\?LinkId=2124703/);
});

test("support troubleshooting text tells users to verify shortcut target paths", () => {
  const text = buildSupportTroubleshootingText(
    {
      version: "20260703",
      frontendAssets: {
        script: "assets/index-current.js",
        scriptSha256: "CURRENT123",
      },
    },
    {
      executable: "D:\\tools\\SSH-Agent-Tool.exe",
      executableDirectory: "D:\\tools",
      startupIdentity: {
        frontendMatchesManifest: false,
        runtimeScript: "assets/index-old.js",
        manifestScript: "assets/index-current.js",
      },
    },
  );

  assert.match(text, /桌面快捷方式/);
  assert.match(text, /目标/);
  assert.match(text, /SSH-Agent-Tool\.exe/);
  assert.match(text, /新解压目录/);
});

test("buildUpdateCheckRequest rejects non-http update urls in readable Chinese", () => {
  const request = buildUpdateCheckRequest({
    version: "20260629",
    updateCheckUrl: "file:///tmp/latest.json",
  });

  assert.equal(request.ok, false);
  assert.equal(request.state, "invalid_url");
  assert.match(request.message, /更新源地址格式无效/);
  assert.match(request.message, /http 或 https/);
});

test("compareReleaseVersions compares date and semver style versions", () => {
  assert.equal(compareReleaseVersions("20260630", "20260629"), 1);
  assert.equal(compareReleaseVersions("20260629", "20260629"), 0);
  assert.equal(compareReleaseVersions("1.4.10", "1.4.9"), 1);
  assert.equal(compareReleaseVersions("1.4.0", "1.4.1"), -1);
});

test("buildUpdateCheckStatus reports a newer release with package links", () => {
  const status = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/latest.json" },
    {
      version: "20260630",
      generatedAt: "2026-06-30 09:10:00",
      currentPackageUrl: "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
      releaseNotesUrl: "https://updates.example.com/notes/20260630",
      packageSha256: "A".repeat(64),
      sha256: "abc123",
    },
  );

  assert.equal(status.ok, true);
  assert.equal(status.state, "available");
  assert.equal(status.latestVersion, "20260630");
  assert.equal(status.currentVersion, "20260629");
  assert.equal(status.packageUrl, "https://updates.example.com/SSH-Agent-Tool-20260630.zip");
  assert.equal(status.releaseNotesUrl, "https://updates.example.com/notes/20260630");
  assert.equal(status.packageSha256, "A".repeat(64));
  assert.match(status.message, /发现新版本 20260630/);
  assert.match(status.message, /当前版本 20260629/);
  assert.doesNotMatch(status.message, /鍙戠幇|褰撳墠|鐗堟湰/);
});

test("buildUpdateCheckStatus reports same-version builds with changed fingerprints as available", () => {
  const status = buildUpdateCheckStatus(
    {
      version: "20260704",
      updateCheckUrl: "https://updates.example.com/latest.json",
      packageSha256: "A".repeat(64),
      standaloneExeSha256: "B".repeat(64),
      frontendAssets: {
        script: "assets/index-old.js",
        scriptSha256: "C".repeat(64),
      },
    },
    {
      version: "20260704",
      currentPackageUrl: "https://updates.example.com/SSH-Agent-Tool-20260704.zip",
      packageSha256: "D".repeat(64),
      standaloneExeSha256: "E".repeat(64),
      frontendAssets: {
        script: "assets/index-new.js",
        scriptSha256: "F".repeat(64),
      },
    },
  );

  assert.equal(status.ok, true);
  assert.equal(status.state, "available");
  assert.equal(status.latestVersion, "20260704");
  assert.equal(status.currentVersion, "20260704");
  assert.equal(status.packageSha256, "D".repeat(64));
});

test("buildUpdateCheckStatus blocks incomplete newer release manifests before download", () => {
  const missingSha = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/ssh-agent/latest.json" },
    {
      version: "20260630",
      packageFile: "SSH-Agent-Tool-20260630.zip",
    },
  );

  assert.equal(missingSha.ok, false);
  assert.equal(missingSha.state, "missing_package_sha256");
  assert.equal(missingSha.packageUrl, "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260630.zip");
  assert.match(missingSha.message, /缺少更新包 SHA256/);
  assert.match(missingSha.message, /packageSha256/);

  const missingPackage = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/ssh-agent/latest.json" },
    {
      version: "20260630",
      packageSha256: "A".repeat(64),
    },
  );

  assert.equal(missingPackage.ok, false);
  assert.equal(missingPackage.state, "missing_package_url");
  assert.match(missingPackage.message, /缺少更新包下载地址/);
  assert.match(missingPackage.message, /packageFile/);
});

test("buildUpdateCheckStatus guides users to in-app update instead of manual replacement", () => {
  const status = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/latest.json" },
    {
      version: "20260630",
      currentPackageUrl: "https://updates.example.com/SSH-Agent-Tool-20260630.zip",
      packageSha256: "A".repeat(64),
    },
  );

  assert.equal(status.state, "available");
  assert.match(status.message, /下载并校验更新包/);
  assert.match(status.message, /安装并重启/);
  assert.doesNotMatch(status.message, /手动替换|手动运行.*脚本/);
});

test("buildUpdateCheckStatus infers package url beside hosted latest manifest", () => {
  const status = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/ssh-agent/latest.json" },
    {
      version: "20260630",
      packageFile: "SSH-Agent-Tool-20260630.zip",
      packageSha256: "A".repeat(64),
    },
  );

  assert.equal(status.state, "available");
  assert.equal(status.packageFile, "SSH-Agent-Tool-20260630.zip");
  assert.equal(status.packageUrl, "https://updates.example.com/ssh-agent/SSH-Agent-Tool-20260630.zip");
});

test("buildUpdateCheckStatus reports current release when latest is not newer", () => {
  const status = buildUpdateCheckStatus(
    { version: "20260629", updateCheckUrl: "https://updates.example.com/latest.json" },
    { version: "20260629", generatedAt: "2026-06-29 12:45:24" },
  );

  assert.equal(status.ok, true);
  assert.equal(status.state, "current");
  assert.equal(status.latestVersion, "20260629");
  assert.match(status.message, /当前已是最新版本/);
  assert.doesNotMatch(status.message, /褰撳墠|鏈€鏂|鐗堟湰/);
});
