import { promises as fs } from "node:fs";
import path from "node:path";

// 与 package.json 的 files 正向条目一致；package.json 由包管理器隐式包含。
export const COPY_NAMES = Object.freeze([
  "lib", "bin", "docs", "presets", "skills", "scripts", "client.js",
  "cordis.patch.yml", "screenshots.json", "package.json", "README.md", "README.zh-CN.md", "LICENSE",
]);
const DIRECTORY_NAMES = new Set(["lib", "bin", "docs", "presets", "skills", "scripts"]);
const PREFIX = ".update-files-";
const REQUIRED_ENTRIES = ["lib/index.js", "bin/dsh-purge.js", "client.js"];

async function stat(file) {
  try { return await fs.lstat(file); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function inspect_tree(file) {
  const info = await fs.lstat(file);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
    throw new Error(`更新资源不是普通文件或目录：${file}`);
  }
  if (info.isDirectory()) {
    const names = await fs.readdir(file);
    if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
      throw new Error(`更新目录包含大小写冲突：${file}`);
    }
    for (const name of names) await inspect_tree(path.join(file, name));
  }
}

/** 只读取已解包目录，不导入或执行其中的代码。 */
export async function validateUpdateDirectory(source, { packageName = "dsh-purge", requiredEntries = REQUIRED_ENTRIES } = {}) {
  const root = await fs.realpath(source);
  const names = await fs.readdir(root);
  for (const name of COPY_NAMES) {
    if (names.filter((item) => item.toLowerCase() === name.toLowerCase()).length > 1) {
      throw new Error(`更新资源缺失或大小写冲突：${name}`);
    }
    const info = await fs.lstat(path.join(root, name));
    if (DIRECTORY_NAMES.has(name) ? !info.isDirectory() : !info.isFile()) {
      throw new Error(`更新资源类型不匹配：${name}`);
    }
    await inspect_tree(path.join(root, name));
  }
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (pkg.name !== packageName || typeof pkg.version !== "string"
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error("更新包名称或版本无效");
  }
  for (const entry of requiredEntries) {
    if (typeof entry !== "string" || entry.includes("\\") || entry.split("/").some((part) => !part || part === "." || part === "..")
      || !COPY_NAMES.includes(entry.split("/")[0])) throw new Error("必需入口不属于受管资源");
    if (!(await fs.lstat(path.join(root, entry))).isFile()) throw new Error(`缺少更新入口：${entry}`);
  }
  return { name: pkg.name, version: pkg.version };
}

async function append(journal, record) {
  const handle = await fs.open(journal, "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
}

async function read_journal(journal) {
  const lines = (await fs.readFile(journal, "utf8")).split("\n");
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    try { records.push(JSON.parse(lines[i])); } catch (error) {
      // 最后一次写入可能被打断；其后的 rename 尚未开始。
      if (i === lines.length - 1) break;
      throw error;
    }
  }
  return records;
}

function nested(a, b) {
  const relative = path.relative(a, b);
  return relative !== "" && relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
}

function checked_header(records, transactionDir) {
  const header = records[0];
  if (header?.type !== "begin" || header.format !== 1 || !Array.isArray(header.targets) || !header.targets.length) {
    throw new Error(`事务日志损坏，保留供人工处理：${transactionDir}`);
  }
  for (const target of header.targets) {
    if (typeof target.dest !== "string" || !path.isAbsolute(target.dest)
      || typeof target.work !== "string" || path.dirname(target.work) !== target.dest
      || !path.basename(target.work).startsWith(PREFIX) || !Array.isArray(target.entries)
      || target.entries.length !== COPY_NAMES.length || new Set(target.entries.map((entry) => entry.name)).size !== COPY_NAMES.length
      || target.entries.some((entry) => !COPY_NAMES.includes(entry.name) || typeof entry.hadOld !== "boolean")) {
      throw new Error("事务日志路径或资源清单无效，未执行恢复");
    }
  }
  if (header.targets[0].work !== transactionDir) throw new Error("事务日志位置不匹配");
  if (new Set(header.targets.map((target) => target.dest.toLowerCase())).size !== header.targets.length
    || header.targets.some((a) => header.targets.some((b) => nested(a.dest, b.dest)))) {
    throw new Error("事务目标重复或嵌套，未执行恢复");
  }
  return header;
}

async function cleanup(header, coordinator) {
  // 协调日志最后删除；其他目标清理失败时仍能再次发现该事务。
  for (const target of header.targets.filter((target) => target.work !== coordinator)) {
    await fs.rm(target.work, { recursive: true, force: true });
  }
  await fs.rm(coordinator, { recursive: true, force: true });
}

async function rollback(header, records, journal, fault) {
  const errors = [];
  const completed = new Set(records.filter((record) => record.type === "restored").map((record) => `${record.target}:${record.name}`));
  const intents = records.filter((record) => record.type === "intent");
  const unique = new Set();
  for (const intent of intents) {
    const key = `${intent.target}:${intent.name}`;
    if (!Number.isSafeInteger(intent.target) || intent.target < 0 || !header.targets[intent.target]
      || !COPY_NAMES.includes(intent.name) || unique.has(key)) throw new Error("事务日志包含无效或重复动作");
    unique.add(key);
  }
  for (const intent of intents.reverse()) {
    if (completed.has(`${intent.target}:${intent.name}`)) continue;
    const target = header.targets[intent.target];
    if (!target || !COPY_NAMES.includes(intent.name)) throw new Error("事务日志包含未知资源");
    const entry = target.entries.find((item) => item.name === intent.name);
    const live = path.join(target.dest, entry.name);
    const staged = path.join(target.work, "stage", entry.name);
    const old = path.join(target.work, "backup", entry.name);
    try {
      await fault?.("rollback", { dest: target.dest, name: entry.name });
      const oldInfo = await stat(old);
      const stageInfo = await stat(staged);
      const liveInfo = await stat(live);
      if ([oldInfo, stageInfo, liveInfo].some((info) => info?.isSymbolicLink())) {
        throw new Error(`恢复资源出现链接：${live}`);
      }
      if (oldInfo) {
        // 不覆盖异常冲突，也不删除唯一备份。
        if (liveInfo && stageInfo) throw new Error(`恢复路径冲突：${live}`);
        if (liveInfo) await fs.rename(live, staged);
        await fs.rename(old, live);
        await fault?.("after-restore", { dest: target.dest, name: entry.name });
      } else if (!entry.hadOld && !stageInfo && liveInfo) {
        await fs.rename(live, staged);
      } else if (entry.hadOld && (!liveInfo || !stageInfo)) {
        throw new Error(`旧资源与备份状态不完整：${live}`);
      }
      await append(journal, { type: "restored", target: intent.target, name: intent.name });
    } catch (error) { errors.push(`${live}: ${error.message}`); }
  }
  if (errors.length) {
    await append(journal, { type: "rollback-failed", errors });
    throw new Error(`更新回滚未完成，保留日志 ${journal}；${errors.join("；")}`);
  }
  await append(journal, { type: "rolled-back" });
}

/**
 * 恢复策略：没有全局 committed 记录就整体回滚；有则仅清理备份。
 * 日志在 rename 前追加并 fsync，结合 stage/backup/live 的存在性处理动作后中断。
 * 这不是多文件可见性的原子切换：提交期间读者可看到混合版本，应停止并发写入/使用。
 * 不提供断电后的目录元数据持久性保证，不对抗外部修改或恶意篡改日志；恢复须在原路径、
 * 原卷且所有目标可用时由单一调用者执行。applyUpdate 的进程内锁不防多进程并发；
 * 调用者必须跨进程串行化。准备期中断或日志损坏将停止并要求人工检查，不猜测提交。
 * 回滚/清理失败保留日志，不删除唯一旧备份。
 */
export async function recoverUpdateTransaction(transactionDir, { fault } = {}) {
  const coordinator = path.resolve(transactionDir);
  const journal = path.join(coordinator, "journal.jsonl");
  const records = await read_journal(journal);
  const header = checked_header(records, coordinator);
  // 多目标恢复前先确认每个原安装根仍可访问，避免把离线目标当作已清理。
  for (const target of header.targets) {
    if (await fs.realpath(target.dest) !== target.dest || !(await fs.stat(target.dest)).isDirectory()) {
      throw new Error(`事务目标已变更，保留日志：${target.dest}`);
    }
    const info = await stat(target.work);
    if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new Error(`事务目录已变更：${target.work}`);
  }
  if (!records.some((record) => record.type === "committed" || record.type === "rolled-back")) {
    // 动作仅在带换行日志写入并同步后开始；移除未完成尾写再追加恢复记录。
    const raw = await fs.readFile(journal, "utf8");
    if (!raw.endsWith("\n")) {
      const complete = raw.slice(0, raw.lastIndexOf("\n") + 1);
      const handle = await fs.open(journal, "r+");
      try { await handle.truncate(Buffer.byteLength(complete)); await handle.sync(); } finally { await handle.close(); }
    }
    await rollback(header, records, journal, fault);
  }
  await cleanup(header, coordinator);
  return { recovered: true, committed: records.some((record) => record.type === "committed") };
}

/** 在给定安装根发现上次中断；不能找到协调日志时停止而非猜测恢复。 */
export async function recoverPendingUpdates(destinations, options = {}) {
  const seen = new Set();
  for (const destination of destinations) {
    const dest = await fs.realpath(destination);
    for (const name of await fs.readdir(dest)) {
      if (!name.startsWith(PREFIX)) continue;
      const work = path.join(dest, name);
      if (!(await fs.lstat(work)).isDirectory() || (await fs.lstat(work)).isSymbolicLink()) throw new Error(`无效事务目录：${work}`);
      const pointer = path.join(work, "coordinator.json");
      let coordinator;
      if (await stat(path.join(work, "journal.jsonl"))) coordinator = work;
      else if (await stat(pointer)) coordinator = JSON.parse(await fs.readFile(pointer, "utf8")).coordinator;
      else throw new Error(`不完整事务准备目录，需人工检查：${work}`);
      if (typeof coordinator !== "string" || !path.isAbsolute(coordinator)) throw new Error(`无效事务指针：${work}`);
      if (seen.has(coordinator)) continue;
      const header = checked_header(await read_journal(path.join(coordinator, "journal.jsonl")), coordinator);
      if (!header.targets.some((target) => target.dest === dest && target.work === work)) {
        throw new Error(`事务指针与目标不匹配：${work}`);
      }
      seen.add(coordinator);
      await recoverUpdateTransaction(coordinator, options);
    }
  }
}

/** 完整 stage/预检所有目标后才提交；fault 仅用于临时目录故障注入。 */
export async function installUpdateFiles(source, destinations, { fault, ...validation } = {}) {
  const unique = new Map();
  for (const dest of destinations) {
    const root = await fs.realpath(dest);
    unique.set(process.platform === "win32" ? root.toLowerCase() : root, root);
  }
  const roots = [...unique.values()];
  if (!roots.length) return { installed: false };
  for (const a of roots) {
    if (!(await fs.stat(a)).isDirectory()) throw new Error(`安装根不是目录：${a}`);
    for (const b of roots) {
      if (nested(a, b)) {
        throw new Error("安装目标不能相互嵌套");
      }
    }
  }
  await recoverPendingUpdates(roots, { fault });
  const sourceRoot = await fs.realpath(source);
  if (roots.some((dest) => dest === sourceRoot || nested(dest, sourceRoot) || nested(sourceRoot, dest))) {
    throw new Error("解包来源与安装目标不能相同或嵌套");
  }
  const pkg = await validateUpdateDirectory(sourceRoot, validation);
  const header = { type: "begin", format: 1, package: pkg, targets: [] };
  let journal;
  let committed = false;
  try {
    for (const dest of roots) {
      const work = await fs.mkdtemp(path.join(dest, PREFIX));
      const target = { dest, work, entries: [] };
      header.targets.push(target);
      await fs.mkdir(path.join(work, "stage"));
      await fs.mkdir(path.join(work, "backup"));
      for (const name of COPY_NAMES) {
        await fault?.("stage", { dest, name });
        const current = await stat(path.join(dest, name));
        // 顶层受管链接不跟随；根本身可由 pnpm 链接解析至真实目录。
        if (current?.isSymbolicLink()) throw new Error(`受管资源不能是链接：${path.join(dest, name)}`);
        target.entries.push({ name, hadOld: Boolean(current) });
        await fs.cp(path.join(sourceRoot, name), path.join(work, "stage", name), { recursive: true, force: false, errorOnExist: true });
      }
      await validateUpdateDirectory(path.join(work, "stage"), validation);
    }
    const coordinator = header.targets[0].work;
    journal = path.join(coordinator, "journal.jsonl");
    await append(journal, header);
    for (const target of header.targets) {
      const pointer = await fs.open(path.join(target.work, "coordinator.json"), "wx");
      try {
        await pointer.writeFile(JSON.stringify({ coordinator }));
        await pointer.sync();
      } finally { await pointer.close(); }
    }
    for (let i = 0; i < header.targets.length; i += 1) {
      const target = header.targets[i];
      for (const entry of target.entries) {
        await append(journal, { type: "intent", target: i, name: entry.name });
        await fault?.("commit", { dest: target.dest, name: entry.name });
        const live = path.join(target.dest, entry.name);
        if (entry.hadOld) await fs.rename(live, path.join(target.work, "backup", entry.name));
        await fault?.("after-backup", { dest: target.dest, name: entry.name });
        await fs.rename(path.join(target.work, "stage", entry.name), live);
        await fault?.("after-install", { dest: target.dest, name: entry.name });
      }
    }
    await append(journal, { type: "committed" });
    committed = true;
    await cleanup(header, coordinator);
    return { installed: true, ...pkg };
  } catch (error) {
    if (journal) {
      if (!committed) {
        try { await recoverUpdateTransaction(header.targets[0].work, { fault }); } catch (recoveryError) {
          throw new AggregateError([error, recoveryError], `${error.message}；${recoveryError.message}`);
        }
      }
      // 提交标记已落盘时不能再回滚：下次恢复只重试清理。
      else throw new Error(`文件已提交，备份清理未完成；保留日志 ${journal}：${error.message}`, { cause: error });
    } else {
      for (const target of header.targets) await fs.rm(target.work, { recursive: true, force: true });
    }
    throw error;
  }
}
