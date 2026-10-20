import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWriteFile, atomicWriteSync, atomicCopyFile } from '../lib/core.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-atomic-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

test('同毫秒并发写入使用独立临时文件且保留完整内容', async (t) => {
  const root = fixture(t);
  const file = path.join(root, 'state.json');
  const values = Array.from({ length: 24 }, (_, i) => JSON.stringify({ i, text: String(i).repeat(10000) }));
  const now = Date.now;
  try {
    Date.now = () => 1800000000000;
    await Promise.all(values.map((value) => atomicWriteFile(file, value)));
  } finally {
    Date.now = now;
  }
  assert.ok(values.includes(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(fs.readdirSync(root), ['state.json']);
});

test('并发原子复制保留某一完整版本且不残留临时文件', async (t) => {
  const root = fixture(t);
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  const out = path.join(root, 'out');
  fs.writeFileSync(a, 'A'.repeat(65536));
  fs.writeFileSync(b, 'B'.repeat(65536));
  await Promise.all(Array.from({ length: 16 }, (_, i) => atomicCopyFile(i % 2 ? a : b, out)));
  assert.ok(['A'.repeat(65536), 'B'.repeat(65536)].includes(fs.readFileSync(out, 'utf8')));
  assert.deepEqual(fs.readdirSync(root).sort(), ['a', 'b', 'out']);
});

test('替换失败不损坏目标目录并清理自己的临时文件', async (t) => {
  const root = fixture(t);
  const dest = path.join(root, 'dest');
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'keep'), 'old');
  await assert.rejects(atomicWriteFile(dest, 'new'));
  assert.throws(() => atomicWriteSync(dest, 'new'));
  assert.equal(fs.readFileSync(path.join(dest, 'keep'), 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(root), ['dest']);
});

test('源文件缺失的复制失败不留下临时产物', async (t) => {
  const root = fixture(t);
  await assert.rejects(atomicCopyFile(path.join(root, 'missing'), path.join(root, 'out')));
  assert.deepEqual(fs.readdirSync(root), []);
});
