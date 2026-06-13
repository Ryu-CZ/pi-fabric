import test from "node:test";
import assert from "node:assert/strict";
import { scoreEntry } from "../src/scoring.js";
import type { FabricEntry } from "../src/types.js";

function entry(overrides: Partial<FabricEntry["frontmatter"]> = {}, body = "body"): FabricEntry {
  return {
    frontmatter: {
      id: "12345678",
      agent: "pi-agent",
      platform: "pi",
      timestamp: new Date().toISOString(),
      type: "note",
      tier: "hot",
      summary: "Default summary",
      project_id: "proj",
      source_tool: "pi-fabric",
      ...overrides,
    },
    body,
    file: "x.md",
    path: "/tmp/x.md",
    cold: false,
  };
}

test("keyword and phrase matches increase score", () => {
  const strong = scoreEntry(entry({ summary: "Redis cache decision", tags: ["redis"] }, "redis cache body"), { query: "redis cache" });
  const weak = scoreEntry(entry({ summary: "Unrelated" }, "redis mentioned once"), { query: "redis cache" });
  assert.ok(strong > weak);
});

test("recency boost favors recent entries", () => {
  const recent = scoreEntry(entry({ timestamp: new Date().toISOString(), summary: "Redis" }), { query: "redis" });
  const old = scoreEntry(entry({ timestamp: new Date(Date.now() - 120 * 86_400_000).toISOString(), summary: "Redis" }), { query: "redis" });
  assert.ok(recent > old);
});

test("agent boost favors requested agent", () => {
  const wanted = scoreEntry(entry({ agent: "other", summary: "Redis" }), { query: "redis", agent: "other" }, "pi-agent");
  const notWanted = scoreEntry(entry({ agent: "pi-agent", summary: "Redis" }), { query: "redis", agent: "other" }, "pi-agent");
  assert.ok(wanted > notWanted);
});

test("project boost favors requested project", () => {
  const wanted = scoreEntry(entry({ project_id: "target", summary: "Redis" }), { query: "redis", project: "target" });
  const notWanted = scoreEntry(entry({ project_id: "other", summary: "Redis" }), { query: "redis", project: "target" });
  assert.ok(wanted > notWanted);
});
