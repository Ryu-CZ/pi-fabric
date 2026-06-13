# pi-fabric Implementation Plan

This plan implements `DESIGN.md` as a Pi adapter extension for the existing Hermes/Icarus Fabric markdown corpus. Phase 1 is compatibility-first: no Qdrant, Redis, Hermes `state.db`, telemetry, fine-tuning, or model-switching writes.

## Success criteria from DESIGN.md

- Build a standalone TypeScript Pi extension named `pi-fabric`.
- Resolve `$FABRIC_DIR` as: env `FABRIC_DIR` → existing `~/fabric` → `~/.pi/fabric`.
- Read/write Icarus-compatible markdown entries with YAML frontmatter, 8-hex `id`, independent 4-hex filename suffix, atomic temp-file rename, and shared `cold/` support.
- Implement phase-1 tools: `fabric_write`, `fabric_recall`, `fabric_search`, `fabric_pending`, `fabric_curate`, `fabric_brief`, `fabric_init_obsidian`.
- Preserve Hermes field names, tool parameter names, validation rules, pending-work semantics, and `agent:id` linking semantics.
- Verify/use actual Pi extension API hooks; implement only available lifecycle hooks and fail open.
- Provide tests covering all DESIGN.md compatibility-test items.

## Reference facts already verified

- Icarus registers 16 tools and 4 hooks in `/home/tom/tmp/memory-os/icarus/__init__.py`.
- Icarus schemas use `fabric_recall.query`, `fabric_recall.max_results`, optional `agent`, optional `project`, and `fabric_write` comma-string `tags` / `artifact_paths` in `/home/tom/tmp/memory-os/icarus/schemas.py`.
- Icarus core store behavior is in `/home/tom/tmp/memory-os/icarus/state.py`:
  - `write_entry()` uses frontmatter `id = secrets.token_hex(4)` and filename suffix `secrets.token_hex(2)`.
  - filenames are `<agent>-<type>-<slug>-<suffix>.md`.
  - atomic write is `.tmp` then rename.
  - `has_entry_ref()` searches both root and `cold/` by frontmatter `agent` + `id`.
  - `curate_entry()` updates by frontmatter `id`.
  - `read_pending()` groups open assigned work, reviews of current agent's work, and customer-scoped open tickets.
  - `search_entries()` scans root and `cold/`.
- Pi extension hooks are available per Pi docs:
  - `session_start` for status/brief setup.
  - `before_agent_start` can inject a persistent message and/or alter system prompt.
  - `agent_end` exposes `event.messages` for optional auto-capture.
- Pi tool registration uses `pi.registerTool({ name, description, parameters: Type.Object(...), execute(...) })` and returns `{ content: [{ type: "text", text }], details }`.

## Project scaffold

Create:

```txt
package.json
README.md
tsconfig.json
src/
  index.ts
  config.ts
  types.ts
  yaml.ts
  fabric-store.ts
  scoring.ts
  hooks.ts
tests/
  fabric-store.test.ts
  scoring.test.ts
```

Package conventions should mirror `pi-memory-os`: ESM, `@earendil-works/pi-coding-agent`, `@sinclair/typebox`, TypeScript 5.8+, Node 22+ built-ins only. Use `pi.extensions: ["./src/index.ts"]`.

## Implementation steps

### 1. Configuration (`src/config.ts`)

Implement `loadConfig(cwd = process.cwd())`:

- `fabricDir`: `process.env.FABRIC_DIR` if set; else existing `~/fabric`; else `~/.pi/fabric`.
- `agent`: `FABRIC_AGENT` → `HERMES_AGENT_NAME` → `pi-agent`.
- `projectId`: `FABRIC_PROJECT_ID` → cwd basename → `unknown`.
- `compatMode`: `FABRIC_COMPAT_MODE || "icarus"`.
- `autoStore`: default enabled unless `FABRIC_AUTO_STORE` is false-like.

Do not read/write Hermes runtime files.

### 2. Types (`src/types.ts`)

Define:

- `FabricEntryType = "task" | "decision" | "review" | "resolution" | "research" | "code-session" | "session" | "note"`.
- `FabricStatus = "completed" | "open" | "blocked" | "superseded"`.
- `TrainingValue = "high" | "normal" | "low"`.
- `FabricFrontmatter` with DESIGN.md fields.
- `FabricEntry = { frontmatter, body, file, path, cold }`.
- Tool param/result types for the seven phase-1 tools.

Keep `tags?: string | string[]` and `artifact_paths?: string | string[]` accepted at the store boundary.

### 3. YAML/frontmatter helpers (`src/yaml.ts`)

Use a deliberately small Icarus-compatible YAML subset:

- Writer:
  - quote scalars with `JSON.stringify(String(value))`.
  - write arrays as JSON arrays, valid YAML (`["a","b"]`).
  - omit empty optional fields.
- Parser:
  - split first `---\n ... \n---` block.
  - parse quoted strings, bare strings, booleans-as-strings where needed, and bracket arrays.
  - normalize arrays; for scalar array fields, accept comma strings.
- Preserve unknown body content exactly.

Avoid a runtime dependency unless parser complexity grows.

### 4. Store layer (`src/fabric-store.ts`)

Implement `FabricStore` as the single filesystem abstraction.

Methods:

- `ensureDirs()` creates root and `cold/`.
- `initObsidian()` creates root, `cold/`, `daily/`, `.obsidian/` with minimal idempotent config.
- `writeEntry(params)`:
  - validate required `type`, `summary`, `content`.
  - validate supported type.
  - `status === "open"` requires `assigned_to`.
  - `type === "review"` requires `review_of`.
  - `review_of` / `revises` must match non-empty `agent:id` with id length at least 4; if local ref exists can be checked, reject missing local refs for compatibility with Icarus behavior.
  - `training_value` must be `high|normal|low`.
  - normalize tags/artifact paths from comma string or array and write YAML arrays.
  - generate frontmatter `id` from `crypto.randomBytes(4).toString("hex")`.
  - generate independent filename suffix from `crypto.randomBytes(2).toString("hex")`.
  - slug from summary: lowercase, non-alnum to `-`, max 40, trim `-`.
  - write `<target>.tmp`, then `rename()` to `.md`.
  - default `platform: "pi"`, `tier: "hot"`, `source_tool: "pi-fabric"`.
- `listEntries({ includeCold = true })` scans root `*.md` and optionally `cold/*.md`.
- `hasEntryRef(ref)` searches root and `cold/` by frontmatter `agent` and `id`.
- `search(query, limit = 10)` matches root and `cold/`, returning `{ query, count, results: [{ file, agent, summary, matches }] }`.
- `pending({ customer_id? })` mirrors Icarus grouping:
  - open tasks from other agents assigned to current agent.
  - reviews from other agents whose `review_of` starts with current `agent:`.
  - customer-scoped open tickets assigned to current agent.
- `curate(entry_id, training_value)` searches root and `cold/`, rewrites frontmatter by `id`, and uses temp-file rename.
- `recentOwn(limit)`, `recentOthers(limit)`, and `brief()` support `fabric_brief`.

### 5. Scoring (`src/scoring.ts`)

Implement phase-1 filesystem retrieval without Hermes `state.db`:

- Tokenize/lowercase query, summary, body, tags.
- Score components:
  - summary and body keyword/phrase matches.
  - tag overlap.
  - recency boost over 90 days.
  - optional `agent` boost.
  - optional `project` boost using `project_id`.
  - small boosts for open assigned work and linked review/revision fields if easy.
- Return sorted entries with DESIGN.md-compatible fields:
  - `score`, `id`, `agent`, `type`, `timestamp`, `summary`, `file`, `path`.
- Public tool parameter must remain `max_results`, not `limit`.

Document that this is a phase-1 simplification of `fabric-retrieve.py`.

### 6. Pi extension entry (`src/index.ts`)

Register exactly the phase-1 compatibility subset:

1. `fabric_write`
2. `fabric_recall`
3. `fabric_search`
4. `fabric_pending`
5. `fabric_curate`
6. `fabric_brief`
7. `fabric_init_obsidian`

Use TypeBox schemas. For `tags` and `artifact_paths`, expose a permissive schema that accepts either arrays or comma strings if TypeBox/JSON schema support permits; otherwise expose arrays in Pi and normalize strings defensively at runtime.

Return text JSON for compatibility and put raw objects in `details`.

Do not register training/model tools in phase 1; mention them in README as future work.

### 7. Hooks (`src/hooks.ts` or inside `index.ts`)

Use only verified Pi hooks:

- `session_start`:
  - ensure status footer: `Fabric: linked` / `Fabric: not initialized` / pending count.
  - do not write entries automatically.
- `before_agent_start`:
  - skip empty/social/system-like prompts.
  - call `store.recall(prompt, { max_results: 3 })`.
  - inject a `fabric-context` message if results exist.
  - optionally include `fabric_brief` only on first turn of a session.
  - sanitize retrieved content to strip unpaired backticks and obvious injection preambles.
- `agent_end`:
  - if `FABRIC_AUTO_STORE` enabled, inspect final assistant message.
  - skip short/social/system-injection content.
  - use Icarus-style regexes for decision/outcome/completion.
  - write `type: "decision"`, `training_value: "high"`, `status: "completed"` when criteria are met.
  - catch and ignore errors so Fabric cannot break Pi sessions.

Do not implement unverified hook names.

### 8. Tests

Use Node's built-in test runner or Vitest. Required test coverage must map to DESIGN.md §14:

1. Pi writes an entry and parsed frontmatter contains Icarus fields.
2. Open assigned entry appears in `pending()` for that agent.
3. `review_of=agent:id` accepts an existing entry and malformed refs are rejected.
4. Comma-string and array `tags` both write YAML arrays; same for `artifact_paths`.
5. `curate()` updates by frontmatter `id`, not filename suffix.
6. `search()` scans both root and `cold/`.
7. `recall()` accepts `max_results`, `agent`, and `project` names and returns compatible fields.
8. `fabric_init_obsidian` can be called repeatedly without changing success.

Add focused scoring tests for keyword, recency, agent, and project boosts.

### 9. README

Document:

- What pi-fabric is and is not.
- Compatibility with Hermes/Icarus shared markdown corpus.
- Directory resolution order.
- The seven phase-1 tools.
- Env vars from DESIGN.md.
- Installation/loading paths for Pi extensions.
- Phase-1 limitations: no Hermes DB/telemetry writes, no Qdrant/Redis, no training/model replacement.
- Manual interop test with `/tmp/shared-fabric-test`.

## Implementation order

1. Scaffold package/tsconfig/README skeleton.
2. Implement config/types/yaml helpers.
3. Implement `FabricStore.writeEntry`, parsing, listing, and `hasEntryRef`.
4. Add tests for writes, tags/artifact normalization, refs.
5. Implement search/pending/curate/brief and tests.
6. Implement scoring/recall and tests.
7. Wire tools in `index.ts`.
8. Add lifecycle hooks after tool tests are green.
9. Run full test/build and manual temp-dir smoke test.
10. Optional Hermes interop: write with pi-fabric under `/tmp/shared-fabric-test`, then parse/read with Icarus reference code.

## Risks and mitigations

- **YAML edge cases:** keep emitted YAML simple and JSON-compatible; parser only needs the field subset emitted by Icarus/Pi.
- **Reference validation strictness:** Icarus rejects missing local refs; preserve this for local refs, but document behavior if corpus is incomplete.
- **Concurrent writes:** independent random suffix and atomic rename make create safe; curation uses temp-file rewrite.
- **Prompt injection from recalled memory:** sanitize retrieved snippets before injection and avoid injecting raw full entries by default.
- **Pi hook payload drift:** keep hooks small, optional, and fail-open; tools remain the core supported API.
