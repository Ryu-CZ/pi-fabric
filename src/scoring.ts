import type { FabricEntry, FabricRecallParams, RecallResult } from "./types.js";
import { FabricStore } from "./fabric-store.js";

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function daysAgo(timestamp: string): number {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return 365;
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

export function scoreEntry(entry: FabricEntry, params: FabricRecallParams, currentAgent?: string): number {
  const q = params.query.trim().toLowerCase();
  const qTokens = tokens(q);
  if (!qTokens.length) return 0;

  const summary = String(entry.frontmatter.summary || "").toLowerCase();
  const body = entry.body.toLowerCase();
  const tagText = (entry.frontmatter.tags || []).join(" ").toLowerCase();
  let score = 0;

  if (summary.includes(q)) score += 8;
  if (body.includes(q)) score += 4;
  for (const t of qTokens) {
    if (summary.includes(t)) score += 3;
    if (body.includes(t)) score += 1;
    if (tagText.split(/\s+/).includes(t)) score += 4;
  }

  const age = daysAgo(entry.frontmatter.timestamp);
  score += Math.max(0, 3 * (1 - Math.min(age, 90) / 90));

  if (params.agent && entry.frontmatter.agent === params.agent) score += 5;
  else if (!params.agent && currentAgent && entry.frontmatter.agent === currentAgent) score += 1;
  if (params.project && entry.frontmatter.project_id === params.project) score += 5;
  if (entry.frontmatter.status === "open" && (!currentAgent || entry.frontmatter.assigned_to === currentAgent)) score += 1;
  if (entry.frontmatter.review_of || entry.frontmatter.revises) score += 0.5;

  return score;
}

export async function recall(store: FabricStore, params: FabricRecallParams): Promise<{ query: string; count: number; results: RecallResult[] }> {
  const max = Math.max(1, Math.min(params.max_results ?? 10, 100));
  const scored = (await store.listEntries({ includeCold: true }))
    .map((entry) => ({ entry, score: scoreEntry(entry, params, store.config.agent) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  const results = scored.map(({ entry, score }) => ({
    score: Number(score.toFixed(3)),
    id: entry.frontmatter.id,
    agent: entry.frontmatter.agent,
    type: entry.frontmatter.type,
    timestamp: entry.frontmatter.timestamp,
    summary: entry.frontmatter.summary,
    file: entry.file,
    path: entry.path,
  }));
  return { query: params.query, count: results.length, results };
}
