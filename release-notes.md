# 1.1.74

## 中文

- 版本 **1.1.74**：把系统提示词送进模型的原生 system 槽，不再塞进最后一条 user 消息。移植自上游 1.1.72 的 #89–#92，并按 0.2.1-rc.2 的实际代码形状重写。
- **#89 `SYSTEM_FIELD_EXTRACT`**：`buildRequest()` 把 `role: "system"` 的消息抽出来合并成独立的 `system` 字段，`messages` 里只留非 system 消息。原来系统提示词混在对话历史里，模型容易把它当成用户说过的话；抽出来之后走请求级字段，语义干净。
- **#90 `OPENAI_NATIVE_SYSTEM_ROLE`**：openai-completions 把 `systemPrompt` 折进 `messages[0].role = "system"`（`/chat/completions` 的原生槽），不再拼到最后一条 user 前面。顺带剥掉 ChatML 残留标记（`<|im_start|>system:`、`<|im_end|>`、`<project_instructions>`）。
- **#91 `ANTHROPIC_NATIVE_PARAMS_SYSTEM`**：anthropic-messages 优先读 `context.systemPrompt`，写入顶层 `params.system`（`/messages` 的原生槽），同样剥掉 ChatML 残留。原来只有 `context.system` 和首条 system 消息两条路，`systemPrompt` 会被丢掉。
- **#92 `SUBAGENT_SAME_INJECT_PATH`**：子代理创建时立刻调用 `globalThis.__dshPurgePrepareAssemble`，父会话怎么挂注入，子代理就怎么挂，不再靠「第一次发送前」才补。同时把子代理的 `permissionPreset` 从 `auto || danger-full-access ? preset : undefined` 改成 `preset || "danger-full-access"`，父会话放行的权限子代理直接继承。
- **`resolveInjectText()` 优先级反转**：改成 **磁盘 `prompt-inject.md` 优先** > 本进程未落盘 > 内置。原来进程内缓存排在前面，用户点保存写完文件却不生效，得重启才认。
- 新增 `tests/system-slot-patches.test.mjs`：覆盖 #89–#92 的命中、替换结果和二次应用幂等性。
- 全量 39 项测试通过；#89–#92 已在 0.2.1-rc.2 真实宿主文件上验证 1/1、3/3、3/3、2/2 全部命中，打完后语法校验通过、二次应用全部 `already`。

## English

- **1.1.74** routes the system prompt into the model's native system slot instead of stuffing it into the last user message. Ported from upstream 1.1.72's #89–#92 and rewritten against the real 0.2.1-rc.2 code shape.
- **#89 `SYSTEM_FIELD_EXTRACT`**: `buildRequest()` lifts `role: "system"` messages into a dedicated `system` field and leaves only non-system messages in `messages`. The prompt used to sit inside conversation history, where the model could read it as something the user said.
- **#90 `OPENAI_NATIVE_SYSTEM_ROLE`**: openai-completions folds `systemPrompt` into `messages[0].role = "system"` (the native `/chat/completions` slot) rather than prepending it to the last user turn, and strips leftover ChatML markers (`<|im_start|>system:`, `<|im_end|>`, `<project_instructions>`).
- **#91 `ANTHROPIC_NATIVE_PARAMS_SYSTEM`**: anthropic-messages prefers `context.systemPrompt` and writes it to top-level `params.system` (the native `/messages` slot), stripping the same markers. Previously only `context.system` and the first system message were read, so `systemPrompt` was dropped.
- **#92 `SUBAGENT_SAME_INJECT_PATH`**: subagents call `globalThis.__dshPurgePrepareAssemble` at creation time, so a child hangs the inject exactly the way its parent does instead of waiting for the first send. The child `permissionPreset` changes from `auto || danger-full-access ? preset : undefined` to `preset || "danger-full-access"`, inheriting the parent's granted access.
- **`resolveInjectText()` priority inverted**: on-disk `prompt-inject.md` now wins over the in-process override, which wins over the bundled default. Saving the file used to lose to a stale in-memory copy until restart.
- Adds `tests/system-slot-patches.test.mjs`, covering match, replacement result, and second-pass idempotence for #89–#92.
- All 39 tests pass. #89–#92 hit 1/1, 3/3, 3/3, and 2/2 against the real 0.2.1-rc.2 host files, the patched files pass a syntax check, and a second apply reports `already` for every one.

# 1.1.73

## 中文

- 版本 **1.1.73**：修复 1.1.72 在官方 0.2.x 上暴露的兼容回归与预设迁移问题。
- 旧红队预设含 `toolFilter` / `persona` 时不再自动整份覆盖：改为 YAML 节点级就地迁移，只处理 `tool-subagent` 与 `workflow` / `ralph` 行，跳过块标量正文；写入前重新解析，整体重建前备份，备份失败取消重建。
- 官方 0.2.0 没有 `working-directory:current` 上下文时，persona suffix 写入实际会话目录并设 `interpolate: false`；0.2.1 继续使用宿主必需上下文，不重复目录。
- 红队预设恢复 `backgroundMode: continuable`（0.2.0 需要，0.2.1 保留但不报错）；spawn 与 fork 都显式 `maxDepth: 1`，并禁用会绕过限深的 `workflow` / `ralph`。
- `#32` Web 面常量行替换改为负向前瞻，连续应用不再追加注释。
- 兼容探测器按端面、宿主版本和实检状态过滤失效项；空目录返回 2，真失效返回 1。
- Windows 解包回滚的 rename 增加 `EPERM` / `EBUSY` 短暂重试。

## English

- **1.1.73** fixes compatibility regressions and preset migration exposed on official 0.2.x.
- Existing redteam presets with `toolFilter` / `persona` are migrated in place instead of being overwritten: only `tool-subagent` and `workflow` / `ralph` rows are touched, block-scalar bodies are skipped, the result is re-parsed before writing, and a whole-template rebuild requires a successful backup.
- On official 0.2.0, the persona suffix now carries the actual session directory with `interpolate: false` when `working-directory:current` is absent; 0.2.1 keeps the host's required context without duplicating it.
- The redteam preset restores `backgroundMode: continuable` for 0.2.0 (0.2.1 preserves it harmlessly), sets `maxDepth: 1` on both spawn and fork, and disables `workflow` / `ralph`, which bypass the depth cap.
- The `#32` Web-surface constant replacement uses a negative lookahead, so repeated applies no longer append the marker.
- The compatibility probe filters dead patterns by surface, host version, and live status; an empty tree exits 2 and a real failure exits 1.
- Windows rollback renames retry transient `EPERM` / `EBUSY`.

# 1.1.72

## 中文

- 版本 **1.1.72**：适配官方 **dsh 0.2.1-rc.2**，同时保留 0.2.0-rc.2。
- 修「点应用 → 立即重启」报**清洗没有写进全部宿主，已取消重启**：0.2.1-rc.2 重写了 `dsh-system-prompt` 的 `assemble()` 尾段（waterfall 与 return 之间多了 `requiredContexts`），#40 的六条 pattern 全部落空，`complete prompt keeps inject` 写不进宿主，重启校验判 false。本版新增该尾段的整段替换，并保留 `requiredContexts` 的 context 收窄语义。
- Web 面身份句在 0.2.1-rc.2 整体搬到新包 `dsh-harness-dev-context`：#32、#53 增加该目标文件与新句式，`web-app` 侧只剩变量描述也一并中和。
- 0.2.1-rc.2 删掉了 `dsh-hooks-claude-code`、`dsh-hooks-codex`：#30 / #31 / #64 / #65 标记 `absentSince: 0.2.1`，在 0.2.1 上按「宿主无此功能」显示不适用，不再算补丁失败。
- #77 补上 0.2.1 的 `append(record)` 句式（`this.revised.clear()` 变成 `if (this.revised.size > 0) this.revised.clear()`）：回退标记到达时，已发消息恢复「立刻从当前对话移除」。至此 0.2.1 与 0.2.0 的生效差集只剩 4 条 hooks（宿主已删包）。
- 新增宿主版本自适应：`hostDshVersion()` / `hostAtLeast()`，补丁可按版本裁剪，避免 0.2.0 与 0.2.1 的句式互相污染。
- 新增 `scripts/probe-dsh-compat.mjs`：对着任意 `@deepseek-ai` 目录跑全部补丁，`--baseline` 直接列出「旧版命中、新版归零」的真回归，升级前先跑一遍再改代码。
- 前端挂点补上 0.2.1 的 `data-dockkit-strip-tabs` 标签条；找不到锚点从 `warn` 降为 `debug`，并补一条挂载成功日志。
- `dsh.client.inject` 去掉已删除的 `dsh-client-ui-slots`、从不存在的 `dsh-client-runtime`，改列 `dsh-client-ui-layout`；`dshTarget` 标为 `0.2.0-rc.2 || 0.2.1-rc.2`。

## English

- **1.1.72** targets official **dsh 0.2.1-rc.2** and keeps 0.2.0-rc.2 working.
- Fixes Apply → restart aborting with "patches were not written into every host": 0.2.1-rc.2 rewrote the tail of `dsh-system-prompt`'s `assemble()` (a `requiredContexts` block now sits between the waterfall and the return), so every #40 pattern missed and the `complete prompt keeps inject` marker never landed. Adds a whole-tail replacement that preserves the new context narrowing.
- The Web identity paragraph moved to the new `dsh-harness-dev-context` package: #32 and #53 gained that target plus the new sentence, and the remaining `web-app` variable description is neutralized too.
- 0.2.1-rc.2 dropped `dsh-hooks-claude-code` / `dsh-hooks-codex`: #30 / #31 / #64 / #65 carry `absentSince: 0.2.1` and report not-applicable instead of failed.
- #77 gains the 0.2.1 `append(record)` shape (`this.revised.clear()` became `if (this.revised.size > 0) this.revised.clear()`): a rewind marker drops the sent messages from the current conversation again. The remaining 0.2.0 → 0.2.1 delta is exactly the four hooks patches whose packages upstream deleted.
- Host-version gating (`hostDshVersion`, `hostAtLeast`) so patches are selected per release instead of matching both lines blindly.
- New `scripts/probe-dsh-compat.mjs`: runs every patch against any `@deepseek-ai` tree; `--baseline` lists the patterns that used to match and no longer do.
- Adds the 0.2.1 `data-dockkit-strip-tabs` anchor, demotes the missing-anchor warning to debug, and logs a successful mount.
- `dsh.client.inject` drops the removed `dsh-client-ui-slots` and the never-shipped `dsh-client-runtime`, adds `dsh-client-ui-layout`; `dshTarget` becomes `0.2.0-rc.2 || 0.2.1-rc.2`.

# 1.1.71

## 中文

- 版本 **1.1.71**。
- 修复 1.1.70 的 `??` 混 `||`：插件启用时 `failed to import`（桌面 / Web 同一入口）。
- #86 只改 UI 队列 steer → followup；公共 `steer()` 收回 next-step，代理间 `send_message` 仍下一步插入。
- `installed-rev` 跨版本不再沿用旧 `apply:x.y.z`。#88 按现行 `renderedPrompt` / 旧 `system` 锚点打中的那条落标记。
- 发版前 `node --check` 主入口，避免再把语法错误打进 Release。

## English

- **1.1.71**.
- Fix 1.1.70 `??` mixed with `||`: enable failed to import on desktop and web.
- #86 keeps UI queue steer → followup. Public `steer()` is next-step again so `send_message` inserts at the next step.
- Stale `apply:x.y.z` in `installed-rev` refreshes across versions. #88 marks the host anchor that actually exists (`renderedPrompt` or `system`).
- Release CI syntax-checks the plugin entry.

# 1.1.70

## 中文

- 版本 **1.1.70**。
- Hub / 残装若给 `dsh-purge` 加上 `pluginPackages`，Cordis 会一直 pending，宿主退出码 1。本版把依赖钉回 `systemPrompt` + `tools`。
- 清洗页只合并升级链展示（免责、审批、挂全文、hooks 等），Apply 仍打全部补丁。
- 去掉已无用的 #81 / #89 清单行；挂全文并进 #87，官方 phase-1 走静默放行。
- 指挥端改为「按用户给的目标开工」。合并 #97 / #98 / #99。

## English

- **1.1.70**.
- Hub / incomplete installs that inject `pluginPackages` leave dsh-purge pending and kill the host. Dependencies are pinned to `systemPrompt` + `tools`.
- Clean page groups upgrade-chain patches for display only; Apply still writes every patch.
- Dropped dead #81 / #89 rows. Hang lives in #87. Official phase-1 keep is silent.
- Commander bind: start from the user's target. Includes #97 / #98 / #99.

# 1.1.69

## 中文

- 版本 **1.1.69**。
- 发送时剥掉 ChatML / `project_instructions`，框和磁盘不动。
- 应用 + 重启挂当前默认，不必再点保存；框里仍是插件旧默认会刷到加密槽。
- 红队只排不折：注入 → cap → 红队正文；目标卡/角色段改名 `dshpg-*`。
- 隔离 ctx 也注册 inject/cap；#86 steer 改 next-turn；#87 hang 用 LF 比对。
- 红队操作稿锁「上面的提示词作准」；指挥端去掉「给了单位名就授权」。

## English

- **1.1.69**.
- Peel ChatML / `project_instructions` on the wire; box and disk stay intact.
- Apply + restart hangs the current default; no extra Save. Stale plugin defaults refresh from the sealed slot.
- Redteam: inject → cap → ops only (no fold). Card/role sections renamed `dshpg-*`.
- Isolated ctx also registers inject/cap. #86 steer → next-turn. #87 hang needle uses LF.
- Redteam ops note: inject wins. Commander no longer says a company name means authorized.

# 1.1.68

## 中文

- 版本 **1.1.68**。
- **#92**：技能面板认 YAML 块标量 `description`（`|` / `>`），不再误报不可用。
- **#93**：红队「版本/更新」：`file://` 转成本地路径；Windows 用 `.cmd` + `shell` 起 npm/pnpm；npm 404 回落 GitHub tags。
- **#94**：官方桌面 CLI 入口补 `app.asar.unpacked` 回退。Hub 首次安装仍可能撞官方 asar 路径。
- **#95**：拆除 `refusal-recover`（读错字段永不触发；修好会无限复读）。
- **#96**：bash 前台等待从插件标过的 600s 迁回 60s，后续工具不再被堵 10 分钟。
- 注入置顶；capability 段改名 `dshpg-capabilities`；用户 prompt 一律 followup（#85）；默认关闭自动「继续」。

## English

- **1.1.68**.
- **#92**: Skill panel parses YAML block-scalar `description`.
- **#93**: Redteam update: `file://` → fs path; Windows npm/pnpm via `.cmd`; GitHub tags if registry 404.
- **#94**: Desktop CLI falls back to `app.asar.unpacked`. Hub first-install may still hit stock asar.
- **#95**: Removed `refusal-recover` (dead reader / unbounded nudge loop).
- **#96**: Restore marked bash foreground wait 600s → 60s.
- Inject leads; capability section renamed; user prompt always followup; autoContinue default off.

# 1.1.67

## 中文

- 版本 **1.1.67**。
- **#85**：continue 续跑在传输/429 连错时不再无限兜圈。`takeContinue` 加 failStreak 阈值；`refundContinue` 不清 `lastContinueSeq`，连错 ≥3 直接放弃。
- **#84**：区域拦截的空 Assistant 流改为单批 `text-chunks` 记录（带 `.length`），不再卡住宿主 UI。
- 启动种子：进程启动时若 `$DSH_HOME/prompt-inject.md` 为空或缺失，自动把加密默认稿写一次；用户改过的稿不动。清洗完点重启后，重启成功立刻就能用默认提示词。
- Windows 官方包重启：restart 脚本名改成 `pid+random`，首启不与并发实例打架；多余的 `.cmd` 中介删掉，直接 `wscript.exe //nologo //B` 起脚本；本机旧版无 pid 后缀的脚本/日志超过 24h 启动时自动清。
- 杀进程范围收紧：`ASAR_SWAP_PS1` 不再 `/IM` 杀全名同名进程，只按安装根下 pid 停，避免误伤第三方同名。
- 官方 CLI shim 原地改写之前先存一份 `.dsh-purge.bak`，并走原子写，断电/盘满可回退。
- 首装场景不卡：WScript 判 clean 时，两边都是 null（文件缺或读失败）放行启动，只有任一明确 dirty 才拦。
- 探测缓存：`runningExes` / `shortcutExes` 空结果不再缓存；点"应用"前 `clearDesktopLocateCache()` 仍可强刷。
- `scheduleAsarRenameWhenIdle` 的 `.rename-pending` 锁：时钟回拨或超过 30 分钟视为失效，清掉重做。
- `execFileSync` 三处 PowerShell 调用加 `maxBuffer: 8MB`，大结果不再静默 ENOBUFS 掉。
- 其他：net-scope region gate 指数退避 + IPv6 regex 收紧；identity `injectMatchers` 支持 >4096 分段匹配、`installAssembleGuard` 幂等；hooks-deny 删 R0 兜底规则改原子写；extract-asar commit 不删 `nextDir`，写 `.dshpurge-recover.json` 便回滚；client.js redteam preset 多路检测、shell.submit WeakMap 清理补齐。

## English

- **1.1.67**.
- **#85**: Continue loop no longer spins forever on TRANSPORT/429 streaks. `takeContinue` adds a failStreak gate; `refundContinue` leaves `lastContinueSeq` set; 3 consecutive failures abandon.
- **#84**: Region-gate empty-assistant stream becomes one batched `text-chunks` record (with `.length`), no longer hangs the host UI.
- Boot-time seeding: on startup, if `$DSH_HOME/prompt-inject.md` is empty or missing, the encrypted default is written once; a user-edited file is untouched. After the Apply → cleanup → restart cycle, the default prompt is active immediately.
- Windows official-build restart: restart script name now includes `pid+random`, so concurrent instances don't clobber each other; the `.cmd` intermediary is dropped — `wscript.exe //nologo //B` is spawned directly; legacy unsuffixed scripts/logs older than 24h are purged on each startup.
- Kill scope tightened: `ASAR_SWAP_PS1` no longer uses `/IM` to kill by full name — only pids under the install root are stopped, so same-named third-party processes aren't collateral.
- Official CLI shim repair now saves `.dsh-purge.bak` and uses atomic write before overwriting, so power loss / disk full is recoverable.
- First-install not blocked: when WScript checks for clean markers, two nulls (missing or unreadable) now pass through; only an explicit `false` blocks startup.
- Probe caches: `runningExes` / `shortcutExes` no longer cache empty results; `clearDesktopLocateCache()` on Apply still forces a refresh.
- `scheduleAsarRenameWhenIdle` `.rename-pending` lock: clock skew or ≥30-min-old lock is treated as stale and cleared.
- Three `execFileSync` PowerShell calls get `maxBuffer: 8MB` so large results no longer silent-fail with ENOBUFS.
- Also: net-scope region-gate exponential backoff + stricter IPv6 regex; identity `injectMatchers` segments >4096-char payloads, `installAssembleGuard` is idempotent; hooks-deny drops R0 fallback and uses atomic write for state; extract-asar commit no longer deletes `nextDir` and writes `.dshpurge-recover.json` for rollback; client.js redteam preset detection broadened; `shell.submit` WeakMap cleanup wired.

# 1.1.66

## 中文

- 版本 **1.1.66**。
- **#80**：清洗页可关掉 hooks deny / ask 旁路。关掉且文件干净显示跳过，不计入已应用；关掉后再打开，64/65 会按官方形态再打一次。
- **#81**：继续 / 拒答续跑的来源 kind 改为 `dsh-purge`；限流和传输失败不再自动续一轮。
- 重启后不用点保存也会挂上默认提示词；每一轮都补回全文。空的应用请求不再清空磁盘上的提示词。
- 声明过的 overlay 只剩 `.dshpurge.bak` 时，应用会先拷回再加载。
- 红队报告补上得分点短名。中文 README 恢复题图和预览图。

## English

- **1.1.66**.
- **#80**: The clean page can turn off the hooks deny/ask bypass. Off + clean files show skipped and are not counted as applied. Turning it back on reapplies 64/65 from the official form.
- **#81**: Continue / refusal-recover use source kind `dsh-purge`. RATE_LIMIT and TRANSPORT no longer start another continue turn.
- Restart hangs the default prompt without a Save click; every step puts the full text back. An empty Apply body no longer wipes the disk prompt.
- A declared overlay that exists only as `.dshpurge.bak` is copied back before load.
- Red-team reports get short score-point names. Chinese README restores the banner and preview images.

# 1.1.65

## 中文

- 版本 **1.1.65**。
- 默认提示词按 `lib/default-prompt-inject.md` 重新加密进槽。磁盘上仍是用户自己改过的稿时，不覆盖。
- 红队接入截图登记、得分点看图，以及报告六段。可把某次演练导出成目录。
- 技能正文缺工具路径、缺密钥或 VPS 还是占位符时，不再把整条技能标成不可用。缺口留在详情里。
- 打开页面或组装提示词时，会把当前默认稿同步到磁盘，不必先点保存。
- 删掉没有调用的桌面启动封装、旧迁移脚本，以及已经注释掉的手动继续入口。

## English

- **1.1.65**.
- The default prompt is sealed again from `lib/default-prompt-inject.md`. A prompt the user already edited on disk is left as-is.
- Red team gains shot registration, score-point images, and the six-part report. An engagement can be exported to a folder.
- A skill stays usable when a documented tool path, key, or VPS placeholder is missing. The gap stays on the skill detail.
- Opening the page or assembling the prompt writes the current default to disk, without a Save click first.
- Unused desktop launch helpers, the old migration script, and the commented manual-continue entry are removed.

# 1.1.64

## 中文

- 版本 **1.1.64**。
- 红队流程八项。角色稿只在**新建靶标**时播种；已经建好的靶标，要在演练台里把智能体同步一次才会换成新稿。
- **内网**改为叶子节点，自己按收集、梳理、发现、利用做，不再往下派活。
- 并发名额：不带 key 的 release 只放最早的一条。子智能体结束由服务端自动释放；手动释放必须带上 acquire 返回的 key。
- 预检带 `include` 时只体检点名的技能，不再被全局缺密钥拖成失败。缺项带上由用户执行的修复说明。
- IPv6 计分至少两个冒号，`dc01:389` 这类主机名不再 ×3。计分只留在 `score-rules.js`。
- 攻击链计分跳过已停用的得分点。
- `.env` 认 `export KEY=value`。未加引号的行内注释会剥掉，引号里的 `#` 保留。
- 内网计分 code 改为 `central-system`、`boundary-logical`、`boundary-strong` 等，以 `redteam_score_list` 实际返回为准。
- 漏洞发现和利用从 `priority=high` 打起。优先级为空时，先回报指挥补一轮评估。
- 删掉没有调用的代码。设置页里过期的 `legacyApplyPath(...)` 调用改为 `applyPathOp`。

## English

- **1.1.64**.
- Eight red-team flow fixes. Role prompts seed **new** engagements only; sync agents on an existing engagement to pick them up.
- The internal role is a leaf and does collect, assess, scan, and exploit itself.
- A release without a key drops only the oldest reservation. Ending a subagent auto-releases; a manual release must carry the acquire key.
- Preflight `include` checks only the named skills. Broken items include fixes for the user to run.
- IPv6 scoring needs at least two colons, so `dc01:389` is no longer ×3. Scoring lives only in `score-rules.js`.
- Attack-chain scoring skips disabled score points.
- `.env` accepts `export KEY=value` and strips unquoted inline comments. A `#` inside quotes stays.
- Internal score codes match the live list (`central-system`, `boundary-logical`, `boundary-strong`, and the rest), taken from `redteam_score_list`.
- Vuln-scan and exploit start at `priority=high`. If priority is empty, report back and run another assess first.
- Unused code removed. Stale settings calls to `legacyApplyPath` now call `applyPathOp`.

# 1.1.63

## 中文

- 版本 **1.1.63**。
- 官方更新脚本去掉中文注释，避免 `official update script is not ASCII`。

## English

- **1.1.63**.
- Official update script is ASCII only, so the handoff no longer fails the ASCII check.

# 1.1.62

## 中文

- 版本 **1.1.62**。
- 继续/重试重新打开。
- 锚点门：首轮输出上限 1024→8192，最多 2 步；已调工具即放开，英文思考过不了 we 锚也不再卡住。
- 已有预设的锚点配置与包内不一致时同步，不整份覆盖。

## English

- **1.1.62**.
- Continue/retry is on again.
- Anchor gate: bootstrap cap 8192, max 2 steps; promote after the first tool call.
- Existing presets sync the anchor-gate block when it differs from the package.

# 1.1.61

## 中文

- 版本 **1.1.61**。
- **多宿主 Apply**：npm-global 与桌面 `resources/app` 一并补丁（#72 类路径问题）。
- **#73**：代理 / IP / DNS 等 benign 话题不再误触攻击闸门（`net-scope.js`）。
- **#74**：自定义提示词持久化——`resolveInjectText` 读 `prompt-inject.md`，UI 保存走 `saveOverrideContent`，启动 `ensureOperatorBody`。
- **极简**：#80 保持官方 persistent-shell；UI 选 minimal 以 `agent-preset/selected` 为准（不再被会话头 `standard` 误导）；`adaptInjectForMinimalPreset` 对齐 shell-only 工具表。
- **拒答续跑**：`refusal-recover` 识别「我不做 / 不参与」等句式。
- 注入链：`injectMatchers` 防重复段；默认提示词重加密进 `asset-table.js`。

## English

- **1.1.61**.
- **Multi-host Apply**: patch npm-global and desktop `resources/app` together.
- **#73**: Benign proxy/IP/DNS topics no longer trip the attack gate.
- **#74**: Custom prompt persists via `prompt-inject.md` + `saveOverrideContent`.
- **Minimal**: #80 official shell-only preset; preset from `agent-preset/selected`; runtime `adaptInjectForMinimalPreset`.
- **Refusal recover**: broader Chinese refusal phrasing.
- Inject assembly dedupe; default prompt re-sealed.

# 1.1.60

## 中文

- 版本 **1.1.60**。
- **极简 / PTC**：与标准同一任务却被拦，多半是 preset 里 `run_code`、沙箱、plan 文案未洗净，或内置 minimal 缺 `agent-instructions`。本版反转 #60/#61/#63，minimal 补插件（#26）。**完全退出 → 应用 → 重启 → 新开对话** 后再测。
- **回退 → 重新发送**：「回退一次 / 回退上一轮」留在当前对话；已发送句回到输入框，本轮助手输出与 todo 撤掉。**1.1.60** 起按**当前轮**定位，多轮后不会又退到第一条用户消息（#74/#75 + `lib/rewind.js`）。
- **应用 / 重启**：用户点应用、重启时写入 client 包，避免误报「清洗没有完成，已取消重启」。
- 默认提示词从 `default-prompt-inject.md` **重新加密**进 `asset-table.js`；运行时只读加密槽。
- **#66** Windows `app.asar` 无 JScript 时 PowerShell 换包；**#67** `dsh.cmd` 解包路径；**#69** 演练台 `position:fixed`；**#71** assemble 守卫幂等；**#70** 技能路径按本机 OS 判定；**#68** 文档改为 `desktop` profile + `.tar.gz`（Hub 一键仍走 git，见 README）。

## English

- **1.1.60**.
- **Minimal / PTC**: Same task blocked while standard works → uncleared `run_code`, sandbox, or plan text, or minimal preset missing `agent-instructions`. This release flips #60/#61/#63 and adds the plugin on minimal (#26). **Quit fully → Apply → Restart → new chat** before retesting.
- **Rewind → resend**: Rewind buttons stay in the same chat; your last user line returns to the composer and this round’s assistant output/todos drop. From **1.1.60**, bounds follow the **current turn**, not the first user message (#74/#75 + `lib/rewind.js`).
- **Apply / restart**: User Apply/Restart writes client bundles so restart is not cancelled as “clean incomplete”.
- Default prompt **re-sealed** into `asset-table.js`; runtime reads the encrypted slot only.
- **#66** asar swap PS fallback; **#67** `dsh.cmd`; **#69** dock fixed; **#71** idempotent assemble guard; **#70** skill paths per host OS; **#68** docs: `desktop` + `.tar.gz` (Hub one-click still git — see README).

# 1.1.59

## 中文

- 版本升级到 1.1.59。
- 点应用后不再因为宿主路径或旧标记对不上，就报「清洗没有写进当前宿主」（#65）。
- `resources\app\node_modules` 和 `resources\app\dsh\node_modules` 都认。原文里已经没有官方身份句、也没有丢掉注入的写法时，不再要求那两条标记。
- complete 段补丁同时认 tab 和空格。

## English

- Version 1.1.59.
- Apply no longer reports that the clean missed the current host just because the package path or the old markers do not match (#65).
- Both `resources/app/node_modules` and `resources/app/dsh/node_modules` count. If the official identity sentence and the inject-dropping return are already gone, those two markers are not required.
- The complete-prompt patch matches both tab and space indentation.

# 1.1.58

## 中文

- 版本升级到 1.1.58。
- 打开、应用、重启都会挂上提示词。磁盘上有正文就用磁盘，没有就用规则集，再没有就用内置默认，不用再点保存。
- 启动不再在页面发出之后改写前端 client.js，避免输入框因模块版本号对不上而消失（#63）。
- macOS / Linux 已解包桌面端点应用后会退出并重新打开；清洗标记两种写法都认（#64）。

## English

- Version 1.1.58.
- Open, Apply, and restart all hang the prompt. A saved file wins, then the active rule set, then the built-in default. Save is not required.
- Startup no longer rewrites frontend client.js after the page has taken a module revision, so the composer does not disappear (#63).
- Unpacked macOS and Linux desktop builds quit and relaunch after Apply. Both inject markers count as clean (#64).

# 1.1.57

## 中文

- 版本升级到 1.1.57。
- 应用并重启后，设置框里的提示词直接挂到系统段；框空则用当前规则集。两者都空就停下来要求输入。
- 创造、PTC、极简、unrestricted、梁神与标准模式一样清掉拦截和禁止，并保住各自的工具流程。
- 演练授权按本机目录保存，更新后不用重授权；卸载成功后才清掉。空的环境初始化不再当成已配置。
- 官方 Messages 请求的 system 字段改用当前系统提示，不再钉住第一条。

## English

- Version 1.1.57.
- After Apply and restart, the settings-box prompt is hung on the system section. An empty box uses the active rule set. If both are empty, Apply stops and asks for a prompt.
- Cordis, PTC, minimal, unrestricted, and Liangshen clear intercepts and bans the same way standard does, and keep their own tools.
- Drill authorization is stored in this install and survives updates. It is cleared only after uninstall succeeds. An empty environment init is no longer treated as configured.
- The official Messages request system field uses the current system prompt instead of the first snapshot.

# 1.1.56

## 中文

- 版本升级到 1.1.56。
- 应用按设置框、当前规则集、官方系统提示词的顺序选用。空框且没有规则时停下来要求输入，不再把内置默认写进磁盘。
- 清洗和演练台跟随 DSH 主题的透明玻璃，去掉手动换色。
- 说明只保留官方 Web 和官方桌面。

## English

- Version 1.1.56.
- Apply uses the settings box, then the active rule set, then the official system prompt. An empty box with no rules asks for a prompt and does not write the built-in default to disk.
- 清洗 and the drill console use transparent glass that follows the DSH theme. The manual theme switch is gone.
- Docs keep official Web and the official desktop only.

# 1.1.55

## 中文

- 版本升级到 1.1.55。
- 点「应用」并重启后，每一轮 assemble 都会把提示词补回最前；宿主换成新 assemble 也会再包一次，不会第二轮丢掉。
- 空框不再在前端误取消应用；重启前先落下默认提示词。密封 asar 不会因为当前进程还是旧包而取消重启。
- 第二次应用不会因为冷却把重启/注入当成取消；密封包在换掉之前每次应用都会重启一次，补丁写完后不再空转。

## English

- Version 1.1.55.
- After Apply + restart, every assemble turn puts the operator prompt back at the front. If the host replaces assemble, it is wrapped again so turn 2 does not drop the inject.
- An empty settings box no longer cancels Apply on the client; Restart seeds the default prompt first. A sealed asar no longer cancels restart just because the running process still has the old archive.
- A second Apply is not treated as a cancel because of settle cooldown. A sealed archive still restarts on each Apply until swapped; after patches are in, it does not loop.

# 1.1.54

## 中文

- 版本升级到 1.1.54。
- 官方桌面密封 asar 启动不再中途解包/杀进程：避开 Host Fiber._reload 的 INACTIVE_EFFECT / DesktopHostFatalError；补丁留给设置页「应用」。
- 桌面 settle 延后并在 context 停用时退出；启动自愈只写盘、不 scheduleRestart（#59 / #60 / #61）。
- 市场 tar 安装与空 sha / 缺 installed-rev 的无限重启修复仍在（#58–#61，1.1.53）。

## English

- Version 1.1.54.
- Official desktop no longer unpacks or kills the host mid-boot on a sealed asar; that raced Fiber._reload and threw INACTIVE_EFFECT / DesktopHostFatalError. Patches wait for Settings Apply.
- Desktop settle is delayed and aborts on an inactive context; startup self-heal writes files only and does not scheduleRestart (#59 / #60 / #61).
- Marketplace tarball install and empty-sha / missing installed-rev restart loops remain fixed (#58–#61, 1.1.53).

# 1.1.53

## 中文

- 版本升级到 1.1.53。
- 修复点「应用」后无限重启（#59 / #60 / #61）：tarball 安装没有 `installed-rev`、或 `applied.json` 空 sha 时，启动不再反复 reapply+restart；对齐后不再空转重启，并加冷却。
- web 自愈重启不再自动弹浏览器，关窗后不会再被反复拉起新窗口（#59 / #61）。
- 空 sha 只在非密封、且清洗标记还在（或找不到插件根）时补戳，避免冲掉密封宿主自愈（#56 / #57）。
- 市场安装：`package.json` 标明优先 tar.gz/zip，避免 Hub 退回 `git ls-remote` 失败（#58）。

## English

- Version 1.1.53.
- Stop Apply/startup infinite restart (#59 / #60 / #61): missing `installed-rev` after tarball install or empty `applied.json` sha no longer reapply+restart every boot; skip restart once aligned, with a cooldown.
- Web self-heal restart does not open a browser, so closing the window no longer respawns tabs (#59 / #61).
- Empty-sha heal only runs when the host is not sealed and markers are present (or the plugin root is missing), so sealed-host self-heal still works (#56 / #57).
- Marketplace install prefers tar.gz/zip in `package.json` so Hub does not fall back to a failing `git ls-remote` (#58).

# 1.1.52

## 中文

- 版本升级到 1.1.52。
- 官方桌面「应用/重启」不再自动跑官方 installer（#57）：宿主版本由用户自行升级；插件只解包打补丁，避免落盘前误判失败清掉 `resources\\app`。
- 有 `applied.json` 但宿主又回到 sealed / 找不到插件根时，判定未对齐并自愈重打；面板提示「补丁已丢失，请重新应用」。
- 插件启动路径永不自动更新，仅面板手动更新。
- 默认提示词按本地 `default-prompt-inject.md` 重新加密写入 `asset-table.js`。
- 用户自改提示词不会被「应用」盖回加密默认：磁盘正文与内置不同时一律保留；运行时内置默认只读加密槽。
- 回退切点扩到整轮并在替换后清空 derive 缓存，避免下次发送仍带上被撤掉的内容。

## English

- Version 1.1.52.
- Official desktop Apply/Restart no longer auto-runs the official installer (#57); users upgrade the host themselves; the plugin only unpacks and patches.
- If `applied.json` exists but the host is sealed again / plugin root is missing, treat as mismatched and reapply; UI shows patches-lost.
- Plugin startup never auto-updates; update only from the panel.
- Reseal the default prompt from local `default-prompt-inject.md` into `asset-table.js`.
- Keep user-replaced prompts: never overwrite disk text that differs from the bundled sealed default; runtime bundled default comes only from the sealed slot.
- Rewind cuts the whole last turn and invalidates derive cache so the next send does not keep undone content.

# 1.1.51

## 中文

- 版本升级到 1.1.51。
- 修复 `/skills import` 对 `$DSH_HOME/skills` 自身导入时先删后拷把技能删空（#54）。
- 补齐 `platformEnvAdaptStatus` / `platformEnvAdaptSkip`，发送门禁不再误报「环境还没配好」（#55）。
- 修复官方桌面：无版本/同版本 `installer.exe` 被当成待更新劫持重启；更新失败时恢复 `resources/app`；空 sha 的 applied stamp 不再跳过 reapply（#56，0.1.7/0.2 同路径）。
- 补丁 #52 兼容无 `.volatile()` 写法；#57 跟到 `useDeveloperRole` 并覆盖 responses 通路；#48 上游已删句按软完成；状态导出 `patches_ready`；桌面端 shim 显示「本端不需要」。

## English

- Version 1.1.51.
- Reject `/skills import` when source overlaps `$DSH_HOME/skills` so delete-then-copy cannot wipe skills (#54).
- Implement `platformEnvAdaptStatus` / `platformEnvAdaptSkip` so the send gate no longer false-blocks ready environments (#55).
- Official desktop: ignore unversioned/same-version `installer.exe` pending updates; restore `resources/app` if update handoff fails; empty applied stamp sha no longer skips reapply (#56, same path on 0.1.7 and 0.2).
- Patch #52 matches non-`.volatile()` defaults; #57 follows `useDeveloperRole` and covers responses; #48 soft-settles when upstream removed the caution text; export `patches_ready`; desktop shim shows not-needed-here.

# 1.1.50

## 中文

- 版本升级到 1.1.50。
- 修复 macOS 官方桌面：点「应用」假失败「失败: 正在重启。」、解包后 `dsh` CLI 失效、status 误标 ✗（#53）。
- 修复点「应用」重启后默认提示词不注入：未改过时自动落盘内置默认，不必先点保存。

## English

- Version 1.1.50.
- Fix macOS official desktop: Apply false "Failed: Restarting.", broken `dsh` CLI after asar unpack, and status ✗ false negatives (#53).
- Fix default prompt not injecting after Apply + restart; bundled default is written without requiring Save first.

# 1.1.49-beta.1

## 中文

- 版本升级到 1.1.49-beta.1（#53 测试版）。
- 修复 macOS 官方桌面点「应用」后假失败「失败: 正在重启。」：`scheduleRestart` helper/runtime 分支补回 `restarting: true`；Darwin 重启改为 osascript 优雅退出 + SIGTERM/SIGKILL，排除 CLI 进程后再 `open` 重开（剥掉 ELECTRON_RUN_AS_NODE）。
- 解包 app.asar 后自动修补官方 `dsh` CLI 入口（asar/`app/` 回退）并补 `app/runtime -> ../runtime`，避免 `dsh web` 等全部 MODULE_NOT_FOUND。
- `/purge status` 对多路径文件清单按数组逐项判断，不再把已打补丁文件标成 ✗。
- 前端重启失败文案不再把成功分支的 note 当成 error。

## English

- Version 1.1.49-beta.1 (prerelease for #53).
- Fix macOS official desktop Apply false failure "Failed: Restarting.": helper/runtime branches of scheduleRestart return restarting:true; Darwin restart uses osascript quit then SIGTERM/SIGKILL, skips CLI processes, relaunches via open without ELECTRON_RUN_AS_NODE.
- After unpacking app.asar, auto-patch the official dsh CLI entry (asar/app fallback) and add app/runtime -> ../runtime so dsh web and other subcommands keep working.
- /purge status treats multi-path file lists correctly instead of marking patched files as missing.
- Restart failure UI no longer uses the success note as the error detail.

# 1.1.48

## 中文

- 版本升级到 1.1.48。
- 修复红队指挥「只派活」约束被组装时误删，导致不派 subagent；预设在 Agent Teams 下强制重开 classic subagent。
- 增加按任务选用 skill/MCP 的协议（先读目录，再按任务调用；子代理与红队同样）；不改官方注册与工具面。
- 子代理 maxDepth 适配 0.2 无 default 的 schema，补回默认 10。

## English

- Version 1.1.48.
- Fix redteam lead dispatch-only SOP being stripped during assemble; re-enable classic subagent under Agent Teams in the redteam preset.
- Add task-matched skill/MCP selection protocol (read catalog, then call what the task needs; same for subagents and redteam). Does not change official registration.
- Raise subagent maxDepth default to 10 on 0.2 schemas that dropped .default().

# 1.1.47

## 中文

- 版本升级到 1.1.47。
- 演练台「环境适配」接通 `platformConfigGet` / `Save` / `AssignToolkit`，修复 `unknown op: platformConfigGet`，工具路径与 FOFA/VPS 配置可正常读写。
- 技能库目录探测增加 `$DSH_HOME/redteam/skills`，Windows 用 `homedir()` 回退，不再只信空的 `HOME`。
- 知识库优先使用环境适配里的 nuclei 模板路径；空库时显示本机 `knowledge.db` 路径，避免误判成接口挂了。
- 首次安装弹出用户须知：说明用途、免费开源、GitHub 仓库地址；声明背着作者营利将追究法律责任，并提示禁止违法用途。确认后本机不再弹出。
- 桌面定位与表面检测放宽，安装目录名含 `DeepseekHarnessDesktop` 等也能找到本机 Harness；失败的定位缓存不再一直卡住「还没定位」。
- 回退与请求路径小修，降低后轮卡住或假进度的情况。

## English

- Version 1.1.47.
- Wire drill Env adapt ops `platformConfigGet` / `Save` / `AssignToolkit`, fixing `unknown op: platformConfigGet` so tool paths and FOFA/VPS config work again.
- Skill catalog also probes `$DSH_HOME/redteam/skills` and falls back with `homedir()` on Windows when `HOME` is empty.
- Knowledge prefers nuclei templates from Env adapt; empty libraries show the local `knowledge.db` path so a missing API is not assumed.
- First install shows a user notice: what the plugin does, that it is free/open source, the GitHub repo URL, legal warning against profit behind the author, and illegal-use prohibitions. After confirm it does not show again on that machine.
- Broader desktop locate/surface detection (including `DeepseekHarnessDesktop` installs); failed locate caches no longer stick on "host not located".
- Small rewind/request-path fixes to reduce later-turn hangs and misleading progress.

# 1.1.46

## 中文

- 版本升级到 1.1.46。1.1.45 有问题，略过，不要安装。
- 默认提示词按 `default-prompt-inject.md` 重新加密写入。
- 修复注入不稳定：第二轮或任务做到一半人设失效、被当成 `project_instructions` 拆掉的问题。
- 工作区替换稿和作用域说明改回 0.1.7 的优先级：不能压过 system、developer 和用户原话。主 intro 的反软拒绝句保持不变。已经叠上的作用域强句整段收成这一句。
- 进模型前剥掉外层 ChatML / `<project_instructions>` 壳，避免模型把真实 system 注入当成项目说明。
- 组装后的系统提示段统一保证 `text` 为字符串；不再会话钉死整段 sections，避免第二轮 `renderPrompt` 读 `undefined.length` 直接死掉并报 `(gateway/internal)`。
- `agent/pre-step` 始终把 `decision.messages` 规范成数组，避免第二轮发送时读空 messages 炸掉。
- 地区闸门：多地址域名不能只因其中一个解析到受控地区就整站拦死（CDN/多线噪声 IP）。
- 回退后 `deriveMessages` / `systemNodes` 对缺 `content` 做兜底，避免回退再发送时 `(gateway/internal)`。
- 清洗进度：未定位宿主时不再显示吓人的 `0/63`；本机不需要或组件未装的项计入已就绪，避免假的 `48/63`。
- 点「应用」就会写入默认提示词并注入，框空时用内置默认，不必先点保存。
- 修复回退：`snapshotEvents()` 为空时不再读 `undefined.length`，避免 `(gateway/internal)` 报错导致回退无效。

## English

- Version 1.1.46. Skip 1.1.45; that version has bugs. Do not install it.
- Reseal the default prompt from `default-prompt-inject.md`.
- Fix unstable inject: persona dropping on the second turn or mid-task, including cases where the model treated the system inject as `project_instructions` and rejected it.
- Replacement and scope workspace intros match 0.1.7 again: they do not override system, developer, or direct user instructions. The main intro anti-soft-refuse text stays. A stacked scope paragraph is collapsed back to that one sentence.
- Strip outer ChatML / `<project_instructions>` wrappers before the text reaches the model, so a real system inject is not read as project instructions.
- Sanitize assembled system-prompt sections so `text` is always a string; stop pinning full sections for a session, which could make the second turn crash in `renderPrompt` on `undefined.length` with `(gateway/internal)`.
- Always normalize `decision.messages` to an array in `agent/pre-step`, so a second send does not die on a missing messages list.
- Region gate: multi-address hosts are no longer blocked just because one resolved IP is in a controlled region (CDN/noise).
- After rewind, `deriveMessages` / `systemNodes` tolerate missing `content`, so resend no longer fails with `(gateway/internal)`.
- Clean progress: do not show a scary `0/63` before the host is located; items not needed on this install count as ready, so a fake `48/63` no longer appears.
- Apply writes and injects the default prompt; an empty box uses the bundled default, so a separate Save is not required.
- Fix rewind: empty `snapshotEvents()` no longer reads `undefined.length`, so undo no longer fails with `(gateway/internal)`.

# 1.1.44

## 中文

- 版本升级到 1.1.44。
- 官方桌面解开 `app.asar` 时先写到旁边的目录，解开完成才换上 `resources/app`。目录里已经有宿主之后只改这些文件。同一份归档又出现时只把它挪开。归档的大小或时间变了，或目录不在了，才再解一次。解包卡住或补丁没写完，把上一份放回去，升级标记留到下次再试。
- 回退上一轮只撤掉最后一条已经发出的消息和它的回复，更早的轮次留在对话里，也从模型请求里拿掉。连续回退后留下的空标记不再进下一轮请求，下一句按新消息发。
- 可编辑提示词整份放在系统提示最前，同一份正文不再拼第二遍。每一步用当前这一份替换第一条系统提示。
- deepseek.com 的系统提示固定走 system，思维链照旧发送。
- 地区拦截只看这次任务里的目标。自己的服务器只认名单上的那一个地址或主机名。禁止句写上之后才结束这一轮。
- 官方始终用带 CTF 的默认提示词。红队开了规则集就只用规则集；否则用去掉 CTF 的默认提示词，再接红队操作。子代理跟主会话吃同一份。磁盘没有提示词时启动就用默认那份，不必先点保存。

## English

- Version 1.1.44.
- Unpacking `app.asar` writes beside `resources/app` and swaps in only after the unpack finishes. Once that directory is usable, later starts only edit those files. The same archive showing up again is moved aside. A new size or mtime, or a missing directory, is unpacked once. If unpacking sticks or that patch round does not finish, the previous directory is put back and the upgrade marker stays for the next start.
- Rewinding the previous round removes only that sent message and its reply. Earlier rounds stay on screen and leave the next model request. Leftover rewind markers stay off the next model request, so the next send is a new message.
- The editable prompt is placed once at the front of the system prompt. Each step replaces the first system prompt with that current text.
- Instructions for deepseek.com stay on the system role. Thinking is still sent.
- The region check looks only at this task's target. An own server is allowed only when that exact address or hostname is on the list. The turn ends after the denial sentence is written.
- Official mode always uses the default prompt, including CTF. Red team uses only the active rule set, or the default prompt without CTF followed by the red team steps. Subagents receive the same inject as the main session. If the prompt file is empty, startup uses the bundled default without requiring Save.

# 1.1.43

## 中文

- 版本升级到 1.1.43。
- 还没定位到本机 Harness 时，不再把每一条显示成跳过，分组计数也不再把跳过算成已完成。
- 补丁列表补齐到全部 52 条，总数和分组对得上。
- 启动时如果暂时找不到宿主目录，不再把这个空结果缓存住。

## English

- Version 1.1.43.
- Before this install is located, rows are no longer shown as skipped, and a skip no longer counts as done in the group total.
- The patch list now includes all 52 items, so the total matches the groups.
- A miss while looking up the host directory is not cached for the rest of the process.

# 1.1.42

## 中文

- 版本升级到 1.1.42。
- 清洗页提示词下面可以登记自己的服务器：每行一个 IP 或完整主机名，点保存名单。说明里写了步骤，并附了截图。
- 新对话把提示词放在系统提示最前。面板改为白墨玻璃，两种主题都能看清字。
- 补丁进度只计已应用的项。网页身份那条在后一条改写句子之后，仍显示已应用。
- 补上 0.1.x 的入口针。已经打过的 0.2.0 不会被重写。

## English

- Version 1.1.42.
- Under Prompt on the Clean page, register your own server: one IP or exact hostname per line, then Save list. The docs include the steps and a screenshot.
- New chats place the prompt at the front of the system prompt. The dock is frosted glass, and both the light and ink themes stay readable.
- The patch count includes only applied items. The web-surface identity row stays applied after the later sentence rewrite.
- Needles for 0.1.x entry points were added. An already patched 0.2.0 host is not rewritten.

# 1.1.41

## 中文

- 版本升级到 1.1.41。
- 官方模式只注入当前提示词；启用规则集后以规则集为主。红队再附上红队操作要求。
- 回退留在当前会话：先选回退一次或上一轮，上一句放回输入框，并清掉已经发出去的内容。
- 宿主没清洗完，或没有可注入的提示词时，不重启。
- 默认已是完全权限时，新会话不再被钉回受限权限。官方模型的 Session Log 上传默认关闭。
- 目标地址落在中国大陆、香港、澳门时停止。

## English

- Version 1.1.41.
- Official modes inject the editable prompt, or the active rule set when one is enabled. Red team also keeps its operating section.
- Rewind stays on the current session: choose one step or the last round, return the last line to the composer, and clear what was already sent.
- Restart is cancelled unless the host is cleaned and inject text is present.
- A full-access default is no longer pinned back to a restricted preset. Official model Session Log upload is off by default.
- Targets whose addresses fall in mainland China, Hong Kong, or Macau are stopped.

# 1.1.40

## 中文

- 版本升级到 1.1.40。
- 适配 **DSH 0.2.0-rc.2**：Anthropic OAuth 不再在系统提示最前面强插「You are Claude Code…」，自定义 `prompt-inject` 不会被压到后面。
- 去掉在 0.2 里已不存在的 **patch 41**（developer 角色改写），避免无效补丁占位。
- 设置页点 **应用** 成功后 **自动重启** 宿主，不必再打开插件点第二次重启。

## English

- Version 1.1.40.
- For **DSH 0.2.0-rc.2**, Anthropic OAuth no longer prepends “You are Claude Code…” ahead of your system prompt, so custom `prompt-inject` is not pushed behind a Claude identity block.
- Removed **patch 41** (developer-role remap) because those needles are gone in 0.2.
- After **Apply** in settings, the host **restarts automatically**; you no longer need to open the plugin again to confirm restart.

# 1.1.39

## 中文

- 版本升级到 1.1.39。
- 中文 Windows 上，官方桌面版点「安装并重启」不再停在「正在准备重启」。更新脚本首行改为纯 ASCII，路径里的中文写成 `\u` 转义，避免 Windows Script Host 按 GBK 把换行吞进注释。
- macOS 和 Linux 不走这条脚本，重启方式不变。

## English

- Version 1.1.39.
- On Chinese Windows, the official desktop install-and-restart no longer stays on preparing to restart. The update script starts with an ASCII comment, and non-ASCII paths are written as `\u` escapes, so Windows Script Host does not swallow the newline when it reads the file as GBK.
- macOS and Linux do not use this script. Their restart path is unchanged.

# 1.1.38

## 中文

- 版本升级到 1.1.38。
- 红队不再替用户下载工具。没有安装脚本时，引导改走演练台「环境适配」，由用户自己填路径。
- 长时间任务会在系统提示词里放一张「本次目标」卡。指挥和子代理看的是同一张：只打这个单位，回报里带出来的其它单位不打。子代理按角色使用自己的提示词，派活时的单位名称必须和这张卡一致。
- 工具查找认发行版上的真实文件名，例如 Kali 的 `httpx-toolkit`、`impacket-secretsdump`，不再把 Python 的 `httpx` 当成扫描器。
- 官方桌面在 macOS、Linux 上也能找到 `app.asar`（Mac 用 `Contents/Resources`）。Windows 以外不再包一层会把 `require` 弄坏的控制台隐藏。
- 红队接入锚点门：开头几步输出上限 1024；第一段思考里有 `we`、没有 `let me` 就放开，否则同一轮最多再走 4 步。上下文压缩后再关一次。红队工具和人设保持原样。
- 随包技能同步到 `$DSH_HOME/redteam/skills`，预设用 `dshHomePath` 指向它，不再把某一台电脑的 `node_modules` 路径写进预设。你自己的技能仍在 `$DSH_HOME/skills`，同名以你的为准。
- 修好红队模式不显示：声明预设时漏了路径变量，插件中途退出，模式下拉就没有这一项。
- 说明里加回赞助地址。

## English

- Version 1.1.38.
- Red team no longer downloads tools for you. When the setup script is missing, the guide points at the drill console environment page so you fill in the paths.
- Long jobs keep a target card in the system prompt. The commander and subagents see the same card: stay on that organization, and do not switch to other names that show up in results. Each subagent loads its own role text, and dispatched work must use the name on the card.
- Tool lookup accepts distro filenames such as Kali's `httpx-toolkit` and `impacket-secretsdump`, and does not treat Python's `httpx` as the scanner.
- The official desktop app can find `app.asar` on macOS and Linux (`Contents/Resources` on Mac). Outside Windows, the console-hide wrapper that broke `require` is not installed.
- Red team uses an anchor gate: the first steps are capped at 1024 output tokens, the cap lifts when the first reasoning block contains `we` and not `let me`, otherwise it lasts at most 4 steps in that turn, and a context compaction closes the gate again. Red team tools and the persona stay as they are.
- Bundled skills are copied to `$DSH_HOME/redteam/skills` and the preset points there with `dshHomePath`, instead of a machine-specific `node_modules` path. Your own skills stay in `$DSH_HOME/skills` and win on the same name.
- Red team mode shows in the mode list again. Declaring the preset no longer exits early because a path variable was missing.
- The sponsor addresses are back in the readme.

# 1.1.37

## 中文

- 版本升级到 1.1.37。
- 修改演示台环境配置滚动问题。

## English

- Version 1.1.37.
- The drill console environment page scrolls, so the rest of the settings can be filled in.

# 1.1.36

## 中文

- 版本升级到 1.1.36。
- 解决红队模式拒绝问题。

## English

- Version 1.1.36.
- Fix red team mode refusing the cleaned prompt.

# 1.1.35

## 中文

- 版本升级到 1.1.35。
- 启动时不再自动更新，要自己在面板里选择。
- dsh-purge 入口改到「上下文」旁边，不再挡住别的插件按钮。
- 得分口径对齐上游：25 项，Web 应用增加兜底归类。
- 知识库 14 类计数包含本机 nuclei 模板，点某一类可以筛选。
- 技能路径跟随 `$DSH_HOME`，不再因为示例路径在本机不存在就把整条技能标成不可用。

## English

- Version 1.1.35.
- Startup no longer auto-updates; choose the update in the panel.
- The dsh-purge entry sits beside Context, so it no longer covers other plugin buttons.
- Scoring matches upstream: 25 items, with a fallback bucket for other web apps.
- The 14 knowledge categories count local nuclei templates, and a category filters the list.
- Skill paths follow `$DSH_HOME`. A skill is no longer marked unavailable just because an example path is missing on this machine.

# 1.1.34

## 中文

- 版本升级到 1.1.34。
- **演练台知识库直接列出本机模板**。打开「知识库 · POC / EXP」就能看到一页 nuclei 模板，并可以翻页、按 CVE 或组件搜索。不再只显示「本机模板 N」、下面是空的。
- **更新包在 Windows、macOS、Linux 上都能解压**。Linux 不再调用 PowerShell。顺序是：Windows 用 tar，不行再用 PowerShell；macOS 和 Linux 用 tar、unzip、python3、bsdtar。这些都没有时，用 Node 自己解 zip。感谢 @cracer4869 在 #44 报出 Kali 上的 `spawnSync powershell ENOENT`。

## English

- Version 1.1.34.
- **The drill knowledge page lists local templates.** Opening Knowledge shows a page of nuclei templates, with paging and search by CVE or component. It no longer shows only the template count.
- **Update archives extract on Windows, macOS, and Linux.** Linux does not call PowerShell. Windows tries tar, then PowerShell. macOS and Linux try tar, unzip, python3, then bsdtar. If none of those exist, Node extracts the zip itself. Thanks to @cracer4869 for reporting `spawnSync powershell ENOENT` on Kali in #44.

# 1.1.33

## 中文

- 版本升级到 1.1.33。
- **修复已经重启后，打开面板仍弹出「需要重启」**。官方客户端已经从解开的 `resources/app` 运行时，不再仅因为当前是官方进程就再要求退出一次。只有这次真的挪开了 `app.asar`，才会提示重启。

## English

- Version 1.1.33.
- **Fix the restart dialog coming back after you already restarted.** When the official app is already running from the unpacked `resources/app`, opening the panel no longer asks you to quit again just because this is the official process. The restart prompt appears only when `app.asar` was actually moved aside in this run.

# 1.1.32

## 中文

- 版本升级到 1.1.32。
- **按测试版接上演练台布局**：面板可拖动、可改大小，浅色和深色跟宿主主题走。
- **设置页不再出现本插件**。从会话标题旁的 dsh-purge 打开右侧栏，清洗和演练台都在里面。

## English

- Version 1.1.32.
- **Bring the beta dock layout onto stable**: the panel can be dragged and resized, and light and dark follow the host theme.
- **The plugin no longer appears on the Settings page.** Open the right dock from dsh-purge beside the session title. Clean and Drill are both in that dock.

# 1.1.31

## 中文

- 版本升级到 1.1.31。
- **演练台进入正式版**。右侧栏两页：清洗、演练台。第一次进入演练台要读声明并确认授权。资产、技能和本机环境都在本插件里，不再单独装测试版红队包。
- **修复回退堆分支**：宿主不能在原会话里截断，回退后会把旧会话从侧边栏移出，多退几次不会留下一串分支。

## English

- Version 1.1.31.
- **Drill console is on the stable release.** The right dock has two pages: Clean and Drill. The first time you open Drill you read the notice and confirm authorization. Assets, skills, and the local environment ship inside this plugin.
- **Fix rewind leaving a branch every time.** The host cannot truncate a session in place. After rewind the old session leaves the sidebar, so repeated undo does not pile up branches.

# 1.1.30

## 中文

- 版本升级到 1.1.30。
- **修复正式版和 web 切换版本失败**：不再用 `dsh plugin add` 拉包。pnpm 请求 GitHub 压缩包会 `http 302` 或 `fetch failed`。改由插件自己下载。
- **修复思考和输出死循环**：去掉默认提示词里没有终止条件的重置。

## English

- Version 1.1.30.
- **Fix version switching on the desktop app and web**: stop installing through `dsh plugin add`. pnpm's fetch of the GitHub archive returns `http 302` or `fetch failed`. The plugin downloads the package itself.
- **Fix the thinking and output loop**: remove the default-prompt reset that had no stop condition.

# 1.1.28

## 中文

- **修复更新失败 `http 302`**：下载改为直连 `codeload.github.com`，并手动跟随跳转，避免 Electron/部分 Node 对 github.com → codeload 的 302 处理失败。
- **修复测试版列表空白**：前端 `keepListedVersion` 与后端一致，正式版已发布时仍保留 beta tip / `beta` 分支；tip SHA 拉不到时回退 raw/jsDelivr 探测。

## English

- **Fix update failure `http 302`**: download via `codeload.github.com` and follow redirects manually so Electron/some Node builds no longer stall on github.com → codeload 302.
- **Fix empty beta list**: client `keepListedVersion` matches the server — keep the beta tip / `beta` branch after stable ships; fall back to raw/jsDelivr when tip SHA cannot be fetched.

# 1.1.27

## 中文

- **修复应用重启后进规则设定仍弹「需要重启」**：手动「应用」成功后写入 `applied` 戳，重启后 settle 不再误判补丁未对齐。
- 点「重启」清掉 `boot_full_quit` 粘性标记；status 按布尔值同步弹窗。
- web `waitForRestart` 必须先看到旧进程掉线再判定成功，避免同进程误刷新又弹窗。

## English

- **Fix restart prompt still showing after Apply + successful restart**: write the `applied` stamp on successful manual Apply so settle does not think patches are out of date.
- Clear sticky `boot_full_quit` when Restart is clicked; status syncs the modal from the boolean.
- Web `waitForRestart` requires the old process to go down before treating restart as success, avoiding same-process false refresh.

# 1.1.26

## 中文

- **修复测试通道被正式版同号藏掉**：`1.1.25` 正式发布后，`1.1.25-beta.*` 因「正式已追上」逻辑整通道不可见；现 **beta 分支 tip 始终列出**（正式/测试并行，测试带红队）。
- 已追上的旧 beta **标签**仍会隐藏；`1.1.11-beta` 仍下线。

## English

- **Fix beta lane hidden by same-number stable**: after `1.1.25` stable, `1.1.25-beta.*` vanished via the “stable caught up” filter; the **beta branch tip always stays listed** (parallel channels; beta carries red-team).
- Older caught-up beta **tags** still hide; `1.1.11-beta` stays withdrawn.

# 1.1.25

## 中文

- **修复 [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**：不再把 `profiles/*/cordis.patch.yml`（用户 patch 层）纳入 `backupAll`/`revertAll`；升级自愈时不会用旧 bak 覆盖用户后来追加的 `insert`。
- 启动/还原时主动丢掉历史上误建的 `cordis.patch.yml.dshpurge.bak`，保留当前用户文件。
- 新增 `npm run test:profile-patch`。

## English

- **Fix [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**: stop including `profiles/*/cordis.patch.yml` (user patch layer) in `backupAll`/`revertAll`, so upgrade reapply no longer restores an old bak over later user `insert`s.
- Drop stale `cordis.patch.yml.dshpurge.bak` without restoring; keep the live user file.
- Add `npm run test:profile-patch`.

# 1.1.24

## 中文

- **修复 [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**：`pathLooksDesktop` 不再仅凭路径里的 `deepseek-harness` 子串把源码版判成桌面端；需带 `resources/` / `.exe` / `.app` 等安装形态。
- **修复 [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**：源码部署的 `apps/cli`（tsdown 构建产物）禁止 hide-console 注入；`revertAll` 在无 `.dshpurge.bak` 时只跳过、绝不删除目标文件。
- 新增 `npm run test:surface` 回归。

## English

- **Fix [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**: `pathLooksDesktop` no longer treats source trees as desktop just because the path contains `deepseek-harness`; require install shapes (`resources/`, `.exe`, `.app`).
- **Fix [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**: skip hide-console injection into source `apps/cli` build output; `revertAll` never deletes targets when `.dshpurge.bak` is missing.
- Add `npm run test:surface`.

# 1.1.23

## 中文

- **修复 [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**：`#1`/`#2`/`#3` 提示词补丁每次 `apply` 叠加约 +841 字符、永不收敛。
- **原因**：替换产物仍以前一版文本为前缀，且未设 `skipIfMarked`，`autoApplyOnStart` 每轮都会再写一层。
- **修复**：为 `#1`/`#2`/`#3` 补 `skipIfMarked: true`（[#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)），并加 `npm run test:idempotence` 回归。
- 已膨胀的宿主文件不会自动缩回，需还原 `.dshpurge.bak` 或重装 dsh 后再 apply。

## English

- **Fix [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**: prompt patches `#1`/`#2`/`#3` grew by ~+841 chars on every `apply` and never converged.
- **Cause**: replacement text still starts with the previous pattern, and `skipIfMarked` was missing, so `autoApplyOnStart` rewrote every boot.
- **Fix**: set `skipIfMarked: true` on `#1`/`#2`/`#3` ([#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)); add `npm run test:idempotence`.
- Already-bloated host files are not auto-shrunk — restore `.dshpurge.bak` or reinstall dsh, then apply again.

# 1.1.22

## 中文

- **修复官方桌面点「应用」报 ENOENT**。`app.asar` 还在时，新建 `dsh-purge-child-process-hide.mjs` 会失败，路径被写成 `resources\app.asar\...\dsh-purge-child-process-hide.mjs`，补丁停在待应用。
- **原因**：官方客户端还带着 `app.asar` 时，Electron 会把 `resources\app` 映射进这个归档。归档里没有的新文件，用普通文件接口去创建就会 ENOENT。
- **两种写法都保留**。归档还在时，改写真实磁盘上的 `resources\app`。没有 `app.asar` 时仍用原来的 `node:fs`，包括 Web、社区桌面，以及官方包已经解开并把归档挪成 `app.asar.bak` 的情况。
- 安装目录不写死盘符。Web 和社区桌面的应用、重启保持原样。宿主仍对准 **dsh 0.1.7-rc.2**。

## English

- **Fixes ENOENT when Apply runs on the official desktop.** While `app.asar` is still present, creating `dsh-purge-child-process-hide.mjs` failed. The path was rewritten to `resources\app.asar\...\dsh-purge-child-process-hide.mjs`, and patches stayed pending.
- **Cause**: with the archive still in place, Electron maps `resources\app` into `app.asar`. Creating a file that is not already in the archive through the normal file API throws ENOENT.
- **Both write paths stay.** If the archive is still there, files are written on the real `resources\app` directory. If there is no `app.asar`, the previous `node:fs` path is unchanged. That covers Web, community desktop, and an official install that has already been unpacked and had the archive moved to `app.asar.bak`.
- Install paths are not pinned to a drive letter. Web and community desktop keep their existing Apply and restart. The host target remains **dsh 0.1.7-rc.2**.

# 1.1.21

## 中文

- **修复必需补丁失败 #43、#9、#15、#23、#42**。点「应用」不再因为这 5 条报「清洗未完成」。提示词本来就会写入；这 5 条没写上时，界面却把整次应用判失败，看起来像插件失效。
- **原因**：上级文件夹名叫 DeepSeek Harness 时，整棵目录被当成官方桌面。Web 的 npm 包因此被排除，这 5 条对得上的原文也没写进去。安装路径不写死盘符。现在只有旁边真有桌面程序，或路径在该安装的 `resources/app` 里，才算桌面安装。Web、社区桌面、官方桌面各自打自己的包。
- **#43**：去掉 Web 四个内置预设（standard、ptc、cordis、minimal）里的身份句。没写上时，预设里的原身份句会留在注入旁边。
- **#9**：审批请求自动放行。
- **#15**：沙箱 `confine` 不再包一层，命令按原样执行。
- **#23**：子代理默认深度从 1 提到 10。
- **#42**：给设置服务补回旧的 `register` / `get`，还在调旧接口的插件才能加载。
- 文件在、但这份原文不在当前版本里时，显示跳过，不再把整次应用判失败。原文还在时仍会写上。

## English

- **Fixes required-patch failures #43, #9, #15, #23, and #42.** Apply no longer reports the cleanse as incomplete because of these five. The prompt was already written; the failure made the plugin look dead.
- **Cause**: a parent folder named DeepSeek Harness was treated as the official desktop install, so the Web npm packages were excluded and these five were never written. Install paths are not pinned to a drive letter. A tree counts as the desktop install only when the desktop executable is beside it, or the path is under that install's `resources/app`. Web, community desktop, and official desktop each patch their own packages.
- **#43**: strips the identity sentence from the four built-in Web presets (standard, ptc, cordis, minimal). Left in place, that sentence stays next to the inject.
- **#9**: approval requests are auto-granted.
- **#15**: sandbox `confine` no longer wraps the command.
- **#23**: subagent default depth moves from 1 to 10.
- **#42**: the settings service gets the old `register` / `get` methods back, so plugins that still call them can load.
- When the file exists but this version does not contain that original text, the row shows skipped and Apply still completes. Text that is present is still written.

# 1.1.20

## 中文

- **宿主版本**：当前对准 **dsh 0.1.7-rc.2**。上一档 **0.1.7-rc.1**（含 `0.1.7-rc.1.20260924.1`）的旧锚点仍可用。
- **官方桌面升级**：已经下载的新版本会在重启，或在应用里点安装并重启时真正安装，然后解开新版本并重新打补丁。没有新版本时，重启仍是关掉再打开当前客户端。安装目录不写死盘符。
- **补丁**：#14、#35 跟上 rc.2 的升级写法，不再报必需补丁失败。#29、#33、#36 的新提示句也会打上。
- Web 和社区版 DSH Desktop 的应用、重启保持原样。

## English

- **Host version**: current target is **dsh 0.1.7-rc.2**. Anchors for the previous target, **0.1.7-rc.1** (including `0.1.7-rc.1.20260924.1`), still match.
- **Official desktop upgrade**: a downloaded update installs on Restart, or on the in-app install-and-restart action, then the new build is unpacked and patched. With no pending update, Restart still closes and reopens the current client. Install paths are not pinned to a drive letter.
- **Patches**: #14 and #35 match the rc.2 escalation text, so Apply no longer fails those required patches. #29, #33, and #36 follow the new prompt wording.
- Web and community DSH Desktop keep their existing Apply and restart.

# 1.1.19

## 中文

- **官方桌面 EXE**：支持官方 DeepSeek Harness。点「应用」解开 `app.asar` 并补上原生模块，再点「重启」，客户端自己关掉并重新打开。Web 和社区版 DSH Desktop 的应用、重启保持原样。
- **重启**：官方客户端退出不再被外壳当成崩溃，也不会留下后台 PowerShell。重启脚本不再调用 Windows 脚本宿主没有的 `toISOString`，避免弹出运行时错误。新进程不再继承 `ELECTRON_RUN_AS_NODE`，否则会刚打开就退出。
- **更新**：换版本或回退时，按落地的那一版自动还原再应用，不必每次手动先还原再应用再重启。
- **补丁列表**：宿主已经自带 `dsh-web-fetch-http` 时，不再显示一条永远跳过的 #20。安装目录不再写死盘符。

## English

- **Official desktop EXE**: Apply on official DeepSeek Harness unpacks `app.asar`, restores native modules, then Restart closes the client and opens it again. Web and community DSH Desktop keep their existing Apply and restart.
- **Restart**: exiting the official host is no longer treated as a crash, and no PowerShell process is left behind. The helper no longer calls `toISOString`, which made Windows Script Host pop a runtime error. The new process does not inherit `ELECTRON_RUN_AS_NODE`, which made it exit immediately.
- **Updates**: switching or rolling back a version restores and reapplies that version's patches without a manual revert first.
- **Patch list**: hosts that already depend on `dsh-web-fetch-http` no longer show a permanently skipped #20. Install paths are not pinned to a drive letter.

# 1.1.18

## 中文

- **重启**：点「重启」后旧页面的 token 会失效，只刷新等于打不开。现在会等端口释放（必要时结束旧进程），并按新进程打印的地址打开浏览器。请用新打开的页面，再新开一轮对话。
- **设置**：1.1.17 之前若已把 `legacyApplyPath` 叠进 `dsh-settings`，点「应用」会收成一份，提供商目录才能起来。收好之后再重启一次。

## English

- **Restart**: the old page token dies with the process, so a refresh looks like restart did nothing. Restart now frees the port and opens the browser at the new `dsh web:` URL. Use that page and start a new chat.
- **Settings**: Apply collapses duplicate `legacyApplyPath` left by earlier 1.1.17 patches so `dsh-settings` can load. Restart once after that apply.

# 1.1.17

## 中文

- **稳定性**：修复设置补丁 #42 在 dsh 0.1.7 上重复插入 `legacyApplyPath` 的问题。此前会导致 `@deepseek-ai/dsh-settings` 无法加载、提供商目录报错、mnemon 等插件连锁 pending。现改为 `skipIfMarked`，且不再与官方已自带的 `legacyApplyPath` 叠写。
- **工作区强指令**：#1/#2 同时识别 `WORKSPACE_*` 与 `AGENT_*` 常量名，避免「全局/替换式免责」在旧宿主上显示跳过、应用无效。
- **拒答与软拒**：官方 `agent-instructions` 强指令补充本机授权评测与反软拒话术；插件增加固定 `dsh-purge:rules` 段（与执行规则一致）。**新开会话并重启 dsh 后**生效。

## English

- **Stability**: patch #42 no longer stacks duplicate `legacyApplyPath` on dsh 0.1.7, which broke `@deepseek-ai/dsh-settings`, provider catalog loading, and downstream plugins. Uses `skipIfMarked` and does not re-insert the helper the official package already ships.
- **Workspace intros**: patches #1/#2 match both `WORKSPACE_*` and `AGENT_*` constant names so rows no longer show Skipped on older installs.
- **Refusal / soft refusal**: stronger official workspace intros plus a fixed `dsh-purge:rules` section. **Restart dsh and start a new chat** for prompt changes.

# 1.1.16

## 中文

- 对准 **dsh 0.1.7-rc.1**。工作区说明常量改名为 `AGENT_INSTRUCTIONS_INTRO`，句子没变，补丁跟着改。
- 沙箱 `confine()` 已是 `async confine(argv, policy, signal)`，补丁按新函数写。直通行为与上一版相同。
- 子代理深度改到 `dsh-subagent`，默认从 1 提到 10。深度检查还在。
- 设置服务补回旧的 `register` / `get`。`dsh-mnemon`、`dsh-better-reasoning-effort` 这类还在调旧接口的插件可以继续用。官方 `describe` / `update` 不动。补丁只打一次，不会在启动时重复插入。
- 删掉 0.1.7 里已经对不上的旧条文，包括单独给 `dsh-base` 补 `dsh-web-fetch-http` 依赖的那条。官方包已经自带。
- Web 四个内置预设（standard、ptc、cordis、minimal）只清空身份句。工作目录、工具列表、`ptc` 模式，以及 minimal 的 `complete: true` 和 `includeRuntimeContext: false` 不动。
- `complete: true` 时，`prompt-inject.md` 仍接在这段前面。换宿主版本或旧钩子删段之后，注入不会丢。点「应用」之后仍要再点「重启」，新开一轮对话才进当前会话。
- `dsh-compaction-instant` 网页端从已删除的 `settingsScope` 改到 `configForms`，页面不再停在 Failed to load plugins。
- 回退在 0.1.7 上会建出新会话，但界面仍停在旧对话，看起来像没反应。0.1.7 已没有 `sessions.open`。现在改用 `uiWorkspace.openSession` 切到新会话，并把上一句填回输入框。失败原因显示在按钮上。
- README 的赞赏区换成非盈利声明：严禁商业售卖、付费倒卖或黑灰产牟利，仅供技术参考。

## English

- Aligned with **dsh 0.1.7-rc.1**. The workspace-instruction constant is now `AGENT_INSTRUCTIONS_INTRO`. The sentence is unchanged, and the patch follows it.
- Sandbox `confine()` is now `async confine(argv, policy, signal)`, and the patch matches that function. Passthrough behavior is the same as the previous release.
- Subagent depth lives on `dsh-subagent`. The default moves from 1 to 10. The depth check remains.
- The settings service again exposes the old `register` / `get` methods, so plugins such as `dsh-mnemon` and `dsh-better-reasoning-effort` keep working. Official `describe` / `update` stay. The patch applies once and does not insert itself again on startup.
- Patch text that no longer exists in 0.1.7 is removed, including the extra `dsh-web-fetch-http` dependency on `dsh-base`. The official package already depends on it.
- The four built-in Web presets (standard, ptc, cordis, minimal) lose only the identity sentence. The working-directory suffix, tool lists, `ptc` mode, and minimal's `complete: true` plus `includeRuntimeContext: false` stay.
- When `complete: true`, `prompt-inject.md` is still prepended to that section. A host upgrade or an older hook that drops the section does not drop the inject. After Apply you still click Restart and start a new chat before it enters the session.
- The `dsh-compaction-instant` web client uses `configForms` instead of the removed `settingsScope`, so the page no longer stops on Failed to load plugins.
- Rewind on 0.1.7 created the new session and left the UI on the old chat, so the click looked dead. 0.1.7 has no `sessions.open`. The button now opens the new session with `uiWorkspace.openSession` and puts the previous user line back in the composer. A failure shows on the button.
- The README sponsor block is now a non-profit notice: no commercial resale and no gray-market profit; technical reference only.
