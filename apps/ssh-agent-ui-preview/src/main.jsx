import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

function sanitizeBoundaryError(error) {
  const raw = error?.stack || error?.message || String(error || "unknown render error");
  return String(raw)
    .replace(/\b(authorization\s*:\s*bearer\s+)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .replace(/\b(authorization\s*:\s*)(?!bearer\b)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .replace(/\b(cookie\s*:\s*)["']?[^"'\r\n]+/gi, "$1[redacted]")
    .replace(/((?:api[-_ ]?key|access[-_ ]?key|token|password|passwd|pwd|secret)\s*[:=]\s*)["']?[^"'\s,;]+/gi, "$1[redacted]")
    .slice(0, 4000);
}

function buildKnownCrashAdvice(error) {
  const text = sanitizeBoundaryError(error);
  const staleBundleNames = [
    ["index-", "BCGy_mkD", ".js"].join(""),
    ["index-", "C55DkVKK", ".js"].join(""),
  ];
  if (
    /Power\s+is not defined|ReferenceError:\s*Power|exportConnectionCheckReport\s+is not defined/.test(text)
    || staleBundleNames.some((name) => text.includes(name))
  ) {
    return "检测到旧版前端资源或旧安装包导致界面白屏。请删除旧解压目录和旧桌面快捷方式，只重新解压最新版 ZIP，然后双击里面的 SSH-Agent-Tool.exe。";
  }
  return "";
}

function buildCrashAdvice(error, currentScript, manifestScript) {
  const knownAdvice = buildKnownCrashAdvice(error);
  if (knownAdvice) return knownAdvice;

  const current = String(currentScript || "").trim();
  const expected = String(manifestScript || "").trim();
  if (current && expected && current !== expected) {
    return "当前页面脚本和版本清单不一致，通常是旧包、旧解压目录、旧桌面快捷方式或文件复制不完整。请删除旧目录后重新解压最新版 ZIP，再运行 SSH-Agent-Tool.exe。";
  }
  return "";
}

function buildCrashDiagnosis(error, currentScript, manifestScript) {
  const knownAdvice = buildKnownCrashAdvice(error);
  const current = String(currentScript || "").trim();
  const expected = String(manifestScript || "").trim();
  const mismatched = current && expected && current !== expected;
  if (!knownAdvice && !mismatched) return null;
  return {
    title: "\u68c0\u6d4b\u7ed3\u8bba",
    summary: "\u7591\u4f3c\u6b63\u5728\u8fd0\u884c\u65e7\u5b89\u88c5\u5305\u3001\u65e7\u89e3\u538b\u76ee\u5f55\u6216\u65e7\u684c\u9762\u5feb\u6377\u65b9\u5f0f",
    rows: [
      { label: "\u5f53\u524d\u811a\u672c", value: currentScript || "\u672a\u8bfb\u53d6" },
      { label: "\u6e05\u5355\u811a\u672c", value: manifestScript || "\u672a\u8bfb\u53d6" },
      { label: "\u5904\u7406\u65b9\u5f0f", value: "\u5220\u9664\u65e7\u76ee\u5f55\u548c\u65e7\u5feb\u6377\u65b9\u5f0f\uff0c\u91cd\u65b0\u89e3\u538b\u6700\u65b0 ZIP \u540e\u53cc\u51fb SSH-Agent-Tool.exe" },
    ],
  };
}

async function writeBoundaryToolLog(error, info) {
  try {
    await window.pywebview?.api?.write_tool_log_event?.({
      level: "error",
      component: "frontend",
      action: info?.action || "react_error_boundary",
      message: sanitizeBoundaryError(error),
      context: {
        componentStack: sanitizeBoundaryError(info?.componentStack || ""),
        frontendScript: info?.frontendScript || getCrashFrontendScriptName(error),
      },
    });
  } catch {
    // The recovery screen must still render even if logging is unavailable.
  }
}

function installFrontendRuntimeLogging() {
  window.addEventListener("error", (event) => {
    const error = sanitizeBoundaryError(event.error || event.message);
    void writeBoundaryToolLog(error, {
      action: "frontend_window_error",
      componentStack: sanitizeBoundaryError(event.filename || "") + ":" + String(event.lineno || ""),
      frontendScript: getCrashFrontendScriptName(event.error || event.filename || event.message),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = sanitizeBoundaryError(event.reason);
    void writeBoundaryToolLog(reason, {
      action: "frontend_unhandled_rejection",
      componentStack: "unhandled promise rejection",
      frontendScript: getCrashFrontendScriptName(event.reason),
    });
  });
}

function getCurrentFrontendScriptName() {
  const scripts = Array.from(document.scripts || []);
  const src = scripts
    .map((script) => script?.src || "")
    .reverse()
    .find((value) => /\/assets\/index-[^/\\]+\.js(?:$|[?#])/i.test(value) || /assets[\\/]+index-[^/\\]+\.js/i.test(value));
  if (!src) return "";
  try {
    const pathname = new URL(src, window.location.href).pathname.replace(/\\/g, "/");
    const assetIndex = pathname.lastIndexOf("/assets/");
    if (assetIndex >= 0) return pathname.slice(assetIndex + 1);
    return pathname.split("/").filter(Boolean).pop() || src;
  } catch {
    const normalized = String(src).replace(/\\/g, "/");
    const assetIndex = normalized.lastIndexOf("/assets/");
    if (assetIndex >= 0) return normalized.slice(assetIndex + 1).split(/[?#]/)[0];
    return normalized.split("/").filter(Boolean).pop()?.split(/[?#]/)[0] || "";
  }
}

function extractFrontendScriptNameFromError(error) {
  const text = sanitizeBoundaryError(error);
  const assetMatch = text.match(/(?:dist[\\/])?assets[\\/]((?:index-)[^"'()\s\\/]+\.js)/i);
  if (assetMatch?.[1]) return `assets/${assetMatch[1]}`;
  const fileMatch = text.match(/\b((?:index-)[^"'()\s\\/]+\.js)\b/i);
  return fileMatch?.[1] ? `assets/${fileMatch[1]}` : "";
}

function getCrashFrontendScriptName(error) {
  return getCurrentFrontendScriptName() || extractFrontendScriptNameFromError(error);
}

function buildCrashScriptMatchText(currentScript, manifestScript) {
  const current = String(currentScript || "").trim();
  const expected = String(manifestScript || "").trim();
  if (!current || !expected) return "--";
  return current === expected
    ? "是"
    : "否，脚本不一致就是旧包、旧解压目录、旧快捷方式或残缺复制。";
}

function buildCrashDetailsText(error, releaseManifest, runtimeDiagnostics) {
  const manifest = releaseManifest || {};
  const runtime = runtimeDiagnostics || {};
  const assets = manifest.frontendAssets || {};
  const clientEntry = runtime.clientEntry || {};
  const currentFrontendScript = getCrashFrontendScriptName(error);
  const scriptMatchText = buildCrashScriptMatchText(currentFrontendScript, assets.script);
  const crashAdvice = buildCrashAdvice(error, currentFrontendScript, assets.script);
  return [
    "SSH Agent 工具界面错误",
    `版本：${manifest.version || "--"}`,
    `包名：${manifest.packageName || "--"}`,
    `ZIP 文件：${manifest.packageFile || "--"}`,
    `ZIP SHA256：${manifest.packageSha256 || "--"}`,
    `EXE SHA256：${manifest.standaloneExeSha256 || manifest.sha256 || "--"}`,
    `更新通道：${manifest.updateChannel || "--"}`,
    `可执行文件：${manifest.executable || "--"}`,
    `生成时间：${manifest.generatedAt || "--"}`,
    `运行路径：${runtime.executable || "--"}`,
    `程序目录：${runtime.executableDirectory || "--"}`,
    `日志目录：${runtime.toolLogDir || runtime.appDataRoot || "--"}`,
    `客户端入口：${clientEntry.message || "--"}`,
    `推荐入口：${clientEntry.recommendedEntry || "完整解压最新版 ZIP 后，双击解压目录根部的 SSH-Agent-Tool.exe"}`,
    `当前页面脚本：${currentFrontendScript || "--"}`,
    `清单前端脚本：${assets.script || "--"}`,
    `脚本一致：${scriptMatchText}`,
    `脚本哈希：${assets.scriptSha256 || "--"}`,
    `样式哈希：${assets.stylesheetSha256 || "--"}`,
    crashAdvice ? `诊断建议：${crashAdvice}` : "",
    "",
    "跨电脑启动排查：",
    "1. 对比当前页面脚本和清单前端脚本；如果不一致，就是旧包、旧解压目录、旧快捷方式或复制不完整。",
    "2. 打开解压目录里的版本指纹.txt，对比错误页里的当前页面脚本和版本指纹里的前端资源。",
    "3. 删除旧解压目录和旧桌面快捷方式。",
    "4. 重新完整解压最新版 ZIP，再双击 SSH-Agent-Tool.exe。",
    "5. 如果客户端入口提示临时目录，请不要从压缩包预览窗口直接运行，先完整解压到普通文件夹。",
    "6. 如果仍失败，请在此页面点击“导出诊断包”，把诊断包和本段错误信息一起发送给开发者。",
    "",
    sanitizeBoundaryError(error),
  ].filter((line) => line !== "").join("\n");
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      releaseManifest: null,
      runtimeDiagnostics: null,
      diagnosticPackageStatus: "",
      copyCrashStatus: "",
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    void writeBoundaryToolLog(error, {
      action: "react_error_boundary",
      componentStack: info?.componentStack || "",
      frontendScript: getCrashFrontendScriptName(error),
    });
    void this.loadCrashReleaseManifest();
    void this.loadCrashRuntimeDiagnostics();
  }

  async loadCrashReleaseManifest() {
    const api = window.pywebview?.api;
    if (!api?.read_release_manifest) return;
    try {
      const releaseManifest = await api.read_release_manifest();
      if (releaseManifest && typeof releaseManifest === "object") {
        this.setState({ releaseManifest });
      }
    } catch {
      // The recovery screen must not depend on release metadata being available.
    }
  }

  async loadCrashRuntimeDiagnostics() {
    const api = window.pywebview?.api;
    if (!api?.read_runtime_diagnostics) return;
    try {
      const runtimeDiagnostics = await api.read_runtime_diagnostics();
      if (runtimeDiagnostics && typeof runtimeDiagnostics === "object") {
        this.setState({ runtimeDiagnostics });
      }
    } catch {
      // The recovery screen must still render even if runtime diagnostics fail.
    }
  }

  async openToolLogs() {
    const api = window.pywebview?.api;
    if (!api?.get_tool_log_dir) return;
    try {
      const path = await api.get_tool_log_dir();
      if (path && api.open_path) await api.open_path(path);
    } catch {
      // Keep the crash recovery UI usable even if the shell open call fails.
    }
  }

  async openCrashInstallDirectory() {
    const api = window.pywebview?.api;
    const runtimeDiagnostics = this.state.runtimeDiagnostics || {};
    const targetPath = String(runtimeDiagnostics.executableDirectory || "").trim();
    if (!api?.open_path) {
      this.setState({ copyCrashStatus: "当前环境不支持打开程序目录，请复制错误信息继续排查。" });
      return;
    }
    if (!targetPath) {
      this.setState({ copyCrashStatus: "暂时没有读取到程序目录，请先复制错误信息或导出诊断包。" });
      return;
    }
    try {
      await api.open_path(targetPath);
    } catch (error) {
      this.setState({ copyCrashStatus: `程序目录打开失败：${sanitizeBoundaryError(error)}` });
    }
  }

  async openCrashFingerprintFile() {
    const api = window.pywebview?.api;
    const runtimeDiagnostics = this.state.runtimeDiagnostics || {};
    const executableDirectory = String(runtimeDiagnostics.executableDirectory || "").trim();
    const fingerprintPath = executableDirectory ? `${executableDirectory}\\版本指纹.txt` : "";
    if (!api?.open_path) {
      this.setState({ copyCrashStatus: "当前环境不支持打开版本指纹，请复制错误信息继续排查。" });
      return;
    }
    if (!fingerprintPath) {
      this.setState({ copyCrashStatus: "暂时没有读取到版本指纹位置，请先复制错误信息或导出诊断包。" });
      return;
    }
    try {
      await api.open_path(fingerprintPath);
    } catch (error) {
      this.setState({ copyCrashStatus: `版本指纹打开失败：${sanitizeBoundaryError(error)}` });
    }
  }

  async exportCrashDiagnosticPackage() {
    const api = window.pywebview?.api;
    if (!api?.export_diagnostic_package) {
      this.setState({ diagnosticPackageStatus: "当前环境不支持导出诊断包，请使用正式 Windows 客户端。" });
      return;
    }
    this.setState({ diagnosticPackageStatus: "正在导出诊断包..." });
    try {
      const result = await api.export_diagnostic_package();
      const diagnosticPackagePath = String(result?.path || "").trim();
      let copyHint = "";
      if (diagnosticPackagePath && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(diagnosticPackagePath);
          copyHint = "，诊断包路径已复制";
        } catch {
          copyHint = "，诊断包路径复制失败，请手动复制";
        }
      }
      const fileCount = Array.isArray(result?.files) ? `，共 ${result.files.length} 个文件` : "";
      const status = diagnosticPackagePath
        ? `诊断包已导出：${diagnosticPackagePath}${fileCount}${copyHint}`
        : result?.message || "诊断包已导出。";
      this.setState({ diagnosticPackageStatus: status });
    } catch (error) {
      const runtimeDiagnostics = this.state.runtimeDiagnostics || {};
      const toolLogDir = runtimeDiagnostics.toolLogDir || runtimeDiagnostics.appDataRoot || "";
      const logHint = toolLogDir ? `\n工具日志目录：${toolLogDir}` : "";
      this.setState({
        diagnosticPackageStatus: `诊断包导出失败：${sanitizeBoundaryError(error)}${logHint}\n请点击“复制错误信息”，并把错误信息和工具日志一起反馈。`,
      });
    }
  }

  async copyCrashDetails() {
    const details = buildCrashDetailsText(this.state.error, this.state.releaseManifest, this.state.runtimeDiagnostics);
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copyCrashStatus: "错误信息已复制，可以直接粘贴反馈给开发者。" });
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = details;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        this.setState({
          copyCrashStatus: copied
            ? "错误信息已复制，可以直接粘贴反馈给开发者。"
            : "复制失败，请手动复制页面中的错误堆栈和版本信息。",
        });
      } catch {
        this.setState({ copyCrashStatus: "复制失败，请手动复制页面中的错误堆栈和版本信息。" });
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const crashReleaseManifest = this.state.releaseManifest;
    const crashRuntimeDiagnostics = this.state.runtimeDiagnostics;
    const crashFrontendAssets = crashReleaseManifest?.frontendAssets || {};
    const crashClientEntry = crashRuntimeDiagnostics?.clientEntry || {};
    const knownCrashAdvice = buildKnownCrashAdvice(this.state.error);
    const currentFrontendScript = getCrashFrontendScriptName(this.state.error);
    const scriptMatchText = buildCrashScriptMatchText(currentFrontendScript, crashFrontendAssets.script);
    const crashAdvice = buildCrashAdvice(this.state.error, currentFrontendScript, crashFrontendAssets.script);
    const crashDiagnosis = buildCrashDiagnosis(this.state.error, currentFrontendScript, crashFrontendAssets.script);
    const releaseRows = [
      ["版本：", crashReleaseManifest?.version],
      ["包名：", crashReleaseManifest?.packageName],
      ["ZIP 文件：", crashReleaseManifest?.packageFile],
      ["ZIP SHA256：", crashReleaseManifest?.packageSha256],
      ["EXE SHA256：", crashReleaseManifest?.standaloneExeSha256 || crashReleaseManifest?.sha256],
      ["更新通道：", crashReleaseManifest?.updateChannel],
      ["可执行文件：", crashReleaseManifest?.executable],
      ["生成时间：", crashReleaseManifest?.generatedAt],
      ["运行路径：", crashRuntimeDiagnostics?.executable],
      ["程序目录：", crashRuntimeDiagnostics?.executableDirectory],
      ["日志目录：", crashRuntimeDiagnostics?.toolLogDir || crashRuntimeDiagnostics?.appDataRoot],
      ["客户端入口：", crashClientEntry.message],
      ["推荐入口：", crashClientEntry.recommendedEntry],
      ["当前页面脚本：", currentFrontendScript],
      ["清单前端脚本：", crashFrontendAssets.script],
      ["脚本一致：", scriptMatchText],
      ["脚本哈希：", crashFrontendAssets.scriptSha256],
      ["样式哈希：", crashFrontendAssets.stylesheetSha256],
    ].filter(([, value]) => String(value || "").trim());

    return (
      <main className="app-crash-screen" role="alert">
        <section>
          <p className="app-crash-kicker">SSH Agent 工具</p>
          <h1>界面发生错误</h1>
          <p>当前窗口没有白屏，错误已经写入工具日志。你可以重新加载界面，或打开日志目录继续排查。</p>
          {crashAdvice && <p className="app-crash-advice">{crashAdvice}</p>}
          {crashDiagnosis && (
            <div className="app-crash-diagnosis" role="note">
              <strong>{crashDiagnosis.title}</strong>
              <p>{crashDiagnosis.summary}</p>
              <dl>
                {crashDiagnosis.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {releaseRows.length > 0 && (
            <dl className="app-crash-meta" aria-label="当前版本信息">
              {releaseRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{String(value || "").trim()}</dd>
                </div>
              ))}
            </dl>
          )}
          <pre>{sanitizeBoundaryError(this.state.error)}</pre>
          {this.state.diagnosticPackageStatus && (
            <p className="app-crash-diagnostic-status">{this.state.diagnosticPackageStatus}</p>
          )}
          {this.state.copyCrashStatus && (
            <p className="app-crash-copy-status" role="status">{this.state.copyCrashStatus}</p>
          )}
          <div className="app-crash-actions">
            <button type="button" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button type="button" onClick={() => this.openToolLogs()}>
              打开工具日志
            </button>
            <button type="button" onClick={() => this.openCrashInstallDirectory()}>
              打开程序目录
            </button>
            <button type="button" onClick={() => this.openCrashFingerprintFile()}>
              打开版本指纹
            </button>
            <button type="button" onClick={() => this.copyCrashDetails()}>
              复制错误信息
            </button>
            <button type="button" onClick={() => this.exportCrashDiagnosticPackage()}>
              导出诊断包
            </button>
          </div>
        </section>
      </main>
    );
  }
}

installFrontendRuntimeLogging();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
