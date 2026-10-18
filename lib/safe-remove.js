import nodeFs from "node:fs";
import path from "node:path";

const RETRYABLE = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);

/**
 * Electron 的 recursive rm 会进入 Windows junction 的目标；original-fs 也不能规避。
 * 使用父目录的 Dirent 识别根链接，逐项 unlink，绝不把链接交给递归删除器。
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
