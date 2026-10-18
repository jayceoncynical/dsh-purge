#!/usr/bin/env node
/**
 * 宿主兼容探测：把 dsh-purge 的全部补丁对着某个 dsh 安装树跑一遍，
 * 直接告诉你在这次上游改版里哪些补丁失效、哪些会让「应用 + 重启」被拦下。
 *
 * 用法：
 *   node scripts/probe-dsh-compat.mjs --base <aiBase> [--baseline <aiBase>]
 *                                     [--home <dshHome>] [--surface web|desktop]
 *                                     [--apply] [--json]
 *
 * aiBase 是包含 dsh-agent-instructions、dsh-system-prompt 的 @deepseek-ai 目录，
 * 例如 <npm prefix>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
 * 或 <profile>/node_modules/@deepseek-ai。
 *
 * --baseline 传旧版本的同名目录：输出「旧版命中、新版归零」的真回归，
 * 这是升级后真正要改的 pattern 清单。
 *
 * 不带 --apply 时只读：统计 pattern 命中，不改任何文件。
 * 带 --apply 时会在该树上真打补丁（先在副本上跑，别对生产宿主直接用）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { surface: "web", apply: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--base") out.base = argv[++i];
    else if (arg === "--baseline") out.baseline = argv[++i];
    else if (arg === "--home") out.home = argv[++i];
    else if (arg === "--surface") out.surface = argv[++i];
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.base) {
  console.log(
    [
      "用法: node scripts/probe-dsh-compat.mjs --base <aiBase> [选项]",
      "",
      "  --base     新版本 @deepseek-ai 目录（必填）",
      "  --baseline 旧版本 @deepseek-ai 目录，用于筛出真回归",
      "  --home     DSH_HOME；缺省用临时目录，避免读到真实 profile",
      "  --surface   web | desktop（默认 web）",
      "  --apply     在给定树上真打补丁（先在副本上跑）",
      "  --json      输出 JSON",
    ].join("\n"),
  );
  process.exit(args.help ? 0 : 2);
}

const base = path.resolve(args.base);
const baseline = args.baseline ? path.resolve(args.baseline) : "";
const home = args.home ? path.resolve(args.home) : fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-probe-"));
process.env.DSH_SURFACE = args.surface;
process.env.DSH_HOME = home;

const core = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);
const hostClean = await import(pathToFileURL(path.join(root, "lib", "host-clean.js")).href);

/** 只读统计一棵树上每条 replacement 的命中次数。 */
function collectRows(aiBase) {
  const files = core.targetFiles(aiBase, home);
  const emptyKeys = Object.entries(files)
    .filter(([, value]) => (Array.isArray(value) ? value.length === 0 : !value))
    .map(([key]) => key);
  const rows = [];
  for (const patch of core.ALL_PATCHES) {
    const keys = Array.isArray(patch.file) ? patch.file : [patch.file];
    const paths = [];
    for (const key of keys) {
      const value = files[key];
      if (Array.isArray(value)) paths.push(...value);
      else if (value) paths.push(value);
    }
    const texts = paths.map((fp) => {
      try {
        return fs.readFileSync(fp, "utf8");
      } catch {
        return "";
      }
    });
    const hits = (patch.replacements || []).map((rep) => {
      let total = 0;
      for (const text of texts) {
        const n =
          typeof rep.pattern === "string"
            ? text.split(rep.pattern).length - 1
            : (text.match(rep.pattern) || []).length;
        total += n;
      }
      return total;
    });
    rows.push({
      id: patch.id,
      name: patch.name,
      optional: patch.optional === true,
      absentSince: patch.absentSince || "",
      fileCount: paths.length,
      patternCount: hits.length,
      hits,
      totalHits: hits.reduce((a, b) => a + b, 0),
      deadPatterns: hits.filter((n) => n === 0).length,
    });
  }
  return { emptyKeys, rows };
}

/** 旧版命中 >0、新版归零的 pattern：升级后必须补的适配点。 */
function diffRows(oldRows, newRows) {
  const byId = new Map(newRows.map((row) => [row.id, row]));
  const out = [];
  for (const row of oldRows) {
    const other = byId.get(row.id);
    if (!other) continue;
    row.hits.forEach((before, index) => {
      const after = other.hits[index] ?? 0;
      if (before > 0 && after === 0) {
        out.push({
          id: row.id,
          name: row.name,
          optional: row.optional,
          patternIndex: index,
          before,
          after,
          absentSince: other.absentSince,
          targetFiles: other.fileCount,
        });
      }
    });
  }
  return out;
}

const current = collectRows(base);
const version = core.hostDshVersion(base);
const baseVersion = baseline ? core.hostDshVersion(baseline) : "";

let regressions = null;
if (baseline) regressions = diffRows(collectRows(baseline).rows, current.rows);

let applyReport = null;
let keepsInject = null;
if (args.apply) {
  const applied = await core.applyPatches(base, core.ALL_PATCHES, {});
  const live = await core.patchStatus(base, core.ALL_PATCHES);
  applyReport = applied.map((row) => ({ ...row, status_now: live[row.patch_id] || "" }));
  try {
    keepsInject = hostClean.hostPromptKeepsInject(
      fs.readFileSync(path.join(base, "dsh-system-prompt", "lib", "index.js"), "utf8"),
    );
  } catch {
    keepsInject = null;
  }
}

const isHard = (row) => !row.optional && !row.absentSince;
const result = {
  base,
  home,
  surface: args.surface,
  hostVersion: version || "(unknown)",
  baseline: baseline || null,
  baselineVersion: baseline ? baseVersion || "(unknown)" : null,
  emptyTargetKeys: current.emptyKeys,
  deadHardPatches: current.rows.filter((row) => row.patternCount > 0 && row.totalHits === 0 && isHard(row)),
  deadOptionalPatches: current.rows.filter(
    (row) => row.patternCount > 0 && row.totalHits === 0 && !isHard(row) && !row.absentSince,
  ),
  regressions,
  applyReport,
  restartGate: applyReport
    ? {
        hostPromptKeepsInject: keepsInject,
        // 真正的重启门禁是 hostPromptKeepsInject（core.allPatchHostsWritten）；
        // 其余未落地的条目只作为待办列出，不阻止重启。
        blockers: keepsInject === true
          ? []
          : applyReport
              .filter((row) => {
                const patch = core.ALL_PATCHES.find((p) => p.id === row.patch_id);
                if (!patch || patch.optional) return false;
                return !["applied", "already", "na", "skipped"].includes(row.status_now || row.status);
              })
              .map((row) => ({ id: row.patch_id, name: row.name, status: row.status_now || row.status })),
        unsettled: applyReport
          .filter((row) => {
            const patch = core.ALL_PATCHES.find((p) => p.id === row.patch_id);
            if (!patch || patch.optional) return false;
            return !["applied", "already", "na", "skipped"].includes(row.status_now || row.status);
          })
          .map((row) => ({ id: row.patch_id, name: row.name, status: row.status_now || row.status })),
      }
    : null,
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`宿主: ${result.base}`);
  console.log(`版本: ${result.hostVersion}   面: ${result.surface}   home: ${result.home}`);
  if (result.baseline) console.log(`基线: ${result.baseline} (${result.baselineVersion})`);
  console.log("");
  console.log(result.emptyTargetKeys.length
    ? `宿主缺少的目标键: ${result.emptyTargetKeys.join(", ")}`
    : "目标键: 全部解析成功");

  if (regressions) {
    console.log("");
    if (regressions.length === 0) console.log("真回归: 无（旧版命中的 pattern 在新版仍命中）");
    else {
      console.log(`真回归 (${regressions.length}) — 旧版命中、新版归零:`);
      for (const row of regressions) {
        console.log(
          `  #${String(row.id).padEnd(3)} ${row.name.padEnd(40)} pattern#${row.patternIndex} ${row.before}→0  optional=${row.optional}`,
        );
      }
    }
  }

  console.log("");
  if (result.deadHardPatches.length === 0) console.log("必需补丁全部落空: 无");
  else {
    console.log(`必需补丁全部落空 (${result.deadHardPatches.length}):`);
    for (const row of result.deadHardPatches) console.log(`  #${String(row.id).padEnd(3)} ${row.name}`);
  }
  if (result.deadOptionalPatches.length) {
    console.log("");
    console.log(`可选补丁全部落空 (${result.deadOptionalPatches.length}): ${result.deadOptionalPatches.map((r) => `#${r.id}`).join(", ")}`);
  }

  if (applyReport) {
    console.log("");
    const byStatus = {};
    for (const row of applyReport) {
      const key = row.status_now || row.status;
      byStatus[key] = (byStatus[key] || 0) + 1;
    }
    console.log("应用结果:", JSON.stringify(byStatus));
    console.log("重启校验 hostPromptKeepsInject:", keepsInject);
    if (result.restartGate.blockers.length) {
      console.log("会拦下重启的补丁:", result.restartGate.blockers.map((r) => `#${r.id} ${r.name}`).join(", "));
    } else {
      console.log("会拦下重启的补丁: 无");
    }
    if (result.restartGate.unsettled.length) {
      console.log("非可选但未落地（不阻止重启）:", result.restartGate.unsettled.map((r) => `#${r.id} ${r.name}(${r.status})`).join(", "));
    }
  }
}
