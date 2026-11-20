/**
 * 审计修复的回归测试：每条都对应一处「改坏了没人发现」的高危逻辑。
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { defaultOverrideText } from "../lib/core.js";
import { asarSwapLockIsLive } from "../lib/desktop.js";
import { pathsOverlap } from "../lib/skills.js";
import { shouldDeletePluginTree } from "../lib/uninstall.js";
import { versionIsNewer } from "../lib/update.js";

// 只取脚本文本执行解析，不运行它；与 desktop-swap-failure.test.mjs 同一套读法。
function asarRenameIdleScript() {
  const src = fs.readFileSync(new URL("../lib/desktop.js", import.meta.url), "utf8");
  const start = src.indexOf("const ASAR_RENAME_WHEN_IDLE_PS1 = [");
  const end = src.indexOf("\nconst ASAR_RENAME_WHEN_IDLE_SH", start);
  assert.ok(start > 0 && end > start, "找不到换包助手脚本");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${src.slice(start, end)}\nglobalThis.script = ASAR_RENAME_WHEN_IDLE_PS1;`, sandbox);
  return sandbox.script;
}

test("预发布号按数值比较：rc.10 比 rc.9 新", () => {
  assert.equal(versionIsNewer("2.0.3-rc.10", "2.0.3-rc.9"), true);
  assert.equal(versionIsNewer("2.0.3-rc.9", "2.0.3-rc.10"), false);
  assert.equal(versionIsNewer("2.0.3", "2.0.3-rc.10"), true);
  assert.equal(versionIsNewer("2.0.4", "2.0.3"), true);
  assert.equal(versionIsNewer("2.0.3", "2.0.3"), false);
});

test("卸载只认 node_modules/dsh-purge 这一段，不删邻居包", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-uninstall-"));
  const exact = path.join(home, "profiles", "web", "node_modules", "dsh-purge");
  assert.equal(shouldDeletePluginTree(exact), true);
  assert.equal(shouldDeletePluginTree(`${exact}-fork`), false);
  assert.equal(shouldDeletePluginTree(path.join(home, "profiles", "web", "node_modules", "dsh-purge-2.0.3")), false);
  assert.equal(shouldDeletePluginTree(path.join(home, "profiles", "web")), false);
  assert.equal(shouldDeletePluginTree(""), false);
});

test("符号链接源与 skills 目录算重叠（realpath 生效）", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-overlap-"));
  const real = path.join(base, "skills");
  fs.mkdirSync(real);
  const link = path.join(base, "linked-skills");
  try {
    fs.symlinkSync(real, link, "junction");
  } catch {
    t.skip("本机不允许创建目录链接");
    return;
  }
  assert.equal(pathsOverlap(link, real), true);
  assert.equal(pathsOverlap(path.join(base, "other"), real), false);
});

test("换包锁只在助手还在续心跳时才算进行中", () => {
  const now = 1_800_000_000_000;
  assert.equal(asarSwapLockIsLive(now - 5_000, now), true);
  assert.equal(asarSwapLockIsLive(now - 5 * 60_000, now), false, "助手 5 分钟没心跳，锁不该继续挡重排");
  assert.equal(asarSwapLockIsLive(now + 1_000, now), false, "时钟回拨按失效处理");
  assert.equal(asarSwapLockIsLive(Number.NaN, now), false);
});

test("换包助手：宿主不在时改名、清锁并拉起", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-asar-"));
  const asar = path.join(dir, "app.asar");
  const lock = `${asar}.rename-pending`;
  const relaunched = path.join(dir, "relaunched.txt");
  const exe = path.join(dir, "fake-host.cmd");
  fs.writeFileSync(asar, "sealed");
  fs.writeFileSync(lock, `${Date.now()}\n`);
  fs.writeFileSync(exe, `@echo off\r\n> "${relaunched}" echo ok\r\n`);
  const script = path.join(dir, "swap.ps1");
  fs.writeFileSync(script, asarRenameIdleScript(), "utf8");

  const run = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-AsarPath", asar, "-ExePath", exe, "-LockPath", lock],
    // 隔离 TEMP：避免真实环境里正在进行的官方重启标记让助手进入等待。
    { env: { ...process.env, TEMP: dir, TMP: dir }, timeout: 60_000, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(fs.existsSync(asar), false, "app.asar 应该被改名");
  assert.equal(fs.existsSync(`${asar}.bak`), true, "应留下 app.asar.bak");
  assert.equal(fs.existsSync(lock), false, "成功后应清掉换包锁");
  // Start-Process 是异步的：等最多 5 秒让假宿主落盘。
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(relaunched) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  assert.equal(fs.existsSync(relaunched), true, "应重新拉起宿主");
});

test("默认提示词来自明文 md，而不是内嵌密文", () => {
  const text = defaultOverrideText();
  assert.ok(text.length > 1000, `默认提示词疑似读不到：长度 ${text.length}`);
  assert.ok(text.includes("[MODE:"), "默认提示词内容不对");
});
