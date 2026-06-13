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
| 16 tools | ✅ | ✅ Port 7 core, skip training pipeline initially |
| 4 hooks | ✅ on_session_start, pre_llm_call, post_llm_call, on_session_end | ✅ Pi equivalents: session_start, before_agent_start, agent_end |
| Ranked retrieval | ✅ Keyword + recency + agent affinity | ✅ Simpler: keyword grep + recency (Qdrant optional phase 2) |
| Fine-tuning pipeline | ✅ export → train → eval → switch | ⏳ Phase 2 |

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
| **pi-fabric** | Local filesystem (`~/.pi/fabric/`) | Structured entries (decisions, handoffs, reviews), ranked retrieval, training data |

**Optional overlap:** pi-fabric can use pi-memory-os's Qdrant connection for semantic recall of fabric entries in phase 2. For phase 1, filesystem-only is simpler and more portable.

---

## 3. Storage Format

### Entry file: `~/.pi/fabric/<agent>-<type>-<slug>-<id>.md`

Exactly the same YAML frontmatter schema as Memory OS Fabric for cross-compatibility:

```yaml
---
id: "a3f29b01"
agent: "pi-agent"
platform: "pi"
timestamp: "2026-06-13T12:00:00Z"
type: "decision"              # decision | resolution | review | task | code-session | note | research
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
~/.pi/fabric/
├── pi-agent-decision-fastify-switch-a3f29b01.md
├── pi-agent-review-rate-limiter-race-d4e2f0.md
├── daedalus-task-fix-auth-holes-77c3e1.md
├── daily/                [optional, for Obsidian integration]
│   └── 2026-06-13.md
└── cold/                 [archived entries]
```

### Key design rules

- **8-hex-char IDs** via `crypto.randomBytes(4).toString('hex')` (same as Icarus)
- **Slug from summary** for human-readable filenames: `re.sub(r'[^a-z0-9]+', '-', summary.lower())[:40]`
- **Atomic writes**: write to `.tmp` then rename (prevents partial reads)
- **Cold tier**: when entries exceed a threshold or agent calls archive, move to `cold/`

---

## 4. Tool Specification (Phase 1 — 7 tools)

### 4.1 `fabric_write` — Create structured entry

```typescript
pi.registerTool({
  name: "fabric_write",
  description: "Write a structured memory entry with YAML frontmatter.",
  parameters: Type.Object({
    type: Type.String({ enum: ["decision","resolution","review","task","code-session","note","research"] }),
    summary: Type.String({ maxLength: 120 }),
    content: Type.String({ description: "Markdown body of the entry" }),
    tags: Type.Optional(Type.Array(Type.String())),
    status: Type.Optional(Type.String({ enum: ["completed","open","blocked","superseded"] })),
    outcome: Type.Optional(Type.String()),
    review_of: Type.Optional(Type.String()),
    revises: Type.Optional(Type.String()),
    assigned_to: Type.Optional(Type.String()),
    training_value: Type.Optional(Type.String({ enum: ["high","normal","low"] })),
    evidence: Type.Optional(Type.String()),
    artifact_paths: Type.Optional(Type.Array(Type.String())),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // 1. Generate ID, agent name, timestamp
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
  description: "Search memory entries by keyword/agent/type. Returns ranked results.",
  parameters: Type.Object({
    query: Type.Optional(Type.String()),
    agent: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    limit: Type.Optional(Type.Number({ default: 5 })),
  }),
  async execute(...) {
    // Phase 1: Read all .md files, parse frontmatter, filter & score
    //   score = keyword_match * 0.4 + recency * 0.3 + agent_affinity * 0.15 + exact_match * 0.15
    // Phase 2: Optionally use pi-memory-os Qdrant for semantic boost
  },
});
```

**Scoring logic** (same as Icarus `fabric-retrieve.py`):

| Factor | Weight | Source |
|--------|--------|--------|
| Keyword match | 0.40 | FTS5-style `query.toLowerCase()` against summary + text |
| Recency | 0.30 | `days_since = now - timestamp; score = 1 - days / 90` (capped at 1) |
| Agent affinity | 0.15 | `agent == current_agent ? 1.0 : 0.3` |
| Exact field match | 0.15 | `type == filter?.type ? 1.0 : 0; tags overlap → 0.5` |

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

### 4.7 `fabric_init_repo` — One-time directory setup

Create `~/.pi/fabric/` structure, create `.gitignore`, write initial `README.md` inside it. Optional: init as git repo.

---

## 5. Lifecycle Hooks

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
  // fabric_recall(query, limit=3)
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

### 5.3 `agent_end` — Auto-capture decisions

```typescript
pi.on("agent_end", async (event, ctx) => {
  // 1. Get last assistant message
  // 2. Apply heuristics to detect high-value content:
  //    - Contains decision keywords (decided, resolved, completed, fixed, deployed...)
  //    - Contains outcome indicators (>80 chars, not just acknowledgements)
  // 3. If threshold met, call fabric_write internally
  //    type: "code-session", training_value: "normal"
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
│   ├── index.ts               ← Pi extension factory (registers 7 tools + 3 hooks)
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
FABRIC_DIR     // Default: ~/.pi/fabric
FABRIC_AGENT   // Default: process.env.HERMES_AGENT_NAME || "pi-agent"
```

Configurable settings (can be added later without breaking changes):
- `FABRIC_MAX_ENTRIES` — cold archive threshold
- `FABRIC_AUTO_STORE` — enable/disable agent_end auto-capture

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
| 5. 7 tools in extension factory | src/index.ts | 150 |
| 6. 3 lifecycle hooks | src/index.ts | 100 |
| 7. Tests | tests/*.test.ts | 150 |

**Deliverable:** Pi agent can write, recall, search, and auto-capture entries. Tools functional in Pi session.

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
| `/home/tom/tmp/memory-os/icarus/fabric-retrieve.py` | Ranked retrieval scoring algorithm (keyword + recency + agent + tier). |
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
| Async | Sync file I/O | `await fs.readFile/writeFile` |
| Agent name | `HERMES_AGENT_NAME` env var | Same env var or `FABRIC_AGENT` |
| Session ID | `state.session_id` global | Available via hook `_event.sessionId`? (verify in Pi API) |

---

## 13. Immediate Next Steps

1. **Read the Icarus reference files** listed in §12 — especially `state.py` (the core I/O logic) and `hooks.py` (the injection logic)
2. **Scaffold the project** — copy `package.json` and `tsconfig.json` from pi-memory-os, update package name to `pi-fabric`
3. **Implement `src/types.ts`** — Entry interface, config types, tool param types
4. **Implement `src/fabric-store.ts`** — write, read, search, curate, pending, brief
5. **Implement `src/scoring.ts`** — ranked retrieval algorithm
6. **Implement `src/index.ts`** — wire 7 tools + 3 hooks
7. **Write tests** — start with the scoring engine (pure logic, easiest to TDD)
8. **Link the extension** — `mkdir -p ~/.pi/agent/extensions/fabric && ln -s ~/git/pi-fabric/src ~/.pi/agent/extensions/fabric/` (check Pi's actual extension loading mechanism)
9. **Test in a Pi session** — call each tool, verify lifecycle injections appear in system prompt

---

*End of handoff document. Continue from here when ready.*
