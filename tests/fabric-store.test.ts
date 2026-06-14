import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FabricStore } from "../src/fabric-store.js";
import { parseFrontmatter } from "../src/yaml.js";
import type { FabricConfig } from "../src/types.js";
import { recall } from "../src/scoring.js";

async function makeStore(agent = "pi-agent") {
  const dir = await mkdtemp(join(tmpdir(), "pi-fabric-"));
  const config: FabricConfig = { fabricDir: dir, agent, projectId: "proj", compatMode: "icarus", autoStore: true };
  return new FabricStore(config);
}

test("Pi writes an entry with Icarus-compatible frontmatter", async () => {
  const store = await makeStore();
  const entry = await store.writeEntry({ type: "decision", summary: "Use TypeScript", content: "## Context\nUse TS.", training_value: "high" });
  assert.match(entry.frontmatter.id, /^[0-9a-f]{8}$/);
  assert.match(entry.file, /^pi-agent-decision-use-typescript-[0-9a-f]{4}\.md$/);
  const parsed = parseFrontmatter(await readFile(entry.path, "utf8")).frontmatter;
  assert.equal(parsed.platform, "pi");
  assert.equal(parsed.tier, "hot");
  assert.equal(parsed.source_tool, "pi-fabric");
  assert.equal(parsed.project_id, "proj");
});

test("open assigned entry appears pending for assigned agent", async () => {
  const store = await makeStore("pi-agent");
  await store.writeEntry({ agent: "other", type: "task", summary: "Fix API", content: "Please fix", status: "open", assigned_to: "pi-agent" });
  const pending = await store.pending();
  assert.equal(pending.open_tasks.length, 1);
  assert.equal(pending.total, 1);
  assert.equal(pending.open_tickets.length, 0);
});

test("review_of accepts existing refs and malformed/missing refs are rejected", async () => {
  const store = await makeStore("pi-agent");
  const base = await store.writeEntry({ type: "decision", summary: "Base decision", content: "base" });
  const review = await store.writeEntry({ agent: "reviewer", type: "review", summary: "Review base", content: "looks good", review_of: `pi-agent:${base.frontmatter.id}` });
  assert.equal(review.frontmatter.review_of, `pi-agent:${base.frontmatter.id}`);
  await assert.rejects(() => store.writeEntry({ type: "review", summary: "Bad", content: "bad", review_of: "not-a-ref" }), /review_of/);
  await assert.rejects(() => store.writeEntry({ type: "review", summary: "Missing", content: "bad", review_of: "pi-agent:abcd" }), /not found/);
});

test("revises accepts existing refs and malformed/missing refs are rejected", async () => {
  const store = await makeStore("pi-agent");
  const base = await store.writeEntry({ type: "decision", summary: "Original decision", content: "base" });
  const revision = await store.writeEntry({ type: "decision", summary: "Updated decision", content: "revision", revises: `pi-agent:${base.frontmatter.id}` });
  assert.equal(revision.frontmatter.revises, `pi-agent:${base.frontmatter.id}`);
  await assert.rejects(() => store.writeEntry({ type: "decision", summary: "Bad revision", content: "bad", revises: "not-a-ref" }), /revises/);
  await assert.rejects(() => store.writeEntry({ type: "decision", summary: "Missing revision", content: "bad", revises: "pi-agent:abcd" }), /not found/);
});

test("comma-string and array tags/artifact_paths write YAML arrays", async () => {
  const store = await makeStore();
  const one = await store.writeEntry({ type: "note", summary: "Comma lists", content: "body", tags: "a, b,c", artifact_paths: "x.ts, y.ts" });
  const two = await store.writeEntry({ type: "note", summary: "Array lists", content: "body", tags: ["d", "e"], artifact_paths: ["z.ts"] });
  const fm1 = parseFrontmatter(await readFile(one.path, "utf8")).frontmatter;
  const fm2 = parseFrontmatter(await readFile(two.path, "utf8")).frontmatter;
  assert.deepEqual(fm1.tags, ["a", "b", "c"]);
  assert.deepEqual(fm1.artifact_paths, ["x.ts", "y.ts"]);
  assert.deepEqual(fm2.tags, ["d", "e"]);
  assert.deepEqual(fm2.artifact_paths, ["z.ts"]);
});

test("curate updates by frontmatter id, not filename suffix", async () => {
  const store = await makeStore();
  const entry = await store.writeEntry({ type: "note", summary: "Curate me", content: "body" });
  const suffix = entry.file.match(/-([0-9a-f]{4})\.md$/)?.[1];
  assert.ok(suffix);
  await assert.rejects(() => store.curate(suffix, "low"), /entry not found/);
  const result = await store.curate(entry.frontmatter.id, "low");
  assert.equal(result.training_value, "low");
  const parsed = parseFrontmatter(await readFile(entry.path, "utf8")).frontmatter;
  assert.equal(parsed.training_value, "low");
});

test("search scans both root and cold", async () => {
  const store = await makeStore();
  const hot = await store.writeEntry({ type: "note", summary: "Hot needle", content: "root body" });
  const cold = await store.writeEntry({ type: "note", summary: "Cold item", content: "cold needle body" });
  await mkdir(join(store.config.fabricDir, "cold"), { recursive: true });
  await rename(cold.path, join(store.config.fabricDir, "cold", cold.file));
  const result = await store.search("needle");
  assert.equal(result.count, 2);
  assert.deepEqual(new Set(result.results.map((r) => r.file)), new Set([hot.file, cold.file]));
});

test("recall accepts max_results, agent, project and returns compatible fields", async () => {
  const store = await makeStore();
  await store.writeEntry({ agent: "other", type: "research", summary: "Redis indexing", content: "redis fts", project_id: "proj-a" });
  await store.writeEntry({ agent: "pi-agent", type: "research", summary: "Redis queue", content: "redis worker", project_id: "proj-b" });
  const result = await recall(store, { query: "redis", max_results: 1, agent: "other", project: "proj-a" });
  assert.equal(result.count, 1);
  assert.equal(result.results[0].agent, "other");
  assert.ok("score" in result.results[0]);
  assert.ok("id" in result.results[0]);
  assert.ok("file" in result.results[0]);
  assert.ok("path" in result.results[0]);
});

test("brief includes pending counts, recent activity, and suggested next action", async () => {
  const store = await makeStore("pi-agent");
  await store.writeEntry({ agent: "other", type: "task", summary: "Do pending thing", content: "please", status: "open", assigned_to: "pi-agent" });
  await store.writeEntry({ agent: "pi-agent", type: "note", summary: "Own recent note", content: "done" });
  await store.writeEntry({ agent: "other", type: "note", summary: "Other recent note", content: "context" });

  const pending = await store.pending();
  const recentOwn = await store.recentOwn(1);
  const brief = await store.brief();

  assert.equal(brief.fabric_dir, store.config.fabricDir);
  assert.equal(brief.agent, "pi-agent");
  assert.deepEqual(brief.pending, {
    open_tasks: 1,
    reviews_of_my_work: 0,
    open_tickets: 0,
    total: 1,
    first_items: [{ id: pending.open_tasks[0].frontmatter.id, summary: "Do pending thing", file: pending.open_tasks[0].file }],
  });
  assert.deepEqual(brief.recent_own, [{ id: recentOwn[0].frontmatter.id, type: "note", summary: "Own recent note", file: recentOwn[0].file }]);
  assert.ok(Array.isArray(brief.recent_others));
  assert.equal(brief.suggested_next_action, "Review pending Fabric work first.");
});

test("fabric_init_obsidian is idempotent", async () => {
  const store = await makeStore();
  assert.deepEqual(await store.initObsidian(), { ok: true, path: store.config.fabricDir });
  assert.deepEqual(await store.initObsidian(), { ok: true, path: store.config.fabricDir });
  assert.ok((await stat(join(store.config.fabricDir, ".obsidian"))).isDirectory());
  assert.ok((await stat(join(store.config.fabricDir, "daily"))).isDirectory());
  await readFile(join(store.config.fabricDir, ".obsidian", "app.json"), "utf8");
});
