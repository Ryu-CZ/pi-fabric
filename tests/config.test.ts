import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "pi-fabric-config-"));
}

test("FABRIC_DIR overrides Pi settings fabric dir", async () => {
  const cwd = await tempDir();
  const agentDir = await tempDir();
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ fabricDir: "/from/settings" }));
  const oldFabric = process.env.FABRIC_DIR;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.FABRIC_DIR = "/from/env";
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    assert.equal(loadConfig(cwd).fabricDir, "/from/env");
  } finally {
    if (oldFabric === undefined) delete process.env.FABRIC_DIR; else process.env.FABRIC_DIR = oldFabric;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
});

test("loadConfig reads global ~/.pi/agent-style settings via PI_CODING_AGENT_DIR", async () => {
  const cwd = await tempDir();
  const agentDir = await tempDir();
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ "pi-fabric": { fabricDir: "shared-fabric" } }));
  const oldFabric = process.env.FABRIC_DIR;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  delete process.env.FABRIC_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    assert.equal(loadConfig(cwd).fabricDir, join(agentDir, "shared-fabric"));
  } finally {
    if (oldFabric === undefined) delete process.env.FABRIC_DIR; else process.env.FABRIC_DIR = oldFabric;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
});

test("project .pi/settings.json fabric dir overrides global Pi settings", async () => {
  const cwd = await tempDir();
  await mkdir(join(cwd, ".pi"));
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ fabric: { dir: "project-fabric" } }));
  const agentDir = await tempDir();
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ fabricDir: "/global/fabric" }));
  const oldFabric = process.env.FABRIC_DIR;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  delete process.env.FABRIC_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    assert.equal(loadConfig(cwd).fabricDir, join(cwd, ".pi", "project-fabric"));
  } finally {
    if (oldFabric === undefined) delete process.env.FABRIC_DIR; else process.env.FABRIC_DIR = oldFabric;
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
});
