/**
 * 演练台数据量基准（审查文档 E04）。
 *
 * 目的：在拆分 store-core.js（E03）之前，先锁住不同数据规模下的行为耗时，
 * 拆分后用同一脚本对照，证明重构没有引入数量级回退。
 *
 * 用法：node scripts/bench-store.mjs [规模档位]
 *   档位：small(默认) | medium | large
 *
 * 只在系统临时目录建库造数，跑完自清理；不发网络、不碰真实库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { RedteamStore } from '../lib/redteam/store-core.js';

const SCALES = {
  small: { assets: 50, portsPer: 4, historyPer: 1, rounds: 5 },
  medium: { assets: 500, portsPer: 6, historyPer: 3, rounds: 3 },
  large: { assets: 2000, portsPer: 8, historyPer: 5, rounds: 2 },
};
const scale = SCALES[process.argv[2] || 'small'];
if (!scale) {
  console.error(`未知档位：${process.argv[2]}（可选 ${Object.keys(SCALES).join('/')}）`);
  process.exit(1);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-bench-'));
const store = new RedteamStore(root);

function ipOf(i) {
  // 10.0.x.y 网段内的确定性地址，避免随机种子影响可重复性。
  return `10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${(i % 254) + 1}`;
}

const results = [];
function bench(name, fn) {
  const times = [];
  for (let i = 0; i < scale.rounds; i += 1) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const best = times[0];
  const median = times[Math.floor(times.length / 2)];
  results.push({ name, best: +best.toFixed(1), median: +median.toFixed(1) });
  console.log(`${name.padEnd(38)} best=${best.toFixed(1).padStart(8)}ms  median=${median.toFixed(1).padStart(8)}ms`);
}

try {
  const { id } = store.openEngagement('bench', ['10.0.0.0/8']);
  const db = store.db(id);

  // ── 造数：资产 × 端口 × 服务历史 ──
  {
    const t0 = performance.now();
    const bundle = { assets: [] };
    for (let a = 0; a < scale.assets; a += 1) {
      const ports = [];
      for (let p = 0; p < scale.portsPer; p += 1) {
        // 多轮不同快照：第一轮 https，之后逐轮变化再部分恢复，制造真实历史。
        for (let h = 0; h < scale.historyPer; h += 1) {
          ports.push({
            port: 8000 + p * 10 + h,
            service: h === 0 ? 'http' : (h % 2 ? 'nginx' : 'http'),
            product: h === 0 ? null : `prod-${h % 3}`,
          });
        }
      }
      bundle.assets.push({ ip: ipOf(a), primary_name: `host-${a}.bench.local`, ports });
    }
    store.importBundle(id, bundle);
    // 重复导入一轮同快照：验证 R06 去重路径在大数据量下的表现。
    store.importBundle(id, bundle);
    console.log(`造数：${scale.assets} 资产 / ${scale.assets * scale.portsPer * scale.historyPer} 端口快照（含重复导入）耗时 ${(performance.now() - t0).toFixed(0)}ms`);
  }

  const assetCount = db.prepare('SELECT COUNT(*) AS n FROM asset').get().n;
  const portCount = db.prepare('SELECT COUNT(*) AS n FROM port').get().n;
  const serviceCount = db.prepare('SELECT COUNT(*) AS n FROM service').get().n;
  console.log(`库内：资产=${assetCount} 端口=${portCount} 服务快照=${serviceCount}\n`);

  const firstAssetId = db.prepare('SELECT id FROM asset ORDER BY id LIMIT 1').get().id;
  const allIds = db.prepare('SELECT id FROM asset ORDER BY id').all().map((r) => r.id);

  bench('stats() 全库统计', () => store.stats(id));
  bench('listAssets() 全量列表(含服务去重)', () => store.listAssets(id, {}));
  bench('listAssets(q=文本检索)', () => store.listAssets(id, { q: 'bench' }));
  bench('assetChildren() 批量预取', () => store.assetChildren(db, allIds));
  bench('assetRow() 单资产详情', () => store.assetRow(db, db.prepare('SELECT * FROM asset WHERE id = ?').get(firstAssetId)));
  bench('discoveryTimeline() 时间线', () => store.discoveryTimeline(id, {}));
  bench('listVulns() 空结果查询', () => store.listVulns(id, {}));
  bench('report() 成果报告', () => store.report(id));
  bench('testStats() 状态统计', () => store.testStats(id));
  bench('db() 句柄缓存命中', () => store.db(id));

  // ── 句柄增长检查：多靶标不应无限累积 ──
  const before = store.handles.size;
  for (let i = 0; i < 5; i += 1) {
    const e = store.openEngagement(`handle-check-${i}`, [], { bindCurrent: false });
    store.stats(e.id);
  }
  const grown = store.handles.size - before;
  console.log(`\n句柄检查：新开 5 个靶标后句柄增长 ${grown} 个（close() 统一释放）`);

  console.log('\n--- JSON（供拆分前后机器对照）---');
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    scale: process.argv[2] || 'small',
    counts: { assets: assetCount, ports: portCount, services: serviceCount },
    results,
    handleGrowth: grown,
  }));
} finally {
  store.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
