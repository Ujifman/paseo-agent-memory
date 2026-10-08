import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { MCP_SERVER_SOURCE } from "./mcp-source";

export const GLOBAL_SCOPE = "_global";
const INDEX_FILE = "MEMORY.md";

export interface MemoryProject {
  /** Stable identity: Paseo's project key, so worktrees and clones share one memory. */
  key: string;
  displayName: string;
  rootPath: string;
}

export function memoryRoot(): string {
  const override = process.env.PASEO_AGENT_MEMORY_DIR;
  if (override) {
    return path.resolve(override);
  }
  return path.join(process.env.PASEO_HOME ?? path.join(homedir(), ".paseo"), "memory");
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

export function projectDirName(project: MemoryProject): string {
  const label = project.displayName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${label || "project"}-${shortHash(project.key)}`;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

/** Creates the project's memory directory and records which project owns it. */
export async function ensureProjectDir(project: MemoryProject): Promise<string> {
  const name = projectDirName(project);
  const dir = path.join(memoryRoot(), name);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(memoryRoot(), GLOBAL_SCOPE), { recursive: true });
  await writeAtomic(path.join(dir, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
  return name;
}

/** Index entries (`- name (type) — description`) of one scope, without the heading. */
export async function readIndex(scopeDirName: string): Promise<string> {
  try {
    const raw = await readFile(path.join(memoryRoot(), scopeDirName, INDEX_FILE), "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.replace(/^- \[([^\]]+)\]\([^)]*\)/, "- $1"))
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Writes the embedded MCP server next to the memory and returns its path.
 * The file name carries a content hash: agent configurations are persisted
 * with this path, so an updated plugin must not rewrite a script that
 * already-created agents still launch.
 */
export async function ensureMcpScript(): Promise<string> {
  const dir = path.join(memoryRoot(), ".runtime");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `memory-mcp-${shortHash(MCP_SERVER_SOURCE)}.mjs`);
  await writeAtomic(file, MCP_SERVER_SOURCE);
  return file;
}
