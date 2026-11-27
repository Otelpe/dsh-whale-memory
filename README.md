# dsh-whale-memory · 鲸记

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的跨会话记忆插件。
它不写摘要，只做两件事：**每回合提醒你该查**，**查的时候把原话还给你**。

**语言**：[中文](README.md) · [English](README.en.md)

---

## 它解决什么

会话记录都躺在硬盘上，但要用的时候，多半是想不起来去找 —— 不是检索不准，是没触发。

这个插件补两层：

1. **门**。每回合在系统提示最上面注入一小段：现在几点、上次停在哪、哪几种情况必须先查。
2. **门牌回取**。`query` 找行，`open` 把那行的**逐字原文**还给模型，附一个带内容指纹的门牌。

没有向量库，没有 LLM 摘要，不改你的会话日志。

## 装

三种方式，从简到繁。

**一、从 npm（发布后可用）**

```bash
dsh plugin --profile <你的 profile 名> add dsh-whale-memory
```

**二、直接从 GitHub 装**

```bash
dsh plugin --profile <profile> add github:Otelpe/dsh-whale-memory
```

**三、下载源码，本地装**

到 [Releases / Tags](https://github.com/Otelpe/dsh-whale-memory/tags) 下 `Source code (zip)`，
解压到一个固定目录，然后：

```bash
dsh plugin --profile <profile> add link:<解压出来的目录>
```

桌面端装插件需要 `danger-full-access` 级别；装完重启 DSH 才加载。

## 配

在 profile 的 `cordis.patch.yml` 里给它一段 `config`（完整字段见 [cordis.patch.yml](cordis.patch.yml)）。
最少填两个：

```yaml
- id: dsh-whale-memory
  config:
    sessionsRoot: 'D:/DSH-data/sessions'                        # 会话日志根目录
    indexPath: 'D:/DSH-data/memory/index/words.jsonl'           # 索引落点
```

不填 `indexPath` 就没索引可查；不填 `sessionsRoot` 就没有冷启动召回。别的都能用默认值。

| 字段 | 默认 | 作用 |
|---|---|---|
| `door` / `recall` | `true` / `true` | 两段注入各自开关。宿主自带门的场合，把 `door` 关掉 |
| `restPath` | 空 | 可选，落点 JSONL；填了门里会多出一行「上次停在这」 |
| `autoIndexMinutes` | `30` | 索引过期就自己在进程内重建；`0` 关掉 |
| `sessionPick` | `true` | 用「最近动过的日志」近似本会话 |
| `sessionPickWindowMs` | `600000` | 只认这么多毫秒内动过的日志，更旧的宁可空着 |
| `maxDoorBytes` | `600` | 门的大小预算，超了会告警并截断 |

## 用

```bash
dsh-whale-memory index --sessions <会话日志根> --out <索引目录> [--full]
dsh-whale-memory query <词> [--index <目录或文件>] [--limit 25]
dsh-whale-memory open <门牌> --sessions <会话日志根>
dsh-whale-memory doctor [--index <目录>] [--max-age <分钟>]
```

`index` 是增量的：没变的文件按 `(大小, mtime)` 跳过。`--full` 强制重建。

平时你不需要敲这些。装了插件以后，索引会自己重建，模型自己会查。

## 门牌

```
log:session-<uuid>#seq=<行号>&h=<8 位哈希>
```

`seq` 是解完所有 zstd 帧之后的行号，不是重新编的序号。`h` 是 `sha256(role + "\n" + text)` 的前 8 位。

所以：**行号漂了也能按内容找回同一条**，`open` 会用哈希扫一遍，找到就回原文并说明「行号已变」。
只有内容真的被改掉或删掉，才报「原文已变」—— 宁可不给，也不给错行。

## 实测

- 212 份会话日志、9000+ 条原话，建索引约 4 秒，坏帧 0。
- 47 个测试，零运行时依赖，只用 Node 内建模块。

## 它不做什么

- 不写日记、不主动搭话、不定时醒来。
- 不用向量库，不生成摘要，不把转述当记忆。
- 不改你的会话日志，只读。
- 不发私信、不连 QQ 或微信。

## 已知取舍

- **冷启动召回靠「最近动过的日志」** 近似本会话。同时开两个会话时会认错 —— 只影响首轮那一条提示，不污染索引。根治要等宿主暴露会话 id。
- **索引是快照**。默认 30 分钟内会自动重建；需要更实时就把 `autoIndexMinutes` 调小。
- **门和宿主自带的提示可能重复**。重复就关 `door`，留 `recall`。

## 开发

```bash
git clone https://github.com/Otelpe/dsh-whale-memory
cd dsh-whale-memory
npm test          # node --test，零依赖
```

目录：`lib/` 全部实现，`bin/` 命令行入口，`test/` 测试，`docs/` 设计稿与发布记录。

## 许可

MIT。
