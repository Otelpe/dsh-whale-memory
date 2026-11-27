# dsh-whale-memory

Cross-session memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
No summaries. It does exactly two things: **reminds the model when to look**, and **hands back the verbatim line**.

**Languages**: [中文](README.md) · [English](README.en.md)

---

## The problem

Your session logs are already on disk. The hard part is not retrieval — it is *triggering* retrieval.
Nobody remembers to go look.

So this plugin adds two thin layers:

1. **A door.** A few lines at the top of every system prompt: current time, where we left off,
   and the four situations that require a lookup.
2. **Pointer retrieval.** `query` finds a line; `open` returns that line **verbatim**, with a signed
   pointer that carries a content fingerprint.

No vector store. No LLM summarization. Never writes to your session logs.

## Install

**1. From npm (once published)**

```bash
dsh plugin --profile <profile> add dsh-whale-memory
```

**2. Straight from GitHub**

```bash
dsh plugin --profile <profile> add github:Otelpe/dsh-whale-memory
```

**3. Download and link**

Grab `Source code (zip)` from [tags](https://github.com/Otelpe/dsh-whale-memory/tags), unzip somewhere
stable, then:

```bash
dsh plugin --profile <profile> add link:<unzipped-dir>
```

The desktop host requires `danger-full-access` to install plugins. Restart DSH afterwards.

## Configure

Add a `config` block in your profile's `cordis.patch.yml` (full shape in
[cordis.patch.yml](cordis.patch.yml)). Minimal:

```yaml
- id: dsh-whale-memory
  config:
    sessionsRoot: 'D:/DSH-data/sessions'                  # session log root
    indexPath: 'D:/DSH-data/memory/index/words.jsonl'     # where the index lives
```

Without `indexPath` there is nothing to query; without `sessionsRoot` there is no cold-start recall.
Everything else has a sane default.

| key | default | what it does |
|---|---|---|
| `door` / `recall` | `true` / `true` | switch each injection independently; turn `door` off if your host already ships one |
| `restPath` | empty | optional landing-point JSONL; when set, the door gains a "last time on" line |
| `autoIndexMinutes` | `30` | rebuild a stale index in-process; `0` disables |
| `sessionPick` | `true` | approximate "this session" by the most recently written log |
| `sessionPickWindowMs` | `600000` | only logs touched within this window count; older means no recall |
| `maxDoorBytes` | `600` | door byte budget; truncation warns instead of silently cutting |

## Use

```bash
dsh-whale-memory index --sessions <root> --out <dir> [--full]
dsh-whale-memory query <words> [--index <dir-or-file>] [--limit 25]
dsh-whale-memory open <pointer> --sessions <root>
dsh-whale-memory doctor [--index <dir>] [--max-age <minutes>]
```

`index` is incremental: unchanged files are skipped by `(size, mtime)`. `--full` rebuilds.
Once installed you rarely type these — the index refreshes itself and the model does the querying.

## The pointer

```
log:session-<uuid>#seq=<line>&h=<8 hex chars>
```

`seq` is the line number after decoding every zstd frame, not a re-numbered sequence.
`h` is the first 8 hex chars of `sha256(role + "\n" + text)`.

Consequences: **a drifted line number still resolves**, because `open` falls back to scanning the
log for the matching hash and reports the new position. Only if the content itself changed or
disappeared does it refuse with `原文已变` (the original text changed) — never the wrong line.

## Measured

- 212 session logs, 9000+ lines, ~4 s to index, zero bad frames.
- 47 tests, zero runtime dependencies (Node built-ins only).

## What it deliberately does not do

- No diary, no proactive messages, no scheduled wake-ups.
- No vector store, no summarization, no paraphrases posing as memory.
- No writes to your session logs. Read-only.
- No direct messages, no QQ/WeChat bridges.

## Known trade-offs

- **Cold-start recall approximates "this session"** by the most recently modified log. With two
  sessions running at once it may pick the wrong one — that affects one first-turn hint, never the
  index. A real fix needs the host to expose a session id.
- **The index is a snapshot.** It self-rebuilds every 30 minutes by default; lower
  `autoIndexMinutes` for fresher data.
- **The door can duplicate a host-provided prompt.** If it does, set `door: false` and keep `recall`.

## Development

```bash
git clone https://github.com/Otelpe/dsh-whale-memory
cd dsh-whale-memory
npm test          # node --test, no dependencies
```

Layout: `lib/` implementation, `bin/` CLI entry, `test/`, `docs/` (design + release notes).

## License

MIT.
