import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function agentPanelSource() {
  const start = app.indexOf("function AgentPanel");
  const end = app.indexOf("function PlanCard", start);
  assert.notEqual(start, -1, "AgentPanel should exist");
  assert.notEqual(end, -1, "PlanCard should follow AgentPanel");
  return app.slice(start, end);
}

function buildModelMessagesSource() {
  const start = app.indexOf("function buildModelMessages");
  const end = app.indexOf("function buildAgentSearchStatusMessage", start);
  assert.notEqual(start, -1, "buildModelMessages should exist");
  assert.notEqual(end, -1, "buildAgentSearchStatusMessage should follow buildModelMessages");
  return app.slice(start, end);
}

function toolSettingsSource() {
  const start = app.indexOf("function ToolSettingsModal");
  const end = app.indexOf("function ModelSettingsModal", start);
  assert.notEqual(start, -1, "ToolSettingsModal should exist");
  assert.notEqual(end, -1, "ModelSettingsModal should follow ToolSettingsModal");
  return app.slice(start, end);
}

test("Agent quick prompts render labels and insert prompt text", () => {
  const source = agentPanelSource();

  assert.match(source, /const promptText = typeof prompt === "string" \? prompt : prompt\?\.text \|\| ""/);
  assert.match(source, /key=\{item\.label \|\| item\.text\}/);
  assert.match(source, />\{item\.label \|\| item\.text\}<\/button>/);
  assert.doesNotMatch(source, /key=\{item\}/);
  assert.doesNotMatch(source, />\{item\}<\/button>/);
});

test("Agent chat expands simple slash commands before sending", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  const sendSource = source.slice(sendStart, sendEnd);

  assert.match(app, /const AGENT_SLASH_COMMANDS = \[/);
  assert.match(app, /aliases:\s*\["\/分析",\s*"\/analyse",\s*"\/analyze"\]/);
  assert.match(app, /function expandAgentSlashCommand\(value = ""\)/);
  assert.match(app, /const normalized = raw\.replace\(\s*\/\\s\+\/g,\s*" "\s*\)\.trim\(\)/);
  assert.match(app, /return `\$\{item\.text\}\\n\\n\$\{detail\}`/);
  assert.match(sendSource, /const rawText = message\.trim\(\)/);
  assert.match(sendSource, /const text = expandAgentSlashCommand\(rawText\)/);
  assert.match(sendSource, /\{ role: "user", text, attachmentSummary: sentAttachmentSummary \}/);
});

test("Agent uses the visible SSH terminal lines for attachment and model context", () => {
  const source = agentPanelSource();
  const modelSource = buildModelMessagesSource();
  const renderStart = app.indexOf("<AgentPanel");
  const renderEnd = app.indexOf("<ContextMenu", renderStart);
  assert.notEqual(renderStart, -1, "App should render AgentPanel");
  assert.notEqual(renderEnd, -1, "AgentPanel should render before context menu");
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(source, /terminalLines/);
  assert.match(source, /const terminalText = \(terminalLines \|\| \[\]\)\.slice\(-120\)\.join\("\\n"\)/);
  assert.doesNotMatch(source, /server\.terminal/);
  assert.match(source, /terminalLines,/);
  assert.match(modelSource, /const contextTerminalLines = Array\.isArray\(options\.terminalLines\) \? options\.terminalLines : \[\]/);
  assert.match(modelSource, /buildAgentTerminalContext\(contextTerminalLines\)/);
  assert.doesNotMatch(modelSource, /buildAgentTerminalContext\(server\.terminal \|\| \[\]\)/);
  assert.match(renderSource, /terminalLines=\{selectedTerminalLines\}/);
});

test("Agent model context redacts attachments through the shared context builder", () => {
  const modelSource = buildModelMessagesSource();

  assert.match(modelSource, /buildAgentAttachmentContext\(attachments,\s*\{ maxLines: 80, maxChars: 12000 \}\)/);
  assert.doesNotMatch(modelSource, /String\(item\.content \|\| ""\)\.slice\(0, 12000\)/);
});

test("Agent chat can stop a reply and clear the conversation", () => {
  const source = agentPanelSource();

  assert.match(source, /function cancelAgentResponse\(\)/);
  assert.match(source, /agentRequestRef\.current \+= 1/);
  assert.match(source, /setAgentThinking\(false\)/);
  assert.match(source, /setConversation\(\(current\) => \[\.\.\.current,\s*\{ role: "agent", text: "\\u5df2\\u505c\\u6b62\\u672c\\u6b21 Agent \\u56de\\u590d\\u3002" \}\]\)/);
  assert.match(source, /aria-label="\\u505c\\u6b62 Agent \\u56de\\u590d"/);
  assert.match(source, /onClick=\{cancelAgentResponse\}/);

  assert.match(source, /function clearAgentConversation\(\)/);
  assert.match(source, /setMessage\(""\)/);
  assert.match(source, /setAgentAttachments\(\[\]\)/);
  assert.match(source, /setConversation\(\[buildAgentWelcomeMessage\(selectedServer\)\]\)/);
  assert.match(source, /aria-label="\\u6e05\\u7a7a\\u5bf9\\u8bdd"/);
  assert.match(source, /onClick=\{clearAgentConversation\}/);
  assert.match(source, /AI \\u5bf9\\u8bdd\\u5df2\\u6e05\\u7a7a/);
});

test("Agent chat input does not send while IME composition is active", () => {
  const source = agentPanelSource();
  const handlerStart = source.indexOf("function handleMessageKeyDown");
  const handlerEnd = source.indexOf("function parseChatMessageBlocks", handlerStart);
  assert.notEqual(handlerStart, -1, "Agent message key handler should exist");
  assert.notEqual(handlerEnd, -1, "message block parser should follow message key handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /if \(event\.isComposing \|\| event\.nativeEvent\?\.isComposing\) return;/);
  assert.ok(
    handler.indexOf("if (event.isComposing || event.nativeEvent?.isComposing) return;") < handler.indexOf('event.key === "Enter" && !event.shiftKey'),
    "IME composition guard must run before Enter can send the Agent chat message",
  );
});

test("Agent task status stays out of the chat conversation flow", () => {
  const source = agentPanelSource();
  const conversationIndex = source.indexOf('className="agent-conversation"');
  const inputIndex = source.indexOf('className="agent-input-card"');
  const betweenConversationAndInput = source.slice(conversationIndex, inputIndex);

  assert.notEqual(conversationIndex, -1, "Agent conversation should exist");
  assert.notEqual(inputIndex, -1, "Agent input should exist");
  assert.doesNotMatch(betweenConversationAndInput, /agent-compact-tasks/);
  assert.doesNotMatch(betweenConversationAndInput, /pendingTasks\.length|runningTasks\.length/);
  assert.match(source, /agent-header-task-status/);
});

test("Agent pending task dock shows approval controls outside the chat transcript", () => {
  const source = agentPanelSource();
  const headerIndex = source.indexOf('className="agent-header"');
  const dockIndex = source.indexOf('className="agent-task-dock"');
  const conversationIndex = source.indexOf('className="agent-conversation"');
  const conversationSource = source.slice(conversationIndex, source.indexOf('className="agent-input-card"', conversationIndex));

  assert.notEqual(headerIndex, -1, "Agent header should exist");
  assert.notEqual(dockIndex, -1, "pending task dock should exist");
  assert.notEqual(conversationIndex, -1, "Agent conversation should exist");
  assert.ok(headerIndex < dockIndex && dockIndex < conversationIndex, "pending task dock must sit outside the chat transcript");
  assert.match(source, /const firstPendingTask = pendingTasks\[0\]/);
  assert.match(source, /Agent 待审批动作/);
  assert.match(source, /firstPendingTask\.title \|\| firstPendingTask\.capabilityName/);
  assert.match(source, /firstPendingTask\.capabilityType/);
  assert.match(source, /firstPendingTask\.targetServer/);
  assert.match(source, /onApproveTask\?\.\(firstPendingTask\)/);
  assert.match(source, /onCancelTask\?\.\(firstPendingTask\)/);
  assert.match(source, /批准/);
  assert.match(source, /取消/);
  assert.doesNotMatch(conversationSource, /agent-task-dock|Agent 待审批动作|onApproveTask/);
});

test("Agent running task dock exposes a visible cancel action outside chat", () => {
  const source = agentPanelSource();
  const headerIndex = source.indexOf('className="agent-header"');
  const dockIndex = source.indexOf('className="agent-task-dock running"');
  const conversationIndex = source.indexOf('className="agent-conversation"');
  const conversationSource = source.slice(conversationIndex, source.indexOf('className="agent-input-card"', conversationIndex));

  assert.notEqual(headerIndex, -1, "Agent header should exist");
  assert.notEqual(dockIndex, -1, "running task dock should exist");
  assert.notEqual(conversationIndex, -1, "Agent conversation should exist");
  assert.ok(headerIndex < dockIndex && dockIndex < conversationIndex, "running task dock must sit outside the chat transcript");
  assert.match(source, /const firstRunningTask = runningTasks\[0\]/);
  assert.match(source, /Agent 正在执行/);
  assert.match(source, /firstRunningTask\.title \|\| firstRunningTask\.capabilityName/);
  assert.match(source, /firstRunningTask\.capabilityType/);
  assert.match(source, /firstRunningTask\.targetServer/);
  assert.match(source, /onCancelRunningTask\?\.\(firstRunningTask\)/);
  assert.match(source, />停止</);
  assert.doesNotMatch(conversationSource, /agent-task-dock running|Agent 正在执行|onCancelRunningTask/);
});

test("App approval dispatches Agent tasks into real runners", () => {
  const start = app.indexOf("async function executeApprovedAgentTask");
  const end = app.indexOf("async function cancelRunningAgentTask", start);
  assert.notEqual(start, -1, "App should define Agent task runner dispatch");
  assert.notEqual(end, -1, "Agent task runner dispatch should sit before cancellation");
  const source = app.slice(start, end);

  assert.match(source, /buildCliRunnerPlan\(runtimeRequest\)/);
  assert.match(source, /api\.run_local_cli_command\(plan\.command,\s*20,\s*task\.id\)/);
  assert.match(source, /buildMcpRunnerPlan\(runtimeRequest/);
  assert.match(source, /api\.call_mcp_http\(plan\.endpoint,\s*plan\.requests,\s*15,\s*plan\.headers \|\| \[\],\s*task\.id\)/);
  assert.match(source, /buildSkillRunnerPlan\(runtimeRequest,\s*evaluateCommandPolicy/);
  assert.match(source, /buildSkillRunnerDispatch\(plan/);
  assert.match(app, /executeApprovedAgentTask\(approvedTask,\s*decision\.runtimeRequest\)/);
});

test("App cancellation reaches both local CLI and MCP running tasks", () => {
  const start = app.indexOf("async function cancelRunningAgentTask");
  const end = app.indexOf("function clampLayoutColumn", start);
  assert.notEqual(start, -1, "App should define running Agent task cancellation");
  assert.notEqual(end, -1, "cancellation source should end before layout helpers");
  const source = app.slice(start, end);

  assert.match(source, /api\?\.cancel_local_cli_command/);
  assert.match(source, /api\?\.cancel_mcp_http_call/);
  assert.match(source, /task\.id/);
});

test("Agent runner results are appended back into the chat conversation", () => {
  const panelSource = agentPanelSource();
  const runnerStart = app.indexOf("async function executeApprovedAgentTask");
  const runnerEnd = app.indexOf("async function cancelRunningAgentTask", runnerStart);
  const cancelStart = app.indexOf("async function cancelRunningAgentTask");
  const cancelEnd = app.indexOf("function clampLayoutColumn", cancelStart);
  assert.notEqual(runnerStart, -1, "App should define Agent runner dispatch");
  assert.notEqual(runnerEnd, -1, "Agent runner dispatch should end before cancellation");
  assert.notEqual(cancelStart, -1, "App should define Agent cancellation");
  assert.notEqual(cancelEnd, -1, "Agent cancellation source should end before layout helpers");
  const runnerSource = app.slice(runnerStart, runnerEnd);
  const cancelSource = app.slice(cancelStart, cancelEnd);
  const renderStart = app.indexOf("<AgentPanel");
  const renderEnd = app.indexOf("<ContextMenu", renderStart);
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(app, /const \[agentTaskNotice,\s*setAgentTaskNotice\] = useState\(null\)/);
  assert.match(runnerSource, /setAgentTaskNotice\(\{/);
  assert.match(runnerSource, /Agent 任务已完成/);
  assert.match(runnerSource, /Agent 任务执行失败/);
  assert.match(cancelSource, /setAgentTaskNotice\(\{/);
  assert.match(cancelSource, /Agent 任务已取消/);
  assert.match(renderSource, /agentTaskNotice=\{agentTaskNotice\}/);
  assert.match(panelSource, /agentTaskNotice,/);
  assert.match(panelSource, /processedAgentTaskNoticeRef/);
  assert.match(panelSource, /setConversation\(\(current\) => \[\.\.\.current,\s*\{ role: "agent", text: agentTaskNotice\.text \}\]\)/);
});

test("Agent chat follows the latest message while replying", () => {
  const source = agentPanelSource();

  assert.match(source, /const agentConversationRef = useRef\(null\)/);
  assert.match(source, /const target = agentConversationRef\.current/);
  assert.match(source, /target\.scrollTop = target\.scrollHeight/);
  assert.match(source, /\}, \[conversation,\s*agentThinking\]\)/);
  assert.match(source, /<div className="agent-conversation" aria-label="Agent \\u5bf9\\u8bdd" ref=\{agentConversationRef\}>/);
});

test("Agent chat renders code blocks and multiline answers with a message renderer", () => {
  const source = agentPanelSource();

  assert.match(source, /function ChatMessageContent/);
  assert.match(source, /parseChatMessageBlocks/);
  assert.match(source, /className="chat-code-block"/);
  assert.match(source, /<ChatMessageContent text=\{item\.text\} \/>/);
  assert.doesNotMatch(source, /<p>\{item\.text\}<\/p>/);
});

test("Agent code blocks expose a copy action for generated commands", () => {
  const source = agentPanelSource();

  assert.match(source, /async function copyChatCodeBlock/);
  assert.match(source, /navigator\.clipboard\?\.writeText\?\.\(String\(code \|\| ""\)\)/);
  assert.match(source, /onNotice\?\.\("\\u4ee3\\u7801\\u5757\\u5df2\\u590d\\u5236"\)/);
  assert.match(source, /aria-label="\\u590d\\u5236\\u4ee3\\u7801\\u5757"/);
  assert.match(source, /onClick=\{\(\) => copyChatCodeBlock\(block\.text\)\}/);
});

test("Tool settings exposes custom Agent Skill MCP and CLI capability management", () => {
  const source = toolSettingsSource();
  const renderStart = app.indexOf("<ToolSettingsModal");
  const renderEnd = app.indexOf("{releaseInfoOpen", renderStart);
  assert.notEqual(renderStart, -1, "App should render ToolSettingsModal");
  assert.notEqual(renderEnd, -1, "ToolSettingsModal render block should end before release info modal");
  const renderSource = app.slice(renderStart, renderEnd);

  assert.match(source, /capabilities = \[\]/);
  assert.match(source, /selectedServer = ""/);
  assert.match(source, /onCapabilitiesChange/);
  assert.match(source, /onQueueCapability/);
  assert.match(source, /const \[capabilityType,\s*setCapabilityType\] = useState\("Skill"\)/);
  assert.match(source, /function addCustomAgentCapability\(/);
  assert.match(source, /buildCapabilityDraft\(capabilityType,\s*capabilityName/);
  assert.match(source, /addAgentCapability\(capabilities,\s*draft\)/);
  assert.match(source, /onCapabilitiesChange\?\.\(nextCapabilities\)/);
  assert.match(source, /function toggleCustomCapability\(capability\)/);
  assert.match(source, /setAgentCapabilityEnabled\(capabilities,\s*capability\.id,\s*!capability\.enabled\)/);
  assert.match(source, /function deleteCustomCapability\(capability\)/);
  assert.match(source, /removeAgentCapability\(capabilities,\s*capability\.id\)/);
  assert.match(source, /function queueCapabilityForSelectedServer\(capability\)/);
  assert.match(source, /onQueueCapability\?\.\(capability\)/);
  assert.match(source, /const capabilityFileInputRef = useRef\(null\)/);
  assert.match(source, /function importSkillCapabilityFile\(event\)/);
  assert.match(source, /new FileReader\(\)/);
  assert.match(source, /reader\.readAsText\(file,\s*"utf-8"\)/);
  assert.match(source, /buildCapabilityDraft\("Skill",\s*String\(reader\.result \|\| ""\)/);
  assert.match(source, /accept="\.json,\.skill,\.md,\.txt"/);
  assert.match(source, /onChange=\{importSkillCapabilityFile\}/);
  assert.match(source, />\s*\{"加入队列"\}\s*<\/button>/);
  assert.match(source, /disabled=\{!selectedServer \|\| capability\.enabled === false\}/);
  assert.match(source, />\{"导入 Skill 文件"\}<\/button>/);
  assert.match(source, /className="capability-panel"/);
  assert.match(source, /自定义 Agent 能力/);
  assert.match(source, /<option value="Skill">Skill<\/option>/);
  assert.match(source, /<option value="MCP">MCP<\/option>/);
  assert.match(source, /<option value="CLI">CLI<\/option>/);
  assert.match(renderSource, /capabilities=\{agentCapabilities\}/);
  assert.match(renderSource, /selectedServer=\{selectedServer\}/);
  assert.match(renderSource, /onCapabilitiesChange=\{saveAgentCapabilities\}/);
  assert.match(renderSource, /onQueueCapability=\{queueAgentCapability\}/);
});

test("App can queue any enabled Agent capability for the selected SSH server", () => {
  const start = app.indexOf("function queueAgentCapability");
  const end = app.indexOf("function queueDiagnosticSkill", start);
  assert.notEqual(start, -1, "App should define a generic Agent capability queue helper");
  assert.notEqual(end, -1, "generic capability queue helper should sit before diagnostic skill helper");
  const source = app.slice(start, end);

  assert.match(source, /if \(capability\?\.enabled === false\)/);
  assert.match(source, /buildAgentTask\(capability,\s*\{ serverName: name \}\)/);
  assert.match(source, /setAgentTasks\(\(current\) => queueAgentTask\(current,\s*task\)\)/);
  assert.match(source, /Agent \\u5df2\\u52a0\\u5165\\u6267\\u884c\\u961f\\u5217/);
  assert.match(source, /return task/);
});

test("Agent model failures expose copyable redacted diagnostics", () => {
  const source = agentPanelSource();

  assert.match(source, /function buildAgentFailureDiagnosticText/);
  assert.match(source, /function buildAgentFailureMessage/);
  assert.match(source, /async function copyAgentFailureDiagnostic/);
  assert.match(source, /diagnosticText:\s*buildAgentFailureDiagnosticText/);
  assert.match(source, /hasApiKey:\s*Boolean/);
  assert.match(source, /API Key/);
  assert.match(source, /chat-diagnostic-copy/);
  assert.match(source, /aria-label="\\u590d\\u5236 Agent \\u6392\\u969c\\u4fe1\\u606f"/);
  assert.match(source, /onClick=\{\(\) => copyAgentFailureDiagnostic\(item\.diagnosticText\)\}/);
  assert.match(source, /Agent \\u6392\\u969c\\u4fe1\\u606f\\u5df2\\u590d\\u5236/);
  assert.doesNotMatch(source, /apiKey:\s*modelConfig\.apiKey/);
  assert.doesNotMatch(source, /API Key[\\s\\S]{0,80}modelConfig\.apiKey/);
});

test("Agent file attachment picker accepts multiple text files", () => {
  const source = agentPanelSource();

  assert.match(source, /const files = Array\.from\(event\.target\.files \|\| \[\]\)/);
  assert.match(source, /files\.forEach\(\(file\) => \{/);
  assert.match(source, /addContextAttachment\("file",\s*file\.name,\s*String\(reader\.result \|\| ""\)\)/);
  assert.match(source, /type="file"[\s\S]{0,160}multiple/);
  assert.doesNotMatch(source, /const file = event\.target\.files\?\.\[0\]/);
});

test("Agent file attachment picker rejects oversized files before reading them", () => {
  const source = agentPanelSource();
  const handlerStart = source.indexOf("function handleAttachmentFileChange");
  const handlerEnd = source.indexOf("function removeAttachment", handlerStart);
  assert.notEqual(handlerStart, -1, "attachment handler should exist");
  assert.notEqual(handlerEnd, -1, "removeAttachment should follow attachment handler");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(app, /const MAX_AGENT_ATTACHMENT_BYTES = 1024 \* 1024/);
  assert.match(handler, /if \(file\.size > MAX_AGENT_ATTACHMENT_BYTES\)/);
  assert.match(handler, /附件过大/);
  assert.match(handler, /return/);
  assert.ok(
    handler.indexOf("file.size > MAX_AGENT_ATTACHMENT_BYTES") < handler.indexOf("reader.readAsText"),
    "large files must be rejected before FileReader reads them",
  );
});

test("Agent attachments use stable unique ids when multiple files are loaded quickly", () => {
  const source = agentPanelSource();

  assert.match(source, /const attachmentSequenceRef = useRef\(0\)/);
  assert.match(source, /function nextAgentAttachmentId\(type\)/);
  assert.match(source, /attachmentSequenceRef\.current \+= 1/);
  assert.match(source, /id: nextAgentAttachmentId\(type\)/);
  assert.doesNotMatch(source, /id:\s*`\$\{type\}-\$\{Date\.now\(\)\}`/);
});

test("Agent send snapshots attachments then clears the composer attachments", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  const sendSource = source.slice(sendStart, sendEnd);

  assert.match(sendSource, /let requestAttachments = agentAttachments/);
  assert.match(sendSource, /setAgentAttachments\(\[\]\)/);
  assert.ok(
    sendSource.indexOf("let requestAttachments = agentAttachments") < sendSource.indexOf("setAgentAttachments([])"),
    "attachments should be snapshotted before the composer is cleared",
  );
  assert.ok(
    sendSource.indexOf("if (!agentReadiness.ready)") < sendSource.indexOf("setAgentAttachments([])"),
    "unready model state should keep attachments available for retry",
  );
  assert.ok(
    sendSource.indexOf("setAgentAttachments([])") < sendSource.indexOf("api.chat_with_model"),
    "composer attachments should clear before the long model request starts",
  );
});

test("Agent web search failures show a visible notice", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  const sendSource = source.slice(sendStart, sendEnd);

  assert.match(sendSource, /const searchResult = await withAgentApiTimeout\(\s*api\.search_web\(text\),/);
  assert.match(sendSource, /buildAgentSearchStatusMessage\(searchResult,\s*text\)/);
  assert.match(sendSource, /if \(!searchResult\?\.ok\)/);
  assert.match(sendSource, /onNotice\?\.\(searchResult\?\.message \|\| "\\u8054\\u7f51\\u641c\\u7d22\\u672a\\u8fd4\\u56de\\u53ef\\u7528\\u7ed3\\u679c\\u3002"\)/);
});

test("Agent chat model and web search requests recover from desktop API timeouts", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  const sendSource = source.slice(sendStart, sendEnd);

  assert.match(app, /const AGENT_API_TIMEOUT_MS = 90000/);
  assert.match(app, /function withAgentApiTimeout\(promise,\s*message\)/);
  assert.match(sendSource, /await withAgentApiTimeout\(\s*api\.search_web\(text\),\s*"Agent 联网搜索响应超时，请稍后重试或关闭联网搜索。",?\s*\)/);
  assert.match(sendSource, /await withAgentApiTimeout\(\s*api\.chat_with_model\(modelConfig,/);
  assert.match(sendSource, /"Agent 模型响应超时，请检查模型 API、中转站或网络后重试。"/);
  assert.ok(
    sendSource.indexOf("withAgentApiTimeout(") < sendSource.indexOf("if (agentRequestRef.current !== requestId) return;"),
    "timeout guarded request should still use latest-request protection after it returns",
  );
});

test("Agent web search API absence is explicit and not sent as enabled context", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  const sendSource = source.slice(sendStart, sendEnd);

  assert.match(sendSource, /let requestWebSearchEnabled = webSearchEnabled/);
  assert.match(sendSource, /if \(webSearchEnabled && !api\?\.search_web\)/);
  assert.match(sendSource, /requestWebSearchEnabled = false/);
  assert.match(sendSource, /onNotice\?\.\("\\u5f53\\u524d\\u8fd0\\u884c\\u73af\\u5883\\u6ca1\\u6709\\u8054\\u7f51\\u641c\\u7d22\\u6865\\u63a5\\u3002"\)/);
  assert.match(sendSource, /buildAgentSearchStatusMessage\(\{ ok: false,\s*message: "\\u5f53\\u524d\\u8fd0\\u884c\\u73af\\u5883\\u6ca1\\u6709\\u8054\\u7f51\\u641c\\u7d22\\u6865\\u63a5\\u3002" \},\s*text\)/);
  assert.match(sendSource, /webSearchEnabled:\s*requestWebSearchEnabled/);
  assert.doesNotMatch(sendSource, /webSearchEnabled,\s*\n\s*\}\)/);
});

test("Agent chat shows which attachments were sent with a user message", () => {
  const source = agentPanelSource();
  const sendStart = source.indexOf("async function sendMessage");
  const sendEnd = source.indexOf("function cancelAgentResponse", sendStart);
  const renderStart = source.indexOf('className="agent-conversation"');
  const renderEnd = source.indexOf('className="agent-input-card"', renderStart);
  assert.notEqual(sendStart, -1, "sendMessage should exist");
  assert.notEqual(sendEnd, -1, "cancelAgentResponse should follow sendMessage");
  assert.notEqual(renderStart, -1, "conversation render should exist");
  assert.notEqual(renderEnd, -1, "input card should follow conversation");
  const sendSource = source.slice(sendStart, sendEnd);
  const renderSource = source.slice(renderStart, renderEnd);

  assert.match(source, /function buildSentAttachmentSummary\(attachments = \[\]\)/);
  assert.match(sendSource, /const sentAttachmentSummary = agentReadiness\.ready \? buildSentAttachmentSummary\(agentAttachments\) : ""/);
  assert.match(sendSource, /\{ role: "user", text, attachmentSummary: sentAttachmentSummary \}/);
  assert.match(renderSource, /item\.attachmentSummary/);
  assert.match(renderSource, /className="chat-attachment-summary"/);
  assert.match(source, /已附加上下文/);
});

test("Agent header separates server provider and model with readable Chinese punctuation", () => {
  const source = agentPanelSource();
  const headerStart = source.indexOf("<div className=\"agent-header\">");
  const conversationStart = source.indexOf("<div className=\"agent-conversation\"", headerStart);
  assert.notEqual(headerStart, -1, "Agent header should exist");
  assert.notEqual(conversationStart, -1, "Agent conversation should follow the header");
  const headerSource = source.slice(headerStart, conversationStart);

  assert.match(headerSource, /\{selectedServer\} · \{modelConfig\.provider\} \/ \{modelConfig\.model\}/);
  assert.doesNotMatch(headerSource, /\{selectedServer\} \? \{modelConfig\.provider\}/);
});

test("Agent queues model suggested Skill MCP and CLI actions for approval", () => {
  const source = agentPanelSource();
  const helperStart = source.indexOf("function queueSuggestedAgentActions");
  const sendStart = source.indexOf("async function sendMessage", helperStart);
  assert.notEqual(helperStart, -1, "AgentPanel should parse model suggested actions");
  assert.notEqual(sendStart, -1, "sendMessage should follow suggested action helper");
  const helperSource = source.slice(helperStart, sendStart);
  const sendSource = source.slice(sendStart, source.indexOf("function cancelAgentResponse", sendStart));

  assert.match(helperSource, /parseAgentActionSuggestions\(reply\)/);
  assert.match(helperSource, /buildAgentTask\(suggestion/);
  assert.match(helperSource, /serverName:\s*selectedServer/);
  assert.match(helperSource, /fileName:\s*selectedFile\?\.name \|\| ""/);
  assert.match(helperSource, /onTaskQueueChange\?\.\(\(current\) =>/);
  assert.match(helperSource, /queueAgentTask\(queue,\s*task\)/);
  assert.match(helperSource, /onNotice\?\.\(`Agent 已加入 \$\{tasks\.length\} 个待审批动作。`\)/);
  assert.match(sendSource, /queueSuggestedAgentActions\(reply\)/);
});
