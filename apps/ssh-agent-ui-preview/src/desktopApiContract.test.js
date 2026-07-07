import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "src", "App.jsx");
const desktopApiPath = join(projectRoot, "desktop_app.py");

function stripJavaScriptStrings(source) {
  return String(source || "").replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, (match) => match[0] + match.at(-1));
}

function frontendDesktopApiCalls(source) {
  const codeOnly = stripJavaScriptStrings(source);
  const names = new Set([...codeOnly.matchAll(/\bapi(?:\?\.)?\.([A-Za-z_]\w*)/g)].map((match) => match[1]));
  const details = [];

  for (const match of codeOnly.matchAll(/\bapi(?:\?\.)?\.([A-Za-z_]\w*)(?:\?\.)?\s*\(/g)) {
    const openParenIndex = codeOnly.indexOf("(", match.index + match[0].length - 1);
    const args = readCallArguments(codeOnly, openParenIndex);
    details.push({ name: match[1], providedArgs: countTopLevelArguments(args) });
  }

  for (const match of String(source || "").matchAll(/\bcallReleaseApi\(\s*["']([A-Za-z_]\w*)["']/g)) {
    const openParenIndex = String(source || "").indexOf("(", match.index);
    const args = readCallArguments(source, openParenIndex);
    const providedArgs = countTopLevelArguments(args) >= 3 ? 1 : 0;
    names.add(match[1]);
    details.push({ name: match[1], providedArgs });
  }

  const result = [...names].sort();
  Object.defineProperty(result, "details", { value: details, enumerable: false });
  return result;
}

function backendDesktopApiMethods(source) {
  const methods = [];
  for (const match of String(source || "").matchAll(/^    def ([A-Za-z_]\w*)\(([\s\S]*?)\)\s*(?:->[^:\n]+)?\s*:/gm)) {
    methods.push({ name: match[1], requiredArgs: countRequiredPythonArgs(match[2]) });
  }
  const result = [...new Set(methods.map((method) => method.name))].sort();
  Object.defineProperty(result, "details", { value: methods, enumerable: false });
  return result;
}

function findDesktopApiArityMismatches(calls, methods) {
  const requiredByName = new Map((methods.details || []).map((method) => [method.name, method.requiredArgs]));
  const seen = new Set();
  return (calls.details || [])
    .filter((call) => Number.isFinite(call.providedArgs))
    .filter((call) => {
      const requiredArgs = requiredByName.get(call.name);
      return Number.isFinite(requiredArgs) && call.providedArgs < requiredArgs;
    })
    .map((call) => ({ name: call.name, providedArgs: call.providedArgs, requiredArgs: requiredByName.get(call.name) }))
    .filter((item) => {
      const key = `${item.name}:${item.providedArgs}:${item.requiredArgs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readCallArguments(source, openParenIndex) {
  const text = String(source || "");
  if (openParenIndex < 0 || text[openParenIndex] !== "(") return "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  let templateExpressionDepth = 0;
  for (let index = openParenIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote === "`" && char === "$" && text[index + 1] === "{") {
        templateExpressionDepth += 1;
        depth += 1;
        index += 1;
        continue;
      }
      if (char === quote && templateExpressionDepth === 0) quote = "";
      if (quote === "`" && char === "}" && templateExpressionDepth > 0) {
        templateExpressionDepth -= 1;
        depth -= 1;
      }
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) {
      depth += 1;
      continue;
    }
    if (")]}\\".includes(char)) {
      if (char === ")" && depth === 0) return text.slice(openParenIndex + 1, index);
      depth = Math.max(0, depth - 1);
    }
    if (char === "/" && previous === "/") {
      const newline = text.indexOf("\n", index + 1);
      if (newline === -1) break;
      index = newline;
    }
  }
  return "";
}

function countTopLevelArguments(argsText) {
  const args = String(argsText || "").trim();
  if (!args) return 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  let count = 1;
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(char)) {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    else if (")]}\\".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) count += 1;
  }
  return count;
}

function countRequiredPythonArgs(paramsText) {
  return splitTopLevelPythonArgs(paramsText)
    .map((param) => param.trim())
    .filter(Boolean)
    .filter((param) => !param.startsWith("*"))
    .filter((param) => param.split(":", 1)[0].trim() !== "self")
    .filter((param) => !param.includes("="))
    .length;
}

function splitTopLevelPythonArgs(paramsText) {
  const text = String(paramsText || "").replace(/#[^\n]*/g, "");
  const parts = [];
  let depth = 0;
  let quote = "";
  let escaped = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (["\"", "'"].includes(char)) {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    else if (")]}\\".includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

test("desktop api scanner includes dynamic release api method names", () => {
  const calls = frontendDesktopApiCalls(`
    await api.read_release_manifest();
    await callReleaseApi("download_release_update", "正在下载...");
  `);

  assert.deepEqual(calls, ["download_release_update", "read_release_manifest"]);
});

test("desktop api contract reports calls with too few required arguments", () => {
  const calls = frontendDesktopApiCalls("await api.create_sftp_directory(server, credentialRef, targetPath);");
  const methods = backendDesktopApiMethods(`
class DesktopApi:
    def create_sftp_directory(self, server, credential_ref, parent_path, directory_name):
        pass
`);
  const mismatches = findDesktopApiArityMismatches(calls, methods);

  assert.deepEqual(mismatches, [{
    name: "create_sftp_directory",
    providedArgs: 3,
    requiredArgs: 4,
  }]);
});

test("frontend desktop api calls are implemented by DesktopApi", () => {
  const calls = frontendDesktopApiCalls(readFileSync(appPath, "utf8"));
  const methods = backendDesktopApiMethods(readFileSync(desktopApiPath, "utf8"));
  const missing = calls.filter((name) => !methods.includes(name));
  const arityMismatches = findDesktopApiArityMismatches(calls, methods);

  assert.ok(calls.length > 40, "should scan the real App.jsx desktop api surface");
  assert.equal(missing.length, 0, `DesktopApi missing frontend methods: ${missing.join(", ")}`);
  assert.deepEqual(arityMismatches, [], `DesktopApi calls with too few arguments: ${JSON.stringify(arityMismatches)}`);
});
