import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RedteamStore } from '../lib/redteam/store-core.js';

// report() 与 reportTargets() 消费同一份事实：界面用后者做按目标分组，
// 报告用前者出 Markdown。拆分（E03 第一块）时发现两者 bySeverity 形状
// 历史上不一致——report 恒定 5 个严重级键，reportTargets 只有三个、
// low/info 没有时直接缺键。同一份数据、两个入口、两种结构，调用方难写。
// 本文件锁住"两个入口结构一致、口径一致"。

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function tempStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-report-parity-'));
  const store = new RedteamStore(root);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return store;
}

function seed(store, { withLow = false } = {}) {
  const { id } = store.openEngagement('parity', ['10.0.0.0/8']);
  const db = store.db(id);
  store.importBundle(id, { assets: [{ ip: '10.0.0.5', ports: [{ port: 443, service: 'https' }] }] });
  const assetId = db.prepare('SELECT id FROM asset').get().id;
  store.addVuln(id, { asset_id: assetId, cve: 'CVE-2026-2001', title: '严重', severity: 'critical', status: 'exploited' });
  store.addVuln(id, { asset_id: assetId, cve: 'CVE-2026-2002', title: '高危', severity: 'high', status: 'confirmed' });
  store.addVuln(id, { asset_id: assetId, cve: 'CVE-2026-2003', title: '中危', severity: 'medium', status: 'confirmed' });
  if (withLow) {
    store.addVuln(id, { asset_id: assetId, cve: 'CVE-2026-2004', title: '低危', severity: 'low', status: 'confirmed' });
    store.addVuln(id, { asset_id: assetId, cve: 'CVE-2026-2005', title: '信息', severity: 'info', status: 'confirmed' });
  }
  return id;
}

function targetOf(store, id, options) {
  const grouped = store.reportTargets(id, options);
  const target = grouped.targets.find((item) => item.key === '10.0.0.5');
  assert.ok(target, '分组里应包含 10.0.0.5');
  return { target, grouped };
}

test('默认口径：两个入口的 bySeverity 键集与计数完全一致', (t) => {
  const store = tempStore(t);
  const id = seed(store);
  const report = store.report(id);
  const { target } = targetOf(store, id);
  assert.deepEqual(Object.keys(target.stats.bySeverity).sort(), SEVERITIES.slice().sort());
  assert.deepEqual(Object.keys(report.stats.bySeverity).sort(), SEVERITIES.slice().sort());
  for (const key of SEVERITIES) {
    assert.equal(target.stats.bySeverity[key], report.stats.bySeverity[key], `严重级 ${key} 计数不一致`);
  }
});

test('默认口径：筛选掉的两边一致，low/info 键位保留为 0', (t) => {
  const store = tempStore(t);
  const id = seed(store, { withLow: true });
  const report = store.report(id);
  const { target, grouped } = targetOf(store, id);
  assert.equal(report.stats.results, 3);
  assert.equal(target.stats.vulns, 3);
  for (const key of ['low', 'info']) {
    assert.equal(report.stats.bySeverity[key], 0, `report 的 ${key} 应为 0`);
    assert.equal(target.stats.bySeverity[key], 0, `reportTargets 的 ${key} 应为 0`);
  }
  assert.equal(report.stats.filteredOut, 2);
  assert.equal(grouped.totals.filteredOut, 2);
});

test('includeAll 口径：两边都把 low/info 计入且计数相同', (t) => {
  const store = tempStore(t);
  const id = seed(store, { withLow: true });
  const report = store.report(id, { all: true });
  const { target, grouped } = targetOf(store, id, { all: true });
  assert.equal(report.stats.results, 5);
  assert.equal(target.stats.vulns, 5);
  for (const key of SEVERITIES) {
    assert.equal(target.stats.bySeverity[key], report.stats.bySeverity[key], `全量口径 ${key} 不一致`);
  }
  assert.equal(report.stats.filteredOut, 0);
  assert.equal(grouped.totals.filteredOut, 0);
});
