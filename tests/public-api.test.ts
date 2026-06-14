import test from "node:test";
import assert from "node:assert/strict";
import extension, {
  FABRIC_ENTRY_TYPES,
  FabricStore,
  loadConfig,
  recall,
  scoreEntry,
  type FabricConfig,
  type FabricEntry,
  type FabricRecallParams,
  type FabricWriteParams,
  type PendingResult,
  type RecallResult,
  type TrainingValue,
} from "../src/index.js";

function entry(): FabricEntry {
  return {
    frontmatter: {
      id: "12345678",
      agent: "api-agent",
      platform: "pi",
      timestamp: new Date().toISOString(),
      type: "note",
      tier: "hot",
      summary: "Public API redis note",
      project_id: "api-project",
      source_tool: "pi-fabric",
    },
    body: "redis body",
    file: "api-agent-note-public-api-0000.md",
    path: "/tmp/api-agent-note-public-api-0000.md",
    cold: false,
  };
}

test("package root exposes stable programmatic API", async () => {
  assert.equal(typeof extension, "function");
  assert.equal(typeof loadConfig, "function");
  assert.equal(typeof FabricStore, "function");
  assert.equal(typeof recall, "function");
  assert.equal(typeof scoreEntry, "function");
  assert.ok(FABRIC_ENTRY_TYPES.includes("task"));

  const config: FabricConfig = {
    fabricDir: "/tmp/pi-fabric-public-api-test",
    agent: "api-agent",
    projectId: "api-project",
    compatMode: "icarus",
    autoStore: true,
  };
  const store = new FabricStore(config);
  assert.equal(store.config.agent, "api-agent");
  assert.equal(typeof store.brief, "function");
  assert.equal(typeof store.pending, "function");
  assert.equal(typeof store.recentOwn, "function");
  assert.equal(typeof store.recentOthers, "function");

  const params: FabricRecallParams = { query: "redis", max_results: 5, project: "api-project" };
  const result: RecallResult = {
    score: scoreEntry(entry(), params, config.agent),
    id: "12345678",
    agent: "api-agent",
    type: "note",
    timestamp: entry().frontmatter.timestamp,
    summary: "Public API redis note",
    file: "api-agent-note-public-api-0000.md",
    path: "/tmp/api-agent-note-public-api-0000.md",
  };
  assert.ok(result.score > 0);

  const training: TrainingValue = "normal";
  const writeParams: FabricWriteParams = { type: "note", summary: "s", content: "c", training_value: training };
  const pending: PendingResult = { open_tasks: [], reviews_of_my_work: [], open_tickets: [], total: 0 };
  assert.equal(writeParams.training_value, "normal");
  assert.equal(pending.total, 0);
});
