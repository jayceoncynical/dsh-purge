import assert from 'node:assert/strict';
import test from 'node:test';

// 为什么需要这条测试：
// `node --check` 只做语法检查，**不解析 import**。拆分模块时漏写 import、
// 或循环依赖在初始化期就取用对方绑定，语法检查全部通过，但插件根本加载不起来。
// 这轮 E03 拆分里已经真实踩到过一次（core.js 漏了 patch-defs 的 import，
// `node --check` 依旧通过）。所以发布前必须真的 import 一次入口。
//
// 只加载、不跑 apply：本测试不写盘、不探测宿主、不起子进程。

test('插件入口可真实加载（import 图完整）', async () => {
  const mod = await import('../lib/index.js');
  assert.equal(mod.name, 'dsh-purge');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.default, 'object');
  assert.equal(typeof mod.default.apply, 'function');
  assert.ok(Array.isArray(mod.inject));
  assert.equal(typeof mod.registerPromptSections, 'function');
});

test('演练台三个子入口可真实加载', async () => {
  const store = await import('../lib/redteam/store.js');
  assert.equal(store.name, 'redteam-store');
  assert.equal(typeof store.apply, 'function');

  const ui = await import('../lib/redteam/ui.js');
  assert.equal(ui.name, 'dsh-purge-redteam-ui');
  assert.equal(typeof ui.apply, 'function');

  // tools.js 在模块顶层就要从宿主解析 @deepseek-ai/dsh-tools（真实宿主才装），
  // 干净 CI 上必然拿不到——那是部署前置条件，不是模块图错误。
  // 但"相对路径 import 写错"这类错误也必须被抓住，所以：
  //   · 允许且仅允许"解析不到宿主工具"这一种失败；
  //   · 用下面的静态解析测试兜住相对导入的完整性。
  let tools = null;
  let toolsError = null;
  try {
    tools = await import('../lib/redteam/tools.js');
  } catch (error) {
    toolsError = error;
  }
  if (toolsError) {
    assert.match(
      String(toolsError.message),
      /cannot resolve @deepseek-ai\/dsh-tools from host/,
      `tools.js 加载失败但原因不是缺宿主工具（可能是本地 import 写错）：${toolsError.message}`,
    );
  } else {
    assert.equal(tools.name, 'dsh-purge-redteam-tools');
    assert.equal(typeof tools.apply, 'function');
  }
});

test('演练台模块的相对 import 全部指向存在的文件', async () => {
  // 不执行被检查的模块，只解析源码里的相对导入并核对文件是否存在。
  const { readFileSync, existsSync, statSync } = await import('node:fs');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../lib/redteam/', import.meta.url));
  const files = ['tools.js', 'ui.js', 'store.js', 'store-core.js', 'index.js', 'client.js',
    'read-queries.js', 'report-gen.js', 'schema.js', 'validate.js', 'score-rules.js'];
  const missing = [];
  for (const file of files) {
    const full = resolve(root, file);
    if (!existsSync(full)) { missing.push(`${file} 不存在`); continue; }
    const source = readFileSync(full, 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(full), match[1]);
      if (!existsSync(target) || !statSync(target).isFile()) {
        missing.push(`${file} -> ${match[1]}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('补丁定义表结构完整（拆分后仍被 core 正确装配）', async () => {
  const defs = await import('../lib/patch-defs.js');
  for (const name of ['PATCHES', 'CODE_PATCHES', 'ENGINE_PATCHES', 'NEW_TOOL_PATCHES']) {
    assert.ok(Array.isArray(defs[name]), `${name} 必须是数组`);
    assert.ok(defs[name].length > 0, `${name} 不能为空`);
  }
  const core = await import('../lib/core.js');
  const total = defs.PATCHES.length + defs.CODE_PATCHES.length
    + defs.ENGINE_PATCHES.length + defs.NEW_TOOL_PATCHES.length;
  assert.equal(core.ALL_PATCHES.length, total);
  // id 唯一：重复 id 会让状态表互相覆盖
  const ids = core.ALL_PATCHES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, '补丁 id 必须唯一');
});

test('成果模块拆分后仍与 store 的委托方法一致', async () => {
  const { RedteamStore } = await import('../lib/redteam/store-core.js');
  for (const method of ['report', 'reportTargets', 'listWeb', 'listChain', 'listCredentials',
    'listAccess', 'listWebshells', 'listHttpEvidence', 'listAttackFiles', 'attackFileTree']) {
    assert.equal(typeof RedteamStore.prototype[method], 'function', `${method} 丢失`);
  }
});
