export const FABRIC_ENTRY_TYPES = [
  "task",
  "decision",
  "review",
  "resolution",
  "research",
  "code-session",
  "session",
  "note",
] as const;

export type FabricEntryType = (typeof FABRIC_ENTRY_TYPES)[number];
export type FabricStatus = "completed" | "open" | "blocked" | "superseded";
export type TrainingValue = "high" | "normal" | "low";
export type MaybeList = string | string[];

export interface FabricConfig {
  fabricDir: string;
  agent: string;
  projectId: string;
  compatMode: string;
  autoStore: boolean;
}

export interface FabricFrontmatter {
  id: string;
  agent: string;
  platform: string;
  timestamp: string;
  type: FabricEntryType;
  tier: string;
  summary: string;
  project_id: string;
  session_id?: string;
  tags?: string[];
  status?: FabricStatus;
  outcome?: string;
  review_of?: string;
  revises?: string;
  customer_id?: string;
  assigned_to?: string;
  training_value?: TrainingValue;
  verified?: string;
  evidence?: string;
  source_tool: string;
  artifact_paths?: string[];
  [key: string]: unknown;
}

export interface FabricEntry {
  frontmatter: FabricFrontmatter;
  body: string;
  file: string;
  path: string;
  cold: boolean;
}

export interface FabricWriteParams {
  type: FabricEntryType | string;
  summary: string;
  content: string;
  tags?: MaybeList;
  status?: FabricStatus;
  outcome?: string;
  review_of?: string;
  revises?: string;
  customer_id?: string;
  assigned_to?: string;
  training_value?: TrainingValue | string;
  verified?: string | boolean;
  evidence?: string;
  artifact_paths?: MaybeList;
  project_id?: string;
  session_id?: string;
  tier?: string;
  agent?: string;
}

export interface FabricRecallParams {
  query: string;
  max_results?: number;
  agent?: string;
  project?: string;
}

export interface RecallResult {
  score: number;
  id: string;
  agent: string;
  type: string;
  timestamp: string;
  summary: string;
  file: string;
  path: string;
}

export interface FabricSearchResult {
  query: string;
  count: number;
  results: Array<{ file: string; agent: string; summary: string; matches: string[] }>;
}

export interface PendingResult {
  open_tasks: FabricEntry[];
  reviews_of_my_work: FabricEntry[];
  open_tickets: FabricEntry[];
  total: number;
}
