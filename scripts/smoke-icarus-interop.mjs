#!/usr/bin/env node
// Smoke test: write markdown with pi-fabric, then parse it with the original
// Icarus parser when the reference checkout is available.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { FabricStore } from "../dist/src/index.js";

const icarusDir = process.env.ICARUS_DIR || "/home/tom/tmp/memory-os/icarus";
const fabricDir = await mkdtemp(join(tmpdir(), "pi-fabric-icarus-interop-"));

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

try {
  const store = new FabricStore({
    fabricDir,
    agent: "pi-agent",
    projectId: "pi-fabric-smoke",
    compatMode: "icarus",
    autoStore: true,
  });
  const entry = await store.writeEntry({
    type: "task",
    summary: "Icarus interop smoke",
    content: "Body content for Icarus parser verification.",
    tags: "interop, smoke",
    status: "completed",
    outcome: "parseable by Icarus",
    training_value: "high",
    artifact_paths: ["scripts/smoke-icarus-interop.mjs"],
  });

  const python = String.raw`
import json
import sys
from pathlib import Path

icarus_dir = Path(sys.argv[1])
entry_path = Path(sys.argv[2])
if not (icarus_dir / "parsing.py").exists():
    print(json.dumps({"skipped": True, "reason": f"missing Icarus parser at {icarus_dir}"}))
    raise SystemExit(0)

sys.path.insert(0, str(icarus_dir))
from parsing import parse_entry

parsed = parse_entry(entry_path)
if parsed is None:
    raise AssertionError("parse_entry returned None")
assert parsed.get("id"), "missing id"
assert parsed.get("agent") == "pi-agent", parsed.get("agent")
assert parsed.get("platform") == "pi", parsed.get("platform")
assert parsed.get("type") == "task", parsed.get("type")
assert parsed.get("tier") == "hot", parsed.get("tier")
assert parsed.get("summary") == "Icarus interop smoke", parsed.get("summary")
assert parsed.get("project_id") == "pi-fabric-smoke", parsed.get("project_id")
assert parsed.get("tags") == ["interop", "smoke"], parsed.get("tags")
assert parsed.get("artifact_paths") == ["scripts/smoke-icarus-interop.mjs"], parsed.get("artifact_paths")
assert parsed.get("status") == "completed", parsed.get("status")
assert parsed.get("outcome") == "parseable by Icarus", parsed.get("outcome")
assert parsed.get("training_value") == "high", parsed.get("training_value")
assert "Body content for Icarus parser verification." in parsed.get("body", ""), parsed.get("body")
print(json.dumps({"skipped": False, "file": str(entry_path), "id": parsed.get("id")}))
`;

  const result = spawnSync("python3", ["-c", python, icarusDir, entry.path], { encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`Icarus parser exited with status ${result.status}`);
  } else {
    const payload = JSON.parse(result.stdout.trim());
    if (payload.skipped) {
      console.log(`SKIP: ${payload.reason}`);
    } else {
      console.log(`PASS: pi-fabric entry ${payload.id} parsed by Icarus (${payload.file})`);
    }
  }
} finally {
  await rm(fabricDir, { recursive: true, force: true });
}
