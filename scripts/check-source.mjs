import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? collect(file) : /\.(?:js|mjs)$/.test(entry.name) ? [file] : [];
  });
}
const files = ['lib', 'bin', 'scripts', 'tests'].flatMap((dir) => collect(path.join(root, dir)));
files.push(path.join(root, 'client.js'));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`源码语法检查通过：${files.length} 个文件`);
