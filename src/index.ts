import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.js";
import { FabricStore } from "./fabric-store.js";
import { registerHooks } from "./hooks.js";
import { recall } from "./scoring.js";
import type { FabricWriteParams, TrainingValue } from "./types.js";

export { loadConfig } from "./config.js";
export { FabricStore } from "./fabric-store.js";
export { recall, scoreEntry } from "./scoring.js";
export { FABRIC_ENTRY_TYPES } from "./types.js";
export type {
  FabricConfig,
  FabricEntry,
  FabricEntryType,
  FabricFrontmatter,
  FabricRecallParams,
  FabricSearchResult,
  FabricStatus,
  FabricWriteParams,
  MaybeList,
  PendingResult,
  RecallResult,
  TrainingValue,
} from "./types.js";

const TextOrArray = Type.Union([Type.String(), Type.Array(Type.String())]);
const EntryType = Type.Union([Type.Literal("task"), Type.Literal("decision"), Type.Literal("review"), Type.Literal("resolution"), Type.Literal("research"), Type.Literal("code-session"), Type.Literal("session"), Type.Literal("note")]);
const Training = Type.Union([Type.Literal("high"), Type.Literal("normal"), Type.Literal("low")]);

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value };
}

export default function (pi: ExtensionAPI): void {
  const store = new FabricStore(loadConfig());

  pi.registerTool({
    name: "fabric_write",
    label: "Fabric Write",
    description: "Write an Icarus-compatible Fabric markdown entry.",
    promptSnippet: "Use fabric_write to persist important tasks, decisions, reviews, research, and notes to the shared Fabric corpus.",
    parameters: Type.Object({
      type: EntryType,
      summary: Type.String(),
      content: Type.String(),
      tags: Type.Optional(TextOrArray),
      status: Type.Optional(Type.Union([Type.Literal("completed"), Type.Literal("open"), Type.Literal("blocked"), Type.Literal("superseded")])),
      outcome: Type.Optional(Type.String()),
      review_of: Type.Optional(Type.String()),
      revises: Type.Optional(Type.String()),
      customer_id: Type.Optional(Type.String()),
      assigned_to: Type.Optional(Type.String()),
      training_value: Type.Optional(Training),
      verified: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
      evidence: Type.Optional(Type.String()),
      artifact_paths: Type.Optional(TextOrArray),
      project_id: Type.Optional(Type.String()),
      session_id: Type.Optional(Type.String()),
      tier: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const entry = await store.writeEntry(params as FabricWriteParams);
      return jsonResult({ status: "written", id: entry.frontmatter.id, file: entry.file, path: entry.path, frontmatter: entry.frontmatter });
    },
  });

  pi.registerTool({
    name: "fabric_recall",
    label: "Fabric Recall",
    description: "Recall ranked Fabric entries using phase-1 filesystem scoring.",
    promptSnippet: "Use fabric_recall to retrieve relevant memories from the shared Fabric corpus by query.",
    parameters: Type.Object({
      query: Type.String(),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      agent: Type.Optional(Type.String()),
      project: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) { return jsonResult(await recall(store, params)); },
  });

  pi.registerTool({
    name: "fabric_search",
    label: "Fabric Search",
    description: "Case-insensitive grep over hot and cold Fabric markdown entries.",
    promptSnippet: "Use fabric_search for literal case-insensitive search across hot and cold Fabric markdown entries.",
    parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    async execute(_toolCallId, params) { return jsonResult(await store.search(params.query, params.limit)); },
  });

  pi.registerTool({
    name: "fabric_pending",
    label: "Fabric Pending",
    description: "List open Fabric work assigned to this agent and reviews of this agent's work.",
    promptSnippet: "Use fabric_pending to inspect open work assigned to this agent and reviews of this agent's work.",
    parameters: Type.Object({ customer_id: Type.Optional(Type.String()) }),
    async execute(_toolCallId, params) { return jsonResult(await store.pending(params)); },
  });

  pi.registerTool({
    name: "fabric_curate",
    label: "Fabric Curate",
    description: "Update training_value by Fabric frontmatter id.",
    promptSnippet: "Use fabric_curate to update an entry training_value by frontmatter id.",
    parameters: Type.Object({ entry_id: Type.String(), training_value: Training }),
    async execute(_toolCallId, params) { return jsonResult(await store.curate(params.entry_id, params.training_value as TrainingValue)); },
  });

  pi.registerTool({
    name: "fabric_brief",
    label: "Fabric Brief",
    description: "Return a concise operational Fabric brief.",
    promptSnippet: "Use fabric_brief to get pending counts, recent activity, and suggested next action from Fabric.",
    parameters: Type.Object({}),
    async execute() { return jsonResult(await store.brief()); },
  });

  pi.registerTool({
    name: "fabric_init_obsidian",
    label: "Fabric Init Obsidian",
    description: "Idempotently initialize Fabric directories and minimal Obsidian config.",
    promptSnippet: "Use fabric_init_obsidian to create Fabric, cold, daily, and minimal Obsidian directories idempotently.",
    parameters: Type.Object({}),
    async execute() { return jsonResult(await store.initObsidian()); },
  });

  registerHooks(pi, store);
}
