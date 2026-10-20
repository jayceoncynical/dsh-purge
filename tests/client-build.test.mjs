import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../lib/redteam/client.js', import.meta.url), 'utf8');
const start = source.indexOf('    const api = (req) => fetch(');
const end = source.indexOf('\n    let ui = ', start);
assert.ok(start >= 0 && end > start);
const apiSource = source.slice(start, end) + '\n globalThis.testApi = api;';

function apiWith(response) {
  const ctx = vm.createContext({ fetch: async () => response });
  vm.runInContext(apiSource, ctx);
  return ctx.testApi;
}

test('前端请求保留 JSON 成功响应', async () => {
  const result = await apiWith({ ok: true, status: 200, text: async () => '{"ok":true,"total":2}' })({ op: 'fixture' });
  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
});

test('HTTP 错误即使正文宣称成功仍返回失败', async () => {
  const result = await apiWith({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '{"ok":true,"message":"denied"}' })({});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'denied');
});

test('非 JSON 与空响应提供可解释错误', async () => {
  const result = await apiWith({ ok: false, status: 503, text: async () => '<html>unavailable</html>' })({});
  assert.equal(result.ok, false);
  assert.match(result.error, /503 non-json/);
  const empty = await apiWith({ ok: true, status: 200, text: async () => '' })({});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /空响应/);
});

test('前端源码保留倒计时清理与延迟下载释放', () => {
  assert.match(source, /React\.useEffect\(\(\) => \(\) => clearCountdown\(\)/);
  assert.match(source, /onClick: closeModal/);
  assert.match(source, /setTimeout\(\(\) => \{ try \{ URL\.revokeObjectURL\(url\)/);
});
