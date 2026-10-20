import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 闪窗抑制组（E03 第五块）从 core.js 拆到 flash-silence.js 后，与 core 形成
// 双向依赖。这类拆分最容易出的错是"漏导入"——语法检查不报、只有真正调用
// 到那一行才 ReferenceError。本文件用隔离环境把整条流程跑一遍兜住它。

test('拆分后的闪窗抑制在隔离环境可完整执行', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-flash-e2e-'));
  const home = path.join(root, '.dsh');
  const aiBase = path.join(root, 'fake-ai');
  fs.mkdirSync(path.join(aiBase, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(aiBase, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true });
  fs.writeFileSync(path.join(aiBase, 'package.json'), '{"name":"fake"}');

  const saved = {};
  const env = ['DSH_HOME', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'];
  for (const key of env) saved[key] = process.env[key];
  Object.assign(process.env, {
    DSH_HOME: home,
    HOME: root,
    USERPROFILE: root,
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    APPDATA: path.join(root, 'AppData', 'Roaming'),
  });

  try {
    const mod = await import('../lib/flash-silence.js');
    // 四个对外符号必须都在（core 的 re-export 依赖它们）
    for (const name of ['silenceCmdFlash', 'allowTargetForPatch',
      'listLiangshenBootstrapFiles', 'listPiAiApiFiles']) {
      assert.equal(typeof mod[name], 'function', `${name} 未导出`);
    }
    // 完整跑一遍：任何漏导入都会在这里抛 ReferenceError
    const result = mod.silenceCmdFlash(aiBase);
    assert.equal(typeof result, 'object');
    assert.ok('live' in result || 'entry' in result, '返回值结构异常');
    // 只读辅助函数也走一遍
    assert.ok(Array.isArray(mod.listLiangshenBootstrapFiles(home)));
    assert.ok(Array.isArray(mod.listPiAiApiFiles(home, aiBase, 'settings.json')));
    assert.equal(typeof mod.allowTargetForPatch(path.join(home, 'x')), 'boolean');
  } finally {
    for (const key of env) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('补丁目标状态模块读写语义不变', async () => {
  const state = await import('../lib/patch-target-state.js');
  state.setPatchTargetAiBase('/tmp/host-a');
  assert.equal(state.getPatchTargetAiBase(), '/tmp/host-a');
  state.setPatchTargetAiBase('');
  assert.equal(state.getPatchTargetAiBase(), null);
  state.setPatchTargetAiBase(null);
  assert.equal(state.getPatchTargetAiBase(), null);
});

// 端到端只能覆盖"当前 fixture 会走到"的分支：例如 asLf 只在匹配到
// 目标文件时才被调用，假 home 里没有那些文件就不会执行。所以再补一层
// 静态完整性检查——只要 flash-silence.js 用到 core.js 的某个顶层符号
// （函数/常量/命名空间导入），就必须显式 import 进来。
test('flash-silence 用到的 core 符号必须全部显式导入', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../lib/', import.meta.url));
  const core = readFileSync(root + 'core.js', 'utf8');
  const flash = readFileSync(root + 'flash-silence.js', 'utf8');

  const coreSymbols = new Set();
  for (const m of core.matchAll(/^(?:export )?(?:async )?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    coreSymbols.add(m[1]);
  }
  for (const m of core.matchAll(/^import \* as ([A-Za-z_$][\w$]*) from/gm)) coreSymbols.add(m[1]);

  const local = new Set();
  for (const m of flash.matchAll(/^(?:export )?(?:async )?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    local.add(m[1]);
  }
  const imported = new Set();
  for (const m of flash.matchAll(/import\s+\{([\s\S]*?)\}\s+from/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop();
      if (name) imported.add(name);
    }
  }
  for (const m of flash.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from/gm)) imported.add(m[1]);
  for (const m of flash.matchAll(/^import \* as ([A-Za-z_$][\w$]*)/gm)) imported.add(m[1]);

  const missing = [...coreSymbols].filter((name) => (
    !local.has(name)
    && !imported.has(name)
    && new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(flash)
  ));
  assert.deepEqual(missing, [], `这些 core 符号被引用却没有 import：${missing.join(', ')}`);
});
