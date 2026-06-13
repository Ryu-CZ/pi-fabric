import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FabricConfig } from "./types.js";
import { FABRIC_ENTRY_TYPES, type FabricEntry, type FabricFrontmatter, type FabricSearchResult, type FabricWriteParams, type PendingResult, type TrainingValue } from "./types.js";
import { normalizeList, parseFrontmatter, serializeEntry } from "./yaml.js";

const TRAINING_VALUES = new Set(["high", "normal", "low"]);

function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return slug || "entry";
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRef(ref: string, field: string): void {
  if (!/^[^:\s]+:[0-9a-fA-F]{4,}$/.test(ref)) {
    throw new Error(`${field} must be a non-empty agent:id reference with id length at least 4`);
  }
}

export class FabricStore {
  constructor(public readonly config: FabricConfig) {}

  async ensureDirs(): Promise<void> {
    await mkdir(this.config.fabricDir, { recursive: true });
    await mkdir(join(this.config.fabricDir, "cold"), { recursive: true });
  }

  async initObsidian(): Promise<{ ok: true; path: string }> {
    await this.ensureDirs();
    await mkdir(join(this.config.fabricDir, "daily"), { recursive: true });
    await mkdir(join(this.config.fabricDir, ".obsidian"), { recursive: true });
    await writeFile(join(this.config.fabricDir, ".obsidian", "app.json"), JSON.stringify({}, null, 2) + "\n", { flag: "w" });
    return { ok: true, path: this.config.fabricDir };
  }

  async writeEntry(params: FabricWriteParams): Promise<FabricEntry> {
    await this.ensureDirs();
    if (!hasText(params.type)) throw new Error("type is required");
    if (!hasText(params.summary)) throw new Error("summary is required");
    if (!hasText(params.content)) throw new Error("content is required");
    if (!FABRIC_ENTRY_TYPES.includes(params.type as never)) throw new Error(`unsupported entry type: ${params.type}`);
    if (params.status === "open" && !hasText(params.assigned_to)) throw new Error('status "open" requires assigned_to');
    if (params.type === "review" && !hasText(params.review_of)) throw new Error('type "review" requires review_of');
    if (params.review_of) {
      validateRef(params.review_of, "review_of");
      if (!(await this.hasEntryRef(params.review_of))) throw new Error(`review_of reference not found: ${params.review_of}`);
    }
    if (params.revises) {
      validateRef(params.revises, "revises");
      if (!(await this.hasEntryRef(params.revises))) throw new Error(`revises reference not found: ${params.revises}`);
    }
    if (params.training_value && !TRAINING_VALUES.has(params.training_value)) {
      throw new Error("training_value must be high, normal, or low");
    }

    const agent = params.agent || this.config.agent;
    const fm: FabricFrontmatter = {
      id: randomBytes(4).toString("hex"),
      agent,
      platform: "pi",
      timestamp: new Date().toISOString(),
      type: params.type as FabricFrontmatter["type"],
      tier: params.tier || "hot",
      summary: params.summary,
      project_id: params.project_id || this.config.projectId,
      session_id: params.session_id,
      tags: normalizeList(params.tags),
      status: params.status,
      outcome: params.outcome,
      review_of: params.review_of,
      revises: params.revises,
      customer_id: params.customer_id,
      assigned_to: params.assigned_to,
      training_value: params.training_value as TrainingValue | undefined,
      verified: params.verified === undefined ? undefined : String(params.verified),
      evidence: params.evidence,
      source_tool: "pi-fabric",
      artifact_paths: normalizeList(params.artifact_paths),
    };

    const suffix = randomBytes(2).toString("hex");
    const file = `${agent}-${fm.type}-${slugify(fm.summary)}-${suffix}.md`;
    const path = join(this.config.fabricDir, file);
    await writeFile(`${path}.tmp`, serializeEntry(fm, params.content.endsWith("\n") ? params.content : `${params.content}\n`), "utf8");
    await rename(`${path}.tmp`, path);
    return { frontmatter: fm, body: params.content.endsWith("\n") ? params.content : `${params.content}\n`, file, path, cold: false };
  }

  async listEntries(options: { includeCold?: boolean } = {}): Promise<FabricEntry[]> {
    const includeCold = options.includeCold ?? true;
    const entries: FabricEntry[] = [];
    for (const [dir, cold] of [[this.config.fabricDir, false], ...(includeCold ? [[join(this.config.fabricDir, "cold"), true] as const] : [])] as const) {
      let names: string[] = [];
      try { names = await readdir(dir); } catch { continue; }
      for (const name of names.filter((n) => n.endsWith(".md"))) {
        const path = join(dir, name);
        try {
          const text = await readFile(path, "utf8");
          const parsed = parseFrontmatter(text);
          entries.push({ frontmatter: parsed.frontmatter, body: parsed.body, file: name, path, cold });
        } catch { /* skip unreadable/non-fabric markdown */ }
      }
    }
    return entries.sort((a, b) => String(b.frontmatter.timestamp || "").localeCompare(String(a.frontmatter.timestamp || "")));
  }

  async hasEntryRef(ref: string): Promise<boolean> {
    validateRef(ref, "ref");
    const [agent, id] = ref.split(":", 2);
    return (await this.listEntries({ includeCold: true })).some((e) => e.frontmatter.agent === agent && String(e.frontmatter.id).startsWith(id));
  }

  async search(query: string, limit = 10): Promise<FabricSearchResult> {
    const q = query.toLowerCase();
    const results: FabricSearchResult["results"] = [];
    for (const e of await this.listEntries({ includeCold: true })) {
      const text = `${e.frontmatter.summary}\n${e.body}\n${(e.frontmatter.tags || []).join(" ")}`;
      const matches = text.split(/\r?\n/).filter((line) => line.toLowerCase().includes(q)).slice(0, 5);
      if (matches.length) results.push({ file: e.file, agent: e.frontmatter.agent, summary: e.frontmatter.summary, matches });
      if (results.length >= limit) break;
    }
    return { query, count: results.length, results };
  }

  async pending(opts: { customer_id?: string } = {}): Promise<PendingResult> {
    const entries = await this.listEntries({ includeCold: true });
    const agent = this.config.agent;
    const customerMatches = (e: FabricEntry) => !opts.customer_id || e.frontmatter.customer_id === opts.customer_id;
    const open_tasks = entries
      .filter((e) => e.frontmatter.type === "task" && e.frontmatter.status === "open" && e.frontmatter.assigned_to === agent && e.frontmatter.agent !== agent && customerMatches(e))
      .slice(0, 30);
    const reviews_of_my_work = entries
      .filter((e) => e.frontmatter.type === "review" && e.frontmatter.agent !== agent && String(e.frontmatter.review_of || "").startsWith(`${agent}:`))
      .slice(0, Math.max(0, 30 - open_tasks.length));
    const taskPaths = new Set(open_tasks.map((e) => e.path));
    const open_tickets = entries
      .filter((e) => e.frontmatter.status === "open" && e.frontmatter.assigned_to === agent && !!e.frontmatter.customer_id && customerMatches(e) && !taskPaths.has(e.path))
      .slice(0, Math.max(0, 30 - open_tasks.length - reviews_of_my_work.length));
    return { open_tasks, reviews_of_my_work, open_tickets, total: open_tasks.length + reviews_of_my_work.length + open_tickets.length };
  }

  async curate(entry_id: string, training_value: TrainingValue): Promise<{ ok: true; id: string; file: string; training_value: TrainingValue }> {
    if (!TRAINING_VALUES.has(training_value)) throw new Error("training_value must be high, normal, or low");
    for (const e of await this.listEntries({ includeCold: true })) {
      if (e.frontmatter.id === entry_id) {
        e.frontmatter.training_value = training_value;
        await writeFile(`${e.path}.tmp`, serializeEntry(e.frontmatter, e.body), "utf8");
        await rename(`${e.path}.tmp`, e.path);
        return { ok: true, id: entry_id, file: basename(e.path), training_value };
      }
    }
    throw new Error(`entry not found: ${entry_id}`);
  }

  async recentOwn(limit = 5): Promise<FabricEntry[]> {
    return (await this.listEntries({ includeCold: true })).filter((e) => e.frontmatter.agent === this.config.agent).slice(0, limit);
  }

  async recentOthers(limit = 5): Promise<FabricEntry[]> {
    return (await this.listEntries({ includeCold: true })).filter((e) => e.frontmatter.agent !== this.config.agent).slice(0, limit);
  }

  async brief(): Promise<Record<string, unknown>> {
    const pending = await this.pending();
    const recent_own = await this.recentOwn(5);
    const recent_others = await this.recentOthers(5);
    return {
      fabric_dir: this.config.fabricDir,
      agent: this.config.agent,
      pending: {
        open_tasks: pending.open_tasks.length,
        reviews_of_my_work: pending.reviews_of_my_work.length,
        open_tickets: pending.open_tickets.length,
        total: pending.total,
        first_items: [...pending.open_tasks, ...pending.reviews_of_my_work, ...pending.open_tickets].slice(0, 5).map((e) => ({ id: e.frontmatter.id, summary: e.frontmatter.summary, file: e.file })),
      },
      recent_own: recent_own.map((e) => ({ id: e.frontmatter.id, type: e.frontmatter.type, summary: e.frontmatter.summary, file: e.file })),
      recent_others: recent_others.map((e) => ({ id: e.frontmatter.id, agent: e.frontmatter.agent, type: e.frontmatter.type, summary: e.frontmatter.summary, file: e.file })),
      suggested_next_action: pending.total ? "Review pending Fabric work first." : "No pending Fabric work; continue current task.",
    };
  }
}
