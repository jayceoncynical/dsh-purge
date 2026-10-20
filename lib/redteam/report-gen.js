/**
 * 成果报告生成（从 store-core.js 拆出，见审查文档 E03 第一块）。
 *
 * 这里只做「把库里的事实编排成报告」：按目标分组的成果视图（reportTargets）
 * 与整份 Markdown 成果报告（report）。数据读取全部走传入的 RedteamStore 实例，
 * 本模块不持有数据库句柄、不写库。
 *
 * 对外 API 不变：RedteamStore 上保留同名方法做一行委托（见 store-core.js），
 * dispatch 路径与既有调用方零改动。
 *
 * ── 刻意的 ESM 循环依赖说明 ──────────────────────────────────────────
 * 本模块从 store-core.js 导入 readMeta（元数据解析，被 store-core 内多个方法
 * 共用，不属于报告独占，因此留在原处）；store-core.js 反过来从本模块导入
 * generateReport / generateReportTargets。这是有意的循环，安全性依据：
 *   · readMeta 是 function declaration，经 ESM live binding 导出；
 *   · 本模块的顶层代码不调用 readMeta —— 它只在 report 生成函数体内被引用，
 *     而那些函数最早也要等 RedteamStore 实例方法被调用时才执行，
 *     那时两个模块的初始化均已完成，绑定已落实；
 *   · 本模块顶层也不引用 store-core 的任何类或常量，不存在初始化顺序敏感。
 */

import { slugTarget, nowIso } from './ip-utils.js'
import { readMeta } from './store-core.js'

/**
 * 按目标分组的成果报告：每个 IP / URL / C 段一份，供界面展开收起。
 * 收录口径与 report() 一致（已验证/已利用且中危以上）。
 */
export function generateReportTargets(store, id, options = {}) {
  const meta = readMeta(store.metaPathOf(id)) || {}
  const includeAll = options.all === true
  const allVulns = store.listVulns(id, { limit: 2000 }).items
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  const isResult = (v) => v.status === 'confirmed' || v.status === 'exploited'
  const isReal = (v) => v.severity === 'critical' || v.severity === 'high' || v.severity === 'medium'
  const vulns = (includeAll ? allVulns : allVulns.filter((v) => isResult(v) && isReal(v)))
    .slice().sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
  const chain = store.listChain(id)
  const creds = store.listCredentials(id, {})
  const access = store.listAccess(id, {})
  const files = store.listAttackFiles(id, {})

  const targets = new Map()
  const ensure = (key) => {
    if (!targets.has(key)) {
      targets.set(key, { key, label: key, kind: /^\d{1,3}(\.\d{1,3}){3}$/.test(key) ? 'ip' : 'host', segment: '', vulns: [], chain: [], access: [], creds: [], files: [] })
    }
    return targets.get(key)
  }
  const assetIpOf = (assetId) => {
    if (assetId === null || assetId === undefined) return undefined
    const asset = store.getAsset(id, assetId)
    return asset === undefined ? undefined : asset.ip
  }
  for (const v of vulns) {
    const key = v.asset_ip || (v.target ? slugTarget(v.target) : '未归属目标')
    const g = ensure(key)
    g.vulns.push(v)
    if (g.segment === '' && v.segment_cidr) g.segment = v.segment_cidr
  }
  for (const a of access) {
    const key = assetIpOf(a.asset_id) || slugTarget(a.host)
    const g = ensure(key)
    g.access.push(a)
    if (g.segment === '') { const asset = a.asset_id === null || a.asset_id === undefined ? undefined : store.getAsset(id, a.asset_id); if (asset && asset.segment_cidr) g.segment = asset.segment_cidr }
  }
  for (const c of creds) ensure(assetIpOf(c.asset_id) || slugTarget(c.host)).creds.push(c)
  for (const f of files) ensure(assetIpOf(f.asset_id) || slugTarget(f.target)).files.push(f)
  for (const st of chain) if (st.asset_ip) ensure(st.asset_ip).chain.push(st)

  const renderVuln = (v) => {
    const out = []
    out.push(`#### [${(v.severity || 'info').toUpperCase()}] ${v.cve ? v.cve + ' — ' : ''}${v.title || ''}`, '')
    out.push(`- 目标：${v.target || '—'}`)
    out.push(`- 状态：${v.status === 'exploited' ? '已成功利用' : '已验证'} · 置信度：${v.confidence === null || v.confidence === undefined ? '—' : v.confidence} · 发现方式：${v.source || '—'}`)
    out.push(`- 危害与证据：${v.evidence || '—'}`)
    const evidence = store.listHttpEvidence(id, { vuln_id: v.id })
    if (evidence.length) {
      out.push('', '**复现请求（可直接粘贴进 Burp Suite / Yakit）**：', '')
      for (const e of evidence) {
        out.push(`*${e.label || e.method + ' ' + (e.url || '')}*`, '')
        if (e.request) out.push('```http', e.request.replace(/\r/g, '').trim(), '```', '')
        if (e.response) out.push('响应摘要：', '```http', String(e.response).replace(/\r/g, '').trim().slice(0, 2000), '```', '')
      }
    }
    out.push('')
    return out
  }

  const groups = new Map()
  const list = []
  for (const g of targets.values()) {
    const lines = []
    lines.push(`## ${g.label}${g.segment ? '（' + g.segment + '）' : ''}`, '')
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const v of g.vulns) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1
    lines.push(`- 成果：漏洞 ${g.vulns.length} 个（严重 ${bySeverity.critical} · 高危 ${bySeverity.high} · 中危 ${bySeverity.medium}）· 已控 ${g.access.length} · 凭据 ${g.creds.length} · 攻击文件 ${g.files.length}`, '')
    if (g.vulns.length) { lines.push('### 成果漏洞', ''); for (const v of g.vulns) lines.push(...renderVuln(v)) }
    if (g.access.length) {
      lines.push('### 已获得权限', '')
      for (const a of g.access) lines.push(`- ${a.host} · ${a.username || '—'} · ${a.method || '—'} · ${a.privilege || '—'} · ${a.session_ref || ''}`)
      lines.push('')
    }
    if (g.creds.length) {
      lines.push('### 凭据', '')
      for (const c of g.creds) lines.push(`- ${c.host} · ${c.username || '—'} · ${c.secret_type || '—'} · ${c.privilege || '—'} · ${c.secret_ref || ''}`)
      lines.push('')
    }
    if (g.files.length) {
      lines.push('### 攻击文件', '')
      for (const f of g.files) lines.push(`- \`${f.name}\`（${f.kind}）：${f.description || '—'}｜效果：${f.evidence}｜路径：${f.path}`)
      lines.push('')
    }
    if (g.chain.length) {
      lines.push('### 攻击链', '')
      for (const st of g.chain) lines.push(`${st.seq}. [${st.stage}] ${st.title}${st.detail ? ' — ' + st.detail : ''}`)
      lines.push('')
    }
    const entry = {
      key: g.key, label: g.label, kind: g.kind, segment: g.segment || '未归属',
      stats: { vulns: g.vulns.length, bySeverity, accesses: g.access.length, credentials: g.creds.length, files: g.files.length, chainSteps: g.chain.length },
      markdown: lines.join('\n'),
    }
    list.push(entry)
    const cidr = entry.segment
    if (!groups.has(cidr)) groups.set(cidr, { cidr, targets: [] })
    groups.get(cidr).targets.push(entry)
  }
  const grouped = Array.from(groups.values())
    .map((g) => ({ cidr: g.cidr, targets: g.targets.slice().sort((a, b) => b.stats.vulns - a.stats.vulns || a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.cidr.localeCompare(b.cidr))
  return {
    generated_at: nowIso(),
    engagement: { id, name: meta.target_name || id, scope: meta.scope_cidrs || [] },
    groups: grouped,
    targets: list,
    totals: {
      targets: list.length,
      vulns: vulns.length,
      accesses: access.length,
      credentials: creds.length,
      files: files.length,
      filteredOut: allVulns.length - vulns.length,
    },
  }
}

/**
 * 生成 Markdown 成果报告。
 *
 * 只交付「成果漏洞」：状态为 confirmed / exploited，且严重级为 critical / high / medium。
 * 待验证（candidate）、误报（false-positive）、低危与信息级（low/info）都不进报告——
 * 它们是过程噪声（水洞）。信息收集的资产清单也不进报告（在资产测绘页面看）。
 * 报告保留：成果漏洞（含可粘贴进 Burp/Yakit 的原始请求）、攻击链（内网突破成果）、
 * 已获得权限与凭据、修复建议。
 *
 * @param id - 靶标 id。
 * @param options - `{ all: true }` 时输出全部漏洞（用于自查，不出交付物）。
 */
export function generateReport(store, id, options = {}) {
  const meta = readMeta(store.metaPathOf(id)) || {}
  const includeAll = options.all === true
  const chain = store.listChain(id)
  const creds = store.listCredentials(id, {})
  const access = store.listAccess(id, {})
  const allVulns = store.listVulns(id, { limit: 2000 }).items
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  const isResult = (v) => v.status === 'confirmed' || v.status === 'exploited'
  const isReal = (v) => v.severity === 'critical' || v.severity === 'high' || v.severity === 'medium'
  const vulns = (includeAll ? allVulns : allVulns.filter((v) => isResult(v) && isReal(v)))
    .slice()
    .sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
  const filteredOut = allVulns.length - vulns.length

  const lines = []
  const push = (...xs) => lines.push(...xs)
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const v of vulns) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1
  const exploited = vulns.filter((v) => v.status === 'exploited').length

  push(`# 攻防演练成果报告 — ${meta.target_name || id}`, '')
  push(`- 生成时间：${nowIso()}`)
  push(`- 授权范围：${(meta.scope_cidrs || []).join(', ') || '（未记录）'}`)
  push(`- 成果概览：成果漏洞 ${vulns.length} 个（严重 ${bySeverity.critical} · 高危 ${bySeverity.high} · 中危 ${bySeverity.medium}）· 已成功利用 ${exploited} 个 · 已控制资产 ${access.length} 台 · 已获取凭据 ${creds.length} 条`)
  push('')

  push('## 一、成果漏洞', '')
  if (!vulns.length) {
    push('本次演练暂无可交付的成果漏洞（只收录已验证/已利用且中危及以上的漏洞）。', '')
  } else {
    for (const v of vulns) {
      push(`### [${(v.severity || 'info').toUpperCase()}] ${v.cve ? v.cve + ' — ' : ''}${v.title || ''}`, '')
      push(`- 目标：${v.target || '—'}`)
      push(`- 资产：${v.asset_ip || '—'}（${v.segment_cidr || '—'}）`)
      push(`- 状态：${v.status === 'exploited' ? '已成功利用' : '已验证'} · 置信度：${v.confidence === null || v.confidence === undefined ? '—' : v.confidence} · 发现方式：${v.source || '—'}`)
      push(`- 危害与证据：${v.evidence || '—'}`)
      const evidence = store.listHttpEvidence(id, { vuln_id: v.id })
      if (evidence.length) {
        push('', '**复现请求（可直接粘贴进 Burp Suite / Yakit）**：', '')
        for (const e of evidence) {
          push(`*${e.label || e.method + ' ' + (e.url || '')}*`, '')
          if (e.request) push('```http', e.request.replace(/\r/g, '').trim(), '```', '')
          if (e.response) push('响应摘要：', '```http', String(e.response).replace(/\r/g, '').trim().slice(0, 2000), '```', '')
        }
      }
      push('')
    }
  }

  push('## 二、攻击链', '')
  if (chain.length) {
    for (const s of chain) {
      push(`${s.seq}. **[${s.stage}] ${s.title}**`)
      if (s.asset_ip) push(`   - 资产：${s.asset_ip}`)
      if (s.vuln_title || s.vuln_cve) push(`   - 漏洞：${s.vuln_cve ? s.vuln_cve + ' ' : ''}${s.vuln_title || ''}`)
      if (s.detail) push(`   - 说明：${s.detail}`)
      if (s.evidence_ref) push(`   - 证据：${s.evidence_ref}`)
    }
  } else push('（未记录攻击链步骤）')
  push('')

  push('## 三、已获得权限与凭据', '')
  if (access.length) {
    push('| 主机 | 账号 | 方式 | 权限 | 证据 |', '| --- | --- | --- | --- | --- |')
    for (const a of access) push(`| ${a.host} | ${a.username || '—'} | ${a.method || '—'} | ${a.privilege || '—'} | ${a.session_ref || '—'} |`)
  } else push('（未获得可用访问）')
  push('')
  if (creds.length) {
    push('| 主机 | 账号 | 类型 | 权限 | 引用 |', '| --- | --- | --- | --- | --- |')
    for (const c of creds) push(`| ${c.host} | ${c.username || '—'} | ${c.secret_type || '—'} | ${c.privilege || '—'} | ${c.secret_ref || '—'} |`)
  } else push('（未获取凭据）')
  push('')

  push('## 四、修复建议', '')
  const advice = []
  if (vulns.some((v) => v.cve)) advice.push('1. 按上方 CVE 编号优先修补受影响组件，建立组件版本基线并纳入补丁管理。')
  if (access.some((a) => a.method === 'webshell' || a.method === 'rce' || a.method === 'upload')) advice.push('2. 收紧文件上传与命令执行面：上传目录禁止执行、白名单校验、最小权限运行 Web 进程。')
  if (access.some((a) => a.method === 'vnc' || a.method === 'rdp' || a.method === 'ssh')) advice.push('3. 收敛远程管理暴露面（VNC/RDP/SSH 不暴露公网），强制强口令与多因子认证。')
  if (creds.some((c) => c.secret_type === 'connection-string')) advice.push('4. 禁止通过接口/配置泄露数据库连接串，密钥统一纳入密钥管理并对接口做鉴权。')
  advice.push(`${advice.length + 1}. 对本次涉及的接口做统一鉴权与越权校验，建立接口资产台账与自动化回归测试。`)
  push(...advice, '')

  if (filteredOut > 0 && !includeAll) {
    push(`> 本报告只收录已验证/已利用且中危以上的成果漏洞；另有 ${filteredOut} 条待验证、误报或低危/信息级记录未纳入（可在「漏洞战果」页面查看）。`)
    push('')
  }

  return {
    markdown: lines.join('\n'),
    generated_at: nowIso(),
    stats: {
      results: vulns.length,
      bySeverity,
      exploited,
      filteredOut,
      accesses: access.length,
      credentials: creds.length,
      chainSteps: chain.length,
    },
  }
}
