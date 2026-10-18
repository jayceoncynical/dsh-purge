import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { diskFs, hostFs, restoreExtractedDir } = await import(
  process.env.DSH_PURGE_EXTRACT_MODULE || "../lib/extract-asar.js"
);
const { clearStaleExtractedApps } = await import(
  process.env.DSH_PURGE_OFFICIAL_UPDATE_MODULE || "../lib/official-update.js"
);
const { removeTreeSync } = await import(
  process.env.DSH_PURGE_SAFE_REMOVE_MODULE || "../lib/safe-remove.js"
);
const fs = diskFs();
const scratch = fileURLToPath(new URL("../.scratch/", import.meta.url));
fs.mkdirSync(scratch, { recursive: true });

function fixture() {
  const root = fs.mkdtempSync(path.join(scratch, "runtime-cleanup-test-"));
  const resources = path.join(root, "resources");
  const runtime = path.join(resources, "runtime");
  const stale = path.join(resources, "app.dshpurge-prev");
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, "sentinel"), "preserved");
  // All deletion targets are newly created test directories in this workspace.
  assert.ok(stale.startsWith(scratch));
  return { root, resources, runtime, stale, exe: path.join(root, "DeepSeek Harness.exe") };
}

function link(target, entry) {
  fs.symlinkSync(target, entry, process.platform === "win32" ? "junction" : "dir");
}

test("old extracted app cleanup preserves the sibling runtime behind a junction", () => {
  const f = fixture();
  fs.mkdirSync(f.stale);
  link(f.runtime, path.join(f.stale, "runtime"));
  clearStaleExtractedApps(f.exe);
  assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
  assert.equal(fs.existsSync(f.stale), false);
});

test("a junction at the cleanup root is unlinked without deleting its target", () => {
  const f = fixture();
  link(f.runtime, f.stale);
  clearStaleExtractedApps(f.exe);
  assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
  assert.equal(fs.existsSync(f.stale), false);
});

test("ordinary stale files and dangling directory links can still be removed", () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.stale, "nested"), { recursive: true });
  fs.writeFileSync(path.join(f.stale, "nested", "old.js"), "old");
  link(path.join(f.root, "missing"), path.join(f.stale, "dangling"));
  clearStaleExtractedApps(f.exe);
  assert.equal(fs.existsSync(f.stale), false);
  assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
});

test("rollback cleanup preserves a runtime linked from the failed extracted app", () => {
  const f = fixture();
  const app = path.join(f.resources, "app");
  fs.mkdirSync(app);
  link(f.runtime, path.join(app, "runtime"));
  fs.mkdirSync(f.stale);
  fs.writeFileSync(path.join(f.stale, "old.js"), "restored");
  assert.equal(restoreExtractedDir(app, f.stale), true);
  assert.equal(fs.readFileSync(path.join(app, "old.js"), "utf8"), "restored");
  assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
});

test("force tolerates missing targets and non-recursive removal retains its semantics", () => {
  const f = fixture();
  assert.doesNotThrow(() => hostFs.rmSync(f.stale, { recursive: true, force: true }));
  fs.mkdirSync(f.stale);
  assert.throws(() => hostFs.rmSync(f.stale, { recursive: false }));
  assert.equal(fs.existsSync(f.stale), true);
});

test("a child disappearing during cleanup does not leave siblings or a stale root", () => {
  const f = fixture();
  fs.mkdirSync(f.stale);
  fs.writeFileSync(path.join(f.stale, "a-gone"), "gone");
  fs.writeFileSync(path.join(f.stale, "b-remaining"), "remaining");
  const racingFs = {
    ...fs,
    unlinkSync(file) {
      if (path.basename(file) === "a-gone") fs.unlinkSync(file);
      return fs.unlinkSync(file);
    },
  };
  removeTreeSync(f.stale, { force: true }, racingFs);
  assert.equal(fs.existsSync(f.stale), false);
});

test("read-only stale files retain force removal behavior", () => {
  const f = fixture();
  fs.mkdirSync(f.stale);
  const file = path.join(f.stale, "readonly.js");
  fs.writeFileSync(file, "old");
  fs.chmodSync(file, 0o444);
  clearStaleExtractedApps(f.exe);
  assert.equal(fs.existsSync(f.stale), false);
});
