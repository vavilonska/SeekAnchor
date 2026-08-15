# Pi DeepSeek RL-Anchor Extension (DSH Minimal)

> **This extension attempts to reproduce the model-visible DSH Minimal
> composition. It does not claim to unlock a hidden model or hidden reasoning
> capability.**

A research extension for Pi (0.84.x) that lets you run three modes —
`native`, `minimal`, `anchor` — to study whether reproducing the official
DeepSeek Harness (DSH) Minimal composition changes agent behavior on
`deepseek-v4-pro` / `deepseek-v4-flash`.

All DSH composition facts (system prompt, tool schemas, descriptions,
timeouts, result formats, wire parameters) were extracted from the **official
`deepseek-ai/deepseek-harness` source** (commit `47f943859`, v0.1.0-rc.5),
vendored under `vendor/dsh/` and audited in `docs/dsh-minimal-audit.md`.

---

## Purpose

- Reproduce the exact model-visible DSH Minimal composition inside Pi:
  - system prompt: `You are a helpful software engineer assistant.`
  - tools: `bash` (persistent shell) + `str_replace_editor`
  - no compaction, no Pi identity/context/skills in the system message
- Experiment with a **two-phase anchor**: start in the Minimal composition,
  and after the first successful Minimal tool call restore Pi's full tools.
- Measure, not guess: per-turn JSONL logs, composition hashes, token usage,
  and objective benchmark tasks.

## Architecture

```
.pi/extensions/deepseek-rl-anchor/
  index.ts                    # entry: events, tool registration, anchor logic
  config.ts                   # modes / experiments / variants / profiles
  state.ts                    # per-session state machine (anchor rules)
  dsh/
    constants.generated.ts    # exact DSH strings (generated from vendor source)
    schemas.ts                # TypeBox schemas, DSH-exact (snapshot-tested)
  tools/
    persistent-bash.ts        # one long-lived bash per session (DSH semantics)
    str-replace-editor.ts     # view/create/str_replace/insert adapter
  instrumentation/
    logger.ts                 # logs/session-<id>.jsonl
    fingerprint.ts            # we-need / let's / let-me counters (diagnostic)
    composition.ts            # SHA-256 hashes + sanitized /ds-dump
  commands.ts                 # /ds-* commands
tests/                        # 47 unit + integration tests (node --test)
bench/tasks/                  # 3 fixed benchmark tasks with verify.sh
artifacts/minimal-tools.json  # canonical DSH tool schemas + SHA-256
artifacts/fingerprint.json     # sanitized per-session fingerprint
```

Data flow (Minimal mode):

```
DeepSeek model
   ↓  (exact DSH wire: system + 2 tool schemas, no `strict`)
Pi provider payload  ←── before_provider_request (snapshot, contamination check)
   ↓
before_agent_start   (systemPrompt full replacement, setActiveTools([bash, str_replace_editor]))
   ↓
DSH-compatible tools execute via Pi adapters:
   persistent bash  →  one long-lived bash child process (cd/env persist)
   str_replace_editor → local filesystem (absolute paths)
```

## Installation

**Project-local (recommended for experiments — no global changes):**

1. Put this project anywhere; cd into it.
2. Trust the project in Pi, then start pi in the project directory.
   `.pi/extensions/deepseek-rl-anchor/` is auto-discovered.
3. `/reload` if the extension was added while pi was running.
4. Verify: `/ds-status`.

**Global (optional, only after project-level validation):**

```bash
cp -r .pi/extensions/deepseek-rl-anchor ~/.pi/agent/extensions/
```

(Back up `~/.pi/agent/` first. The extension itself never writes to
`~/.pi/agent/`; its only state file is project-level
`.pi/deepseek-rl-anchor/settings.json`.)

## Configuration

Persistent settings live in `.pi/deepseek-rl-anchor/settings.json`
(project-level). Commands update it:

| Command | Effect |
|---|---|
| `/ds-mode native` | Pi exactly as shipped (control group) |
| `/ds-mode minimal` | DSH Minimal composition, permanently |
| `/ds-mode anchor` | Minimal first, restore Pi tools after first successful Minimal tool call |
| `/ds-anchor-variant A` | after anchor: Minimal system + Pi tools |
| `/ds-anchor-variant B` | after anchor: Pi system + Pi tools |
| `/ds-experiment <NAME>` | NATIVE / PROMPT_ONLY / TOOLS_ONLY / MINIMAL / ANCHOR_A / ANCHOR_B |
| `/ds-profile normal` | respect user inference config |
| `/ds-profile benchmark` | DSH defaults: reasoning `high`, max_tokens 256000 |
| `/ds-compaction off` | cancel compaction during experiments |
| `/ds-status` | mode, anchor state, model, active tools, composition hash |
| `/ds-inspect` | what the model will see (hashes, injection detection) |
| `/ds-dump` | sanitized composition dump to `artifacts/composition/` |
| `/ds-debug` | toggle JSONL logging |

### Compaction

DSH Minimal ships no compaction. To fully disable auto-compaction at the
project level, add `.pi/settings.json`:

```json
{ "compaction": { "enabled": false } }
```

`/ds-compaction off` additionally cancels compaction events at runtime while
an experiment is active (restore with `/ds-compaction native`).

## The three modes

### native (default)

No overrides: Pi's own system prompt, tools, context, compaction. The only
difference from a stock Pi is that the extension registers `bash` as a
byte-identical mirror of the built-in (extension `sourceInfo`), plus an
inactive `str_replace_editor`. This is the A/B baseline.

### minimal

- `before_agent_start` **replaces the entire system prompt** with
  `You are a helpful software engineer assistant.`
  (removes Pi identity, tool guidance, AGENTS.md/CLAUDE.md, skills, cwd line).
- Active tools are exactly `["bash", "str_replace_editor"]`; all other tool
  definitions are removed from the provider payload.
- `bash` executes on a persistent shell (see below); `str_replace_editor`
  matches DSH semantics exactly.
- `before_provider_request` strips pi's `strict` field for a DSH-exact wire.

### anchor

State machine (per session, reset on every new session):

```
UNANCHORED ──(first successful Minimal tool call)──▶ ANCHORED
   │                                                    │
   └─ Minimal system + Minimal tools                    └─ variant A: Minimal system + Pi tools
                                                           variant B: Pi system   + Pi tools
```

- Anchor triggers only on a **successful** (non-error) `bash` or
  `str_replace_editor` call. Failed calls keep `UNANCHORED`.
- Note: a non-zero bash exit code is **content**, not an error (DSH
  semantics) — it still counts as success.
- Tool restoration uses `pi.setActiveTools(nativeSnapshot)` and takes effect
  on the next model request within the same run.
- Variant B's system-prompt restore on the same run is implemented in
  `before_provider_request` (payload rewrite of the system message) because
  pi has no public API to clear a mid-run system-prompt override; it is
  flagged as such in the logs.

## Persistent bash adapter

Mirrors `tool-bash-persistent` (verified from source):

- one shell per session; `cd` and exported env persist across calls
- commands serialized; marker-based capture (`__DSH_PERSISTENT_BASH_*__`)
- `[exit code: N]` appended on non-zero exit (content, not error)
- 300 s timeout → partial output + shell reset message
- 16000-char output clipping with the exact DSH `<response clipped>` NOTE
- stderr merged via `2>&1` (the DSH PTY merges both streams)

Deviation: no PTY (non-interactive bash), documented in the code.

## str_replace_editor adapter

Port of `tool-str-replace-editor`:

- `view` (file: `cat -n` style with 6-digit padding + `view_range`; dir:
  2-level listing excluding hidden / node_modules / __pycache__)
- `create` (refuses existing files), `str_replace` (unique match required),
  `insert` (0-based line, insert AFTER line N)
- absolute paths required; DSH error strings; 16000-char clipping

## Experiment methodology

1. For each configuration, run **≥ 5 fresh sessions** (10 if budget allows)
   on each fixed task in `bench/tasks/` (Levels 1–3).
2. Start session → `/ds-experiment <NAME>` → paste `TASK.md` → let it settle.
3. Objective pass/fail: `bench/tasks/<task>/verify.sh` (exit 0 = success).
4. Metrics from `logs/session-<id>.jsonl`:
   task success, tool calls, failed calls, recovery, input/output/reasoning
   tokens, latency, cost, composition hashes, `compositionClean`.
5. Fingerprint (`we need` / `let's` / `let me` counts) is **diagnostic only**
   and never influences the model or the pass/fail decision.

Priority order for conclusions:
**task success > robustness > recovery > efficiency > linguistic fingerprint**.

## Commands reference

| Command | Description |
|---|---|
| `/ds-mode <native\|minimal\|anchor>` | switch mode |
| `/ds-anchor-variant <A\|B>` | anchor restore variant |
| `/ds-experiment <NATIVE\|PROMPT_ONLY\|TOOLS_ONLY\|MINIMAL\|ANCHOR_A\|ANCHOR_B>` | explicit experiment |
| `/ds-profile <normal\|benchmark>` | inference profile |
| `/ds-compaction <native\|off>` | compaction control |
| `/ds-status` | current state |
| `/ds-inspect` | model-visible composition summary |
| `/ds-dump` | sanitized dump to `artifacts/composition/` |
| `/ds-debug` | toggle JSONL logging |

## Known limitations

- `bash` is an extension-registered mirror in native mode (identical schema
  and behavior; `sourceInfo` differs from `<builtin:bash>`).
- Mid-run system-prompt restore (ANCHOR_B) uses `before_provider_request`;
  `ctx.getSystemPrompt()` will not reflect it.
- Other extensions' `before_agent_start` handlers that run after ours could
  re-append prompt text; the payload snapshot + `compositionClean` flag in
  the logs detects this (`COMPOSITION NOT CLEAN` warning).
- `pi.setActiveTools` rebuilds pi's base prompt; harmless because Minimal
  mode replaces the system prompt entirely.
- The persistent shell is a child `bash` without a PTY; prompt/scrollback
  semantics differ slightly (result formatting matches DSH).
- The `0813` build label from the research brief is **UNKNOWN**; the harness
  catalog id is `deepseek-v4-pro` (see `docs/provider-audit.md`).

## Security

- Logs record **metadata only** (names, hashes, counts, usage). Tool
  arguments, message contents, API keys and environment secrets are never
  logged; `/ds-dump` runs a secret-sniffing guard and refuses suspicious
  content.
- The extension does not touch `~/.pi/agent/` (no auth, no settings).
- Benchmark profile only changes the thinking level (restored on switch
  back) and caps `max_tokens` in the payload.
- Persistent shell runs with the same permissions as pi itself; no
  sandboxing is added or removed.

## Uninstall

Project-local: remove `.pi/extensions/deepseek-rl-anchor/` and optionally
`.pi/deepseek-rl-anchor/settings.json`, then `/reload`. Global install:
remove `~/.pi/agent/extensions/deepseek-rl-anchor/`. No other files are
created outside the project (`logs/`, `artifacts/`).

## Reproducing / testing

```bash
npm test            # 47 unit + integration tests (node --test)
npm run extract     # regenerate DSH constants + artifacts from vendor source
sha256sum artifacts/minimal-tools.json
```

## Honest reporting

If experiments show Pi Minimal ≈ Pi Native, or only the linguistic
fingerprint changes without task-success improvement, the correct conclusion
is **"no demonstrated capability improvement"** — not "Minimal reproduced".
See `docs/composition-diff.md` for what differs and what the extension can
and cannot eliminate.
