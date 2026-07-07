const WEBVIEW2_RUNTIME_DOWNLOAD_URL = "https://go.microsoft.com/fwlink/?LinkId=2124703";

export function buildUpdateCheckRequest(manifest = {}) {
  const url = String(manifest?.updateCheckUrl || "").trim();
  if (!url) {
    return {
      ok: false,
      state: "not_configured",
      message: "当前版本未配置远程更新源，请在版本信息中填写 latest.json 更新清单地址。",
    };
  }

  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      state: "invalid_url",
      message: "更新源地址格式无效，请使用 http 或 https 地址。",
    };
  }

  return { ok: true, state: "ready", url };
}

export function buildUpdateCheckStatus(currentManifest = {}, latestManifest = {}) {
  const currentVersion = normalizeVersionText(currentManifest?.version || "dev");
  const latestVersion = normalizeVersionText(latestManifest?.version || "");

  if (!latestVersion) {
    return {
      state: "invalid_manifest",
      currentVersion,
      latestVersion: "",
      message: "远程版本清单缺少版本号，暂时无法判断是否需要更新。",
    };
  }

  const comparison = compareReleaseVersions(latestVersion, currentVersion);
  const explicitPackageUrl = String(latestManifest?.currentPackageUrl || latestManifest?.packageUrl || "").trim();
  const packageFile = String(latestManifest?.packageFile || explicitPackageUrl.split("/").pop() || "").trim();
  const packageUrl = explicitPackageUrl || inferPackageUrlFromUpdateManifest(currentManifest?.updateCheckUrl, packageFile);
  const packageSha256 = String(latestManifest?.packageSha256 || latestManifest?.zipSha256 || latestManifest?.sha256 || "").trim();
  const releaseNotesUrl = String(latestManifest?.releaseNotesUrl || currentManifest?.releaseNotesUrl || "").trim();
  const generatedAt = String(latestManifest?.generatedAt || "").trim();
  const sha256 = String(latestManifest?.sha256 || "").trim();
  const sameVersionChangedBuild = comparison === 0 && releaseFingerprintsChanged(currentManifest, latestManifest);

  if (comparison > 0 || sameVersionChangedBuild) {
    if (!packageUrl) {
      return {
        ok: false,
        state: "missing_package_url",
        currentVersion,
        latestVersion,
        packageUrl,
        packageFile,
        packageSha256,
        releaseNotesUrl,
        generatedAt,
        sha256,
        message: "发现新版本，但远程版本清单缺少更新包下载地址。请在 latest.json 中提供 currentPackageUrl、packageUrl 或 packageFile。",
      };
    }
    if (!packageSha256) {
      return {
        ok: false,
        state: "missing_package_sha256",
        currentVersion,
        latestVersion,
        packageUrl,
        packageFile,
        packageSha256,
        releaseNotesUrl,
        generatedAt,
        sha256,
        message: "发现新版本，但远程版本清单缺少更新包 SHA256。请在 latest.json 中提供 64 位十六进制 packageSha256。",
      };
    }
    if (!isValidReleasePackageSha256(packageSha256)) {
      return {
        ok: false,
        state: "invalid_package_sha256",
        currentVersion,
        latestVersion,
        packageUrl,
        packageFile,
        packageSha256,
        releaseNotesUrl,
        generatedAt,
        sha256,
        message: "发现新版本，但远程版本清单中的更新包 SHA256 格式无效。请在 latest.json 中提供 64 位十六进制 packageSha256。",
      };
    }
    return {
      ok: true,
      state: "available",
      currentVersion,
      latestVersion,
      packageUrl,
      packageFile,
      packageSha256,
      releaseNotesUrl,
      generatedAt,
      sha256,
      message: sameVersionChangedBuild
        ? `发现同版本新构建 ${latestVersion}，当前客户端构建指纹较旧。请点击“下载并校验更新包”，校验通过后点击“安装并重启”。`
        : `发现新版本 ${latestVersion}，当前版本 ${currentVersion}。请点击“下载并校验更新包”，校验通过后点击“安装并重启”。`,
    };
  }

  return {
    ok: true,
    state: "current",
    currentVersion,
    latestVersion,
    packageUrl,
    packageFile,
    packageSha256,
    releaseNotesUrl,
    generatedAt,
    sha256,
    message: `当前已是最新版本 ${currentVersion}。`,
  };
}

export function buildReleaseFingerprintText(manifest = {}, runtimeDiagnostics = {}) {
  const runtime = runtimeDiagnostics || {};
  const startupIdentity = runtime.startupIdentity || {};
  const manifestFrontendAssets = manifest?.frontendAssets || {};
  const runtimeScript = textOrFallback(startupIdentity.runtimeScript || runtime.frontendAssets?.script, "--");
  const runtimeScriptSha = textOrFallback(startupIdentity.runtimeScriptSha256 || runtime.frontendAssets?.scriptSha256, "--");
  const manifestScript = textOrFallback(startupIdentity.manifestScript || manifestFrontendAssets.script, "--");
  const manifestScriptSha = textOrFallback(startupIdentity.manifestScriptSha256 || manifestFrontendAssets.scriptSha256, "--");
  const frontendResourceMatch = resolveFrontendResourceMatch(startupIdentity, runtimeScript, manifestScript);
  const resourceMatchText = frontendResourceMatch === true
    ? "是"
    : frontendResourceMatch === false
      ? "否"
      : "--";
  const staleAdvice = frontendResourceMatch === false
    ? "处理建议：删除旧解压目录和旧快捷方式，重新完整解压最新版 ZIP 后双击 SSH-Agent-Tool.exe。"
    : "处理建议：如果目标电脑仍无法打开，请导出诊断包并发送给开发者。";

  return [
    "SSH Agent 工具版本指纹",
    "",
    `版本：${textOrFallback(manifest?.version, "dev")}`,
    `分发文件：${textOrFallback(manifest?.packageFile, "--")}`,
    `ZIP SHA256：${textOrFallback(manifest?.packageSha256 || manifest?.zipSha256, "--")}`,
    `EXE SHA256：${textOrFallback(manifest?.standaloneExeSha256 || manifest?.exeSha256 || manifest?.sha256, "--")}`,
    `运行路径：${textOrFallback(runtime.executable, "--")}`,
    `运行前端资源：${runtimeScript}`,
    `运行前端资源 SHA256：${runtimeScriptSha}`,
    `清单前端资源：${manifestScript}`,
    `清单前端资源 SHA256：${manifestScriptSha}`,
    `资源一致：${resourceMatchText}`,
    staleAdvice,
  ].join("\n");
}

export function buildReleaseDiagnosticsSummary(manifest = {}, runtimeDiagnostics = {}, options = {}) {
  const runtime = runtimeDiagnostics || {};
  const startupIdentity = runtime.startupIdentity || {};
  const frontendAssets = runtime.frontendAssets || {};
  const startupFailureLog = runtime.startupFailureLog || {};
  const webView2Runtime = runtime.webView2Runtime || {};
  const clientEntry = runtime.clientEntry || {};
  const appName = textOrFallback(manifest?.appName, "SSH Agent 工具");
  const version = textOrFallback(manifest?.version, "dev");
  const runtimeScript = textOrFallback(startupIdentity.runtimeScript || frontendAssets.script, "--");
  const runtimeScriptSha = textOrFallback(startupIdentity.runtimeScriptSha256 || frontendAssets.scriptSha256, "--");
  const manifestFrontendAssets = manifest?.frontendAssets || {};
  const manifestScript = textOrFallback(startupIdentity.manifestScript || manifestFrontendAssets.script, "--");
  const manifestScriptSha = textOrFallback(startupIdentity.manifestScriptSha256 || manifestFrontendAssets.scriptSha256, "--");
  const startupDiagnosisText = buildStartupDiagnosisText(runtime);
  const clientEntryText = textOrFallback(clientEntry.message, "--");
  const recommendedEntryText = textOrFallback(clientEntry.recommendedEntry || options.recommendedClientText, "--");
  const webView2Text = textOrFallback(options.webView2Text, formatWebView2RuntimeText(webView2Runtime));
  const frontendResourceMatch = resolveFrontendResourceMatch(startupIdentity, runtimeScript, manifestScript);
  const resourceMatchText = frontendResourceMatch === true
    ? "是"
    : frontendResourceMatch === false
      ? "否"
      : "--";

  return [
    `应用：${appName}`,
    `版本：${version}`,
    `发布包：${textOrFallback(manifest?.packageName, "--")}`,
    `ZIP 文件：${textOrFallback(manifest?.packageFile, "--")}`,
    `EXE SHA256：${textOrFallback(manifest?.standaloneExeSha256 || manifest?.sha256, "--")}`,
    `ZIP SHA256：${textOrFallback(manifest?.packageSha256, "--")}`,
    `包地址：${textOrFallback(manifest?.currentPackageUrl, "--")}`,
    `更新源：${textOrFallback(manifest?.updateCheckUrl || manifest?.latestManifestUrl, "--")}`,
    `运行路径：${textOrFallback(runtime.executable, "--")}`,
    `程序目录：${textOrFallback(runtime.executableDirectory, "--")}`,
    `客户端入口：${clientEntryText}`,
    `推荐入口：${recommendedEntryText}`,
    `客户端模式：${textOrFallback(options.clientModeText, "--")}`,
    `窗口模式：${textOrFallback(options.consoleModeText, "--")}`,
    `脚本入口：${textOrFallback(options.launcherStatusText, "--")}`,
    `诊断结论：${startupDiagnosisText}`,
    `启动身份：${startupIdentity.ok === true ? "通过" : startupIdentity.ok === false ? "需要检查" : "--"}`,
    `前端资源：${runtimeScript}`,
    `前端资源 SHA256：${runtimeScriptSha}`,
    `清单前端资源：${manifestScript}`,
    `清单前端资源 SHA256：${manifestScriptSha}`,
    `资源一致：${resourceMatchText}`,
    `日志目录：${textOrFallback(runtime.toolLogDir || runtime.appDataRoot, "--")}`,
    `启动失败日志：${textOrFallback(startupFailureLog.path, "--")}`,
    `WebView2：${webView2Text}`,
  ].join("\n");
}

export function buildSupportTroubleshootingText(manifest = {}, runtimeDiagnostics = {}) {
  const runtime = runtimeDiagnostics || {};
  const startupIdentity = runtime.startupIdentity || {};
  const startupFailureLog = runtime.startupFailureLog || {};
  const clientEntry = runtime.clientEntry || {};
  const manifestFrontendAssets = manifest?.frontendAssets || {};
  const runtimeScript = textOrFallback(startupIdentity.runtimeScript || runtime.frontendAssets?.script, "--");
  const runtimeScriptSha = textOrFallback(startupIdentity.runtimeScriptSha256 || runtime.frontendAssets?.scriptSha256, "--");
  const manifestScript = textOrFallback(startupIdentity.manifestScript || manifestFrontendAssets.script, "--");
  const manifestScriptSha = textOrFallback(startupIdentity.manifestScriptSha256 || manifestFrontendAssets.scriptSha256, "--");
  const frontendResourceMatch = resolveFrontendResourceMatch(startupIdentity, runtimeScript, manifestScript);
  const resourceMatchText = frontendResourceMatch === true
    ? "是"
    : frontendResourceMatch === false
      ? "否"
      : "--";
  const webView2Text = formatWebView2RuntimeText(runtime.webView2Runtime || {});
  const clientEntryText = textOrFallback(clientEntry.message, "--");
  const recommendedEntryText = textOrFallback(clientEntry.recommendedEntry, "--");

  return [
    "SSH Agent 工具排查说明",
    `当前版本：${textOrFallback(manifest?.version, "dev")}`,
    `运行路径：${textOrFallback(runtime.executable, "--")}`,
    `程序目录：${textOrFallback(runtime.executableDirectory, "--")}`,
    `客户端入口：${clientEntryText}`,
    `推荐入口：${recommendedEntryText}`,
    `运行前端资源：${runtimeScript}`,
    `运行前端资源 SHA256：${runtimeScriptSha}`,
    `正确前端资源：${manifestScript}`,
    `正确前端资源 SHA256：${manifestScriptSha}`,
    `资源一致：${resourceMatchText}`,
    `ZIP SHA256：${textOrFallback(manifest?.packageSha256, "--")}`,
    `EXE SHA256：${textOrFallback(manifest?.standaloneExeSha256 || manifest?.sha256, "--")}`,
    `日志目录：${textOrFallback(runtime.toolLogDir || runtime.appDataRoot, "--")}`,
    `启动失败日志：${textOrFallback(startupFailureLog.path, "--")}`,
    `已知启动异常：${textOrFallback(startupFailureLog.knownSignature || startupFailureLog.knownIssue, "--")}`,
    `WebView2：${webView2Text}`,
    `WebView2 安装包：${WEBVIEW2_RUNTIME_DOWNLOAD_URL}`,
    "",
    "旧包判断方法：如果错误页里的 dist/assets/index-*.js 和“正确前端资源”不一致，就是旧包、旧解压目录或旧快捷方式。",
    "处理步骤：删除旧解压目录和旧桌面快捷方式，重新解压最新版 ZIP，然后双击 SSH-Agent-Tool.exe。",
    "干净解压：请解压到一个全新的空目录，不要覆盖解压到旧目录，旧目录里可能还有旧前端资源。",
    "快捷方式处理：不要继续使用旧桌面快捷方式；第一次启动请直接双击新解压目录里的 SSH-Agent-Tool.exe。",
    "快捷方式检查：桌面快捷方式右键属性里的“目标”必须指向新解压目录里的 SSH-Agent-Tool.exe。",
    "反馈建议：如果仍无法打开，请把这段排查说明、启动失败日志和工具内导出的诊断包一起发送给开发者。",
  ].join("\n");
}

export function buildStartupDiagnosisText(runtimeDiagnostics = {}) {
  const runtime = runtimeDiagnostics || {};
  const startupIdentity = runtime.startupIdentity || {};
  const startupFailureLog = runtime.startupFailureLog || {};
  const webView2Runtime = runtime.webView2Runtime || {};
  const clientEntry = runtime.clientEntry || {};
  const knownStartupIssue = classifyKnownStartupIssue(runtime);

  if (webView2Runtime.available === false) {
    return `未检测到 WebView2 Runtime，请先安装 Microsoft Edge WebView2 Runtime 后再启动：${WEBVIEW2_RUNTIME_DOWNLOAD_URL}`;
  }

  if (knownStartupIssue === "stale_frontend_bundle") {
    return "检测到旧版前端资源或旧安装包导致界面白屏。请删除旧解压目录和旧桌面快捷方式，只重新解压最新版 ZIP，然后双击里面的 SSH-Agent-Tool.exe。";
  }

  if ((clientEntry.ok === false || clientEntry.riskLevel === "warning") && clientEntry.message) {
    return String(clientEntry.message);
  }

  if (startupIdentity.frontendMatchesManifest === false || frontendScriptNamesMismatch(startupIdentity)) {
    return "前端资源与版本清单不一致，请重新使用最新版 ZIP 解压完整目录后运行。";
  }

  if (startupIdentity.ok === false) {
    return "启动身份校验未通过，请确认使用最新版 ZIP 内的 SSH-Agent-Tool.exe 启动。";
  }

  if (startupFailureLog.exists === true) {
    return "最近记录过启动失败，请打开启动失败日志并发送给开发者。";
  }

  return "未发现明显启动异常；如仍无法打开，请导出诊断包。";
}

function classifyKnownStartupIssue(runtimeDiagnostics = {}) {
  const runtime = runtimeDiagnostics || {};
  const startupIdentity = runtime.startupIdentity || {};
  const startupFailureLog = runtime.startupFailureLog || {};
  const staleBundleNames = [
    ["index-", "BCGy_mkD", ".js"].join(""),
    ["index-", "C55DkVKK", ".js"].join(""),
  ];
  const text = [
    startupFailureLog.knownIssue,
    startupFailureLog.knownSignature,
    startupFailureLog.message,
    startupFailureLog.error,
    startupFailureLog.preview,
    startupIdentity.runtimeScript,
  ].map((item) => String(item || "")).join("\n");

  if (
    startupFailureLog.knownIssue === "stale_frontend_bundle"
    || /Power\s+is not defined|ReferenceError:\s*Power|exportConnectionCheckReport\s+is not defined/.test(text)
    || staleBundleNames.some((name) => text.includes(name))
  ) {
    return "stale_frontend_bundle";
  }
  return "";
}

function frontendScriptNamesMismatch(startupIdentity = {}) {
  const runtimeScript = String(startupIdentity.runtimeScript || "").trim();
  const manifestScript = String(startupIdentity.manifestScript || "").trim();
  return Boolean(runtimeScript && manifestScript && runtimeScript !== manifestScript);
}

function resolveFrontendResourceMatch(startupIdentity = {}, runtimeScriptValue = "", manifestScriptValue = "") {
  if (startupIdentity.frontendMatchesManifest === true) return true;
  if (startupIdentity.frontendMatchesManifest === false) return false;
  const runtimeScript = String(runtimeScriptValue || "").trim();
  const manifestScript = String(manifestScriptValue || "").trim();
  if (!runtimeScript || !manifestScript || runtimeScript === "--" || manifestScript === "--") return null;
  return runtimeScript === manifestScript;
}

function formatWebView2RuntimeText(runtime = {}) {
  if (runtime.available === true) {
    return textOrFallback(runtime.version, "已检测到");
  }
  if (runtime.available === false) {
    return textOrFallback(runtime.message, "未检测到 Microsoft Edge WebView2 Runtime。");
  }
  return "--";
}

export function compareReleaseVersions(left, right) {
  const leftText = normalizeVersionText(left);
  const rightText = normalizeVersionText(right);
  if (leftText === rightText) return 0;

  const leftParts = extractNumericVersionParts(leftText);
  const rightParts = extractNumericVersionParts(rightText);
  if (leftParts.length > 0 || rightParts.length > 0) {
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const leftValue = leftParts[index] || 0;
      const rightValue = rightParts[index] || 0;
      if (leftValue > rightValue) return 1;
      if (leftValue < rightValue) return -1;
    }
    return 0;
  }

  return leftText.localeCompare(rightText, "zh-CN", { numeric: true, sensitivity: "base" });
}

function normalizeVersionText(value) {
  return String(value || "").trim();
}

function textOrFallback(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function extractNumericVersionParts(value) {
  return (String(value || "").match(/\d+/g) || []).map((part) => Number(part));
}

function isValidReleasePackageSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || "").trim());
}

function releaseFingerprintsChanged(currentManifest = {}, latestManifest = {}) {
  const currentFrontendAssets = currentManifest?.frontendAssets || {};
  const latestFrontendAssets = latestManifest?.frontendAssets || {};
  const comparablePairs = [
    [currentManifest?.packageSha256 || currentManifest?.zipSha256, latestManifest?.packageSha256 || latestManifest?.zipSha256],
    [
      currentManifest?.standaloneExeSha256 || currentManifest?.exeSha256 || currentManifest?.sha256,
      latestManifest?.standaloneExeSha256 || latestManifest?.exeSha256 || latestManifest?.sha256,
    ],
    [currentFrontendAssets?.scriptSha256, latestFrontendAssets?.scriptSha256],
    [currentFrontendAssets?.stylesheetSha256, latestFrontendAssets?.stylesheetSha256],
    [currentFrontendAssets?.script, latestFrontendAssets?.script],
    [currentFrontendAssets?.stylesheet, latestFrontendAssets?.stylesheet],
  ];

  return comparablePairs.some(([currentValue, latestValue]) => {
    const currentText = String(currentValue || "").trim();
    const latestText = String(latestValue || "").trim();
    return Boolean(currentText && latestText && currentText !== latestText);
  });
}

function inferPackageUrlFromUpdateManifest(updateCheckUrl, packageFile) {
  const fileName = String(packageFile || "").trim().split(/[\\/]/).pop();
  if (!fileName) return "";
  try {
    const manifestUrl = new URL(String(updateCheckUrl || "").trim());
    if (!["http:", "https:"].includes(manifestUrl.protocol)) return "";
    const directory = manifestUrl.pathname.replace(/[^/]*$/, "");
    return new URL(encodeURIComponent(fileName), `${manifestUrl.origin}${directory || "/"}`).href;
  } catch {
    return "";
  }
}
