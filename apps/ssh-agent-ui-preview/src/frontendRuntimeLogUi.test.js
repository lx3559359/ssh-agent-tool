import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("crash recovery screen keeps user-facing Chinese readable", () => {
  assert.match(main, /SSH Agent 工具/);
  assert.match(main, /界面发生错误/);
  assert.match(main, /打开工具日志/);
  assert.match(main, /导出诊断包/);
  assert.match(main, /复制错误信息/);
  assert.match(main, /删除旧解压目录和旧桌面快捷方式/);
  assert.doesNotMatch(main, /鐣岄潰|閿欒|宸ュ叿|妫€|褰撳墠|瀵煎嚭|鏃ュ織|鎵撳紑|閲嶆柊/);
});

test("frontend runtime logs window errors and unhandled promise rejections", () => {
  assert.match(main, /function installFrontendRuntimeLogging\(\)/);
  assert.match(main, /window\.addEventListener\("error",/);
  assert.match(main, /window\.addEventListener\("unhandledrejection",/);
  assert.match(main, /action:\s*"frontend_window_error"/);
  assert.match(main, /action:\s*"frontend_unhandled_rejection"/);
  assert.match(main, /sanitizeBoundaryError\(event\.error \|\| event\.message/);
  assert.match(main, /sanitizeBoundaryError\(event\.reason/);
  assert.match(main, /installFrontendRuntimeLogging\(\)/);
});

test("frontend crash logs include the running frontend asset name", () => {
  const loggerStart = main.indexOf("async function writeBoundaryToolLog");
  const loggerEnd = main.indexOf("function installFrontendRuntimeLogging", loggerStart);
  const boundaryStart = main.indexOf("componentDidCatch(error, info)");
  const boundaryEnd = main.indexOf("async loadCrashReleaseManifest", boundaryStart);
  const runtimeStart = main.indexOf("function installFrontendRuntimeLogging");
  const runtimeEnd = main.indexOf("function getCurrentFrontendScriptName", runtimeStart);

  assert.notEqual(loggerStart, -1, "writeBoundaryToolLog should exist");
  assert.notEqual(loggerEnd, -1, "writeBoundaryToolLog should end before runtime logging");
  assert.notEqual(boundaryStart, -1, "React error boundary should log caught crashes");
  assert.notEqual(boundaryEnd, -1, "React error boundary logging block should be sliceable");
  assert.notEqual(runtimeStart, -1, "runtime error logging should exist");
  assert.notEqual(runtimeEnd, -1, "runtime logging should end before script-name helper");

  const loggerSource = main.slice(loggerStart, loggerEnd);
  const boundarySource = main.slice(boundaryStart, boundaryEnd);
  const runtimeSource = main.slice(runtimeStart, runtimeEnd);

  assert.match(loggerSource, /frontendScript:[^\n]*getCrashFrontendScriptName\(error\)/);
  assert.match(boundarySource, /frontendScript:\s*getCrashFrontendScriptName\(error\)/);
  assert.match(runtimeSource, /frontendScript:\s*getCrashFrontendScriptName\(/);
});

test("crash recovery screen exposes release identity for cross-machine startup failures", () => {
  assert.match(main, /async loadCrashReleaseManifest\(\)/);
  assert.match(main, /window\.pywebview\?\.api/);
  assert.match(main, /read_release_manifest/);
  assert.match(main, /async loadCrashRuntimeDiagnostics\(\)/);
  assert.match(main, /read_runtime_diagnostics/);
  assert.match(main, /function getCurrentFrontendScriptName\(\)/);
  assert.match(main, /document\.scripts/);
  assert.match(main, /const currentFrontendScript = getCrashFrontendScriptName\(this\.state\.error\)/);
  assert.match(main, /releaseManifest:\s*null/);
  assert.match(main, /runtimeDiagnostics:\s*null/);
  assert.match(main, /const crashReleaseManifest = this\.state\.releaseManifest/);
  assert.match(main, /const crashRuntimeDiagnostics = this\.state\.runtimeDiagnostics/);
  assert.match(main, /const crashFrontendAssets = crashReleaseManifest\?\.frontendAssets/);
  assert.match(main, /packageFile/);
  assert.match(main, /packageSha256/);
  assert.match(main, /standaloneExeSha256/);
  assert.match(main, /executableDirectory/);
  assert.match(main, /toolLogDir/);
  assert.match(main, /scriptSha256/);
  assert.match(main, /stylesheetSha256/);
  assert.match(main, /ZIP SHA256/);
  assert.match(main, /EXE SHA256/);
  assert.match(main, /运行路径：/);
  assert.match(main, /程序目录：/);
  assert.match(main, /日志目录：/);
  assert.match(main, /当前页面脚本：/);
  assert.match(main, /清单前端脚本：/);
  assert.match(main, /脚本一致：/);
  assert.match(main, /脚本不一致就是旧包、旧解压目录、旧快捷方式或残缺复制/);
  assert.match(main, /app-crash-meta/);
});

test("crash recovery screen exposes client entry diagnostics for zip transfer failures", () => {
  assert.match(main, /clientEntry/);
  assert.match(main, /\u5ba2\u6237\u7aef\u5165\u53e3/);
  assert.match(main, /\u63a8\u8350\u5165\u53e3/);
  assert.match(main, /\u5b8c\u6574\u89e3\u538b/);
  assert.match(main, /\u4e34\u65f6\u76ee\u5f55/);
  assert.match(main, /SSH-Agent-Tool\.exe/);
});

test("crash recovery screen explains known stale frontend white screen signatures", () => {
  assert.match(main, /function buildKnownCrashAdvice\(error\)/);
  assert.match(main, /Power\\s\+is not defined/);
  assert.match(main, /BCGy_mkD/);
  assert.match(main, /staleBundleNames/);
  assert.match(main, /旧版前端资源|旧安装包/);
  assert.match(main, /最新版 ZIP/);
  assert.match(main, /旧解压目录/);
  assert.match(main, /旧桌面快捷方式/);
  assert.match(main, /SSH-Agent-Tool\.exe/);
  assert.match(main, /app-crash-advice/);
  assert.match(main, /buildKnownCrashAdvice\(this\.state\.error\)/);
});

test("crash recovery screen gives prominent advice when frontend script mismatches the manifest", () => {
  assert.match(main, /function buildCrashAdvice\(error,\s*currentScript,\s*manifestScript\)/);
  assert.match(main, /buildKnownCrashAdvice\(error\)/);
  assert.match(main, /current !== expected/);
  assert.match(main, /当前页面脚本和版本清单不一致/);
  assert.match(main, /旧包、旧解压目录、旧桌面快捷方式或文件复制不完整/);
  assert.match(main, /请删除旧目录后重新解压最新版 ZIP/);
  assert.match(main, /const crashAdvice = buildCrashAdvice\(this\.state\.error,\s*currentFrontendScript,\s*crashFrontendAssets\.script\)/);
  assert.match(main, /\{crashAdvice && <p className="app-crash-advice">\{crashAdvice\}<\/p>\}/);
});

test("crash recovery screen shows a compact diagnosis banner for stale packages", () => {
  assert.match(main, /function buildCrashDiagnosis\(error,\s*currentScript,\s*manifestScript\)/);
  assert.match(main, /knownAdvice/);
  assert.match(main, /title:\s*"\\u68c0\\u6d4b\\u7ed3\\u8bba"/);
  assert.match(main, /summary:\s*"\\u7591\\u4f3c\\u6b63\\u5728\\u8fd0\\u884c\\u65e7\\u5b89\\u88c5\\u5305\\u3001\\u65e7\\u89e3\\u538b\\u76ee\\u5f55\\u6216\\u65e7\\u684c\\u9762\\u5feb\\u6377\\u65b9\\u5f0f"/);
  assert.match(main, /currentScript \|\| "\\u672a\\u8bfb\\u53d6"/);
  assert.match(main, /manifestScript \|\| "\\u672a\\u8bfb\\u53d6"/);
  assert.match(main, /const crashDiagnosis = buildCrashDiagnosis\(this\.state\.error,\s*currentFrontendScript,\s*crashFrontendAssets\.script\)/);
  assert.match(main, /className="app-crash-diagnosis"/);
  assert.match(main, /crashDiagnosis\.title/);
  assert.match(main, /crashDiagnosis\.summary/);
  assert.match(styles, /\.app-crash-diagnosis\s*\{/);
  assert.match(styles, /\.app-crash-diagnosis dl\s*\{/);
});

test("crash recovery can identify frontend asset names from stack traces", () => {
  assert.match(main, /function extractFrontendScriptNameFromError\(error\)/);
  assert.match(main, /dist\[\\\\\/\]\)\?assets\[\\\\\/\]/);
  assert.match(main, /\(\?:index-\)/);
  assert.match(main, /assets\/\$\{assetMatch\[1\]\}/);
  assert.match(main, /function getCrashFrontendScriptName\(error\)/);
  assert.match(main, /getCurrentFrontendScriptName\(\) \|\| extractFrontendScriptNameFromError\(error\)/);
  assert.match(main, /const currentFrontendScript = getCrashFrontendScriptName\(error\)/);
  assert.match(main, /const currentFrontendScript = getCrashFrontendScriptName\(this\.state\.error\)/);
});

test("crash recovery screen can export a diagnostic package from the error page", () => {
  assert.match(main, /diagnosticPackageStatus:\s*""/);
  assert.match(main, /async exportCrashDiagnosticPackage\(\)/);
  assert.match(main, /api\?\.export_diagnostic_package/);
  assert.match(main, /await api\.export_diagnostic_package\(\)/);
  assert.match(main, /this\.setState\(\{ diagnosticPackageStatus:/);
  assert.match(main, /app-crash-diagnostic-status/);
  assert.match(main, />\s*导出诊断包\s*</);
});

test("crash recovery screen can open the current program directory", () => {
  assert.match(main, /async openCrashInstallDirectory\(\)/);
  assert.match(main, /runtimeDiagnostics/);
  assert.match(main, /executableDirectory/);
  assert.match(main, /api\?\.open_path/);
  assert.match(main, /await api\.open_path\(targetPath\)/);
  assert.match(main, /打开程序目录/);
  assert.match(main, /onClick=\{\(\) => this\.openCrashInstallDirectory\(\)\}/);
});

test("crash recovery screen can open the release fingerprint file", () => {
  assert.match(main, /async openCrashFingerprintFile\(\)/);
  assert.match(main, /const fingerprintPath = executableDirectory \? `\$\{executableDirectory\}\\{2}版本指纹\.txt` : ""/);
  assert.match(main, /await api\.open_path\(fingerprintPath\)/);
  assert.match(main, /打开版本指纹/);
  assert.match(main, /onClick=\{\(\) => this\.openCrashFingerprintFile\(\)\}/);
});

test("crash diagnostic export copies the generated package path for cross-machine bug reports", () => {
  const start = main.indexOf("async exportCrashDiagnosticPackage()");
  const end = main.indexOf("async copyCrashDetails()", start);
  assert.notEqual(start, -1, "exportCrashDiagnosticPackage should exist");
  assert.notEqual(end, -1, "copyCrashDetails should follow diagnostic export");
  const source = main.slice(start, end);

  assert.match(source, /const diagnosticPackagePath = String\(result\?\.path \|\| ""\)\.trim\(\)/);
  assert.match(source, /navigator\?\.clipboard\?\.writeText/);
  assert.match(source, /await navigator\.clipboard\.writeText\(diagnosticPackagePath\)/);
  assert.match(source, /诊断包路径已复制/);
});

test("crash recovery diagnostic export failure points users to logs and copied details", () => {
  const start = main.indexOf("async exportCrashDiagnosticPackage()");
  const end = main.indexOf("async copyCrashDetails()", start);
  assert.notEqual(start, -1, "exportCrashDiagnosticPackage should exist");
  assert.notEqual(end, -1, "copyCrashDetails should follow diagnostic export");
  const source = main.slice(start, end);

  assert.match(source, /runtimeDiagnostics/);
  assert.match(source, /toolLogDir/);
  assert.match(source, /工具日志目录/);
  assert.match(source, /复制错误信息/);
  assert.match(source, /诊断包导出失败/);
});

test("copied crash details include a cross-machine startup checklist", () => {
  const detailsStart = main.indexOf("function buildCrashDetailsText");
  const detailsEnd = main.indexOf("class AppErrorBoundary", detailsStart);
  assert.notEqual(detailsStart, -1, "buildCrashDetailsText should exist");
  assert.notEqual(detailsEnd, -1, "buildCrashDetailsText should end before the error boundary class");
  const source = main.slice(detailsStart, detailsEnd);

  assert.match(source, /跨电脑启动排查/);
  assert.match(source, /运行路径：/);
  assert.match(source, /程序目录：/);
  assert.match(source, /日志目录：/);
  assert.match(source, /对比当前页面脚本和清单前端脚本/);
  assert.match(source, /删除旧解压目录和旧桌面快捷方式/);
  assert.match(source, /重新完整解压最新版 ZIP/);
  assert.match(source, /导出诊断包/);
  assert.match(source, /版本指纹\.txt/);
  assert.match(source, /对比错误页里的当前页面脚本和版本指纹里的前端资源/);
});

test("copied crash details keep cross-machine diagnostics in readable Chinese", () => {
  const detailsStart = main.indexOf("function buildCrashDetailsText");
  const detailsEnd = main.indexOf("class AppErrorBoundary", detailsStart);
  assert.notEqual(detailsStart, -1, "buildCrashDetailsText should exist");
  assert.notEqual(detailsEnd, -1, "buildCrashDetailsText should end before the error boundary class");
  const source = main.slice(detailsStart, detailsEnd);

  assert.match(source, /SSH Agent 工具界面错误/);
  assert.match(source, /跨电脑启动排查/);
  assert.match(source, /运行路径：/);
  assert.match(source, /程序目录：/);
  assert.match(source, /日志目录：/);
  assert.match(source, /版本指纹\.txt/);
  assert.match(source, /删除旧解压目录和旧桌面快捷方式/);
  assert.match(source, /重新完整解压最新版 ZIP/);
  assert.doesNotMatch(source, /宸ュ叿|鐣岄潰|璺ㄧ數|鏃ュ織|鏈€鏂|瑙ｅ帇|瀵煎嚭/);
});

test("crash recovery copy action reports success or fallback guidance", () => {
  assert.match(main, /copyCrashStatus:\s*""/);
  assert.match(main, /this\.setState\(\{ copyCrashStatus:\s*"错误信息已复制/);
  assert.match(main, /this\.setState\(\{ copyCrashStatus:\s*"复制失败/);
  assert.match(main, /请手动复制页面中的错误堆栈/);
  assert.match(main, /app-crash-copy-status/);
  assert.match(main, /\{this\.state\.copyCrashStatus &&/);
});

test("frontend runtime error sanitizers redact auth headers and bearer tokens", () => {
  const boundaryStart = main.indexOf("function sanitizeBoundaryError");
  const boundaryEnd = main.indexOf("async function writeBoundaryToolLog", boundaryStart);
  const runtimeStart = app.indexOf("function sanitizeFrontendRuntimeError");
  const runtimeEnd = app.indexOf("function readLocalJson", runtimeStart);

  assert.notEqual(boundaryStart, -1, "sanitizeBoundaryError should exist");
  assert.notEqual(boundaryEnd, -1, "sanitizeBoundaryError should end before logger");
  assert.notEqual(runtimeStart, -1, "sanitizeFrontendRuntimeError should exist");
  assert.notEqual(runtimeEnd, -1, "sanitizeFrontendRuntimeError should end before local storage helpers");

  const boundarySource = main.slice(boundaryStart, boundaryEnd);
  const runtimeSource = app.slice(runtimeStart, runtimeEnd);

  assert.match(boundarySource, /authorization/i);
  assert.match(boundarySource, /bearer/i);
  assert.match(boundarySource, /cookie/i);
  assert.match(runtimeSource, /authorization/i);
  assert.match(runtimeSource, /bearer/i);
  assert.match(runtimeSource, /cookie/i);
});
