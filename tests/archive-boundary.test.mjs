import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { extractAsar } from '../lib/extract-asar.js';
import { extractZipArchive, extractZipBuffer } from '../lib/zip-extract.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dest: path.join(root, 'out') };
}

function asar(files, body = Buffer.from('ok')) {
  const json = Buffer.from(JSON.stringify({ files }));
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(json.length + 8, 4);
  pre.writeUInt32LE(json.length, 12);
  return Buffer.concat([pre, json, body]);
}

function runAsar(f, files) {
  const archive = path.join(f.root, 'sample.asar');
  fs.writeFileSync(archive, asar(files));
  return extractAsar(archive, f.dest);
}

function zip(rows) {
  const locals = [], central = [];
  let offset = 0;
  for (const row of rows) {
    const name = Buffer.from(row.name);
    const localName = Buffer.from(row.localName || row.name);
    const body = Buffer.from(row.body || '');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(localName.length, 26);
    locals.push(local, localName, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(row.attrs || 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + localName.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(rows.length, 8);
  end.writeUInt16LE(rows.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const badNames = ['../outside', '/absolute', 'C:/drive', 'C:drive', '..\\outside', '\\\\server\\share', 'a//b', 'a/./b', 'a/../b', 'a:b', 'CON', 'trailing.'];
for (const name of badNames) {
  test(`ASAR 全量预检拒绝 ${JSON.stringify(name)}`, (t) => {
    const f = fixture(t);
    assert.throws(() => runAsar(f, { 'first.txt': { size: 2, offset: '0' }, [name]: { size: 2, offset: '0' } }));
    assert.equal(fs.existsSync(f.dest), false);
  });
  test(`ZIP 全量预检拒绝 ${JSON.stringify(name)}`, (t) => {
    const f = fixture(t);
    assert.throws(() => extractZipBuffer(zip([{ name: 'first.txt', body: 'ok' }, { name, body: 'bad' }]), f.dest));
    assert.equal(fs.existsSync(f.dest), false);
  });
}

test('ASAR 正常普通文件与空目录可解包', (t) => {
  const f = fixture(t);
  assert.equal(runAsar(f, { dir: { files: { 'ok.txt': { size: 2, offset: '0' } } }, empty: { files: {} } }), 1);
  assert.equal(fs.readFileSync(path.join(f.dest, 'dir', 'ok.txt'), 'utf8'), 'ok');
  assert.ok(fs.statSync(path.join(f.dest, 'empty')).isDirectory());
});

test('ASAR 非法空目录及数据范围在写入前拒绝', (t) => {
  const f = fixture(t);
  assert.throws(() => runAsar(f, { good: { size: 2 }, '..': { files: {} } }));
  assert.equal(fs.existsSync(f.dest), false);
  assert.throws(() => runAsar(f, { good: { size: 2 }, truncated: { size: 100 } }));
  assert.equal(fs.existsSync(f.dest), false);
});

test('ASAR 拒绝归档中的越界链接及链接父路径', (t) => {
  const f = fixture(t);
  assert.throws(() => runAsar(f, { first: { size: 2 }, bad: { link: '../outside' } }));
  assert.equal(fs.existsSync(f.dest), false);
  assert.throws(() => runAsar(f, { first: { size: 2 }, link: { link: 'target' }, 'link/child': { size: 2 } }));
  assert.equal(fs.existsSync(f.dest), false);
});

for (const kind of ['asar', 'zip']) {
  for (const atRoot of [false, true]) {
    test(`${kind} 拒绝${atRoot ? '目标根' : '父目录'}现存符号链接`, (t) => {
      const f = fixture(t), outside = path.join(f.root, 'outside');
      fs.mkdirSync(outside);
      fs.mkdirSync(f.dest);
      const link = atRoot ? path.join(f.root, 'alias') : path.join(f.dest, 'nested');
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      if (atRoot) f.dest = link;
      const name = atRoot ? 'bad.txt' : 'nested/bad.txt';
      if (kind === 'asar') {
        const files = atRoot ? { 'bad.txt': { size: 2 } } : { nested: { files: { 'bad.txt': { size: 2 } } } };
        assert.throws(() => runAsar(f, files), /符号链接/);
      } else assert.throws(() => extractZipBuffer(zip([{ name, body: 'bad' }]), f.dest), /符号链接/);
      assert.deepEqual(fs.readdirSync(outside), []);
    });
  }
}

test('ZIP 显式目录、空目录、属性目录及仅文件条目', (t) => {
  const f = fixture(t);
  extractZipBuffer(zip([{ name: 'dir/' }, { name: 'empty/' }, { name: 'attrs', attrs: 0x10 },
    { name: 'dir/ok.txt', body: 'ok' }, { name: 'plain.txt', body: 'plain' }]), f.dest);
  assert.ok(fs.statSync(path.join(f.dest, 'empty')).isDirectory());
  assert.ok(fs.statSync(path.join(f.dest, 'attrs')).isDirectory());
  assert.equal(fs.readFileSync(path.join(f.dest, 'dir', 'ok.txt'), 'utf8'), 'ok');
  assert.equal(fs.readFileSync(path.join(f.dest, 'plain.txt'), 'utf8'), 'plain');
});

for (const rows of [
  [{ name: 'same' }, { name: 'same/file' }],
  [{ name: 'same/' }, { name: 'same' }],
  [{ name: 'Case' }, { name: 'case' }],
  [{ name: 'safe', localName: '../other' }],
  [{ name: 'link', attrs: (0xa1ff << 16) >>> 0, body: '../outside' }],
]) {
  test('ZIP 路径冲突、头不一致及链接元数据先拒绝', (t) => {
    const f = fixture(t);
    assert.throws(() => extractZipBuffer(zip([{ name: 'first', body: 'ok' }, ...rows]), f.dest));
    assert.equal(fs.existsSync(f.dest), false);
  });
}

test('ZIP 截断归档拒绝且不创建目标', (t) => {
  const f = fixture(t);
  assert.throws(() => extractZipBuffer(zip([{ name: 'ok', body: 'ok' }]).subarray(0, -5), f.dest));
  assert.equal(fs.existsSync(f.dest), false);
});

test('ZIP 外部工具之前统一预检；Node 发布成功且无暂存残留', (t) => {
  const f = fixture(t), archive = path.join(f.root, 'sample.zip');
  fs.writeFileSync(archive, zip([{ name: '../bad', body: 'bad' }]));
  assert.throws(() => extractZipArchive(archive, f.dest, ['tar', 'node']), /路径/);
  assert.deepEqual(fs.readdirSync(f.root), ['sample.zip']);
  fs.writeFileSync(archive, zip([{ name: 'dir/' }, { name: 'dir/ok', body: 'ok' }]));
  assert.equal(extractZipArchive(archive, f.dest, ['not-a-tool', 'node']), 'node');
  assert.equal(fs.readFileSync(path.join(f.dest, 'dir', 'ok'), 'utf8'), 'ok');
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['out', 'sample.zip']);
});

test('ZIP 外部工具失败残留不污染下一次尝试，且使用已预检快照', (t) => {
  const f = fixture(t), archive = path.join(f.root, 'sample.zip');
  fs.writeFileSync(archive, zip([{ name: 'ok', body: 'ok' }]));
  fs.mkdirSync(f.dest);
  fs.writeFileSync(path.join(f.dest, 'plugin.zip'), '保留下载包');
  const original = childProcess.execFileSync;
  let snapshot;
  childProcess.execFileSync = (tool, args) => {
    assert.equal(tool, 'tar');
    snapshot = args[1];
    assert.notEqual(snapshot, archive);
    assert.deepEqual(fs.readFileSync(snapshot), fs.readFileSync(archive));
    fs.writeFileSync(path.join(args[3], 'tool-residue'), '失败残留');
    throw new Error('模拟外部工具失败');
  };
  syncBuiltinESMExports();
  try {
    assert.equal(extractZipArchive(archive, f.dest, ['tar', 'node']), 'node');
  } finally {
    childProcess.execFileSync = original;
    syncBuiltinESMExports();
  }
  assert.equal(fs.existsSync(snapshot), false);
  assert.deepEqual(fs.readdirSync(f.dest).sort(), ['ok', 'plugin.zip']);
  assert.equal(fs.readFileSync(path.join(f.dest, 'plugin.zip'), 'utf8'), '保留下载包');
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['out', 'sample.zip']);
});

test('ZIP 既有文件冲突预检拒绝且不覆盖无关内容', (t) => {
  const f = fixture(t), archive = path.join(f.root, 'sample.zip');
  fs.mkdirSync(f.dest);
  fs.writeFileSync(path.join(f.dest, 'same'), '旧内容');
  fs.writeFileSync(archive, zip([{ name: 'first', body: 'ok' }, { name: 'same', body: '新内容' }]));
  assert.throws(() => extractZipArchive(archive, f.dest, ['node']), /冲突/);
  assert.deepEqual(fs.readdirSync(f.dest), ['same']);
  assert.equal(fs.readFileSync(path.join(f.dest, 'same'), 'utf8'), '旧内容');
});

test('ZIP 最终失败清理独立暂存目录并保留空目标', (t) => {
  const f = fixture(t), archive = path.join(f.root, 'sample.zip');
  fs.writeFileSync(archive, zip([{ name: 'ok', body: 'ok' }]));
  fs.mkdirSync(f.dest);
  assert.throws(() => extractZipArchive(archive, f.dest, ['not-a-tool']));
  assert.deepEqual(fs.readdirSync(f.dest), []);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['out', 'sample.zip']);
});
