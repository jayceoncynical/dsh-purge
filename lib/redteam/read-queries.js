/**
 * 成果读取查询组（从 store-core.js 拆出，见审查文档 E03 第二块）。
 *
 * 职责：把库里的事实按页面/工具需要的形状读出来——Web 资产清单、攻击链、
 * 凭据、访问会话、WebShell、HTTP 证据、攻击文件及其分组树。
 *
 * 约定：
 *   · 本模块**只读**，所有函数都不写库、不建目录、不记观察；
 *   · 数据访问统一走传入的 RedteamStore 实例（store.db(id) 取句柄，
 *     store.dirOf / slugTarget 等做路径与命名），不持有数据库句柄；
 *   · 对外 API 不变：RedteamStore 上保留同名方法做一行委托，dispatch 与
 *     tools.js / 面板 / 报告的既有调用点零改动。
 *
 * 之所以只搬这一组：它们同属"成果读取"这一条职责边界，且互不依赖写路径，
 * 与写入、计分、报告生成三类逻辑没有交叉，拆分后各自可独立演进。
 */

import { slugTarget } from './ip-utils.js'

/** Web 资产清单：有 URL/标题或常见 Web 端口的资产。 */
export function listWeb(store, id, f = {}) {
  const db = store.db(id)
  const rows = db.prepare(`SELECT p.id AS port_id, p.port, p.proto, p.url, p.title, p.banner, p.provenance, p.tool,
      a.id AS asset_id, a.ip, a.segment_cidr, a.primary_name, a.state,
      s.name AS service, s.product, s.version
    FROM port p JOIN asset a ON a.id = p.asset_id
    LEFT JOIN service s ON s.id = (SELECT MAX(current.id) FROM service current WHERE current.port_id = p.id)
    WHERE p.state = 'open' AND (
      p.url IS NOT NULL OR p.title IS NOT NULL
      OR s.name IN ('http', 'https', 'http-proxy', 'ssl/http')
      OR p.port IN (80, 81, 443, 8000, 8001, 8080, 8081, 8082, 8443, 8888, 9090, 7001, 9000, 9443)
    )
    ORDER BY a.ip_int, p.port`).all()
  const filtered = f.cidr ? rows.filter((r) => r.segment_cidr === f.cidr) : rows
  const limited = f.limit ? filtered.slice(0, Number(f.limit)) : filtered
  return { total: filtered.length, items: limited }
}

/** 攻击链全部步骤，按 seq 排序（步骤写入口在 store-core 的 addChainStep）。 */
export function listChain(store, id) {
  return store.db(id).prepare(`SELECT s.*, a.ip AS asset_ip, v.title AS vuln_title, v.severity AS vuln_severity, v.cve AS vuln_cve
    FROM attack_step s
    LEFT JOIN asset a ON a.id = s.asset_id
    LEFT JOIN vuln v ON v.id = s.vuln_id
    ORDER BY s.seq, s.id`).all()
}

/** 凭据清单：按 host / username 过滤，可选只看带密钥值的条目。 */
export function listCredentials(store, id, f = {}) {
  const db = store.db(id)
  const where = []
  const args = []
  if (f.host) { where.push('host = ?'); args.push(f.host) }
  if (f.username) { where.push('username = ?'); args.push(f.username) }
  if (f.withValue === true) where.push("COALESCE(secret_value,'') <> ''")
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(Number(f.limit) || 200, 1000)
  return db.prepare(`SELECT * FROM credential ${clause} ORDER BY id DESC LIMIT ?`).all(...args, limit)
}

/** 访问会话清单：一次可控访问（横向移动的起点）。 */
export function listAccess(store, id, f = {}) {
  const db = store.db(id)
  const where = []
  const args = []
  if (f.host) { where.push('host = ?'); args.push(f.host) }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(Number(f.limit) || 200, 1000)
  return db.prepare(`SELECT * FROM access_session ${clause} ORDER BY id DESC LIMIT ?`).all(...args, limit)
}

/** WebShell 清单，带上资产 IP 便于面板直接展示。 */
export function listWebshells(store, id, f = {}) {
  const db = store.db(id)
  const where = []
  const args = []
  if (f.status) { where.push('status = ?'); args.push(f.status) }
  if (f.asset_id) { where.push('asset_id = ?'); args.push(f.asset_id) }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(Number(f.limit) || 200, 1000)
  return db.prepare(`SELECT w.*, a.ip AS asset_ip FROM webshell w
    LEFT JOIN asset a ON a.id = w.asset_id ${clause} ORDER BY w.id DESC LIMIT ?`).all(...args, limit)
}

/** HTTP 证据（Burp / Yakit 可复现的原始请求响应）。 */
export function listHttpEvidence(store, id, f = {}) {
  const db = store.db(id)
  const where = []
  const args = []
  if (f.vuln_id !== undefined && f.vuln_id !== null) { where.push('vuln_id = ?'); args.push(Number(f.vuln_id)) }
  if (f.asset_id !== undefined && f.asset_id !== null) { where.push('asset_id = ?'); args.push(Number(f.asset_id)) }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const limit = Math.min(Number(f.limit) || 100, 500)
  return db.prepare(`SELECT * FROM http_evidence ${clause} ORDER BY id DESC LIMIT ?`).all(...args, limit)
}

/** 攻击文件清单：按 target / kind 过滤。 */
export function listAttackFiles(store, id, f = {}) {
  const db = store.db(id)
  const where = []
  const args = []
  if (f.target) { where.push('target = ?'); args.push(f.target) }
  if (f.kind) { where.push('kind = ?'); args.push(f.kind) }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''
  return db.prepare(`SELECT * FROM attack_file ${clause} ORDER BY target, name`).all(...args)
}

/** 攻击文件按目标分组（每个 IP / URL / C 段一个文件夹）。 */
export function attackFileTree(store, id) {
  const groups = new Map()
  for (const row of listAttackFiles(store, id, {})) {
    if (!groups.has(row.target)) groups.set(row.target, { target: row.target, folder: slugTarget(row.target), count: 0, files: [] })
    const g = groups.get(row.target)
    g.files.push(row)
    g.count++
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.target.localeCompare(b.target))
}
