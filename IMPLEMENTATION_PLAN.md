# pi-fabric Implementation Plan

Single tracking document for `pi-fabric`. Stable design decisions live in `DESIGN.md`; user-facing usage lives in `README.md`.

## Product Role

`pi-fabric` is the Pi adapter for the existing Hermes/Icarus Fabric markdown corpus. It owns Fabric-compatible markdown storage, Fabric tools, Fabric recall/scoring, pending/review/brief workflows, and optional Fabric auto-capture.

`pi-memory-os` depends on `pi-fabric` for structured Fabric context. `pi-memory-os` must call `pi-fabric` APIs instead of duplicating Fabric markdown readers, writers, schemas, or tools.

## Current Priority

**Task:** phase-1 pi-fabric implementation is complete; keep compatibility healthy while downstream `pi-memory-os` uses the stable API.

Motivation:

- `pi-memory-os` should remain a glue layer to the existing local Memory OS brain, not a reimplementation of Fabric.
- Fabric markdown storage, schema, tools, pending/review workflows, and brief/recall behavior belong in `pi-fabric`.
- `pi-memory-os` needs Fabric context for ambient Memory OS injection, but it should consume that context by calling `pi-fabric` APIs.
- Importing `pi-fabric/dist/src/...` is brittle because it depends on build layout instead of a supported package contract.
- A stable public API is the enabler for the next `pi-memory-os` task: session-start / first-turn Fabric operational context equivalent to Icarus brief/pending/recent state.

Why now: `pi-memory-os` now consumes `pi-fabric` through the stable package-level API for config/store/recall/brief/pending/recent access, including session-start Fabric operational context.

Status:

- [x] Phase-1 Fabric store/tools/hooks implementation exists.
- [x] Icarus-compatible markdown storage and frontmatter behavior implemented.
- [x] Seven phase-1 tools exist: `fabric_write`, `fabric_recall`, `fabric_search`, `fabric_pending`, `fabric_curate`, `fabric_brief`, `fabric_init_obsidian`.
- [x] Tests exist for config, store behavior, and scoring.
- [x] Add stable public exports for programmatic consumers.
- [x] Add a consumer-style import test for the public API.
- [x] Update `pi-memory-os` to stop importing `pi-fabric/dist/src/...` (`src/retrieval/sources.ts`, `tests/retrieval-sources.test.ts`).
- [x] Support `pi-memory-os` session-start Fabric operational context via public `FabricStore.brief()`.
- [x] Maintain compatibility coverage, including Icarus interop smoke.

## Decisions

| Decision | Status | Notes |
|---|---:|---|
| Keep `pi-fabric` separate from `pi-memory-os` | accepted | Fabric tools/storage and Memory OS lifecycle glue have different ownership. |
| Hermes/Icarus Fabric markdown is the compatibility target | accepted | Preserve field names, linking semantics, pending semantics, and hot/cold layout. |
| Phase 1 avoids Hermes runtime writes | accepted | No Hermes `state.db`, telemetry, training, model-switching, Qdrant, or Redis ownership here. |
| `pi-fabric` owns `fabric_*` tools | accepted | `pi-memory-os` may call APIs, but must not re-register tools. |
| Programmatic API should be stable | accepted/done | Needed so `pi-memory-os` remains glue without importing built internals. |

## Done

Implemented files:

- `src/config.ts` — Fabric config resolution.
- `src/types.ts` — Icarus-compatible Fabric types.
- `src/yaml.ts` — small frontmatter serializer/parser.
- `src/fabric-store.ts` — filesystem storage, listing, search, pending, curate, recent, brief.
- `src/scoring.ts` — phase-1 recall/scoring.
- `src/hooks.ts` — Pi lifecycle hooks, fail-open.
- `src/index.ts` — Pi extension entry and seven Fabric tools.
- `tests/config.test.ts`, `tests/fabric-store.test.ts`, `tests/scoring.test.ts`, `tests/public-api.test.ts`.

Already implemented behavior:

- Resolve Fabric directory from `FABRIC_DIR`, Pi settings/global settings, existing `~/fabric`, or `~/.pi/fabric`.
- Write Icarus-compatible markdown entries with 8-hex frontmatter `id`, independent 4-hex filename suffix, atomic `.tmp` rename, hot/cold support.
- Validate entry types, open-task assignment, reviews, `agent:id` references, and training values.
- Normalize `tags` and `artifact_paths` from string or array.
- Search and recall hot/cold entries.
- List pending tasks, reviews of current agent work, and customer-scoped open tickets.
- Produce operational `brief()` with pending counts, recent own/other activity, and suggested next action.
- Register phase-1 Fabric tools only in `pi-fabric`.

## Reference Facts

Verified against original Memory OS/Hermes/Icarus under `/home/tom/tmp/memory-os/icarus/`:

- Icarus registers Fabric tools and lifecycle hooks in `__init__.py`.
- Tool schemas use `fabric_recall.query`, `fabric_recall.max_results`, optional `agent`, optional `project`, and `fabric_write` comma-string-capable `tags` / `artifact_paths`.
- `state.py` uses frontmatter `id = secrets.token_hex(4)`, filename suffix `secrets.token_hex(2)`, `<agent>-<type>-<slug>-<suffix>.md`, temp-file rename, hot/cold scanning, pending grouping, and curation by frontmatter id.
- Pi supports `session_start`, `before_agent_start`, and `agent_end` hooks; hooks must fail open.

## Planned Work

### 1. Stable Public Programmatic API

Classification: `reuse/enabler`
Status: complete

Goal: let `pi-memory-os` consume Fabric behavior without importing built internals or duplicating markdown logic.

Tasks:

- Export stable package-level or documented subpath APIs for:
  - `loadConfig`
  - `FabricStore`
  - `recall` / scoring types
  - public Fabric types needed by consumers
- Ensure `brief()`, `pending()`, `recentOwn()`, and `recentOthers()` remain accessible through `FabricStore` or a small public helper.
- Keep default extension/tool registration as the package default export.
- Add a consumer-style test or typecheck that imports the public API the way `pi-memory-os` will.
- Build package declarations so consumers have stable TypeScript types.

Verification:

- `npm run build` passes in `pi-fabric`.
- `npm test` passes in `pi-fabric`.
- `pi-memory-os` can replace `pi-fabric/dist/src/...` imports with the stable public API and pass `npm run verify` / `npm run build`.

### 2. Support pi-memory-os Session-start Operational Context

Classification: `cross-repo/reuse`
Status: complete

Goal: provide enough stable API for `pi-memory-os` to recreate Icarus-style session-start Fabric context without direct markdown ownership.

Tasks:

- [x] Confirm `brief()` includes pending counts, first pending items, recent own/other activity, and suggested next action.
- [x] Decide no new `pi-fabric` helper is needed yet: `pi-memory-os` can format/sanitize `FabricStore.brief()` output while `pi-fabric` owns the data.
- [x] Keep sanitization/formatting boundaries clear: `pi-fabric` owns Fabric data; `pi-memory-os` owns final Memory OS injection policy.

Verification:

- [x] `pi-memory-os` session-start context calls `pi-fabric` public APIs only.
- [x] No new `fabric_*` tools are registered by `pi-memory-os`.
- [x] `pi-memory-os` unit tests cover success, fail-open Fabric brief errors, and sanitization.

### 3. Keep Fabric Compatibility Healthy

Classification: `maintenance`
Status: complete for phase 1; monitor for regressions

Tasks:

- [x] Keep tests mapped to compatibility requirements:
  - [x] write/parse frontmatter fields
  - [x] pending grouping
  - [x] `review_of`/`revises` validation
  - [x] tags/artifact normalization
  - [x] curation by frontmatter id
  - [x] hot/cold search
  - [x] recall with `max_results`, `agent`, `project`
  - [x] idempotent Obsidian init, including `.obsidian/` and `daily/` directories
  - [x] operational `brief()` shape for pending/recent/suggested action consumers
- [x] Add manual Hermes/Icarus interop smoke: `npm run smoke:icarus-interop` writes with `FabricStore` under a temp Fabric dir and confirms original Icarus `parsing.parse_entry()` can parse/read it when `ICARUS_DIR` is available.

### 4. Future Non-phase-1 Work

Do only after explicit design decision:

- Hermes telemetry/reporting tools.
- Training/export/model replacement tools.
- Hermes `state.db` writes.
- Qdrant/Redis ownership.
- Shared low-level clients with `pi-memory-os`.

## Do-Not-Build List

Do not add these to `pi-fabric` phase 1:

- Qdrant or Redis clients.
- Memory OS semantic ingestion.
- `memory_os_*` tools.
- Hermes `state.db` or telemetry writes.
- Training/model-switching behavior.
- A replacement Fabric runtime that diverges from Hermes/Icarus markdown compatibility.

## Current Next Step

`pi-fabric` Tasks 1–3 are complete for the current phase. Next priority is cross-repo work in `pi-memory-os`: source-specific retrieval budgets / score policy. In `pi-fabric`, monitor for compatibility regressions and only add maintenance work when a concrete gap is discovered.

Latest verification:

- `pi-fabric`: `npm test` passed (18 tests) after adding `revises`, `brief()`, and Obsidian directory coverage.
- `pi-fabric`: `npm run smoke:icarus-interop` passed against `/home/tom/tmp/memory-os/icarus/parsing.py`.
- `pi-memory-os`: `npm run verify` passed after session-start Fabric operational context changes (typecheck + 17 files / 108 tests).
- `pi-memory-os`: `npm run smoke:lifecycle-context` passed and verified session_start Fabric brief plus before_agent_start dual-source context.
- Code search found no remaining `pi-fabric/dist/src/...` imports under `pi-memory-os/src` or `pi-memory-os/tests`.
