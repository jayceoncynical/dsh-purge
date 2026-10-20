# 运行时能力探测记录（E02 装机验证）

- 时间：2026-10-20
- 目的：确认"engines 提到 >=22.13.0"这个声明与实际宿主运行时一致，并确认演练台依赖的 `node:sqlite` 在两套宿主上都可用。
- 方式：只读探测——以 `ELECTRON_RUN_AS_NODE=1` 运行宿主可执行文件、或直接运行系统 node，执行一段**不写盘、不联网、不加载插件**的脚本；未应用任何补丁、未启动界面、未改动宿主文件。

## 探测结果

| 运行时 | Node 版本 | Electron | `node:sqlite` | FTS5 |
| --- | --- | --- | --- | --- |
| 桌面端（`D:\Harness\DeepSeek Harness.exe`，`ELECTRON_RUN_AS_NODE=1`） | 24.21.0 | 44.7.0 | 可用，`DatabaseSync` 为 function | 可用 |
| `dsh web`（系统 node，npm 全局前缀无自带 node.exe） | 24.21.0 | — | 可用 | 可用 |

探测脚本核心：
```js
import('node:sqlite').then((m) => {
  const db = new m.DatabaseSync(':memory:');
  let fts = false;
  try { db.exec('CREATE VIRTUAL TABLE t USING fts5(x)'); fts = true; } catch {}
  db.close();
  return { sqlite: true, DatabaseSync: typeof m.DatabaseSync, fts5: fts };
});
```

## 结论

1. 这台机器上两套宿主的内嵌运行时都是 Node 24.21.0，`node:sqlite` 与 FTS5 均可用，演练台可正常工作，`engines: >=22.13.0` 与实际相符。
2. 声明仍是**下限**：低于 22.13 的宿主会出现 `node:sqlite` 不可用或 API 差异。此时 `lib/redteam/store-core.js` 第 8 行的顶层 `import { DatabaseSync } from 'node:sqlite'` 会让演练台子插件挂载失败——宿主会把该插件标记为加载失败，其余功能不受影响。这一点是推断（未在低版本运行时上实测），但导入点只有这一处，影响面可确定。
3. FTS5 缺席的情况已有降级路径（`schema.js` 的 `HAS_FTS5` 探测 + LIKE 回退），并有 `REDTEAM_NO_FTS5=1` 的测试开关覆盖。

## 未覆盖

- 未在 Node 22.13.0 的真机验证（只有 CI 的 node:sqlite 相关测试在 22.13.0 上跑过，但那用的是系统 node，不是宿主内嵌运行时）。
- 未验证"宿主内嵌 Node 低于 22.13 时"用户看到的实际报错文案是否够清楚——需要一台装了旧版宿主的机器。
