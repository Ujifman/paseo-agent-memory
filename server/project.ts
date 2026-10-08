import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { PluginHookContext } from "@getpaseo/plugin/server";
import type { MemoryProject } from "./store";

const run = promisify(execFile);

function normalize(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function contains(root: string, target: string): boolean {
  const relative = path.relative(normalize(root), normalize(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { windowsHide: true, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Root of the main checkout; for a worktree this is the repository it was branched from. */
async function mainCheckoutRoot(cwd: string): Promise<string | null> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return commonDir ? path.dirname(commonDir) : null;
}

/**
 * Maps an agent's working directory to the Paseo project that owns it. The
 * most specific registered project wins, so a project nested inside another
 * project's folder keeps its own memory.
 */
export async function resolveProject(
  paseo: PluginHookContext["paseo"],
  cwd: string,
): Promise<MemoryProject> {
  const { projects } = await paseo.projects.list();
  const mainRoot = await mainCheckoutRoot(cwd);

  for (const location of [cwd, mainRoot]) {
    if (!location) {
      continue;
    }
    const owner = projects
      .filter((project) => contains(project.projectRootPath, location))
      .sort((a, b) => b.projectRootPath.length - a.projectRootPath.length)[0];
    if (owner) {
      return {
        key: owner.projectKey ?? `path:${normalize(owner.projectRootPath)}`,
        displayName: owner.projectCustomName ?? owner.projectDisplayName,
        rootPath: owner.projectRootPath,
      };
    }
  }

  const rootPath = mainRoot ?? cwd;
  return {
    key: `path:${normalize(rootPath)}`,
    displayName: path.basename(rootPath),
    rootPath,
  };
}
