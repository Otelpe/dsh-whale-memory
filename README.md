# dsh-whale-memory · 鲸记

Pointer-based cross-session memory for **DeepSeek Harness (DSH)**.

It does two things and nothing else:

1. **A door in every prompt.** Clock, last landing point, and the four situations that
   require a lookup before answering. Short, cached, no tool calls.
2. **Verbatim retrieval by signed pointer.** `index` scans your session logs, `query`
   finds a line, `open` gives you that exact line back — and refuses if the line changed.

No embeddings, no summaries-as-memory, no scheduled wake-ups. A summary is an index;
the raw line is the memory.

## Install

```bash
dsh plugin --profile <your-profile> add dsh-whale-memory
```

Then set at least `indexPath` (and `sessionsRoot` if you want cold-start recall) in your
profile's `cordis.patch.yml` — see `cordis.patch.yml` here for the full config shape.
Restart DSH to load it.

## CLI

```bash
dsh-whale-memory index --sessions <dir> --out <dir> [--full]
dsh-whale-memory query <词> [--index <dir-or-file>] [--limit 25]
dsh-whale-memory open <门牌> --sessions <dir>
dsh-whale-memory doctor [--index <dir-or-file>]
```

`index` is incremental: unchanged files are skipped by `(size, mtimeMs)`; `--full` rebuilds.

## The pointer (`门牌`)

```
log:session-<uuid>#seq=<n>&h=<sha8>
```

`seq` is the line number after decoding every zstd frame of the log — not a re-numbered
sequence. `h` is the first 8 hex chars of `sha256(role + "\n" + text)`.
`open` verifies `h`; a mismatch prints `原文已变` and refuses to hand you the wrong line.

## Config (`cordis.patch.yml`)

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `sessionsRoot` | `''` | session log root; empty disables recall |
| `indexPath` | `''` | `words.jsonl` path (a directory also works) |
| `restPath` | `''` | optional landing-point JSONL; empty hides that line |
| `doorOrder` / `recallOrder` | `130` / `132` | injection order |
| `memqCmd` | `npx dsh-whale-memory` | command shown inside the door |
| `maxDoorBytes` | `600` | door byte budget; truncation warns |
| `maxHits` / `maxSnippetChars` | `2` / `90` | recall shape |
| `thresholds` | `{minTri:2, minBiWithOneTri:4, minBi:6, minBiRatio:0.3}` | three parallel gates |
| `recallQuery` | `''` | the first human line of this session, if your host can supply it |
| `timeZone` | `Asia/Shanghai` | clock rendering |

Every default is empty or neutral: no machine-specific path ships in this package.

### `restPath` format

One JSON object per line; the last `status: "open"` row wins:

```json
{"status":"open","text":"在验重启后的三件事","fromSeq":12,"toSeq":30,"at":"2026-11-27T15:20:00.000Z"}
```

The plugin only reads this file. Anything that can write JSONL can produce it.

## What it deliberately does not do

- No proactive messages, no diaries, no cron, no QQ/WeChat bridges.
- No vector store, no LLM summarization of your history.
- No writes to session logs. Read-only.
- No "we discussed earlier…" text. Recall returns pointers and verbatim snippets only.

## Tests

```bash
npm test
```

`node --test`, zero dependencies, fixtures built in-process as multi-frame zstd.

## License

MIT.
