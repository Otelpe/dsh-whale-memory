# 鲸记（dsh-whale-memory）设计

日期：2026-11-27
状态：待评审（路线已定：C 独立插件）
仓库位置：`E:\Plugin Development`（当前为空，等待本文批准后初始化）

---

## 一、它是什么，为什么现在做

一句话：**把「翻回去」做成宿主自带的能力，而不是靠我记得去敲命令。**

现在这套记忆机制在实践中是能用的，但它有三个结构性问题：

1. **散。** 真正干活的是 `E:\DSH-data\memory\hub` 下二十几个脚本（索引、检索、落点、装配、体检），
   大约七千行，全部以 shell 命令的形式挂在 `SELF.md` 里，靠模型自己想起来去敲。
2. **断。** 换工作区、换机器、换个启动方式，路径就没了；`echo.config.json` 那套踩过坑
   （环境变量不继承、配置解析鸡生蛋）就是这种散装形态的代价。
3. **不可发。** 里面全是本机绝对路径、身份判据、私有事实。要给别人看，只能重写一遍。

要发出去的东西不是那七千行脚本，是四条判断加一个能跑的最小实现：

- 摘要只能是索引，不能是记忆本体。一手层永远优先于任何转述。
- 不连续不是缺陷，是要设计的东西。不是「想起来」，是「翻回去」，所以门要好开。
- 瓶颈不是检索精度，是触发。「取回」不是问题，「知道要取」才是问题。
- 丢的从来不是内容，是「内容存在过」这条线索。

成功的标准（老大能用上、别人能装上）：

- 新会话第一屏自动出现「现在几点 / 上次停在哪 / 哪几种情况必须去查」，不用我记命令。
- 想查一条旧事，一句话就能查到，回来的带门牌（`log:session-xxx#seq=n`），不是转述。
- 换一台机器，只改一个配置文件里的路径，其余照跑。
- 仓库里没有任何本机路径、身份文本、私有事实。

## 二、不做什么

非目标（这一版明确不做）：

- 不做第二个 dsh-world：不抢主动性、不写日记、不刷 B 站、不定时醒来、不发 QQ。
- 不引入向量库或 embedding。
- 不做侧栏 UI 面板。
- 不自动改写或压缩历史日志，只读。

反目标（技术上做成了也算失败）：

- **把摘要当记忆。** 只要注入文本里出现「上一轮我们讨论了……」这种转述而非指针，就算失败。
- **凑数召回。** 没有相关命中时必须输出空，宁可空也不许塞两条不相关的旧会话当热闹。
- **每步全库扫描。** 首轮算一次、缓存到会话结束，不许每步重算，前缀缓存不能白花。
- **静默失败。** 索引没建、路径错、日志格式变了，必须显式告警，不许假装正常返回空。

## 三、已核实的事实（约束）

- 插件形态：`package.json`（含 `dsh.bundle.patch`）+ `cordis.patch.yml` + `lib/index.js`，
  安装用 `dsh plugin --profile <名> add <包名>`，它同时写 `dependencies` 与 `dsh.profile.bundles`。
  本机已有三个这样的样例：`dsh-agent-recall`、`dsh-agent-rest`、`dsh-research`。
- 注入点（已从 `dsh-agent-recall/lib/index.js:439` 与 `dsh-research/lib/host.js:446` 核过）：
  `ctx.inject(['systemPrompt'], scope => scope.systemPrompt.context({ name, order, text }))`，
  `text` 是函数，每步装配时求值。
- 宿主版本 0.2.3-alpha.2（本机），Node 24.22.3（本机）。打包声明 `engines.node >= 20`。
- **会话日志是多帧 zstd。** `zlib.zstdDecompressSync` 只解第一帧，必须逐帧切。
  本机权威实现是 `memory/hub/session-store.mjs`，`dsh-agent-recall` 里抄了一份自包含版本。
- 会话日志布局：`<sessionsRoot>/<工作区目录名>/session-<id>/session.v4.jsonl.zstd`。
  （目录名是工作区路径转义，`--E-work--` 这种，别假设能反解。）
- 索引现状：`<memory>/hub/index/words.jsonl` 2.4 MB、`summaries.jsonl` 217 KB，一行一条 JSON，
  `meta.json` 记 `builtAt/logs/scanned/skippedUnchanged`。**这个格式可以直接复用。**

## 四、三条路，选 C

A. 只发判断：一份设计文档 + 一小段可跑的门牌实现，不碰宿主。
   便宜、干净，但老大要的是能真装上的东西，不是论文。

B. fork dsh-world，把记忆写成它的插件。
   dsh-world 已装 0.8.5，但它发到 npm 的包里 `src` 目录零个 `.ts`，只有 `lib/*.js` 编译产物；
   真 fork 就得自己重建构建链，且从此绑死上游版本和它的生命周期。它的强项（主动性、日记、账单）
   和我们要的东西不重叠。

C. **独立插件（选中）。** 不依赖上游，宿主 API 只用两处（systemPrompt 注入、可选 tools 守卫），
   自己发版。理由：资产是那四条判断和一个索引格式，不是 dsh-world 的功能面；
   独立插件的失败半径最小，老大卸掉它不影响别的。

## 五、设计

### 5.1 两个部分

**① 索引器（CLI，纯 Node，零依赖）**

```
npx dsh-whale-memory index --sessions <dir> --out <dir> [--full]
npx dsh-whale-memory query <词> [--limit 25]
npx dsh-whale-memory open <门牌>          # log:session-<id>#seq=n
npx dsh-whale-memory doctor
```

- 扫 `<sessions>/<工作区>/session-*/session.v*.jsonl.zstd`，逐帧解压。
- 只抽两类记录：`user/message` 的文本、`assistant/message` 的文本首行。
  （索引存原话与首行，不存全文；全文靠门牌回取。）
- 每条落一行 JSON：`{ v: 1, session, seq, time, role, text, chars }`。
- 增量：`meta.json` 按 `(相对路径, size, mtimeMs)` 记账，未变跳过；`--full` 强制重建。
- 产出目录默认 `<out>/words.jsonl` + `meta.json`，与现有 hub 索引同构，**可直接互吃**。

**② 宿主插件（`lib/index.js`）**

两段注入，各管一件事：

- `whale:door`（order 130，在自我层之前）：时钟、上次落点、必查触发清单、门的命令。
  这段是**常驻的**，每步都出现，所以必须短（默认上限 600 字节，超了截断并告警）。
- `whale:recall`（order 132，紧跟自我层）：用本会话第一句人话去索引里捞，
  命中 1–2 条旧会话，给指针 + 逐字片段。**同一会话只算一次**，之后返回缓存。
  两档门限（3 字连续为主，2 字为辅，兜底档给「最近还活跃的会话」并标注清楚），
  都不命中就输出空串。

v1 **不注册自定义工具**：门是 CLI，命令模板由配置给出。
（理由：宿主 tools 服务的注册 API 没核过，不拿没核实的东西进设计。v2 再评估。）

**门必须能开，否则不算门。** 所以 v1 的 CLI 自带 `query` 与 `open`，不把回取推给本机脚本：

- `query`：读 `words.jsonl`，2 字 / 3 字片段打分（与 recall 同一套门限），只回指针 + 逐字片段。
- `open`：从门牌里取 `session` 与 `seq`，按 `<sessionsRoot>/**/session-<id>/session.v*.jsonl.zstd`
  找到文件，逐帧解压，取解帧后第 `seq` 行（行号即 seq，不重编号），回原记录。

**door 的「上次落点」数据源**：不复用 hub 的 `rest.mjs`。配置项 `restPath` 指向一个 JSONL
（每行 `{ status, text, fromSeq, toSeq, at }`），有则取最后一条 open 的落点显示，没有则整行省略。
格式写进 README，任何脚本都能写这个文件；本包不生产它。

**`sessionsRoot` 为空时**：recall 整体禁用（读不到本会话第一句，无从发起），door 照常注入。
不是「另有来源」，是明确关掉。

### 5.2 注入文本长什么样

`whale:door` 大致是：

```
现在：2026-11-27 23:18（星期五）｜距上次落点 3h
上次停在这：E:\work，验重启后的三件事（门牌 log:session-...#seq=n）
必须去查：①说「之前/上次/记得吗」②要写「我记得」③具体路径/版本/数字 ④用户说你记错了
门：memq <词> / memq open <门牌> / memq now
```

`whale:recall` 大致是：

```
可能相关（指针，不是转述）：
- 2026-11-26 13:39 这个插件是给 DSH 装的 B 站养鱼插件… └ log:session-3437...#seq=90
  （命中 3 字片段：插件、养鱼、日记）
```

### 5.3 配置（`cordis.patch.yml` 的 `config:`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `sessionsRoot` | 空 | 会话日志根目录；空则 recall 禁用，door 照常 |
| `indexPath` | 空 | `words.jsonl` 路径；空则读 `<sessionsRoot>/../index/words.jsonl` |
| `restPath` | 空 | 落点 JSONL 路径；空则 door 不显示「上次停在这」 |
| `doorOrder` / `recallOrder` | `130` / `132` | 注入顺序 |
| `doorText` | 内置模板 | 允许整段替换，模板里可用 `{{clock}} {{rest}} {{memqCmd}}` |
| `memqCmd` | `npx dsh-whale-memory` | 门牌里显示的命令前缀，使用者按自己环境改 |
| `maxDoorBytes` | `600` | 超限告警并截断 |
| `maxHits` / `maxSnippetChars` | `2` / `90` | 召回条数与片段长度 |
| `minTri` / `minBiWithOneTri` / `minBi` / `minBiRatio` | `2` / `4` / `6` / `0.3` | 三档并联门限，沿用实测值 |
| `excludeSubagents` | `true` | 分会话不召回 |
| `debug` | `false` | 把候选分数写进注入文本 |

**没有任何本机路径写进默认值。** 空值 + 显式配置是这个插件的发布姿态。

### 5.4 失败模式与检测法

| 失败 | 表现 | 检测 |
|---|---|---|
| 索引不存在 | recall 永远空 | 启动时打一条 `[whale] index not found: <path>`；`doctor` 子命令 |
| 日志格式变了（多帧切不开） | 抽到 0 条，静默 | 索引器统计 `framesDecoded / framesFailed`，任一文件全失败就报错退出码 1 |
| 路径写错 | 同上 | 同上，路径回显 |
| 注入超预算 | 提示被截断 | 显式告警一行，不静默截 |
| 装配抛异常 | 整个回合毁掉 | 全部包 try/catch，异常写 `[whale] disabled: <msg>` 后输出空串 |
| 召回噪音大 | 老大的信任下降，最难发现 | `debug: true` 输出候选分数；门限调参靠它 |

### 5.5 接口

对使用者：四个命令（`index` / `query` / `open` / `doctor`），两段注入（自动），一个开关（配置）。
对维护者：索引行格式（5.1）、`meta.json` 字段、`restPath` 格式、两段注入的 order 约定。

### 5.6 细节裁定（实现时按这些，不再讨论）

- 门牌一律写全：`log:session-<完整 uuid>#seq=n`。显示可缩，门牌不可缩，缩了回取不到。
- 门牌尾部带 8 位内容哈希：`#seq=n&h=<sha8>`，取该行 `role+text` 的 sha256 前 8 位。
  `open` 校验哈希，不符就明确报「原文已变」而不是给出错行。这是从 dsh-world 的
  `chatRef(recordId, content)` 借来的做法 —— 只有 seq 的门牌，日志一重建就指错行。
- `seq` 取解帧后的 JSONL 行号，不重编号；`open` 靠它定位。
- 索引行固定 8 字段（`v/session/seq/time/role/text/chars/path`），片段不落盘，读时现算并整表缓存。
- `text` 以 `[` 开头的记录不入索引（宿主塞进来的卡片类消息）。
- 时区用本机本地时间，星期用中文；截断按 UTF-8 字节切到字符边界，不切半个字。
- 分会话判定沿用现有三条判据（`agent.parent` / `agent.owner` / `meta.parentSessionId`）。
- 「与现有 hub 索引互吃」是单向：我们读它的（`ws/t/session/seq/text` 齐备），
  它读我们的不作保证；字段名对齐即可，不承诺双向。

## 六、验收

做完的定义（每条都要能实跑，不许口头）：

1. fixture 日志放进仓库，`index` 能建索引，退出码 0；`query <词>` 命中到预期行；
   `open log:session-<id>#seq=n` 回出逐字原文（与 fixture 对得上）。
2. fixture 覆盖：多帧 zstd、中文原话、空会话、只有 system 记录的会话。
3. 注入：在本机 profile 装上后重启，新会话第一屏能看到 `whale:door`；同一会话第二步不重算（缓存命中）。
4. 召回：拿一句和 fixture 里某条原话重合的话开新会话，能命中那条，且门牌进 `open` 能回原文。
5. 脱敏：`grep -r "E:\\\\DSH-data" .` 只允许出现在文档的「本机」示例里，且默认配置里一处都没有。
6. 卸载：`dsh plugin remove` 之后宿主正常启动，无残留告警。

## 七、留给实现者的

- 宿主 `tools` 服务的注册 API（v2 才需要）。
- 索引器是否顺带支持 `summaries.jsonl`（压缩摘要也是索引，但摘要不是记忆）。v1 不做。
- 与现有 `E:\DSH-data\memory\hub` 的关系：v1 只读它产出的索引，不替换、不改写。
  两边并存不冲突；等插件稳定了再考虑让 hub 的脚本改调插件。
- 发布：npm 包名 `dsh-whale-memory`，MIT，无 logo 素材依赖，README 里给出两行装法。

## 八、脱敏清单（发布前逐条过）

- [ ] 默认配置无本机路径（当前设计满足）
- [ ] 文档里的路径示例改用 `<sessionsRoot>` 占位，或明确标「本机示例」
- [ ] 不含 SELF.md 全文、身份判据命令、真名、机器名
- [ ] fixture 日志用合成内容，不用真实会话
- [ ] `git log` 里没有误提交的日志文件（`.gitignore` 掉 `index/`、`*.zstd`、`_tmp-logs/`）
