import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assertSafeOutputPath, safeRelativePath, validateEntryPaths } from "./path-boundary.js";

const HIDDEN = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true,
  timeout: 60000,
};

/** 各平台解压顺序。node 不调用外部命令。 */
export function unzipTools(platform = process.platform) {
  if (platform === "win32") return ["tar", "powershell", "node"];
  return ["tar", "unzip", "python3", "bsdtar", "node"];
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new Error("不是 zip 或数据被截断");
}

function checkExtra(buf, start, end, rawName) {
  let nodeOnly = false;
  while (start < end) {
    if (start + 4 > end) throw new Error("zip 扩展元数据损坏");
    const tag = buf.readUInt16LE(start);
    const next = start + 4 + buf.readUInt16LE(start + 2);
    if (next > end) throw new Error("zip 扩展元数据损坏");
    // 外部解压器可能采用另一套名称、链接或 ZIP64 元数据；不允许解析口径分叉。
    if ([0x0001, 0x000d, 0x5855, 0x756e].includes(tag)) throw new Error("不支持的 zip 路径元数据");
    if (tag === 0x7075) {
      if (next - start < 9 || buf[start + 4] !== 1
        || !buf.subarray(start + 9, next).equals(rawName)) throw new Error("zip Unicode 路径元数据不一致");
      nodeOnly = true;
    }
    start = next;
  }
  return nodeOnly;
}

function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("不是 zip");
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralStart = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt16LE(eocd + 4) || buf.readUInt16LE(eocd + 6)
    || buf.readUInt16LE(eocd + 8) !== total || total === 0xffff
    || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error("不支持分卷或 zip64");
  if (centralStart + centralSize !== eocd) throw new Error("zip 目录范围损坏");
  let cursor = centralStart;
  const entries = [];
  const ranges = [];
  for (let n = 0; n < total; n += 1) {
    if (cursor + 46 > eocd || buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error("zip 目录损坏");
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const next = cursor + 46 + nameLen + extraLen + buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    if (next > eocd || !nameLen || buf.readUInt16LE(cursor + 34)) throw new Error("zip 目录损坏");
    if ([compSize, size, localOffset].includes(0xffffffff)) throw new Error("不支持 zip64");
    if (flags & ~0x080e || flags & 1) throw new Error("不支持加密或特殊 zip 标记");
    if (method !== 0 && method !== 8) throw new Error(`不支持的 zip 压缩方式 ${method}`);
    const rawName = buf.subarray(cursor + 46, cursor + 46 + nameLen);
    const name = rawName.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(rawName)) throw new Error("zip 名称编码不明确");
    let nodeOnly = !(flags & 0x800) && rawName.some((b) => b >= 128);
    const attrs = buf.readUInt32LE(cursor + 38);
    const type = (attrs >>> 16) & 0xf000;
    if (type && type !== 0x8000 && type !== 0x4000) throw new Error("zip 链接或特殊文件不受支持");
    if (type === 0x8000 && (name.endsWith("/") || attrs & 0x10)) throw new Error("zip 文件类型不一致");
    if (attrs & 0x400) throw new Error("zip 重解析点不受支持");
    const directory = name.endsWith("/") || type === 0x4000 || Boolean(attrs & 0x10);
    const rel = safeRelativePath(name, { directory });
    nodeOnly = checkExtra(buf, cursor + 46 + nameLen, cursor + 46 + nameLen + extraLen, rawName) || nodeOnly;
    if (localOffset + 30 > centralStart || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("zip 本地头损坏");
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const end = start + compSize;
    if (start > centralStart || end > centralStart
      || !buf.subarray(localOffset + 30, localOffset + 30 + localNameLen).equals(rawName)
      || buf.readUInt16LE(localOffset + 6) !== flags || buf.readUInt16LE(localOffset + 8) !== method) {
      throw new Error("zip 本地头与目录不一致或数据被截断");
    }
    if (!(flags & 8) && (buf.readUInt32LE(localOffset + 18) !== compSize || buf.readUInt32LE(localOffset + 22) !== size)) {
      throw new Error("zip 本地数据大小不一致");
    }
    nodeOnly = checkExtra(buf, localOffset + 30 + localNameLen, start, rawName) || nodeOnly;
    if (directory && size !== 0) throw new Error("zip 目录包含文件数据");
    ranges.push([localOffset, end]);
    entries.push({ name, rel, directory, method, compSize, size, start, end });
    cursor = next;
  }
  if (cursor !== eocd) throw new Error("zip 目录长度不一致");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i][0] < ranges[i - 1][1]) throw new Error("zip 条目范围重叠");
  }
  return validateEntryPaths(entries);
}

export function listZipEntries(buf) {
  return readZipEntries(buf).map((entry) => entry.name);
}

export function listZipFile(zipPath) {
  return listZipEntries(fs.readFileSync(zipPath));
}

function extractEntries(buf, dest, entries) {
  for (const entry of entries) assertSafeOutputPath(dest, entry.rel);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const out = assertSafeOutputPath(dest, entry.rel);
    if (entry.directory) {
      fs.mkdirSync(out, { recursive: true });
      continue;
    }
    const compressed = buf.subarray(entry.start, entry.end);
    const body = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed);
    if (body.length !== entry.size) throw new Error("zip 解压大小不一致");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    assertSafeOutputPath(dest, entry.rel);
    fs.writeFileSync(out, body);
  }
}

export function extractZipBuffer(buf, dest) {
  extractEntries(buf, dest, readZipEntries(buf));
}

function attempt(file, args, extra = {}) {
  try {
    execFileSync(file, args, { ...HIDDEN, stdio: ["ignore", "pipe", "pipe"], ...extra });
    return "";
  } catch (error) {
    const detail = String((error && (error.stderr || error.stdout || error.message)) || "")
      .trim().split(/\r?\n/).filter(Boolean)[0];
    return detail ? `${file}: ${detail}` : file;
  }
}

function checkExtractedTree(root, entries) {
  const allowed = new Map(entries.map((entry) => [entry.rel, entry.directory]));
  for (const entry of entries) {
    const parts = entry.rel.split("/");
    for (let i = 1; i < parts.length; i += 1) allowed.set(parts.slice(0, i).join("/"), true);
  }
  const found = new Set();
  const walk = (dir, prefix = "") => {
    for (const name of fs.readdirSync(dir)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const file = assertSafeOutputPath(root, rel);
      const stat = fs.lstatSync(file);
      if (!allowed.has(rel) || (!stat.isDirectory() && !stat.isFile()) || stat.isDirectory() !== allowed.get(rel)) {
        throw new Error("解压结果与预检清单不一致");
      }
      found.add(rel);
      if (stat.isDirectory()) walk(file, rel);
    }
  };
  walk(root);
  if (entries.some((entry) => !found.has(entry.rel))) throw new Error("解压结果缺少条目");
}

/** 所有工具共享预检，每次在独立空目录尝试，失败残留不进入下一次尝试。 */
export function extractZipArchive(zipPath, dest, tools = unzipTools()) {
  const buf = fs.readFileSync(zipPath);
  const entries = readZipEntries(buf);
  for (const entry of entries) assertSafeOutputPath(dest, entry.rel);
  assertSafeOutputPath(dest);
  if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) throw new Error("解压目标不是目录");
  for (const entry of entries) {
    const out = assertSafeOutputPath(dest, entry.rel);
    if (fs.existsSync(out) && (!entry.directory || !fs.statSync(out).isDirectory())) {
      throw new Error("解压条目与已有目标冲突");
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  const notes = [];
  const workspace = fs.mkdtempSync(path.join(path.dirname(path.resolve(dest)), ".zip-extract-"));
  const snapshot = path.join(workspace, "archive.zip");
  try {
    fs.writeFileSync(snapshot, buf, { flag: "wx" });
    for (const tool of tools) {
      const stage = fs.mkdtempSync(path.join(workspace, "attempt-"));
      try {
        let note;
        if (tool === "node") extractEntries(buf, stage, entries);
        else if (tool === "tar" || tool === "bsdtar") note = attempt(tool, ["-xf", snapshot, "-C", stage]);
        else if (tool === "unzip") note = attempt("unzip", ["-o", "-q", snapshot, "-d", stage]);
        else if (tool === "python3") note = attempt("python3", ["-m", "zipfile", "-e", snapshot, stage]);
        else if (tool === "powershell") note = attempt("powershell",
          ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:DSH_UPD_ZIP -DestinationPath $env:DSH_UPD_DIR -Force"],
          { env: { ...process.env, DSH_UPD_ZIP: snapshot, DSH_UPD_DIR: stage } });
        else throw new Error("未知解压工具");
        if (note) throw new Error(note);
        checkExtractedTree(stage, entries);
        assertSafeOutputPath(dest);
        // 发布前重新检查目标；已有的无关文件（例如下载的 ZIP）保持不动。
        for (const entry of entries) {
          const out = assertSafeOutputPath(dest, entry.rel);
          if (fs.existsSync(out) && (!entry.directory || !fs.statSync(out).isDirectory())) {
            throw new Error("解压条目与已有目标冲突");
          }
        }
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of entries.filter((item) => item.directory)) {
          fs.mkdirSync(assertSafeOutputPath(dest, entry.rel), { recursive: true });
        }
        const copied = [];
        try {
          for (const entry of entries.filter((item) => !item.directory)) {
            const out = assertSafeOutputPath(dest, entry.rel);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.copyFileSync(path.join(stage, ...entry.rel.split("/")), out, fs.constants.COPYFILE_EXCL);
            copied.push(entry.rel);
          }
        } catch (error) {
          for (const rel of copied.reverse()) fs.unlinkSync(assertSafeOutputPath(dest, rel));
          throw error;
        }
        return tool;
      } catch (error) {
        notes.push(`${tool}: ${error && error.message ? error.message : error}`);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    }
    throw new Error(`解压失败：${notes.join(" | ") || "没有可用的解压工具"}`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
