import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const comp = await import("../lib/redteam/preset-composition.js");

// dsh 0.2.1-rc.2 的 dsh-tool-subagent 对 persona / toolFilter 做 Object.hasOwn 硬拦：
// 只要配置里出现这两个键就抛错，整个红队预设 mount 失败，模式下拉显示「加载失败」。
// backgroundMode / enableRunInBackground 已从 Config 删除，留着不报错但毫无作用。
// 这组测试锁住「预设不得再声明这些字段」。
const REJECTED = ["persona", "toolFilter"];
const OBSOLETE = ["backgroundMode", "enableRunInBackground"];

const presetDir = path.join(root, "presets", "redteam");

/** 预设里 tool-subagent 行嵌在 delegation group 内，递归取出所有行。 */
function flatten(rows, out = []) {
  for (const row of rows ?? []) {
    out.push(row);
    if (Array.isArray(row.config)) flatten(row.config, out);
  }
  return out;
}

test("红队预设不声明 0.2.1 会拒绝的 tool-subagent 字段", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const offenders = [];
  for (const row of flatten(def.plugins)) {
    if (row.name !== "@deepseek-ai/dsh-tool-subagent") continue;
    const cfg = row.config ?? {};
    for (const field of REJECTED) {
      if (Object.hasOwn(cfg, field)) offenders.push(`${row.id}.${field}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("红队预设不声明已从 0.2.1 Config 删除的字段", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const offenders = [];
  for (const row of flatten(def.plugins)) {
    const cfg = row.config;
    if (!cfg || Array.isArray(cfg)) continue;
    for (const field of OBSOLETE) {
      if (Object.hasOwn(cfg, field)) offenders.push(`${row.id}.${field}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("叶子约束仍在：spawn 子智能体 maxDepth 为 1", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const row = flatten(def.plugins).find((p) => p.id === "tool-subagent");
  assert.ok(row, "缺少 tool-subagent 行");
  assert.equal(row.config?.maxDepth, 1);
});

test("剥离函数只删被拒字段，其余行保留", async () => {
  const { default: _ } = { default: null };
  const src = fs.readFileSync(path.join(presetDir, "agent.cordis.yml"), "utf8");

  // 造一份含被拒字段的副本，验证自愈时会删掉它们（模板可能是 CRLF，按实际行尾构造）
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const anchorLine = `        maxDepth: 1${nl}`;
  assert.equal(src.includes(anchorLine), true, "构造失败：模板里没有 maxDepth: 1");
  const legacy = src.replace(
    anchorLine,
    `${anchorLine}        toolFilter:${nl}          deny:${nl}            - subagent_fork${nl}`,
  );
  assert.notEqual(legacy, src);

  const mod = await import("../lib/redteam/index.js");
  // installPreset 走文件系统；这里直接验证模块导出的行为不可行，
  // 改用一个最小复现：把 legacy 写进临时 preset 目录后跑 installPreset。
  const os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "purge-preset-test-"));
  const dir = path.join(tmp, ".agent-presets", "redteam");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "agent.cordis.yml"), legacy, "utf8");
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  try {
    mod.installPreset({ log: () => {} });
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  }
  const after = fs.readFileSync(path.join(dir, "agent.cordis.yml"), "utf8");
  assert.equal(/^\s*toolFilter:/m.test(after), false, "自愈后仍有 toolFilter");
  assert.equal(after.includes("- id: anchor-gate"), true, "自愈误删了锚点门");
  assert.equal(after.includes("- id: redteam-tools"), true, "自愈误删了工具行");
});
