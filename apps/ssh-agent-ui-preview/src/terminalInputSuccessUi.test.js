import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`async function ${name}`);
  const end = app.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test("successful SSH session input is recorded in audit and session logs", () => {
  const source = functionSource("sendSelectedSessionInput", "sendSelectedCommand");
  const failureIndex = source.indexOf("if (!result?.ok)");
  const clearIndex = source.indexOf("if (clearInput) updateCommandInput(inputKey, \"\")");
  const triggerIndex = source.indexOf("triggerSshOutputPoll()", clearIndex);
  const successBlock = source.slice(failureIndex, triggerIndex);

  assert.notEqual(failureIndex, -1, "failure branch should exist");
  assert.notEqual(clearIndex, -1, "success path should clear input");
  assert.notEqual(triggerIndex, -1, "success path should trigger output polling");
  assert.match(successBlock, /const loggedInput = formatTerminalInputForLog\(text,\s*\{ sensitiveInput,\s*submit \}\)/);
  assert.match(successBlock, /writeAuditEvent\(\{ type:\s*"interactive_input_sent"/);
  assert.match(successBlock, /writeSessionLogEvent\(\{ type:\s*"interactive_input_sent"/);
  assert.match(successBlock, /command:\s*loggedInput/);
  assert.match(successBlock, /status:\s*"ok"/);
  assert.match(successBlock, /context:\s*sshInputLogContext/);
});

test("successful manual SSH commands are recorded as command sent events", () => {
  const start = app.indexOf("async function sendSelectedCommand");
  const end = app.indexOf("\n  return (", start);
  assert.notEqual(start, -1, "sendSelectedCommand should exist");
  assert.notEqual(end, -1, "sendSelectedCommand should appear before render");
  const source = app.slice(start, end);
  const successIndex = source.indexOf("if (result?.ok)");
  const finishIndex = source.indexOf("if (!interactiveMode)", successIndex);

  assert.notEqual(successIndex, -1, "manual command sender should have a success branch");
  assert.notEqual(finishIndex, -1, "manual command sender should finish session state after success handling");
  const successBlock = source.slice(successIndex, finishIndex);

  assert.match(successBlock, /writeAuditEvent\(\{ type:\s*"command_sent"/);
  assert.match(successBlock, /writeSessionLogEvent\(\{ type:\s*"command_sent"/);
  assert.match(successBlock, /server:\s*name/);
  assert.match(successBlock, /sessionId/);
  assert.match(successBlock, /actor:\s*"user"/);
  assert.match(successBlock, /command/);
  assert.match(successBlock, /status:\s*"ok"/);
});
