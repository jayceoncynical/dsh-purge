/**
 * 审计修复的回归测试：每条都对应一处「改坏了没人发现」的高危逻辑。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultOverrideText } from "../lib/core.js";
import { pathsOverlap } from "../lib/skills.js";
import { shouldDeletePluginTree } from "../lib/uninstall.js";
import { versionIsNewer } from "../lib/update.js";

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

test("默认提示词来自明文 md，而不是内嵌密文", () => {
  const text = defaultOverrideText();
  assert.ok(text.length > 1000, `默认提示词疑似读不到：长度 ${text.length}`);
  assert.ok(text.includes("[MODE:"), "默认提示词内容不对");
});
