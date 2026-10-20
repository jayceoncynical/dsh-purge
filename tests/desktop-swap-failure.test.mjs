import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// 只解析生成文本，绝不运行终止进程、换包或启动宿主的脚本。
const text = fs.readFileSync(new URL('../lib/desktop.js', import.meta.url), 'utf8');
const start = text.indexOf('const ASAR_SWAP_PS1 = [');
const end = text.indexOf('\nconst ASAR_RENAME_WHEN_IDLE_PS1', start);
const ctx = vm.createContext({});
vm.runInContext(text.slice(start, end) + '\nglobalThis.script = ASAR_SWAP_PS1;', ctx);

test('关键归档移动必须产生终止错误且成功前验证源和备份', () => {
  assert.match(ctx.script, /Move-Item -LiteralPath \$AsarPath -Destination \$bak -Force -ErrorAction Stop/);
  const verify = ctx.script.indexOf("throw 'Archive rename verification failed'");
  const success = ctx.script.indexOf('$moved = $true');
  assert.ok(verify > 0 && verify < success);
  assert.match(ctx.script, /Test-Path -LiteralPath \$bak -PathType Leaf/);
  assert.match(ctx.script, /\} else \{\r?\n\s+Set-Content -LiteralPath \$lock/);
});
