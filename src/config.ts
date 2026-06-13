import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { FabricConfig } from "./types.js";

function isFalseLike(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["0", "false", "no", "off", "disabled"].includes(value.trim().toLowerCase());
}

function resolveConfiguredPath(value: string, baseDir: string): string {
  const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
}

function readFabricDirSetting(settingsPath: string): string | undefined {
  if (!existsSync(settingsPath)) return undefined;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const candidates = [
      settings.fabricDir,
      settings.fabric_dir,
      typeof settings.fabric === "object" && settings.fabric ? (settings.fabric as Record<string, unknown>).dir : undefined,
      typeof settings.fabric === "object" && settings.fabric ? (settings.fabric as Record<string, unknown>).fabricDir : undefined,
      typeof settings.piFabric === "object" && settings.piFabric ? (settings.piFabric as Record<string, unknown>).dir : undefined,
      typeof settings.piFabric === "object" && settings.piFabric ? (settings.piFabric as Record<string, unknown>).fabricDir : undefined,
      typeof settings["pi-fabric"] === "object" && settings["pi-fabric"] ? (settings["pi-fabric"] as Record<string, unknown>).dir : undefined,
      typeof settings["pi-fabric"] === "object" && settings["pi-fabric"] ? (settings["pi-fabric"] as Record<string, unknown>).fabricDir : undefined,
    ];
    const found = candidates.find((v): v is string => typeof v === "string" && v.trim().length > 0);
    return found ? resolveConfiguredPath(found, dirname(settingsPath)) : undefined;
  } catch {
    return undefined;
  }
}

function loadFabricDir(cwd: string): string {
  const home = homedir();
  if (process.env.FABRIC_DIR) return resolve(process.env.FABRIC_DIR);

  const projectSetting = readFabricDirSetting(join(resolve(cwd), ".pi", "settings.json"));
  if (projectSetting) return projectSetting;

  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? resolve(process.env.PI_CODING_AGENT_DIR)
    : join(home, ".pi", "agent");
  const globalSetting = readFabricDirSetting(join(agentDir, "settings.json"));
  if (globalSetting) return globalSetting;

  return existsSync(join(home, "fabric")) ? join(home, "fabric") : join(home, ".pi", "fabric");
}

export function loadConfig(cwd = process.cwd()): FabricConfig {
  return {
    fabricDir: loadFabricDir(cwd),
    agent: process.env.FABRIC_AGENT || process.env.HERMES_AGENT_NAME || "pi-agent",
    projectId: process.env.FABRIC_PROJECT_ID || basename(resolve(cwd)) || "unknown",
    compatMode: process.env.FABRIC_COMPAT_MODE || "icarus",
    autoStore: !isFalseLike(process.env.FABRIC_AUTO_STORE),
  };
}
