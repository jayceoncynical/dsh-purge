import assert from "node:assert/strict";
import nativeFs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
const { repairOfficialCliAfterUnpack } = await import(
  process.env.DSH_PURGE_DESKTOP_MODULE || "../lib/desktop.js"
);
const { diskFs } = await import("../lib/extract-asar.js");
const fs = diskFs();
const scratch = fileURLToPath(new URL("../.scratch/", import.meta.url));
const CLI = "dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";
const original = `import { basename, dirname, join, resolve } from "node:path";
function runtimeArchivePath(runtimeDir) {
  const parent = dirname(runtimeDir);
  return basename(parent) === "app.asar" ? parent : undefined;
}
async function runDesktopCli(runtimeDir, supportDir) {
  console.log(JSON.stringify({ runtimeDir, supportDir }));
}
const runtimeDir = resolve(import.meta.dirname, "../../../..");
await runDesktopCli(runtimeDir, join(dirname(runtimeArchivePath(runtimeDir) ?? runtimeDir), "runtime"));
`;

function fixture(container = "app") {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "desktop-cli-runtime-"));
  const resources = path.join(root, "resources");
  const runtime = path.join(resources, "runtime");
  const cli = path.join(resources, container, CLI);
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, "sentinel"), "preserved");
  fs.writeFileSync(cli, original);
  return { root, resources, runtime, cli, exe: path.join(root, "DeepSeek Harness.exe") };
}

for (const container of ["app", "app.asar.unpacked"]) {
  test(`CLI in ${container} resolves physical runtime without a directory junction`, () => {
    const f = fixture(container);
    repairOfficialCliAfterUnpack(f.exe);
    assert.equal(fs.existsSync(path.join(f.resources, "app", "runtime")), false);
    const result = JSON.parse(execFileSync(process.execPath, [f.cli], { encoding: "utf8", windowsHide: true }));
    assert.equal(result.supportDir, f.runtime);
    assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
  });
}

test("migration removes an old runtime junction while preserving its target", () => {
  const f = fixture();
  const link = path.join(f.resources, "app", "runtime");
  fs.symlinkSync(f.runtime, link, process.platform === "win32" ? "junction" : "dir");
  repairOfficialCliAfterUnpack(f.exe);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(path.join(f.runtime, "sentinel"), "utf8"), "preserved");
});

test("CLI runtime repair is idempotent and backs up the stock entry", () => {
  const f = fixture();
  repairOfficialCliAfterUnpack(f.exe);
  const first = fs.readFileSync(f.cli, "utf8");
  assert.notEqual(first, original);
  repairOfficialCliAfterUnpack(f.exe);
  assert.equal(fs.readFileSync(f.cli, "utf8"), first);
  assert.equal(fs.readFileSync(f.cli + ".dsh-purge.bak", "utf8"), original);
});

// Windows 上刚写完的目录可能被杀软/索引器瞬时占用，rename 会短暂 EPERM。
function renameWithRetry(from, to, attempts = 20) {
  for (let i = 0; ; i += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (i >= attempts || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

test("external updater cleanup of the old installation preserves the replacement runtime", () => {
  const f = fixture();
  // A previous plugin version may already have left this absolute junction.
  fs.symlinkSync(f.runtime, path.join(f.resources, "app", "runtime"), process.platform === "win32" ? "junction" : "dir");
  repairOfficialCliAfterUnpack(f.exe);
  const oldInstall = f.root + ".old";
  assert.ok(oldInstall.startsWith(scratch));
  renameWithRetry(f.root, oldInstall);
  fs.mkdirSync(f.runtime, { recursive: true });
  fs.writeFileSync(path.join(f.runtime, "replacement-sentinel"), "new runtime");
  // Use Electron's unguarded remover, modeling a cleanup outside our plugin.
  nativeFs.rmSync(oldInstall, { recursive: true, force: true });
  assert.equal(fs.readFileSync(path.join(f.runtime, "replacement-sentinel"), "utf8"), "new runtime");
});

test("migration leaves a real app/runtime directory and its files intact", () => {
  const f = fixture();
  const physical = path.join(f.resources, "app", "runtime");
  fs.mkdirSync(physical);
  fs.writeFileSync(path.join(physical, "local-file"), "keep");
  repairOfficialCliAfterUnpack(f.exe);
  assert.equal(fs.readFileSync(path.join(physical, "local-file"), "utf8"), "keep");
});

test("an unsupported CLI entry keeps its working legacy link and reports failure", () => {
  const f = fixture();
  const link = path.join(f.resources, "app", "runtime");
  fs.symlinkSync(f.runtime, link, process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(f.cli, "// an unrecognized future CLI entry\n");
  const report = repairOfficialCliAfterUnpack(f.exe);
  assert.equal(report.ok, false);
  assert.equal(fs.existsSync(link), true);
  assert.equal(fs.readFileSync(path.join(link, "sentinel"), "utf8"), "preserved");
});

test("a backup write failure keeps the original entry and runtime link usable", () => {
  const f = fixture();
  const link = path.join(f.resources, "app", "runtime");
  fs.symlinkSync(f.runtime, link, process.platform === "win32" ? "junction" : "dir");
  fs.mkdirSync(f.cli + ".dsh-purge.bak");
  const report = repairOfficialCliAfterUnpack(f.exe);
  assert.equal(report.ok, false);
  assert.equal(fs.readFileSync(f.cli, "utf8"), original);
  assert.equal(fs.existsSync(link), true);
});
