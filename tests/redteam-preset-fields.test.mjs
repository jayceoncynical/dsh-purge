import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const comp = await import("../lib/redteam/preset-composition.js");

// dsh 0.2.1-rc.2 的 dsh-tool-subagent 对 persona / toolFilter 做 Object.hasOwn 硬拦：
// 只要配置里出现这两个键就抛错，整个红队预设 mount 失败，模式下拉显示「加载失败」。
// backgroundMode 则相反：0.2.0 仍读取它，删掉会让子代理退化成前台一次性任务；
// 0.2.1 会保留但不报错。模板必须继续写 backgroundMode: continuable。
const REJECTED = ["persona", "toolFilter"];

const presetDir = path.join(root, "presets", "redteam");

/** 预设里 tool-subagent 行嵌在 delegation group 内，递归取出所有行。 */
function flatten(rows, out = []) {
  for (const row of rows ?? []) {
    out.push(row);
    if (Array.isArray(row.config)) flatten(row.config, out);
  }
  return out;
}

function toolRows(def) {
  return flatten(def.plugins).filter((row) => row.name === "@deepseek-ai/dsh-tool-subagent");
}

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-preset-test-"));
  const osHome = path.join(home, "os-home");
  fs.mkdirSync(osHome, { recursive: true });
  return { home, osHome };
}

function runApply(mod, home, osHome) {
  const logs = [];
  const cleanups = [];
  const provided = {};
  const prevHome = process.env.DSH_HOME;
  const prevOsHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.DSH_HOME = home;
  process.env.HOME = osHome;
  process.env.USERPROFILE = osHome;
  try {
    mod.apply({
      logger: {
        info: (...args) => logs.push(args.join(" ")),
        warn: (...args) => logs.push(args.join(" ")),
        error: (...args) => logs.push(args.join(" ")),
      },
      effect: (fn) => {
        const dispose = fn();
        if (typeof dispose === "function") cleanups.push(dispose);
        return dispose;
      },
      get: () => undefined,
      provide: (key, value) => { provided[key] = value; },
    });
  } finally {
    for (const dispose of cleanups) dispose();
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    if (prevOsHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevOsHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  }
  return { logs, provided };
}

const redteam = await import("../lib/redteam/index.js");

test("红队预设不声明 0.2.1 会拒绝的 tool-subagent 字段", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const offenders = [];
  for (const row of toolRows(def)) {
    const cfg = row.config ?? {};
    for (const field of REJECTED) {
      if (Object.hasOwn(cfg, field)) offenders.push(`${row.id}.${field}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("红队预设保留 0.2.0 仍使用的 backgroundMode", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const rows = toolRows(def);
  const spawn = rows.find((row) => row.config?.toolName === "subagent");
  const fork = rows.find((row) => row.config?.toolName === "subagent_fork");
  assert.equal(spawn?.config?.backgroundMode, "continuable");
  assert.equal(fork?.config?.backgroundMode, "continuable");
});

test("叶子约束覆盖 spawn / fork，并禁用绕过 maxDepth 的 workflow / ralph", () => {
  const def = comp.readPresetDefinition("redteam", presetDir);
  const rows = toolRows(def);
  assert.equal(rows.find((row) => row.config?.toolName === "subagent")?.config?.maxDepth, 1);
  assert.equal(rows.find((row) => row.config?.toolName === "subagent_fork")?.config?.maxDepth, 1);
  const flat = flatten(def.plugins);
  assert.equal(flat.find((row) => row.id === "tool-workflow")?.disabled, true);
  assert.equal(flat.find((row) => row.id === "tool-ralph")?.disabled, true);
});

test("旧预设重新启用 workflow / ralph 时会被改回 disabled", async () => {
  const { migrateSubagentConfig } = await import("../lib/redteam/subagent-config.js");
  const text = [
    "- id: tool-workflow",
    "  name: '@deepseek-ai/dsh-tool-workflow'",
    "  disabled: false",
    "- id: tool-ralph",
    "  name: '@deepseek-ai/dsh-tool-ralph'",
    "",
  ].join("\n");
  const out = migrateSubagentConfig(text, presetDir);
  assert.equal(out.error, "");
  assert.equal((out.text.match(/disabled: true/g) || []).length, 2);
});

test("旧预设就地迁移：删被拒字段、补齐叶子约束、保留用户内容并可解析", async () => {
  const { home, osHome } = tempHome();
  const dir = path.join(home, ".agent-presets", "redteam");
  fs.mkdirSync(dir, { recursive: true });
  const src = fs.readFileSync(path.join(presetDir, "agent.cordis.yml"), "utf8").replace(/\r\n/g, "\n");
  const legacy = src.replace(
    /(        maxDepth: 1\n)/,
    `$1        toolFilter:\n          deny:\n            - subagent_fork\n        persona: |\n          CUSTOM_PERSONA\n`,
  ) + [
    "",
    "- id: custom-extension",
    "  name: custom-extension",
    "  config:",
    "    persona: CUSTOM_FOREIGN",
    "    text: |",
    "      persona: CUSTOM_BODY",
    "      - id: fake-tool",
    "        name: '@deepseek-ai/dsh-tool-subagent'",
    "        config:",
    "          persona: KEEP_IN_PROMPT",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "agent.cordis.yml"), legacy, "utf8");
  fs.copyFileSync(path.join(presetDir, "preset.yml"), path.join(dir, "preset.yml"));

  const { provided } = runApply(redteam, home, osHome);
  const after = fs.readFileSync(path.join(dir, "agent.cordis.yml"), "utf8");
  const def = comp.readPresetDefinition("redteam", dir);
  const row = toolRows(def).find((item) => item.config?.toolName === "subagent");
  assert.equal(Object.hasOwn(row.config, "persona"), false);
  assert.equal(Object.hasOwn(row.config, "toolFilter"), false);
  assert.equal(after.includes("CUSTOM_FOREIGN"), true, "误删了其它插件的 persona");
  assert.equal(after.includes("CUSTOM_BODY"), true, "误删了提示词正文");
  assert.equal(after.includes("KEEP_IN_PROMPT"), true, "误删了块标量里的同形文本");
  assert.equal(after.includes("CUSTOM_PERSONA"), false, "被删字段的块内容应一起移除");
  assert.equal(provided.redteamMode.preset.action, "repaired");
  assert.equal(fs.existsSync(path.join(dir, "agent.cordis.yml.dshpurge.bak")), true);
});

test("已有模板不会被自动整份覆盖", async () => {
  const { home, osHome } = tempHome();
  const dir = path.join(home, ".agent-presets", "redteam");
  fs.mkdirSync(dir, { recursive: true });
  const src = fs.readFileSync(path.join(presetDir, "agent.cordis.yml"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace("{{REDTEAM_SKILLS_DIR}}", "!!js dshHomePath('redteam/skills')");
  fs.writeFileSync(path.join(dir, "agent.cordis.yml"), src, "utf8");
  fs.copyFileSync(path.join(presetDir, "preset.yml"), path.join(dir, "preset.yml"));

  const { provided } = runApply(redteam, home, osHome);
  assert.notEqual(provided.redteamMode.preset.action, "installed");
});

test("显式整体重建前会备份用户预设", () => {
  const { home, osHome } = tempHome();
  const dir = path.join(home, ".agent-presets", "redteam");
  fs.mkdirSync(dir, { recursive: true });
  const custom = "- id: custom\n  name: custom\n  config:\n    persona: KEEP_ME\n";
  fs.writeFileSync(path.join(dir, "agent.cordis.yml"), custom, "utf8");
  const prevHome = process.env.DSH_HOME;
  const prevOsHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.DSH_HOME = home;
  process.env.HOME = osHome;
  process.env.USERPROFILE = osHome;
  try {
    redteam.installPreset({ force: true, log: () => {} });
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    if (prevOsHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevOsHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  }
  const backup = path.join(dir, "agent.cordis.yml.dshpurge.bak");
  assert.equal(fs.existsSync(backup), true);
  assert.equal(fs.readFileSync(backup, "utf8").includes("KEEP_ME"), true);
});
