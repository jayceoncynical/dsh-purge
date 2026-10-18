import assert from "node:assert/strict";
import test from "node:test";
const { rewritePromptAssembly } = await import(
  process.env.DSH_PURGE_IDENTITY_MODULE || "../lib/identity.js"
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

// Optional integration check against an installed DSH version's actual renderer.
test("the host renderer accepts a suffix when only provider/model were registered", {
  skip: !process.env.DSH_SYSTEM_PROMPT_MODULE,
}, async () => {
  const { renderPrompt } = await import(process.env.DSH_SYSTEM_PROMPT_MODULE);
  const input = assembly();
  assert.throws(() => renderPrompt(input), /unknown prompt variable.*cwd/);
  const result = rewritePromptAssembly(input, options("J:\\project {{literal}}"));
  assert.equal(renderPrompt(result), "Your working directory is J:\\project {{literal}}.");
});
