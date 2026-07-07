import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${selector} CSS rule should exist`);
  return match[1];
}

function cssRuleContaining(selector, pattern) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`, "g"))];
  const match = matches.find((item) => pattern.test(item[1]));
  assert.ok(match, `${selector} CSS rule should include ${pattern}`);
  return match[1];
}

function componentSource(name, nextName) {
  const start = app.indexOf(`function ${name}`);
  const end = nextName ? app.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should exist after ${name}`);
  return app.slice(start, end);
}

test("critical desktop layout keeps Agent input tools compact and readable", () => {
  const source = componentSource("AgentPanel", "PlanCard");

  assert.match(source, /className="agent-input-card"/);
  assert.match(source, /className="agent-tool-row"/);
  assert.match(source, />\{"\\u4e0a\\u4f20\\u6587\\u4ef6"\}<\//);
  assert.match(source, />\{"\\u5f15\\u7528\\u7ec8\\u7aef"\}<\//);
  assert.match(source, />\{"\\u5f15\\u7528 SFTP"\}<\//);
  assert.match(source, />\{"\\u8054\\u7f51\\u641c\\u7d22"\}<\//);
  assert.match(source, /className="agent-attachments"/);
  assert.match(source, /className="agent-compose-row"/);

  assert.match(styles, /\.agent-input-card[\s\S]*display:\s*grid/);
  assert.match(styles, /\.agent-input-card \.agent-quick-prompts[\s\S]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.agent-tool-row[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.agent-tool-row button[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.agent-tool-row button[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.agent-attachments button[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.agent-input-card textarea[\s\S]*border:\s*1px solid/);
  assert.match(styles, /\.agent-compose-row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 34px/);
});

test("critical desktop layout keeps Enter output inside the terminal instead of stretching the app", () => {
  const rootRule = cssRule("html, body, #root");
  const bodyRule = cssRule("body");
  const shellRule = cssRule(".app-shell");
  const gridRule = cssRule(".workspace-grid");
  const workspaceRule = cssRule(".terminal-workspace");
  const terminalShellRule = cssRule(".terminal-shell");
  const terminalOutputRule = cssRule(".terminal-output");
  const agentPanelRule = cssRuleContaining(".agent-panel", /grid-template-rows/);
  const agentConversationRule = cssRule(".agent-conversation");
  const agentInputTextareaRule = cssRule(".agent-input-card textarea");

  assert.match(rootRule, /height:\s*100%/);
  assert.match(rootRule, /overflow:\s*hidden/);
  assert.match(bodyRule, /height:\s*100%/);
  assert.match(bodyRule, /overflow:\s*hidden/);
  assert.match(shellRule, /height:\s*100vh/);
  assert.match(shellRule, /overflow:\s*hidden/);
  assert.match(gridRule, /min-height:\s*0/);
  assert.match(gridRule, /overflow:\s*hidden/);
  assert.match(workspaceRule, /min-height:\s*0/);
  assert.match(workspaceRule, /overflow:\s*hidden/);
  assert.match(terminalShellRule, /min-height:\s*0/);
  assert.match(terminalShellRule, /overflow:\s*hidden/);
  assert.match(terminalOutputRule, /min-height:\s*0/);
  assert.match(terminalOutputRule, /overflow:\s*auto/);
  assert.match(agentPanelRule, /grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/);
  assert.match(agentPanelRule, /overflow:\s*hidden/);
  assert.match(agentConversationRule, /min-height:\s*0/);
  assert.match(agentConversationRule, /overflow:\s*auto/);
  assert.match(agentInputTextareaRule, /resize:\s*none/);
});

test("critical desktop layout styles the current Agent chat class names", () => {
  const source = componentSource("AgentPanel", "PlanCard");

  assert.match(source, /className="agent-header"/);
  assert.match(source, /className="agent-header-actions"/);
  assert.match(source, /className="agent-conversation"/);
  assert.match(source, /className=\{`chat-message/);
  assert.match(source, /className="chat-avatar"/);
  assert.match(source, /className="chat-bubble"/);

  assert.match(cssRule(".agent-header"), /display:\s*flex/);
  assert.match(cssRule(".agent-header-actions"), /display:\s*flex/);
  assert.match(cssRule(".agent-conversation"), /overflow:\s*auto/);
  assert.match(cssRule(".chat-message"), /display:\s*grid/);
  assert.match(cssRule(".chat-avatar"), /width:\s*26px/);
  assert.match(cssRule(".chat-message.user .chat-bubble"), /background:\s*#eef5ff/);
}
);

test("critical desktop layout keeps SFTP toolbar labels as full Chinese actions", () => {
  const start = app.indexOf("const sftpTopbarActions = [");
  const end = app.indexOf("const sshTopbarActions = [", start + 1);
  assert.notEqual(start, -1, "SFTP quick actions should exist");
  assert.notEqual(end, -1, "Sidebar should exist after SFTP quick actions");
  const source = app.slice(start, end);

  assert.match(source, /label:\s*"返回上级目录"/);
  assert.match(source, /label:\s*"上传文件"/);
  assert.match(source, /label:\s*"新建文件"/);
  assert.match(source, /label:\s*"新建目录"/);
  assert.match(source, /label:\s*"下载文件\/目录"/);
  assert.doesNotMatch(source, /下载文件\/目录[^}]+selectedFile\?\.type === "folder"/);
  assert.doesNotMatch(source, /label:\s*"上"/);
  assert.doesNotMatch(source, /label:\s*"传"/);
  assert.doesNotMatch(source, /label:\s*"下"/);
});
