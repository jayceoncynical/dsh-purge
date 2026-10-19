import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DSH_HOME = path.join(os.tmpdir(), "dsh-purge-system-slot-test");
process.env.DSH_SURFACE = "web";

const core = await import("../lib/core.js");

function patchOf(id) {
  const patch = core.ALL_PATCHES.find((item) => item.id === id);
  assert.ok(patch, `missing #${id}`);
  return patch;
}

test("#89 extracts role:system into a dedicated system field", () => {
  const patch = patchOf(89);
  const input = [
    "\t\tconst boundaryMessages = session.deriveMessages();",
    "\t\tfor (const message of boundaryMessages) {",
    "\t\t\tif (this.frozenMessages.has(message)) continue;",
    "\t\t\tdeepFreeze(message);",
    "\t\t\tthis.frozenMessages.add(message);",
    "\t\t}",
    "\t\tObject.freeze(boundaryMessages);",
    "\t\treturn markAgentLoopRequest(Object.freeze({",
    "\t\t\t...header.config,",
    "\t\t\tmessages: boundaryMessages,",
    "\t\t\ttoolHistory: session.toolHistory(),",
    "\t\t\t...header.tools !== void 0 ? { tools: header.tools } : {},",
    "\t\t\tsessionId: this.session.id,",
    "\t\t\tsignal",
    "\t\t}));",
    "",
  ].join("\n");

  const once = core.applyReplacementsToText(input, patch, "agent-loop/index.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("[dsh-purge-89] system field extract"), true);
  assert.equal(once.text.includes("...systemField !== void 0 ? { system: systemField } : {},"), true);
  assert.equal(once.text.includes("messages: nonSystemMessages,"), true);
  assert.equal(once.text.includes("messages: boundaryMessages,"), false);

  const twice = core.applyReplacementsToText(once.text, patch, "agent-loop/index.js");
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("#90 seeds a native role:system message for openai-completions", () => {
  const patch = patchOf(90);
  const input = [
    "export function convertMessages(model, context, compat, options) {",
    "    const normalizedContext = resolveTranscript(context, compat.supportsMidConvoSystemMessages);",
    "    const params = [];",
    "    const normalizeToolCallId = (id) => {",
    "        return id;",
    "    };",
    "",
  ].join("\n");

  const once = core.applyReplacementsToText(input, patch, "openai-completions.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("[dsh-purge-90] native system role"), true);
  assert.equal(once.text.includes('const seeded = (promptText && context.messages?.[0]?.role !== "system")'), true);
  assert.equal(once.text.includes("resolveTranscript(seeded, compat.supportsMidConvoSystemMessages)"), true);

  const twice = core.applyReplacementsToText(once.text, patch, "openai-completions.js");
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("#90 pushes system text into the native instruction role", () => {
  const patch = patchOf(90);
  const input = [
    "            const text = i === 0 ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);",
    "            if (text.length > 0) {",
    "                params.push({ role: instructionRole, content: sanitizeSurrogates(text) });",
    "            }",
    "",
  ].join("\n");

  const once = core.applyReplacementsToText(input, patch, "openai-completions.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("// [dsh-purge-90] native system role"), true);
  assert.equal(once.text.includes('replace(/<\\|im_start\\|>\\s*system\\s*:\\s*/gi, "")'), true);
  assert.equal(once.text.includes('replace(/<\\/?project_instructions>/gi, "")'), true);
});

test("#91 prefers systemPrompt and writes native params.system", () => {
  const patch = patchOf(91);
  const input = [
    "    const initialSystemMessage = getInitialSystemMessage(context.messages);",
    '    const initialSystemText = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";',
    "",
  ].join("\n");

  const once = core.applyReplacementsToText(input, patch, "anthropic-messages.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("[dsh-purge-91] native params.system"), true);
  assert.equal(once.text.includes("? context.systemPrompt"), true);

  const twice = core.applyReplacementsToText(once.text, patch, "anthropic-messages.js");
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("#92 wires the child assemble hook and inherits parent access", () => {
  const patch = patchOf(92);
  const input = [
    "\tif (composition.toolFilter !== void 0) childCtx.tools.restrict(composition.toolFilter);",
    "}",
    "\t\tpermissionPreset: preset === \"auto\" || preset === \"danger-full-access\" ? preset : void 0,",
    "",
  ].join("\n");

  const once = core.applyReplacementsToText(input, patch, "subagent/index.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("globalThis.__dshPurgePrepareAssemble"), true);
  assert.equal(once.text.includes('permissionPreset: preset || "danger-full-access",'), true);
  assert.equal(once.text.includes("preset === \"danger-full-access\" ? preset : void 0"), false);

  const twice = core.applyReplacementsToText(once.text, patch, "subagent/index.js");
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});
