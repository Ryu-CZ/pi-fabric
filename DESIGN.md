# pi-fabric Design — Pi Adapter for Existing Hermes/Memory-OS Fabric

> Status: design target for implementation  
> Goal: let Pi agents use the **existing Hermes/Memory-OS Fabric** while Hermes continues running Memory OS  
> Scope: Pi extension interop with Hermes Fabric — structured markdown memory, handoffs, reviews, briefs, and curation

---

## 1. Design decision

`pi-fabric` should be a **Pi adapter extension for the existing Hermes/Memory-OS Fabric**, not a replacement for Hermes Fabric.

Hermes/Memory-OS remains the owner of the full Fabric system, including its Python plugin, lifecycle hooks, retrieval index, telemetry, training export, and model replacement pipeline. Pi participates by reading and writing compatible markdown entries in the same `$FABRIC_DIR`.

It should not be merged into `pi-memory-os` initially.

Reasons:

- The requirement is to keep running Memory OS with Hermes, not replace it.
- Hermes/Icarus already defines the Fabric corpus format and workflow semantics.
- Pi can interoperate by reading/writing the same markdown directory.
- Pi should not require Qdrant, Redis, embeddings, or workers for basic Fabric access.
- Keeping `pi-fabric` separate gives a small, testable, low-dependency adapter.
- Optional semantic recall can later integrate with `pi-memory-os` without making it mandatory.

---

## 2. Compatibility target

The primary compatibility target is actual Hermes/Icarus Fabric under:

```txt
/home/tom/tmp/memory-os/icarus/
```

Important reference files:

- `__init__.py` — registers 16 tools and 4 hooks
- `schemas.py` — actual tool schemas exposed to agents
- `tools.py` — tool handler behavior
- `state.py` — markdown I/O, pending work, brief, curation, training/model helpers
- `fabric-retrieve.py` — SQLite/FTS5 index and additive retrieval scoring
- `hooks.py` — session start, pre-call injection, post-call capture, session-end extraction

This design intentionally implements only the Fabric core first, but it must not diverge from Hermes in ways that prevent corpus sharing.

---

## 3. Non-goals for phase 1

Phase 1 does **not** implement or replace Hermes/Memory-OS services.

Specifically, phase 1 does not implement:

- Together AI fine-tuning
- replacement model switching
- Hermes `.env` mutation
- Hermes `state.db` writes
- Hermes telemetry writes
- Qdrant / Redis dependencies
- Python subprocess wrappers around Icarus
- any attempt to become the authoritative Fabric runtime

Pi should write compatible markdown entries only. Hermes remains responsible for its own runtime state and can rebuild its own indexes from markdown file mtimes.

---

## 4. Runtime relationship

The runtime relationship is:

```txt
Hermes + Memory OS remain running
        │
        ├── owns full Icarus/Fabric runtime behavior
        ├── owns training/export/model replacement paths
        ├── owns Hermes indexes, telemetry, and Memory OS integration
        │
        ▼
shared $FABRIC_DIR markdown corpus  ◄──►  Pi extension reads/writes compatible entries
```

`pi-fabric` is therefore a **peer writer/reader** of the Fabric corpus. It must not claim ownership of the corpus beyond the entries it writes, and it must avoid mutating Hermes runtime files.

---

## 5. Shared storage model

### 5.1 Directory resolution

Pi and Hermes should use the same directory when possible.

Resolution order:

```txt
1. FABRIC_DIR env var, if set
2. Existing ~/fabric, for Hermes/Icarus compatibility
3. ~/.pi/fabric, for Pi-only installs
```

Hermes/Icarus default is effectively:

```txt
~/fabric
```

So on a machine already running Hermes, Pi should usually auto-detect and use that existing corpus.

### 5.2 File layout

```txt
$FABRIC_DIR/
├── <agent>-<type>-<slug>-<suffix>.md
├── cold/
├── daily/              # optional Obsidian integration
└── .obsidian/          # optional Obsidian integration
```

The filename suffix is **not** the entry ID. Icarus uses:

- frontmatter `id`: `secrets.token_hex(4)` → 8 hex chars
- filename suffix: `secrets.token_hex(2)` → 4 hex chars

Pi should match this behavior unless there is a strong reason not to.

### 5.3 Atomic writes

All writes must be atomic:

```txt
write <target>.tmp
rename <target>.tmp -> <target>.md
```

Do not partially rewrite files in place except where unavoidable for curation; even curation should prefer temp-file rewrite + rename.

---

## 6. Frontmatter schema

Pi must preserve Hermes/Icarus field names and meanings.

```yaml
---
id: "a3f29b01"
agent: "pi-agent"
platform: "pi"
timestamp: "2026-06-13T12:00:00Z"
type: "decision"
tier: "hot"
summary: "Switched to Fastify for the API gateway"
project_id: "pi-fabric"
session_id: "sess-..."
tags: ["architecture", "decision", "fastify"]
status: "completed"
outcome: "Resolved latency issue."
review_of: "other-agent:77c3e1"
revises: "pi-agent:b4d2f0"
customer_id: ""
assigned_to: ""
training_value: "high"
verified: "true"
evidence: "Tests pass"
source_tool: "pi-fabric"
artifact_paths: ["src/gateway.ts"]
---
## Context
...
```

Supported entry types should include the Hermes set:

```txt
task, decision, review, resolution, research, code-session, session, note
```

Pi may add more later, but phase 1 should not require Hermes to understand new types.

---

## 7. Tool set

Actual Hermes/Icarus registers 16 tools:

### Memory

- `fabric_recall`
- `fabric_write`
- `fabric_search`
- `fabric_pending`
- `fabric_curate`

### Training

- `fabric_export`
- `fabric_train`
- `fabric_train_status`

### Replacement models

- `fabric_models`
- `fabric_eval`
- `fabric_switch_model`
- `fabric_rollback_model`

### Daily/reporting/integration

- `fabric_brief`
- `fabric_telemetry`
- `fabric_init_obsidian`
- `fabric_report`

### Phase 1 Pi tools

Phase 1 should implement this compatibility subset:

1. `fabric_write`
2. `fabric_recall`
3. `fabric_search`
4. `fabric_pending`
5. `fabric_curate`
6. `fabric_brief`
7. `fabric_init_obsidian`

Do **not** call this “the 7 Hermes tools.” It is a Pi phase-1 subset: six operational tools plus the Icarus-compatible init tool.

---

## 8. Tool compatibility details

### 8.1 `fabric_write`

Hermes requires:

- `type`
- `content`
- `summary`

Important validation behavior to preserve:

- `status: "open"` requires `assigned_to`
- `type: "review"` requires `review_of`
- `review_of` and `revises` must be `agent:id`
- if referenced entries exist locally, validate them when possible
- `training_value` must be `high`, `normal`, or `low`

Hermes schema exposes `tags` and `artifact_paths` as comma-separated strings. Pi may expose arrays in TypeBox, but the store layer must accept both:

```ts
tags?: string | string[]
artifact_paths?: string | string[]
```

Write YAML arrays for both fields.

### 8.2 `fabric_recall`

Hermes schema uses:

```txt
query: string, required
max_results?: integer
agent?: string
project?: string
```

Pi should use the same names. Avoid replacing `max_results` with `limit` in the public tool schema.

Phase 1 retrieval may be simpler than Hermes, but must return compatible result fields:

```txt
score, id, agent, type, timestamp, summary, file/path
```

Full Hermes scoring can be added later.

### 8.3 `fabric_search`

Simple grep over `$FABRIC_DIR/*.md` and `$FABRIC_DIR/cold/*.md`.

Return:

```txt
query, count, results[{file, agent, summary, matches}]
```

### 8.4 `fabric_pending`

Match Hermes behavior:

- open tasks assigned to current agent from other agents
- reviews of current agent’s work
- customer-scoped open tickets assigned to current agent

Return groups:

```txt
open_tasks
reviews_of_my_work
open_tickets
total
```

### 8.5 `fabric_curate`

Update `training_value` by frontmatter `id`, not filename suffix.

Search both hot and cold directories.

### 8.6 `fabric_brief`

Return operational brief containing:

- pending counts and first items
- recent own entries
- recent activity from other agents
- suggested next action

Telemetry stats are optional in Pi phase 1 because Pi should not write Hermes telemetry initially.

### 8.7 `fabric_init_obsidian`

Use the Hermes-compatible name.

Create:

```txt
$FABRIC_DIR/
$FABRIC_DIR/cold/
$FABRIC_DIR/daily/
$FABRIC_DIR/.obsidian/    # optional minimal config
```

The operation must be idempotent.

A Pi-only `fabric_init_repo` may be added later as an alias, but it should not replace `fabric_init_obsidian`.

---

## 9. Retrieval strategy

### 9.1 Phase 1

Use filesystem scan and simple scoring:

- keyword match in summary/body/tags
- recency boost
- agent boost
- project boost
- type/status/linking boosts where easy

This is acceptable for phase 1 if clearly documented as a simplification.

### 9.2 Hermes parity target

Hermes `fabric-retrieve.py` uses:

- SQLite index in `state.db`
- FTS5 table
- keyword hits
- summary hits
- exact phrase
- bigrams/trigrams
- tag hits
- project boost
- agent boost
- recency boost
- tier boost
- type-specific boosts
- open/assigned boost
- review/revision/ref-chain boost
- deduplication
- token budget filtering

Pi should not write Hermes `state.db` in phase 1. If parity is needed, implement a Pi-owned optional index under:

```txt
$FABRIC_DIR/.pi-fabric/index.sqlite
```

or simply port the additive scoring over filesystem reads before introducing SQLite.

---

## 10. Lifecycle hooks

Hermes hooks:

- `on_session_start`
- `pre_llm_call`
- `post_llm_call`
- `on_session_end`

Pi hook equivalents must be verified against the Pi extension API. Proposed mapping:

| Hermes | Pi equivalent | Purpose |
|--------|---------------|---------|
| `on_session_start` | `session_start` if available | brief/pending/recent context |
| `pre_llm_call` | `before_agent_start` or nearest prompt hook | recall relevant entries |
| `post_llm_call` | response-end hook if available | capture high-value decisions |
| `on_session_end` | `agent_end` or session-end hook | extract/summarize session |

Phase 1 should implement only hooks that Pi actually exposes and fail open if context injection/capture is unavailable.

Auto-capture should follow Hermes semantics:

- decision + outcome response → write `type: decision`, `training_value: high`
- completed/fixed/resolved terms → set `status: completed`
- trivial/social closers should not be stored
- system injections should not be stored

---

## 11. Configuration

```txt
FABRIC_DIR          # env override; otherwise existing ~/fabric; otherwise ~/.pi/fabric
FABRIC_AGENT        # preferred Pi agent name
HERMES_AGENT_NAME   # compatibility fallback for agent name
FABRIC_PROJECT_ID   # optional project override; default cwd basename
FABRIC_COMPAT_MODE  # default: icarus
FABRIC_AUTO_STORE   # enable/disable auto-capture hooks
```

Agent name resolution:

```txt
1. FABRIC_AGENT
2. HERMES_AGENT_NAME
3. "pi-agent"
```

Project resolution:

```txt
1. FABRIC_PROJECT_ID
2. current working directory basename
3. "unknown"
```

---

## 12. Relationship to pi-memory-os

`pi-fabric` remains standalone and does not replace Memory OS.

The expected deployment is still:

```txt
Hermes + Memory OS running normally
Pi + pi-fabric configured to the same FABRIC_DIR
```

`pi-memory-os` may later provide optional semantic recall for Pi-side retrieval. Integration should be opt-in:

```txt
FABRIC_RECALL_BACKEND=filesystem | qdrant | hybrid
```

Default remains:

```txt
filesystem
```

No phase-1 feature should require `pi-memory-os` to be installed or running.

---

## 13. Implementation priorities

1. `FabricStore` filesystem layer with Icarus-compatible parsing/writing
2. `fabric_write`, including validation and atomic writes
3. `fabric_search`
4. `fabric_pending`
5. `fabric_brief`
6. `fabric_curate`
7. `fabric_recall` simple scoring
8. `fabric_init_obsidian`
9. Pi lifecycle hook mapping, only after verifying actual API payloads
10. Optional retrieval parity improvements

---

## 14. Compatibility test plan

Use a temp shared Fabric dir:

```bash
export FABRIC_DIR=/tmp/shared-fabric-test
```

Required tests:

1. Pi writes an entry; Hermes-style parser can read frontmatter fields.
2. Pi writes `status=open assigned_to=<agent>`; `fabric_pending` returns it for that agent.
3. Pi writes `review_of=agent:id`; reference validation accepts real entries and rejects malformed refs.
4. Pi writes comma-string and array forms of `tags`; both produce YAML arrays.
5. Pi curates by frontmatter `id`, not filename suffix.
6. Pi searches both hot root and `cold/`.
7. Pi recall accepts `max_results`, `agent`, and `project` parameter names.
8. `fabric_init_obsidian` is idempotent.

Manual Hermes interop test, if Hermes repo is available:

```bash
export FABRIC_DIR=/tmp/shared-fabric-test
# Write with pi-fabric, then run/import Icarus state/search/retrieve against same dir.
```

---

## 15. Final architecture summary

```txt
Hermes/Icarus + Memory OS  ── owns full Fabric runtime
            │
            ▼
shared $FABRIC_DIR markdown corpus
            ▲
            │
Pi + pi-fabric adapter ───── reads/writes compatible Fabric entries

Optional later:
Pi-side recall may use pi-memory-os/Qdrant as an additional semantic boost.
```

The shared markdown corpus is the contract. Hermes/Memory-OS remains the authoritative full Fabric runtime. Pi's job is interop: use the same tool names where practical, preserve frontmatter fields, preserve IDs, linking semantics, and pending-work semantics, and avoid replacing or mutating Hermes runtime state.
