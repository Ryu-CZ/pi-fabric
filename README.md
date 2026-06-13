# pi-fabric

`pi-fabric` is a standalone Pi extension that lets Pi agents read and write the existing Hermes/Icarus Fabric markdown corpus. Phase 1 is compatibility-first: it writes Icarus-compatible markdown entries and exposes a small tool subset, but it does not replace Hermes/Memory OS services.

## What it is not

Phase 1 does **not** write Hermes `state.db` or telemetry, run Qdrant/Redis, fine-tune models, switch replacement models, or mutate Hermes runtime files. Hermes remains the owner of those systems; Pi is only a peer markdown reader/writer.

## Directory resolution

The Fabric directory is resolved as:

1. `FABRIC_DIR`, if set
2. project `.pi/settings.json` Fabric setting
3. global Pi settings at `${PI_CODING_AGENT_DIR:-~/.pi/agent}/settings.json`
4. existing `~/fabric`
5. `~/.pi/fabric`

Supported settings keys are `fabricDir`, `fabric_dir`, `fabric.dir`, `fabric.fabricDir`, `piFabric.dir`, `piFabric.fabricDir`, `pi-fabric.dir`, and `pi-fabric.fabricDir`.

The layout is compatible with Icarus:

```txt
$FABRIC_DIR/
├── <agent>-<type>-<slug>-<suffix>.md
├── cold/
├── daily/
└── .obsidian/
```

Entries use YAML frontmatter with an 8-hex `id`, an independent 4-hex filename suffix, JSON/YAML arrays for `tags` and `artifact_paths`, and atomic temp-file rename writes.

## Phase-1 tools

The extension registers exactly this Pi phase-1 compatibility subset:

- `fabric_write`
- `fabric_recall`
- `fabric_search`
- `fabric_pending`
- `fabric_curate`
- `fabric_brief`
- `fabric_init_obsidian`

Training, model replacement, telemetry, report, and export tools are future work.

## Environment variables

- `FABRIC_DIR` — shared Fabric markdown directory
- `FABRIC_AGENT` — Pi agent name
- `HERMES_AGENT_NAME` — fallback agent name for Hermes compatibility
- `FABRIC_PROJECT_ID` — project ID written into frontmatter
- `FABRIC_COMPAT_MODE` — defaults to `icarus`
- `FABRIC_AUTO_STORE` — set to `false`, `0`, `no`, `off`, or `disabled` to disable auto-capture

## Loading in Pi

This package declares:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Load the extension from this directory with Pi's package/extension loading mechanism, or explicitly with an extension path such as:

```bash
pi -e ./src/index.ts
```

## Retrieval limitations

`fabric_recall` uses phase-1 filesystem scoring: keyword/phrase matches, tag overlap, recency, agent, project, and small status/link boosts. It intentionally does not write or depend on Hermes SQLite/FTS indexes.

## Manual interop smoke test

```bash
export FABRIC_DIR=/tmp/shared-fabric-test
npm test
pi -e ./src/index.ts
```

Then call `fabric_init_obsidian`, write an entry with `fabric_write`, and verify Hermes/Icarus reference code can parse/read the generated markdown under `/tmp/shared-fabric-test`.
