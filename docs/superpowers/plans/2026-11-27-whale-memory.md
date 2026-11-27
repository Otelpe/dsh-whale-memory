# 鲸记（dsh-whale-memory）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发一个零依赖的 DSH 插件，把「时钟 + 落点 + 必查触发」注入每一步，并让任一旧原话能靠门牌逐字取回。

**Architecture:** 两个部分共用一套索引格式。CLI（`index`/`query`/`open`/`doctor`）负责扫会话日志、建索引、回取原文；宿主插件只做两段 `systemPrompt.context` 注入，读同一份索引。全部纯 ESM、Node 内建模块，无第三方依赖。

**Tech Stack:** Node ≥ 20（开发机 24.22.3）、ESM、`node:test` + `node:assert/strict`、`node:zlib`（zstd）、`node:crypto`（sha256）。

**Spec:** `docs/superpowers/specs/2026-11-27-whale-memory-plugin-design.md`

## Global Constraints

- 运行时不引第三方依赖（`dependencies` 为空；`peerDependencies` 只有可选的 `@deepseek-ai/cordis`）。
- 默认配置里一处本机绝对路径都不许有；只允许空值。
- 会话日志多帧 zstd，必须逐帧解；`zlib.zstdDecompressSync` 只解第一帧。
- 门牌格式固定 `log:session-<uuid>#seq=<n>&h=<sha8>`；`h` = `sha256(role + "\n" + text)` 前 8 位。
- 索引行固定 8 字段：`v, session, seq, time, role, text, chars, path`。
- 插件注入全部包 try/catch，异常只写 `[whale]` 一行日志，绝不抛进装配。
- 每条注入有字节上限，超限告警 + 按字符边界截断，不静默。
- 目录 `E:\Plugin Development`；临时产物落 `E:\work\_tmp-logs\`。
- 仓库 MIT；提交信息用英文 `feat:`/`test:`/`docs:` 前缀。

## Review Focus

- **空索引 / 索引不存在**：使用者第一次装、还没跑 `index`。预期 door 照常出现，recall 输出空串并打一行 `[whale] index not found`，不是报错、也不是塞假数据。
- **老日志（v3/单帧 zstd）**：日志格式换过。预期逐帧解析对单帧也成立，解出 0 条要报错退出码 1。
- **日志被压缩工具重建后 seq 偏移**：门牌还在旧 seq 上。预期 `open` 校验哈希不符时明确说「原文已变」，不给错行。
- **非中文查询 / 纯英文**：片段切分要按英文词而非字节。预期英文 token 也参与打分。
- **同名工作区目录含空格或中文**：目录名是转义过的（`--E-Plugin~0020Development--`）。预期索引器只把它当路径，不反解、不显示成标题。

---

### Task 1: 骨架与门牌格式

**Files:**
- Create: `package.json`, `.gitignore`, `LICENSE`, `bin/dsh-whale-memory.js`
- Create: `lib/sign.js`
- Test: `test/sign.test.mjs`

**Interfaces:**
- Produces: `formatSign({session, seq, role, text}) -> string`（`log:session-<session>#seq=<seq>&h=<sha8>`）、
  `parseSign(sign) -> { session, seq, hash } | null`、`hashLine(role, text) -> sha8`。

- [ ] **Step 1: 写 package.json**

`type: "module"`、`bin: {"dsh-whale-memory": "bin/dsh-whale-memory.js"}`、`files: ["lib","bin","cordis.patch.yml","README.md"]`、
`scripts.test = "node --test test/"`、`engines.node = ">=20"`、`license: "MIT"`。

- [ ] **Step 2: 写失败测试 `test/sign.test.mjs`**

断言：`hashLine("user","你好")` 为 8 位小写 hex；`formatSign` 拼出的串能被 `parseSign` 还原；
`parseSign("log:session-abc#seq=7")`（无 h）返回 `hash: null`；`parseSign("乱写")` 返回 `null`。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test` → Expected: FAIL，`Cannot find module '../lib/sign.js'`。

- [ ] **Step 4: 实现 `lib/sign.js`**

`node:crypto` 的 `createHash("sha256")`，取 `digest("hex").slice(0,8)`；`parseSign` 用一条正则，不 split 拼接。

- [ ] **Step 5: 跑测试 + 提交**

Run: `npm test` → PASS。`git init` 后 `git add -A && git commit -m "feat: door sign format with content hash"`。

---

### Task 2: 多帧会话日志读取

**Files:**
- Create: `lib/session-log.js`
- Test: `test/session-log.test.mjs`

**Interfaces:**
- Produces: `splitFrames(buffer) -> Buffer[]`；`readRecords(file) -> { records, frames, failed }`（records 为解出的 JSON 对象数组，按行顺序）；
  `listSessionFiles(sessionsRoot) -> Array<{ session, file, size, mtimeMs }>`。
- Consumes: Task 1 的 `hashLine`（Task 3 起用）。

- [ ] **Step 1: 写失败测试**

用 `zstdCompressSync` 把三段 JSONL 分别压缩后首尾相接成一个 fixture（写进 `test/fixtures/multi-frame/`），
断言 `readRecords` 解出全部 3 条、`frames === 3`、`failed === 0`；再造一个损坏中段，断言 `failed >= 1` 且不抛异常。

- [ ] **Step 2: 跑测试确认失败** — Run: `npm test` → FAIL。

- [ ] **Step 3: 实现 `splitFrames`**

按 zstd 帧魔数 `0x28 B5 2F FD` 扫描切分（跳跃式：从当前位置找下一个魔数）；每帧单独 `zstdDecompressSync`，单帧失败记 `failed` 并继续。

- [ ] **Step 4: 实现 `readRecords` / `listSessionFiles`**

`fs.readdir` 递归匹配 `session-*/session.v*.jsonl.zstd`；`session` 取目录名里的 uuid 部分。

- [ ] **Step 5: 跑测试 + 提交** — `git commit -m "feat: multi-frame zstd session reader"`。

---

### Task 3: 索引器与增量

**Files:**
- Create: `lib/indexer.js`
- Test: `test/indexer.test.mjs`

**Interfaces:**
- Produces: `buildIndex({ sessionsRoot, outDir, full }) -> { written, skipped, failed, logs }`；
  索引文件 `<outDir>/words.jsonl`，行格式见 Global Constraints；`<outDir>/meta.json` 里 `files` 为
  `{ [相对路径]: { size, mtimeMs } }`。
- Consumes: Task 2 的 `readRecords`、`listSessionFiles`。

- [ ] **Step 1: 写失败测试**

对 fixture 建索引后断言：`words.jsonl` 行数等于预期原话数；只收 `user/message` 与 `assistant/message` 的文本；
`text` 以 `[` 开头的记录被跳过；`role+text` 的哈希与 `formatSign` 一致；第二次运行 `skipped === files` 且 `written === 0`；
`--full` 后 `written > 0`。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `buildIndex`**

`seq` = 该文件解帧后 JSONL 行号（从 1 开始，不重编号）；`time` 取记录的 `time` 字段转 ISO；
`chars` = `text.length`；`path` = 相对 `sessionsRoot` 的路径（正斜杠）。
写出用临时文件 + rename，避免半份索引。

- [ ] **Step 4: 跑测试 + 提交** — `git commit -m "feat: incremental indexer"`。

---

### Task 4: 查询打分

**Files:**
- Create: `lib/score.js`
- Test: `test/score.test.mjs`

**Interfaces:**
- Produces: `grams(text) -> { tri: Set<string>, bi: Set<string>, en: Set<string> }`；
  `scoreLine(queryGrams, lineGrams) -> { tri, bi, en, ratio }`；
  `passes(score, thresholds) -> boolean`，`thresholds = { minTri, minBiWithOneTri, minBi, minBiRatio }`。
- Consumes: 无（纯函数）。

- [ ] **Step 1: 写失败测试**

用例：`"这个插件怎么装"` 与同句子只差一字 → `tri >= 2` 判过；
仅两个常见 2 字词重合（`"一个"`/`"什么"`）→ 判不过（停用词表生效）；
英文 `"dsh plugin install"` 与同串 → `en` 命中判过；空查询 → 判不过。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

中文按 2 字 / 3 字滑窗，停用词表照抄设计文档里那一份（26 个常见词）；英文按 `/[a-z0-9_-]{2,}/i` 取词。
`ratio = 命中 bi 数 / 查询 bi 总数`。

- [ ] **Step 4: 跑测试 + 提交** — `git commit -m "feat: trigram scoring with stopwords"`。

---

### Task 5: CLI 四命令

**Files:**
- Create: `lib/cli.js`, `bin/dsh-whale-memory.js`（shebang + 调 `cli.js` 的 `main`）
- Test: `test/cli.test.mjs`

**Interfaces:**
- Produces: `main(argv) -> Promise<exitCode>`，支持 `index|query|open|doctor`；
  `query` 输出每行 `<time> <session前8位> <片段> └ <门牌>`；`open` 校验哈希后打印原记录 `text`。
- Consumes: Task 2/3/4 的模块，Task 1 的 `parseSign`/`hashLine`。

- [ ] **Step 1: 写失败测试**

`main(["index","--sessions",fixture,"--out",tmp])` → 0；
`main(["query","装插件","--index",tmp])` → 0 且 stdout 含门牌；
`main(["open","log:session-<id>#seq=<n>&h=<正确哈希>","--sessions",fixture])` → 0 且输出原文；
同一门牌把哈希改一位 → 非 0 且 stderr 含 `原文已变`；
`main(["doctor"])` 无索引 → 0 且提示 `index not found`。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `main`**

参数自己解析（不引库）：`--sessions`、`--out`、`--index`、`--limit`、`--full`、`--json`。
所有错误写 stderr 并返回退出码 1；`doctor` 永远返回 0。

- [ ] **Step 4: 跑测试 + 提交** — `git commit -m "feat: cli index/query/open/doctor"`。

---

### Task 6: 召回文本

**Files:**
- Create: `lib/recall.js`
- Test: `test/recall.test.mjs`

**Interfaces:**
- Produces: `renderRecall({ query, index, thresholds, maxHits, maxSnippet, excludeSessions }) -> string`。
  无命中返回 `""`。
- Consumes: Task 4 的 `grams`/`scoreLine`/`passes`。

- [ ] **Step 1: 写失败测试**

命中 1 条 → 输出只含该条，带门牌与命中片段说明；查询与索引毫无交集 → `""`；
候选里有本会话 `excludeSessions` → 被排除；`maxHits: 1` 时只出 1 条；输出中不出现「我们讨论了」这类转述词（断言不含 `讨论了`）。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

两档并联（3 字主判据 / 1 tri + 4 bi / 6 bi + 覆盖率），按分数降序截断；每条只放 `time`、片段前 90 字、门牌。

- [ ] **Step 4: 跑测试 + 提交** — `git commit -m "feat: pointer-only recall text"`。

---

### Task 7: 宿主插件与门文本

**Files:**
- Create: `lib/door.js`, `lib/index.js`, `cordis.patch.yml`
- Test: `test/door.test.mjs`

**Interfaces:**
- Produces: `renderDoor({ now, restEntry, memqCmd, maxBytes }) -> string`；
  `lib/index.js` 导出 `name`、`inject = ['systemPrompt']`、`apply(ctx, config)`、`DEFAULTS`。
- Consumes: Task 6 的 `renderRecall`、Task 3 的索引读取。

- [ ] **Step 1: 写失败测试**

`renderDoor` 固定时钟下含「现在：」与中文星期；`restEntry` 为 `null` 时不含「上次停在这」；
给 `maxBytes: 120` 时长度不超过 120 字节且末尾不切半个汉字（用 `Buffer.byteLength` 断言）；
`apply` 用假 `ctx`（记录 `systemPrompt.context` 调用）断言注册了 `whale:door`（order 130）与 `whale:recall`（order 132），
且 `text()` 第二次调用返回同一字符串（缓存生效）。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现**

`door` 四行：时钟 / 上次停在这（有 `restPath` 且末条 `open`）/ 必查触发四条 / 门命令。
`index.js` 里 `ctx.inject(['systemPrompt'], scope => scope.systemPrompt.context({ name, order, text }))`，
两个 `text` 都是闭包 + 缓存；整个 `apply` 包 try/catch。

- [ ] **Step 4: 写 `cordis.patch.yml`**（`insert` 一行，config 全注释，见设计文档 5.3）。

- [ ] **Step 5: 跑测试 + 提交** — `git commit -m "feat: door and recall injection"`。

---

### Task 8: 收尾与验收

**Files:**
- Create: `README.md`、`test/acceptance.test.mjs`
- Modify: `package.json`（`version: 0.1.0`、`keywords`、`repository` 留空待填）

- [ ] **Step 1: 写验收测试**

按设计文档第六节逐条断言：fixture 建索引 → query 命中 → open 回原文一致 → 全仓 `grep` 默认配置无 `E:\\DSH-data`。

- [ ] **Step 2: 跑全量测试** — `npm test` → 全绿。

- [ ] **Step 3: 写 README**（三行装法、四命令、配置表、门牌格式、`restPath` 格式）。

- [ ] **Step 4: 本机装上实跑**

`& 'E:\DSH\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add link:'E:\Plugin Development'`，
重启后确认新会话首屏有 `whale:door`、同一会话第二步不重算。

- [ ] **Step 5: 提交** — `git commit -m "docs: readme and acceptance tests"`。
