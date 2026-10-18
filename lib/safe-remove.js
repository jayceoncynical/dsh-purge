import nodeFs from "node:fs";
import path from "node:path";

const RETRYABLE = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);

/**
 * 防御性删除：逐项 unlink / rmdir，绝不把目录链接交给递归删除器。
 *
 * 背景：Electron 桌面版的 resources/app/runtime 是一个指向 resources/runtime 的
 * Windows junction。清理旧解包目录（app.dshpurge-prev）时，原生
 * rmSync(dir, { recursive: true }) 在部分 Electron 版本上会顺着链接进到目标，
 * 把仍在使用的 runtime 一起删掉。
 *
 * 本函数不依赖「原生删除是否会穿链接」这个结论：它先用父目录的 Dirent 判断根项
 * 是不是链接，是就只 unlink 链接本身；目录则逐层下钻，每个子项都重新判断类型。
 * 因此无论宿主行为如何，链接目标都不会被进入。
 */
export function removeTreeSync(target, options = {}, fs = nodeFs) {
  const root = path.resolve(target);
  const parent = path.dirname(root);
  if (root === parent) throw new Error("Refusing to remove a filesystem root");
  const basename = path.basename(root);
  const maxRetries = options.maxRetries ?? 0;
  const retryDelay = options.retryDelay ?? 100;

  function removeEntry(file, entry) {
    try {
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        fs.unlinkSync(file);
        return;
      }
      for (const child of fs.readdirSync(file, { withFileTypes: true })) {
        removeEntry(path.join(file, child.name), child);
      }
      fs.rmdirSync(file);
    } catch (error) {
      // 子项可被其它清理进程先删掉；只跳过这个子项，继续处理兄弟和根目录。
      if (!options.force || error.code !== "ENOENT") throw error;
    }
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const entry = fs.readdirSync(parent, { withFileTypes: true }).find((item) => (
        process.platform === "win32"
          ? item.name.toLowerCase() === basename.toLowerCase()
          : item.name === basename
      ));
      if (!entry) {
        if (options.force) return;
        const error = new Error(`ENOENT: no such file or directory, rm '${root}'`);
        error.code = "ENOENT";
        error.path = root;
        throw error;
      }
      removeEntry(root, entry);
      return;
    } catch (error) {
      if (options.force && error.code === "ENOENT") return;
      if (attempt >= maxRetries || !RETRYABLE.has(error.code)) throw error;
      const delay = retryDelay * (attempt + 1);
      if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
}
