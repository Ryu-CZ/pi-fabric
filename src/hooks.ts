import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FabricStore } from "./fabric-store.js";
import { recall } from "./scoring.js";

function socialOrUnsafe(text: string): boolean {
  const t = text.trim().toLowerCase();
  return !t || t.length < 12 || /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)[!.\s]*$/.test(t) || t.includes("ignore previous instructions");
}

function sanitize(text: string): string {
  return text
    .replace(/```/g, "`")
    .replace(/ignore (all )?(previous|prior) instructions/gi, "[redacted]")
    .slice(0, 1000);
}

export function registerHooks(pi: ExtensionAPI, store: FabricStore): void {
  let injectedBrief = false;

  pi.on("session_start", async (_event, ctx) => {
    try {
      await store.ensureDirs();
      const pending = await store.pending();
      ctx.ui.setStatus("fabric", `Fabric: linked (${pending.total} pending)`);
    } catch {
      try { ctx.ui.setStatus("fabric", "Fabric: not initialized"); } catch { /* fail open */ }
    }
  });

  pi.on("before_agent_start", async (event) => {
    try {
      const prompt = String((event as { prompt?: unknown }).prompt ?? "").trim();
      if (socialOrUnsafe(prompt)) return;
      const result = await recall(store, { query: prompt, max_results: 3 });
      if (!result.results.length) return;
      const lines = result.results.map((r) => `[${r.score}] ${r.agent}:${r.id} ${r.type} ${r.summary} (${r.file})`);
      let content = `Relevant Fabric context:\n\n${sanitize(lines.join("\n"))}`;
      if (!injectedBrief) {
        injectedBrief = true;
        content += `\n\nFabric brief:\n${sanitize(JSON.stringify(await store.brief()))}`;
      }
      return { message: { customType: "fabric-context", content, display: true } };
    } catch {
      return;
    }
  });

  pi.on("agent_end", async (event) => {
    try {
      if (!store.config.autoStore) return;
      const messages = ((event as { messages?: Array<{ role: string; content?: unknown }> }).messages ?? []);
      const assistant = messages.filter((m) => m.role === "assistant").at(-1);
      const text = typeof assistant?.content === "string" ? assistant.content : JSON.stringify(assistant?.content ?? "");
      const trimmed = text.trim();
      if (socialOrUnsafe(trimmed) || trimmed.length < 80) return;
      if (!/(decided|decision|implemented|completed|fixed|resolved|outcome|tests? pass)/i.test(trimmed)) return;
      await store.writeEntry({
        type: "decision",
        summary: trimmed.split(/\r?\n/)[0].replace(/^#+\s*/, "").slice(0, 120) || "Pi session decision",
        content: trimmed,
        status: "completed",
        training_value: "high",
      });
    } catch {
      // Fabric must never break Pi sessions.
    }
  });
}
