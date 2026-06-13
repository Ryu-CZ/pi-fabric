# pi-fabric — Handoff Design Doc

> **Status:** Design phase, ready for implementation  
> **Repository:** ~/git/pi-fabric/  
> **Predecessor:** [Memory OS Layer 4 — Icarus/Fabric](https://github.com/ClaudioDrews/memory-os/tree/main/icarus)  
> **Pi Reference Extension:** [pi-memory-os](https://github.com/Ryu-CZ/pi-memory-os)  
> **Created:** 2026-06-13

---

## 1. What we're building

**pi-fabric** is a Pi extension that gives Pi coding agents structured cross-session memory — the equivalent of Memory OS's Fabric Layer 4 (the Icarus plugin) but native TypeScript, designed for Pi's extension API.

It is **not** the original [danielmiessler/fabric](https://github.com/danielmiessler/fabric) pattern-runner. It is the **structured memory store** that Hermes agents use to recall decisions, hand off work, and eventually fine-tune replacement models — ported to Pi.

### What the Memory OS Fabric does (our reference)

The Icarus plugin gives Hermes agents a markdown-based memory store accessed via 16 tools and driven by 4 automatic hooks. Agents write structured entries with YAML frontmatter (type, summary, status, training_value, linking fields), retrieve them via ranked search, and optionally export them as fine-tuning pairs for model replacement.

### What we replicate for Pi

| Capability | Icarus | pi-fabric |
|------------|--------|-----------|
| Structured markdown store | ✅ `$FABRIC_DIR/*.md` | ✅ Same format, `~/.pi/fabric/` |
| 16 tools | ✅ | ⏳ Phase 1 ports a subset; full parity is later |
| 4 hooks | ✅ on_session_start, pre_llm_call, post_llm_call, on_session_end | ⏳ Pi equivalents where available; exact hook semantics must be verified |
| Ranked retrieval | ✅ SQLite FTS5 + additive scoring: keyword, summary, phrase/ngram, tags, project, agent, recency, tier, type, status, refs | ✅ Simpler phase-1 scoring, with full parity optional later |
| Fine-tuning pipeline | ✅ export → train → eval → switch | ⏳ Phase 3 |

---

## 2. Architecture Decision

### Chosen path: **Pure TypeScript Pi extension** (not a fork, not a CLI wrapper)

**Why (based on lessons from pi-memory-os):**

| Path | Pros | Cons | Verdict |
|------|------|------|---------|
| **Fork Icarus** | Keep existing Python code, reuse debugging | Python plugin system != Pi extension API. Would need an adapter shim that calls Python from Pi. Fragile. | ❌ Rejected |
| **CLI wrapper** | Zero TypeScript effort | Fragile IPC, spawn overhead, error handling nightmare. User explicitly rejected this pattern during Memory OS design. | ❌ Rejected |
| **Pure TS Pi ext** | Native to Pi, TypeBox schema validation, lifecycle hook integration, shared patterns with pi-memory-os | Build from scratch (~800-1200 LOC + tests) | ✅ **Chosen** |

### Relationship to pi-memory-os

These are complementary extensions that can share a common client library:

| Extension | What it talks to | Purpose |
|-----------|-----------------|---------|
| **pi-memory-os** | Qdrant + Redis/ARQ + llama.cpp | Vector search, embedding ingest, on-demand reflection |
| **pi-fabric** | Local filesystem (`$FABRIC_DIR`) shared with Hermes/Icarus where possible | Structured entries (decisions, handoffs, reviews), ranked retrieval, training data |

**Design decision:** keep `pi-fabric` as a separate extension, but make its default storage and schema compatibility-first so Pi and Hermes agents can read/write the same Fabric corpus. This avoids forcing Qdrant/Redis on Fabric-only users while preserving a path to shared memory.

**Optional overlap:** pi-fabric can use pi-memory-os's Qdrant connection for semantic recall of fabric entries in phase 2. For phase 1, filesystem-only is simpler and more portable.

### Hermes/Icarus shared Fabric compatibility

Hermes/Icarus Fabric is not a localhost HTTP service; the durable shared state is the markdown corpus under `$FABRIC_DIR` plus Hermes-owned indexes/telemetry files. Therefore Pi should connect to existing Hermes Fabric by using the **same directory**, not by wrapping Hermes or writing to its SQLite DB directly.

Compatibility rules:

1. **Directory resolution is compatibility-first:** use `FABRIC_DIR` if set; otherwise, if `~/fabric` exists, use it; otherwise create `~/.pi/fabric` for Pi-only installs.
2. **Markdown is the source of truth:** Pi writes atomic `.md` files only. Hermes can rebuild its own SQLite/FTS index from file mtimes.
3. **Preserve Icarus frontmatter names and meanings:** `id`, `agent`, `platform`, `timestamp`, `type`, `tier`, `summary`, `project_id`, `session_id`, `tags`, `status`, `outcome`, `review_of`, `revises`, `customer_id`, `assigned_to`, `training_value`, `verified`, `evidence`, `source_tool`, `artifact_paths`.
4. **Keep Icarus linking semantics:** `review_of` and `revises` use `agent:id`, and pending work uses `status: "open"` plus `assigned_to`.
5. **Accept both API shapes:** Hermes tool calls use comma-separated `tags` / `artifact_paths`; Pi may expose arrays, but the store layer should parse and write compatible YAML arrays.
6. **Do not mutate Hermes runtime state:** Pi should not write Hermes `state.db`, `.icarus-telemetry.jsonl`, `.icarus-models.json`, `.env`, or training job files in phase 1.

---

## 3. Storage Format

### Entry file: `$FABRIC_DIR/<agent>-<type>-<slug>-<suffix>.md`

Exactly the same YAML frontmatter schema as Memory OS Fabric for cross-compatibility:

```yaml
---
id: "a3f29b01"
agent: "pi-agent"
platform: "pi"
timestamp: "2026-06-13T12:00:00Z"
type: "decision"              # decision | resolution | review | task | code-session | session | note | research
tier: "hot"                   # hot | cold (cold = archived)
summary: "Switched to Fastify for the API gateway"
project_id: "pi-fabric"
session_id: "sess-..."
tags: ["architecture", "decision", "fastify"]
status: "completed"           # completed | open | blocked | superseded
outcome: "Resolved latency issue. Fastify handled 3x throughput."
review_of: "other-agent:77c3e1"     # linking fields
revises: "pi-agent:b4d2f0"
customer_id: ""
assigned_to: ""
training_value: "high"        # high | normal | low
verified: "true"
evidence: "Load test: 3000 req/s sustained, p99 45ms"
source_tool: "pi-fabric"
artifact_paths: ["src/gateway.ts", "tests/load/gateway.test.ts"]
---
## Context
...content body...
## Outcome
...resolution details...
```

### File layout

```
$FABRIC_DIR/
├── pi-agent-decision-fastify-switch-9a3f.md
├── pi-agent-review-rate-limiter-race-d4e2.md
├── daedalus-task-fix-auth-holes-77c3.md
├── daily/                [optional, for Obsidian integration]
│   └── 2026-06-13.md
└── cold/                 [archived entries]
```

### Key design rules

- **8-hex-char entry IDs** via `crypto.randomBytes(4).toString('hex')` in frontmatter, matching Icarus
- **Filename suffix is separate from entry ID**: Icarus uses a short random filename suffix (`secrets.token_hex(2)`, 4 hex chars). For compatibility, do not assume the filename suffix equals `id`.
- **Slug from summary** for human-readable filenames: `re.sub(r'[^a-z0-9]+', '-', summary.lower())[:40]`
- **Atomic writes**: write to `.tmp` then rename (prevents partial reads)
- **Cold tier**: when entries exceed a threshold or agent calls archive, move to `cold/`

---

## 4. Tool Specification (Phase 1 — Pi subset)

Important correction: actual Hermes/Icarus Fabric registers **16 tools**. Phase 1 below is a deliberate Pi-native subset, not a faithful list of all Hermes tools.

Actual Icarus tools are:

- Memory: `fabric_recall`, `fabric_write`, `fabric_search`, `fabric_pending`, `fabric_curate`
- Training: `fabric_export`, `fabric_train`, `fabric_train_status`
- Replacement models: `fabric_models`, `fabric_eval`, `fabric_switch_model`, `fabric_rollback_model`
- Daily/reporting/integration: `fabric_brief`, `fabric_telemetry`, `fabric_init_obsidian`, `fabric_report`

Phase 1 should implement the 5 memory tools plus `fabric_brief` and the compatibility initialization tool `fabric_init_obsidian`. If a Pi-specific `fabric_init_repo` is useful, expose it only as an alias or later addition, not as the primary Icarus-compatible tool.

### 4.1 `fabric_write` — Create structured entry

```typescript
pi.registerTool({
  name: "fabric_write",
  description: "Write a structured memory entry with YAML frontmatter.",
  parameters: Type.Object({
    type: Type.String({ enum: ["decision","resolution","review","task","code-session","session","note","research"] }),
    summary: Type.String({ maxLength: 120 }),
    content: Type.String({ description: "Markdown body of the entry" }),
    tags: Type.Optional(Type.Array(Type.String())), // Icarus tool API uses comma-separated string; Pi may normalize to array internally
    status: Type.Optional(Type.String({ enum: ["completed","open","blocked","superseded"] })),
    outcome: Type.Optional(Type.String()),
    review_of: Type.Optional(Type.String()),
    revises: Type.Optional(Type.String()),
    assigned_to: Type.Optional(Type.String()),
    training_value: Type.Optional(Type.String({ enum: ["high","normal","low"] })),
    evidence: Type.Optional(Type.String()),
    artifact_paths: Type.Optional(Type.Array(Type.String())), // Icarus tool API uses comma-separated string; Pi may normalize to array internally
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 1. Generate entry ID, filename suffix, agent name, timestamp
    // 2. Build frontmatter YAML
    // 3. Atomic write to ~/.pi/fabric/<filename>.md
    // 4. Return { file, id, summary }
  },
});
```

### 4.2 `fabric_recall` — Ranked retrieval

```typescript
pi.registerTool({
  name: "fabric_recall",
  description: "Search memory entries by keyword/agent/project. Returns ranked results.",
  parameters: Type.Object({
    query: Type.String(),
    max_results: Type.Optional(Type.Number({ default: 5 })),
    agent: Type.Optional(Type.String()),
    project: Type.Optional(Type.String()),
  }),
  async execute(...) {
    // Phase 1: Read all .md files, parse frontmatter, filter & score
    //   simple weighted score described below
    // Later: optional SQLite/FTS5 parity with Icarus and/or pi-memory-os Qdrant boost
  },
});
```

**Phase-1 scoring logic** (simplified; not identical to Icarus):

| Factor | Weight | Source |
|--------|--------|--------|
| Keyword match | 0.40 | `query.toLowerCase()` against summary + text |
| Recency | 0.30 | `days_since = now - timestamp; score = 1 - days / 90` (capped at 1) |
| Agent affinity | 0.15 | `agent == current_agent ? 1.0 : 0.3` |
| Exact field match | 0.15 | `type == filter?.type ? 1.0 : 0; tags overlap → 0.5` |

Actual Icarus `fabric-retrieve.py` is more sophisticated: it builds a SQLite/FTS5 index and uses additive boosts for keyword hits, summary hits, exact phrase, bigrams/trigrams, tags, project, agent, recency, tier, type, status, assigned work, review/revision fields, and ref chains. Full parity can be a later phase.

### 4.3 `fabric_search` — Keyword grep

Grep across all entries (frontmatter + body). Simple, fast, no scoring. Returns matching filenames + line snippets.

### 4.4 `fabric_pending` — Work assigned to this agent

Filter entries by `assigned_to: "pi-agent"` + `status: "open"`. Returns grouped by type (tasks, reviews, tickets).

### 4.5 `fabric_brief` — Daily operational brief

Aggregates:
- Pending items (from fabric_pending)
- Recent own entries (last 5 by this agent, last 24h or last 10)
- Activity from other agents (entries where `agent !== current_agent`, last 3)
- Suggested next action (first pending item)

Returns a formatted string ready for injection into system prompt.

### 4.6 `fabric_curate` — Set training value

Find entry by ID, rewrite `training_value` in frontmatter.

### 4.7 `fabric_init_obsidian` — Compatibility initialization

Actual Icarus provides `fabric_init_obsidian`, so Pi should implement this name for shared Fabric compatibility. It should create `$FABRIC_DIR`, `cold/`, `daily/`, and minimal Obsidian vault metadata if desired. It should be safe to call repeatedly.

Optional: add `fabric_init_repo` later as a Pi-only alias that also creates `.gitignore` and `README.md`, but do not make it the primary tool name.

---

## 5. Lifecycle Hooks

Actual Icarus hooks are `on_session_start`, `pre_llm_call`, `post_llm_call`, and `on_session_end`. Pi hook names and payloads differ; verify the Pi extension API before implementation. The mapping below is a proposed approximation, not exact parity.

### 5.1 `session_start` — Show status + inject context footer

```typescript
pi.on("session_start", async (_event, ctx) => {
  // Check that ~/.pi/fabric/ exists
  // Set status indicator: "Fabric: linked" or "Fabric: not initialized"
  // If pending items exist, show count
});
```

### 5.2 `before_agent_start` — Auto-search relevant entries

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // Extract query from event.prompt
  // fabric_recall(query, max_results=3)
  // If results found, inject as:
  //   message: { customType: "fabric-context", content: "...", display: true }
  //
  // Also inject brief if this is the first turn of a session:
  //   message: { customType: "fabric-brief", content: brief, display: false }
  //
  // Implementation matches pi-memory-os before_agent_start pattern exactly
});
```

**Injection format** (keep consistent with pi-memory-os):

```
[pending] 2 item(s) assigned to you:
  - daedalus: Review rate limiter race condition (review, id d4e2f0)

[fabric] relevant context:
  [0.82] daedalus: decision — Switched to Fastify for the API gateway
  [0.65] pi-agent: resolution — Fixed auth token refresh race
```

### 5.3 `agent_end` / response-end capture — Auto-capture decisions

Actual Icarus captures in two stages:

- `post_llm_call`: if the assistant response has decision + outcome signals, writes a `decision` entry with `training_value: "high"` and `status: "completed"` when completion terms are present.
- `on_session_end`: scores the whole session, attempts LLM extraction into `decision`, `resolution`, or `note` entries, and falls back to a legacy `session` entry.

Pi phase 1 can implement the simpler response/session-end capture below if Pi exposes the needed final assistant message and session transcript:

```typescript
pi.on("agent_end", async (event, ctx) => {
  // 1. Get last assistant message and/or compact session transcript
  // 2. Apply heuristics to detect high-value content:
  //    - Contains decision keywords (decided, resolved, completed, fixed, deployed...)
  //    - Contains outcome indicators and enough substantive text
  // 3. If threshold passes, call fabric_write internally
  //    type: "decision", training_value: "high"
  // 4. Silently fail on error (non-critical)
});
```

Heuristics borrowed from Icarus:

```typescript
const DECISION_RE = /(?:decided|resolved|completed|fixed|deployed|shipped|reviewed|approved|rejected)\b/i;
const OUTCOME_RE = /(?:result:|outcome:|conclusion:|because|root cause|instead of|\d+%|\d+x)/i;
const COMPLETION_RE = /(?:completed|finished|done|shipped|deployed|resolved|closed|merged|fixed)\b/i;
```

---

## 6. Project Structure

```
~/git/pi-fabric/
├── HANDOFF.md                 ← this file
├── package.json
├── tsconfig.json
├── LICENSE
├── src/
│   ├── index.ts               ← Pi extension factory (registers phase-1 tool subset + hooks)
│   ├── fabric-store.ts        ← File I/O: read, write, search, curate, pending, brief
│   ├── scoring.ts             ← Ranked retrieval scoring logic
│   └── types.ts               ← TypeScript types for entries, config, tool params
├── tests/
│   ├── fabric-store.test.ts
│   └── scoring.test.ts
└── README.md
```

### Shared patterns from pi-memory-os (reuse the same conventions):

| Pattern | pi-memory-os | pi-fabric |
|---------|-------------|-----------|
| Singleton client | `MemoryOSClient` | `FabricStore` |
| Env-based config | `loadConfig()` → `envStr()`, `envInt()` | Same pattern |
| Package deps | `@sinclair/typebox`, `@earendil-works/pi-coding-agent` | Same |
| Tsconfig | `ES2022`, `ESNext`, `bundler` | Same |
| Pi extension entry | `export default function (pi: ExtensionAPI)` | Same |
| Atomic writes | N/A (goes through Redis) | Write `.tmp` → rename |

### New dependency (filesystem):
- **No additional npm deps.** Node `fs/promises`, `path`, `crypto` are built-in.
- For YAML frontmatter: native approach (manually parse/write, it's simple enough) OR add `js-yaml` if preferred.

---

## 7. Configuration

Environment variables (same `envStr`/`envInt` pattern as pi-memory-os):

```typescript
FABRIC_DIR     // Default resolution: env FABRIC_DIR → existing ~/fabric → ~/.pi/fabric
FABRIC_AGENT   // Default: process.env.FABRIC_AGENT || process.env.HERMES_AGENT_NAME || "pi-agent"
```

Configurable settings (can be added later without breaking changes):
- `FABRIC_COMPAT_MODE` — default `icarus`; preserves Hermes/Icarus schema and tool semantics
- `FABRIC_MAX_ENTRIES` — cold archive threshold
- `FABRIC_AUTO_STORE` — enable/disable automatic capture hooks

---

## 8. Dependencies

### Build (devDependencies, same as pi-memory-os):

```json
{
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/node": "^22.0.0",
    "@earendil-works/pi-coding-agent": "^0.79.0",
    "@sinclair/typebox": "^0.34.0"
  }
}
```

### Runtime:
- Node.js 22+ built-ins only (fs, path, crypto)
- No external runtime deps for phase 1

### Optional runtime (phase 2):
- `ioredis` (if integrating with Memory OS Redis)
- `js-yaml` (if preferring proper YAML parser over manual frontmatter parsing)

---

## 9. Implementation Phasing

### Phase 1 — Core (target: ~500-700 LOC)

| Step | Files | Est. |
|------|-------|------|
| 1. Package scaffold | package.json, tsconfig.json, README.md | — |
| 2. Types + inline YAML helpers | src/types.ts | 60 |
| 3. FabricStore class (CRUD) | src/fabric-store.ts | 200 |
| 4. Scoring engine | src/scoring.ts | 100 |
| 5. Phase-1 tool subset in extension factory | src/index.ts | 150 |
| 6. Pi lifecycle hook mapping | src/index.ts | 100 |
| 7. Tests | tests/*.test.ts | 150 |

**Deliverable:** Pi agent can write, recall, search, brief, and auto-capture entries in the same `$FABRIC_DIR` used by Hermes/Icarus when configured or auto-detected. Tools are functional in a Pi session without requiring Qdrant, Redis, or a running Hermes process.

### Phase 2 — Integration with pi-memory-os (optional)

- `fabric_recall` gets a semantic boost by querying Qdrant for fabric entries (if available)
- Shared embedding client between pi-fabric and pi-memory-os
- Configurable: `FABRIC_RECALL_BACKEND = "filesystem" | "qdrant"`

### Phase 3 — Fine-tuning pipeline (the heavy one)

- `fabric_export` → JSONL training pairs from entries
- `fabric_train` → Together AI (or OpenRouter) fine-tune API
- `fabric_eval` / `fabric_switch_model` / `fabric_rollback_model`
- Model registry: `~/.pi/fabric/models.json`

This phase is ~60% of the Icarus codebase. Only build if model replacement is a real need for Pi agents.

---

## 10. Testing Strategy

### Unit tests (Node native, no test runner needed — or vitest):

```typescript
// fabric-store.test.ts
test("write_entry creates file with correct frontmatter");
test("read_recent returns most recent N entries");
test("curate_entry updates training_value");
test("pending returns only open assigned_to entries");
test("search matches keywords in frontmatter and body");

// scoring.test.ts
test("keyword_match scores exact matches highest");
test("recency_score decays over 90 days");
test("agent_affinity boosts own entries");
```

### Integration test (end-to-end):

```bash
# Run in a temp directory
export FABRIC_DIR=/tmp/pi-fabric-test
pi-fabric-test.sh:
  1. fabric_write(type="decision", summary="test decision", content="...")
  2. fabric_search(query="test") → expect 1 result
  3. fabric_recall(query="test") → expect score > 0
  4. fabric_curate(id, "high") → verify frontmatter changed
  5. Cleanup
```

---

## 11. Pitfalls & Edge Cases

### From pi-memory-os experience

| Pitfall | Mitigation |
|---------|------------|
| **Atomicity** — partial writes from crash | Write `.tmp` → `fs.rename()` (atomic on same filesystem) |
| **Large entries** — 10K+ characters in content | Cap content at 50KB; warn on write if exceeds |
| **Concurrent writes** — two hooks fire simultaneously | Use file-level lock or accept last-write-wins (acceptable for personal use) |
| **Empty FABRIC_DIR** — first call before init | Lazy-create: `ensureDir()` in every read/write path |
| **Orphaned backticks** — injected markdown breaks injection | Sanitize: strip unpaired backticks before injection (Icarus pattern) |
| **Social closers** — "ok", "thanks" trigger auto-store | Skip auto-store if message is short and has no technical markers |
| **Infinitely growing FABRIC_DIR** — thousands of entries | Cold archive: entries > 90 days old → `cold/`. Configurable threshold. |

### From Icarus source (already solved, just port)

| Feature | What it does | Priority |
|---------|-------------|----------|
| `_sanitize_context_text()` | Strips injection attempts from retrieved text before injection | Phase 1 |
| `_is_social_close()` | Detects messages that shouldn't trigger memory search | Phase 1 |
| `_is_system_injection()` | Detects orchestrator/system messages that shouldn't be stored | Phase 1 |
| `_validate_safe_content()` | Heuristic: high directive density = [SANITIZED] | Phase 1 |
| `cold/` tier | Move old entries, keep hot/ fast | Phase 2 |

---

## 12. References

### Code to read before implementing

| File | What it teaches |
|------|-----------------|
| `/home/tom/tmp/memory-os/icarus/state.py` | FABRIC_DIR I/O, write_entry, read_pending, build_brief, curate, scoring. The single most important reference. |
| `/home/tom/tmp/memory-os/icarus/hooks.py` | on_session_start, pre_llm_call, post_llm_call, on_session_end. Social closer detection, injection sanitization. |
| `/home/tom/tmp/memory-os/icarus/fabric-retrieve.py` | Actual ranked retrieval: SQLite/FTS5 plus additive scoring across keywords, summary, phrase/ngram, tags, project, agent, recency, tier, type, status, and refs. |
| `/home/tom/tmp/memory-os/icarus/__init__.py` | Plugin registration structure (how 16 tools + 4 hooks are wired). |
| `/home/tom/tmp/memory-os/icarus/tools.py` | Tool handler implementations (writes, pending, brief, export). |
| `/home/tom/git/pi-memory-os/src/index.ts` | Pi extension patterns: registerTool, pi.on hooks, TypeBox schemas, singleton client. |
| `/home/tom/git/pi-memory-os/src/lib/client.ts` | Config loading (envStr/envInt), type definitions, error handling patterns. |

### Key differences to watch for

| Aspect | Icarus (Python) | pi-fabric (TypeScript) |
|--------|----------------|------------------------|
| YAML parsing | `import yaml` + regex fallback | Manual regex (or `js-yaml` optional) |
| Config | `os.environ["KEY"]` | `process.env.KEY` |
| Filesystem | `pathlib.Path` | `fs/promises` + `path` |
| Default fabric dir | `~/fabric` | Proposed `~/.pi/fabric` |
| Async | Sync file I/O | `await fs.readFile/writeFile` |
| Agent name | `HERMES_AGENT_NAME` env var | Same env var or `FABRIC_AGENT` |
| Session ID | `state.session_id` global | Available via hook `_event.sessionId`? (verify in Pi API) |
| Tool API lists | `tags` and `artifact_paths` are comma-separated strings | Proposed arrays internally; preserve compatibility aliases if possible |

---

## 13. Immediate Next Steps

1. **Read the Icarus reference files** listed in §12 — especially `state.py` (the core I/O logic) and `hooks.py` (the injection logic)
2. **Scaffold the project** — copy `package.json` and `tsconfig.json` from pi-memory-os, update package name to `pi-fabric`
3. **Implement `src/types.ts`** — Entry interface, config types, tool param types
4. **Implement `src/fabric-store.ts`** — write, read, search, curate, pending, brief
5. **Implement `src/scoring.ts`** — ranked retrieval algorithm
6. **Implement `src/index.ts`** — wire the phase-1 tool subset plus verified Pi hook equivalents
7. **Write tests** — start with the scoring engine (pure logic, easiest to TDD)
8. **Link the extension** — `mkdir -p ~/.pi/agent/extensions/fabric && ln -s ~/git/pi-fabric/src ~/.pi/agent/extensions/fabric/` (check Pi's actual extension loading mechanism)
9. **Test in a Pi session** — call each tool, verify lifecycle injections appear in system prompt

---

*End of handoff document. Continue from here when ready.*
