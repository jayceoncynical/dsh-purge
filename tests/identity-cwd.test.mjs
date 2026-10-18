import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require_ = createRequire(import.meta.url);

// Windows 盘符绝对路径会被 ESM loader 当成协议（j:），必须先转成 file:// URL；
// 目录还要解析到真实入口文件，否则 ESM 会拒绝目录导入。
function importSpecifier(specifier) {
  const isPath =
    /^[a-zA-Z]:[\\/]/.test(specifier) || specifier.startsWith("\\\\") || specifier.startsWith("/");
  if (!isPath) return specifier;
  return pathToFileURL(require_.resolve(specifier)).href;
}

const { CWD_ONLY_SUFFIX, rewritePromptAssembly } = await import(
  importSpecifier(process.env.DSH_PURGE_IDENTITY_MODULE || "../lib/identity.js")
);

function assembly(variables = { provider: "test", model: "test-model" }) {
  return {
    sections: [{ name: "deployment:persona-suffix", text: "Your working directory is {{cwd}}." }],
    contexts: [],
    tools: [],
    variables,
  };
}

function options(cwd) {
  return { capabilityProtocol: false, context: { agent: { session: { header: { cwd } } } } };
}

test("missing cwd resolves from the current session without mutating the input", () => {
  const input = assembly();
  const result = rewritePromptAssembly(input, options("J:\\workspace"));
  assert.equal(result.variables.cwd, "J:\\workspace");
  assert.deepEqual(input.variables, { provider: "test", model: "test-model" });
});

test("an existing host cwd takes precedence over the session fallback", () => {
  const input = assembly({ cwd: "/host", provider: "test", model: "test-model" });
  const result = rewritePromptAssembly(input, options("/session"));
  assert.deepEqual(result.variables, input.variables);
});

test("each session uses its own cwd with both rewrite calling conventions", () => {
  const input = assembly();
  assert.equal(rewritePromptAssembly(input, options("/parent")).variables.cwd, "/parent");
  assert.equal(rewritePromptAssembly(input, "", options("/child")).variables.cwd, "/child");
});

test("a missing session cwd does not invent a working directory", () => {
  const input = assembly();
  assert.deepEqual(rewritePromptAssembly(input, options(undefined)).variables, input.variables);
});

test("0.2.0 receives the actual session cwd when no working-directory context exists", () => {
  const input = assembly();
  const result = rewritePromptAssembly(input, options("J:\\project {{literal}}"));
  const suffix = result.sections.find((section) => section.name === "deployment:persona-suffix");
  assert.equal(suffix.interpolate, false);
  assert.equal(suffix.text, 'Your working directory is "J:\\\\project {{literal}}".');
});

test("0.2.1 keeps the host working-directory context instead of duplicating it", () => {
  const input = assembly();
  input.contexts = [{ name: "working-directory:current", text: "Current working directory: \"J:/host\"." }];
  const result = rewritePromptAssembly(input, options("J:/host"));
  const suffix = result.sections.find((section) => section.name === "deployment:persona-suffix");
  assert.equal(suffix.text, CWD_ONLY_SUFFIX);
  assert.equal(result.contexts, input.contexts);
});

test("a host-provided cwd variable is used when the session header has none", () => {
  const input = assembly({ cwd: "J:\\from-host", provider: "test", model: "test-model" });
  const result = rewritePromptAssembly(input, options(undefined));
  const suffix = result.sections.find((section) => section.name === "deployment:persona-suffix");
  assert.equal(suffix.text, 'Your working directory is "J:\\\\from-host".');
});

// Optional integration check against an installed DSH version's actual renderer.
test("the host renderer accepts a suffix when only provider/model were registered", {
  skip: !process.env.DSH_SYSTEM_PROMPT_MODULE,
}, async () => {
  const { renderPrompt } = await import(importSpecifier(process.env.DSH_SYSTEM_PROMPT_MODULE));
  const input = assembly();
  assert.throws(() => renderPrompt(input), /unknown prompt variable.*cwd/);
  const result = rewritePromptAssembly(input, options("J:\\project {{literal}}"));
  const rendered = renderPrompt(result);
  assert.ok(rendered.includes(JSON.stringify("J:\\project {{literal}}")), `实际目录未进入提示词: ${rendered}`);
  assert.equal(rendered.includes("Follow the session working directory"), false);
});
