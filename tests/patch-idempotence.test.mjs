import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DSH_HOME = path.join(os.tmpdir(), "dsh-purge-idempotence-test");
process.env.DSH_SURFACE = "web";

const core = await import("../lib/core.js");

test("web surface marker patch is idempotent", () => {
  const patch = core.ALL_PATCHES.find((item) => item.id === 32);
  assert.ok(patch, "missing #32");
  const input = 'const WEB_SURFACE = "app:web-surface";\n';
  const once = core.applyReplacementsToText(input, patch, "fixture.js");
  assert.equal(once.changed, true);
  assert.equal(once.text.includes("[dsh-purge] web surface identity neutralized"), true);
  const twice = core.applyReplacementsToText(once.text, patch, "fixture.js");
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});
