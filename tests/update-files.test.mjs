import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { COPY_NAMES, installUpdateFiles, recoverPendingUpdates, validateUpdateDirectory } from "../lib/update-files.js";

const directories = ["lib", "bin", "docs", "presets", "skills", "scripts"];
async function write(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
async function populate(root, version, marker) {
  await fs.mkdir(root, { recursive: true });
  for (const name of COPY_NAMES) {
    if (directories.includes(name)) await write(path.join(root, name, "resource.txt"), marker);
    else await write(path.join(root, name), marker);
  }
  await write(path.join(root, "package.json"), JSON.stringify({ name: "dsh-purge", version }));
  await write(path.join(root, "lib/index.js"), marker);
  await write(path.join(root, "bin/dsh-purge.js"), marker);
}
async function fixture(t, count = 1) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "update-files-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await populate(source, "2.0.0", "new");
  const dests = Array.from({ length: count }, (_, i) => path.join(root, `dest-${i}`));
  for (const dest of dests) {
    await populate(dest, "1.0.0", "old");
    await write(path.join(dest, "user-data", "config.json"), "user");
    await write(path.join(dest, "node_modules", "dependency", "index.js"), "dependency");
  }
  return { root, source, dests };
}
async function assert_old(dest) {
  for (const name of COPY_NAMES) {
    const file = directories.includes(name) ? path.join(dest, name, "resource.txt") : path.join(dest, name);
    const content = await fs.readFile(file, "utf8");
    if (name === "package.json") assert.equal(JSON.parse(content).version, "1.0.0");
    else assert.equal(content, "old");
  }
}
async function pending(dest) {
  return (await fs.readdir(dest)).filter((name) => name.startsWith(".update-files-"));
}

// 故意只导入纯文件模块；不触发更新下载或宿主行为。
test("受管清单覆盖发布资源，成功安装保留根、依赖及未受管数据", async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual([...COPY_NAMES].sort(), [...manifest.files.filter((name) => !name.startsWith("!")), "package.json"].sort());
  const before = await fs.stat(f.dests[0]);
  const result = await installUpdateFiles(f.source, f.dests);
  assert.equal(result.version, "2.0.0");
  const after = await fs.stat(f.dests[0]);
  assert.equal(after.ino, before.ino);
  for (const name of directories) assert.equal(await fs.readFile(path.join(f.dests[0], name, "resource.txt"), "utf8"), "new");
  assert.equal(await fs.readFile(path.join(f.dests[0], "user-data/config.json"), "utf8"), "user");
  assert.equal(await fs.readFile(path.join(f.dests[0], "node_modules/dependency/index.js"), "utf8"), "dependency");
  assert.deepEqual(await pending(f.dests[0]), []);
});

test("所有目标完整暂存后才开始提交，stage 失败不改旧文件", async (t) => {
  const f = await fixture(t, 2);
  await assert.rejects(installUpdateFiles(f.source, f.dests, {
    fault(phase, context) {
      if (phase === "stage" && context.dest === f.dests[1] && context.name === "skills") throw new Error("stage failure");
    },
  }), /stage failure/);
  for (const dest of f.dests) {
    await assert_old(dest);
    assert.deepEqual(await pending(dest), []);
  }
});

test("提交备份后失败整体恢复，包括先前已安装资源", async (t) => {
  const f = await fixture(t);
  await assert.rejects(installUpdateFiles(f.source, f.dests, {
    fault(phase, context) {
      if (phase === "after-backup" && context.name === "skills") throw new Error("commit failure");
    },
  }), /commit failure/);
  await assert_old(f.dests[0]);
  assert.deepEqual(await pending(f.dests[0]), []);
});

test("第二目标失败也恢复第一目标全部资源", async (t) => {
  const f = await fixture(t, 2);
  await assert.rejects(installUpdateFiles(f.source, f.dests, {
    fault(phase, context) {
      if (phase === "after-install" && context.dest === f.dests[1] && context.name === "bin") throw new Error("second destination failure");
    },
  }), /second destination failure/);
  for (const dest of f.dests) await assert_old(dest);
});

test("回滚失败保留唯一备份和日志，可幂等重试恢复", async (t) => {
  const f = await fixture(t, 2);
  await assert.rejects(installUpdateFiles(f.source, f.dests, {
    fault(phase, context) {
      if (phase === "after-install" && context.dest === f.dests[1] && context.name === "lib") throw new Error("commit failure");
      if (phase === "rollback" && context.dest === f.dests[0] && context.name === "lib") throw new Error("rollback failure");
    },
  }), /回滚未完成/);
  const work = path.join(f.dests[0], (await pending(f.dests[0]))[0]);
  assert.match(await fs.readFile(path.join(work, "journal.jsonl"), "utf8"), /rollback-failed/);
  assert.equal(await fs.readFile(path.join(work, "backup/lib/resource.txt"), "utf8"), "old");
  // 从非协调目标发现事务，仍恢复整个目标集合。
  await recoverPendingUpdates([f.dests[1]]);
  await recoverPendingUpdates(f.dests);
  for (const dest of f.dests) {
    await assert_old(dest);
    assert.deepEqual(await pending(dest), []);
  }
});

test("无旧资源的提交失败恢复到不存在状态", async (t) => {
  const f = await fixture(t);
  await fs.rm(path.join(f.dests[0], "skills"), { recursive: true });
  await assert.rejects(installUpdateFiles(f.source, f.dests, {
    fault(phase, context) {
      if (phase === "after-install" && context.name === "scripts") throw new Error("failure");
    },
  }));
  await assert.rejects(fs.stat(path.join(f.dests[0], "skills")), { code: "ENOENT" });
});

test("拒绝包身份、版本、入口和不完整资源，不修改目标", async (t) => {
  const f = await fixture(t);
  for (const pkg of [{ name: "other", version: "2.0.0" }, { name: "dsh-purge", version: "invalid" }]) {
    await write(path.join(f.source, "package.json"), JSON.stringify(pkg));
    await assert.rejects(installUpdateFiles(f.source, f.dests), /名称或版本无效/);
    await assert_old(f.dests[0]);
  }
  await write(path.join(f.source, "package.json"), JSON.stringify({ name: "dsh-purge", version: "2.0.0" }));
  await fs.rm(path.join(f.source, "bin/dsh-purge.js"));
  await assert.rejects(validateUpdateDirectory(f.source), { code: "ENOENT" });
  await write(path.join(f.source, "bin/dsh-purge.js"), "new");
  await fs.rm(path.join(f.source, "presets"), { recursive: true });
  await assert.rejects(installUpdateFiles(f.source, f.dests), { code: "ENOENT" });
  await assert_old(f.dests[0]);
});

test("安装根可为目录链接，但受管资源链接及嵌套目标被拒绝", async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, "alias");
  await fs.symlink(f.dests[0], alias, process.platform === "win32" ? "junction" : "dir");
  await installUpdateFiles(f.source, [alias, f.dests[0]]);
  assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
  const outside = path.join(f.root, "outside");
  await write(path.join(outside, "sentinel"), "keep");
  await fs.rm(path.join(f.dests[0], "skills"), { recursive: true });
  await fs.symlink(outside, path.join(f.dests[0], "skills"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(installUpdateFiles(f.source, f.dests), /不能是链接/);
  assert.equal(await fs.readFile(path.join(outside, "sentinel"), "utf8"), "keep");
  await assert.rejects(installUpdateFiles(f.source, [f.dests[0], path.join(f.dests[0], "node_modules")]), /不能相互嵌套/);
});

test("回滚在旧资源恢复后中断可重试，末尾截断记录不破坏恢复", async (t) => {
  const f = await fixture(t, 2);
  const moduleUrl = new URL("../lib/update-files.js", import.meta.url).href;
  const script = `import { installUpdateFiles } from ${JSON.stringify(moduleUrl)};
    await installUpdateFiles(${JSON.stringify(f.source)}, ${JSON.stringify(f.dests)}, {
      fault(phase, context) {
        if (phase === 'after-install' && context.dest === ${JSON.stringify(f.dests[1])} && context.name === 'bin') throw new Error('commit failure');
        if (phase === 'after-restore' && context.dest === ${JSON.stringify(f.dests[0])} && context.name === 'LICENSE') process.exit(74);
      }
    });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { stdio: "inherit" });
  assert.equal(result.status, 74);
  const work = path.join(f.dests[0], (await pending(f.dests[0]))[0]);
  await fs.appendFile(path.join(work, "journal.jsonl"), '{"type":"intent"');
  await recoverPendingUpdates([f.dests[1]]);
  for (const dest of f.dests) await assert_old(dest);
});

test("进程在 rename 后退出仍能通过日志恢复全部目标", async (t) => {
  const f = await fixture(t, 2);
  const moduleUrl = new URL("../lib/update-files.js", import.meta.url).href;
  const script = `import { installUpdateFiles } from ${JSON.stringify(moduleUrl)};
    await installUpdateFiles(${JSON.stringify(f.source)}, ${JSON.stringify(f.dests)}, {
      fault(phase, context) {
        if (phase === 'after-backup' && context.dest === ${JSON.stringify(f.dests[1])} && context.name === 'lib') process.exit(73);
      }
    });`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { stdio: "inherit" });
  assert.equal(result.status, 73);
  await recoverPendingUpdates([f.dests[1]]);
  for (const dest of f.dests) await assert_old(dest);
});
