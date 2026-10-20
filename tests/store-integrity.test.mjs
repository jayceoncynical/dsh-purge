import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RedteamStore } from '../lib/redteam/store-core.js'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-store-integrity-'))
  const store = new RedteamStore(root)
  const id = 'integrity'
  t.after(() => {
    try { store.close() } finally { rmSync(root, { recursive: true, force: true }) }
    assert.equal(existsSync(root), false, '临时数据库目录应完全清理')
  })
  const db = store.db(id, { create: true })
  return { store, id, db }
}

for (const withCve of [true, false]) {
  test(`补充漏洞证据保留缺省字段与报告资格（${withCve ? 'CVE' : '标题'}去重）`, (t) => {
    const { store, id, db } = fixture(t)
    const identity = { title: '本地数据完整性记录', target: 'https://example.test/item' }
    if (withCve) identity.cve = 'CVE-2099-0001'
    const first = store.addVuln(id, {
      ...identity, severity: 'high', status: 'confirmed', evidence: '初始证据',
      source: '本地样本', confidence: 0.9, gained: '样本结论', agent: '样本角色',
    })
    const before = { ...db.prepare('SELECT * FROM vuln WHERE id = ?').get(first.id) }
    assert.equal(store.report(id).stats.results, 1)
    assert.deepEqual(store.addVuln(id, { ...identity, evidence: '补充证据' }), { id: first.id, updated: true })
    const after = { ...db.prepare('SELECT * FROM vuln WHERE id = ?').get(first.id) }
    assert.deepEqual(after, { ...before, evidence: '补充证据' })
    assert.equal(store.report(id).stats.results, 1)
  })
}

test('漏洞枚举只接受显式合法值，创建默认值与两个更新入口保持兼容', (t) => {
  const { store, id, db } = fixture(t)
  const identity = { cve: 'CVE-2099-0002', target: 'https://example.test/enum' }
  const first = store.addVuln(id, { ...identity, severity: 'high', status: 'confirmed' })
  const read = () => ({ ...db.prepare('SELECT severity, status FROM vuln WHERE id = ?').get(first.id) })
  for (const value of [undefined, null, '', 'INVALID', ' high ', 0, {}]) {
    store.addVuln(id, { ...identity, severity: value, status: value })
    assert.deepEqual(read(), { severity: 'high', status: 'confirmed' })
    store.updateVuln(id, first.id, { severity: value, status: value })
    assert.deepEqual(read(), { severity: 'high', status: 'confirmed' })
  }
  store.addVuln(id, { ...identity, severity: 'critical' })
  assert.deepEqual(read(), { severity: 'critical', status: 'confirmed' })
  store.addVuln(id, { ...identity, status: 'fixed' })
  assert.deepEqual(read(), { severity: 'critical', status: 'fixed' })
  store.addVuln(id, { ...identity, severity: 'low', status: 'false-positive' })
  assert.deepEqual(read(), { severity: 'low', status: 'false-positive' })
  for (const input of [{}, { severity: 'INVALID', status: 'INVALID' }]) {
    const created = store.addVuln(id, { title: JSON.stringify(input), ...input })
    assert.deepEqual({ ...db.prepare('SELECT severity, status FROM vuln WHERE id = ?').get(created.id) },
      { severity: 'info', status: 'candidate' })
  }
})

function importService(store, id, patch = {}) {
  return store.importBundle(id, { assets: [{
    ip: '192.0.2.10', state: 'live', provenance: 'active', tool: '本地样本',
    ports: [{ port: 8080, service: 'http', product: '样本服务', version: '1', ...patch }],
  }] })
}

function assertCurrent(store, id, expected) {
  const listed = store.listAssets(id).items[0]
  const detailed = store.getAsset(id, listed.id)
  for (const asset of [listed, detailed]) {
    assert.equal(asset.ports.length, 1)
    assert.equal(asset.open_ports, 1)
    assert.equal(asset.active, 1)
    assert.equal(asset.passive, 0)
    assert.equal(asset.ports[0].service, expected.service ?? 'http')
    assert.equal(asset.ports[0].version, expected.version)
  }
  const web = store.listWeb(id)
  assert.equal(web.total, 1)
  assert.equal(web.items.length, 1)
  assert.equal(web.items[0].version, expected.version)
  assert.equal(store.stats(id).openPorts, 1)
}

test('相同服务快照重复导入只刷新时间，不新增或放大当前端口', (t) => {
  const { store, id, db } = fixture(t)
  importService(store, id)
  db.prepare("UPDATE service SET first_seen = '2000-01-01', last_seen = '2000-01-02'").run()
  const before = { ...db.prepare('SELECT * FROM service').get() }
  const repeated = importService(store, id)
  assert.equal(repeated.counts.services, 1, '导入计数仍表示处理的服务条数')
  const rows = db.prepare('SELECT * FROM service').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, before.id)
  assert.equal(rows[0].first_seen, before.first_seen)
  assert.notEqual(rows[0].last_seen, before.last_seen)
  assert.equal(store.stats(id).services, 1)
  assertCurrent(store, id, { version: '1' })
})

test('服务变化保留历史，恢复旧值作为新状态，当前视图稳定只选一条', (t) => {
  const { store, id, db } = fixture(t)
  for (const version of ['1', '2', '2', '1', '1']) importService(store, id, { version })
  assert.deepEqual(db.prepare('SELECT version FROM service ORDER BY id').all().map((s) => s.version), ['1', '2', '1'])
  assertCurrent(store, id, { version: '1' })
  importService(store, id, { version: '1', cpe: 'cpe:/a:local:sample:1' })
  importService(store, id, { version: '1', cpe: 'cpe:/a:local:sample:1' })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM service').get().n, 4)
  assertCurrent(store, id, { version: '1' })
})

test('服务来源变化单独留档，相同来源重复导入不新增', (t) => {
  const { store, id, db } = fixture(t)
  importService(store, id)
  importService(store, id, { provenance: 'passive', tool: '另一份本地样本' })
  importService(store, id, { provenance: 'passive', tool: '另一份本地样本' })
  assert.deepEqual(db.prepare('SELECT provenance, tool FROM service ORDER BY id').all().map((s) => ({ ...s })), [
    { provenance: 'active', tool: '本地样本' },
    { provenance: 'passive', tool: '另一份本地样本' },
  ])
  assertCurrent(store, id, { version: '1' })
})

test('已有重复历史无需删除也不会放大当前列表，最新状态使用插入顺序', (t) => {
  const { store, id, db } = fixture(t)
  importService(store, id)
  db.exec(`INSERT INTO service(port_id, name, product, version, cpe, provenance, tool, first_seen, last_seen)
    SELECT port_id, name, product, version, cpe, provenance, tool, first_seen, last_seen FROM service;
    INSERT INTO service(port_id, name, product, version, provenance, tool, first_seen, last_seen)
    SELECT port_id, 'https', product, '旧库最新值', provenance, tool, '1999-01-01', '1999-01-01' FROM service LIMIT 1;`)
  store.close()
  assertCurrent(store, id, { service: 'https', version: '旧库最新值' })
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM service').get().n, 3)
  importService(store, id, { service: 'https', version: '旧库最新值' })
  assert.equal(store.db(id).prepare('SELECT COUNT(*) AS n FROM service').get().n, 3)
})

test('没有服务快照的端口仍然显示一次，协议相同端口号保持独立', (t) => {
  const { store, id } = fixture(t)
  store.importBundle(id, { assets: [{ ip: '192.0.2.20', ports: [
    { port: 8080 }, { port: 8080, proto: 'udp' },
  ] }] })
  const asset = store.listAssets(id).items[0]
  assert.equal(asset.open_ports, 2)
  assert.equal(asset.ports.length, 2)
  assert.equal(store.getAsset(id, asset.id).open_ports, 2)
  assert.equal(store.listWeb(id).total, 2)
})
