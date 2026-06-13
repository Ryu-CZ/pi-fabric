import type { FabricFrontmatter } from "./types.js";

const ARRAY_FIELDS = new Set(["tags", "artifact_paths"]);
const OPTIONAL_EMPTY_OMIT = new Set([
  "session_id",
  "tags",
  "status",
  "outcome",
  "review_of",
  "revises",
  "customer_id",
  "assigned_to",
  "training_value",
  "verified",
  "evidence",
  "artifact_paths",
]);

export function normalizeList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = Array.isArray(value) ? value : value.split(",");
  const normalized = parts.map((p) => String(p).trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function shouldOmit(key: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (OPTIONAL_EMPTY_OMIT.has(key)) {
    if (Array.isArray(value) && value.length === 0) return true;
    if (String(value).trim() === "") return true;
  }
  return false;
}

export function stringifyFrontmatter(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (shouldOmit(key, value)) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value.map((v) => String(v)))}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : value;
    } catch {
      const inner = value.slice(1, -1).trim();
      return inner ? inner.split(",").map((v) => v.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean) : [];
    }
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseFrontmatter(text: string): { frontmatter: FabricFrontmatter; body: string } {
  if (!text.startsWith("---\n")) {
    throw new Error("missing YAML frontmatter");
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) throw new Error("unterminated YAML frontmatter");

  const rawYaml = text.slice(4, end);
  let bodyStart = end + "\n---".length;
  if (text.startsWith("\r\n", bodyStart)) bodyStart += 2;
  else if (text.startsWith("\n", bodyStart)) bodyStart += 1;
  const body = text.slice(bodyStart);

  const fm: Record<string, unknown> = {};
  for (const line of rawYaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = parseValue(line.slice(idx + 1));
    fm[key] = ARRAY_FIELDS.has(key) && !Array.isArray(value)
      ? normalizeList(String(value)) ?? []
      : value;
  }

  return { frontmatter: fm as FabricFrontmatter, body };
}

export function serializeEntry(frontmatter: FabricFrontmatter, body: string): string {
  return stringifyFrontmatter(frontmatter) + body;
}
