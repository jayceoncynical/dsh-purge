import fs from "node:fs";
import path from "node:path";

/** 归档使用正斜杠相对路径；同时拒绝会被 Windows 重解释的名称。 */
export function safeRelativePath(name, { directory = false } = {}) {
  if (typeof name !== "string" || !name || /[\\\x00-\x1f\x7f:*?"<>|]/.test(name)
    || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw new Error("路径不合法");
  }
  const rel = directory && name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[ .]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error("路径不合法");
  }
  return parts.join("/");
}

export function isPathInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + path.sep));
}

/** 写入不跟随任何现存链接，包括目标根的祖先和文件本身。 */
export function assertSafeOutputPath(root, rel = "", io = fs) {
  const base = path.resolve(root);
  const target = rel ? path.resolve(base, safeRelativePath(rel)) : base;
  if (!isPathInside(base, target)) throw new Error("路径越界");
  const parsed = path.parse(target);
  let current = parsed.root;
  const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = io.lstatSync(current); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("输出路径包含符号链接");
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error("输出父路径不是目录");
    if (i === parts.length - 1 && !stat.isDirectory() && !stat.isFile()) throw new Error("输出不是普通文件或目录");
  }
  return target;
}

/** 所有名称及文件/目录冲突在落盘前验证，大小写按跨平台的严格口径处理。 */
export function validateEntryPaths(entries) {
  const seen = new Map();
  for (const entry of entries) {
    entry.rel = safeRelativePath(entry.rel, { directory: entry.directory });
    const key = entry.rel.toLowerCase();
    if (seen.has(key)) throw new Error("归档路径重复");
    seen.set(key, entry);
  }
  for (const entry of entries) {
    const parts = entry.rel.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const parent = seen.get(parts.slice(0, i).join("/"));
      if (parent && !parent.directory) throw new Error("归档文件与目录冲突");
    }
  }
  return entries;
}

/** 只读枚举中的单层成员；解析链接后仍须是根内的普通文件。 */
export function resolveListedFile(root, file, members, io = fs) {
  const rel = safeRelativePath(file);
  if (rel.includes("/") || !members.includes(rel)) throw new Error("文件不在枚举清单中");
  const realRoot = io.realpathSync(root);
  const realFile = io.realpathSync(path.join(realRoot, rel));
  if (!isPathInside(realRoot, realFile) || !io.statSync(realFile).isFile()) {
    throw new Error("文件真实路径越界或不是普通文件");
  }
  return realFile;
}
