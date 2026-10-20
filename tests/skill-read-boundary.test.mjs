import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSkillOpFromPluginDir } from '../lib/redteam/ui.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-read-boundary-'));
  const dir = path.join(root, 'skills');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'normal.md'), '---\ndescription: 正常技能\n---\n根内正文');
  fs.writeFileSync(path.join(root, 'outside.md'), '外部正文不得返回');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir };
}

function read(dir, name) {
  return handleSkillOpFromPluginDir({ op: 'skillRead', name }, dir);
}

test('技能兜底只读取枚举中的普通 Markdown', (t) => {
  const f = fixture(t);
  for (const name of ['normal', 'normal.md']) {
    const result = read(f.dir, name);
    assert.equal(result.ok, true);
    assert.equal(result.description, '正常技能');
    assert.match(result.content, /根内正文/);
  }
  assert.equal(read(f.dir, 'missing').ok, false);
});

test('技能兜底拒绝目录外名称及平台异常名称且不返回正文', (t) => {
  const f = fixture(t);
  for (const name of ['../outside', '..\\outside', path.join(f.root, 'outside.md'),
    '/outside', 'C:/outside', 'C:outside', 'normal/../normal', 'normal:stream', 'normal.']) {
    const result = read(f.dir, name);
    assert.equal(result.ok, false, name);
    assert.equal(result.content, undefined);
    assert.doesNotMatch(JSON.stringify(result), /外部正文不得返回/);
  }
});

test('技能兜底拒绝指向根外的符号链接和伪 Markdown 目录', (t) => {
  const f = fixture(t);
  try {
    fs.symlinkSync(path.join(f.root, 'outside.md'), path.join(f.dir, 'linked.md'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('当前 Windows 账户未开放文件符号链接权限');
      return;
    }
    throw error;
  }
  assert.equal(read(f.dir, 'linked').ok, false);
  assert.equal(read(f.dir, 'linked').content, undefined);
  fs.mkdirSync(path.join(f.dir, 'directory.md'));
  assert.equal(read(f.dir, 'directory').ok, false);
  const catalog = handleSkillOpFromPluginDir({ op: 'skillCatalog' }, f.dir);
  assert.equal(catalog.ok, true);
  const linked = catalog.items.find((item) => item.name === 'linked');
  assert.ok(linked);
  assert.notEqual(linked.description, '外部正文不得返回');
  assert.doesNotMatch(JSON.stringify(catalog), /外部正文不得返回/);
});

test('技能根允许自身是目录别名，正文真实路径仍限定根内', (t) => {
  const f = fixture(t), alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(read(alias, 'normal').ok, true);
});
