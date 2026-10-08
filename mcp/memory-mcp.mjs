// Stdio MCP server that gives Paseo agents a persistent, per-project memory.
// Zero dependencies: it is embedded into the plugin (see scripts/embed-mcp.mjs)
// and launched with the daemon's own Node runtime.
//
// Environment:
//   PASEO_MEMORY_ROOT          directory holding one subdirectory per scope
//   PASEO_MEMORY_PROJECT       subdirectory name of the current project
//   PASEO_MEMORY_PROJECT_NAME  display name of the current project

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.env.PASEO_MEMORY_ROOT;
const PROJECT = process.env.PASEO_MEMORY_PROJECT;
const PROJECT_NAME = process.env.PASEO_MEMORY_PROJECT_NAME || PROJECT;
const GLOBAL = "_global";

const TYPES = ["feedback", "project", "reference", "user"];
const MAX_CONTENT = 8000;
const FULL_RECALL_BUDGET = 20000;
const INDEX_FILE = "MEMORY.md";

const SCOPE_TITLES = {
  project: "Project memory: " + PROJECT_NAME,
  global: "Global memory (applies to every project)",
};

function scopeDir(scope) {
  return path.join(ROOT, scope === "global" ? GLOBAL : PROJECT);
}

function toSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function oneLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMemory(raw, fallbackName) {
  const memory = { name: fallbackName, description: "", type: "project", updated: "", body: raw };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return memory;
  }
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field && field[1] in memory && field[1] !== "body") {
      memory[field[1]] = field[2].trim();
    }
  }
  memory.name = fallbackName;
  memory.body = match[2].trim();
  return memory;
}

function serializeMemory(memory) {
  return [
    "---",
    "name: " + memory.name,
    "description: " + memory.description,
    "type: " + memory.type,
    "updated: " + memory.updated,
    "---",
    "",
    memory.body.trim(),
    "",
  ].join("\n");
}

function listMemories(scope) {
  const dir = scopeDir(scope);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((file) => file.endsWith(".md") && file !== INDEX_FILE)
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      return { scope, ...parseMemory(raw, file.slice(0, -3)) };
    });
}

function writeAtomic(file, content) {
  const temp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, file);
}

// MEMORY.md is always derived from the memory files, so it cannot drift.
function rebuildIndex(scope) {
  const lines = ["# " + SCOPE_TITLES[scope], ""];
  for (const memory of listMemories(scope)) {
    lines.push(
      "- [" + memory.name + "](" + memory.name + ".md) (" + memory.type + ") — " + memory.description,
    );
  }
  writeAtomic(path.join(scopeDir(scope), INDEX_FILE), lines.join("\n") + "\n");
}

function indexLine(memory) {
  return "- " + memory.name + " (" + memory.type + ") — " + memory.description;
}

function fullEntry(memory) {
  return (
    "### " +
    memory.name +
    " (" +
    memory.type +
    (memory.updated ? ", updated " + memory.updated : "") +
    ")\n" +
    memory.description +
    "\n\n" +
    memory.body
  );
}

function renderScope(scope, memories, full) {
  const header = "## " + SCOPE_TITLES[scope];
  if (memories.length === 0) {
    return header + "\n(empty)";
  }
  const entries = memories.map(full ? fullEntry : indexLine);
  return header + "\n" + entries.join(full ? "\n\n" : "\n");
}

function recall({ query }) {
  const all = { global: listMemories("global"), project: listMemories("project") };
  const terms = oneLine(query).toLowerCase().split(" ").filter(Boolean);

  if (terms.length === 0) {
    const size = [...all.global, ...all.project].reduce((sum, m) => sum + m.body.length, 0);
    const full = size <= FULL_RECALL_BUDGET;
    const text = [renderScope("global", all.global, full), renderScope("project", all.project, full)];
    if (!full) {
      text.push("Memory is large, so only the index is shown. Use memory_read or memory_recall with a query for the full text.");
    }
    return text.join("\n\n");
  }

  const scored = [...all.project, ...all.global]
    .map((memory) => {
      const haystack = (memory.name + " " + memory.description + " " + memory.body).toLowerCase();
      const score = terms.reduce((sum, term) => sum + haystack.split(term).length - 1, 0);
      return { memory, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (scored.length === 0) {
    return "No memories match: " + terms.join(" ");
  }
  return scored.map(({ memory }) => "[" + memory.scope + "] " + fullEntry(memory).slice(4)).join("\n\n");
}

function read({ name, scope }) {
  const slug = toSlug(name);
  const scopes = scope ? [scope] : ["project", "global"];
  for (const candidate of scopes) {
    const memory = listMemories(candidate).find((entry) => entry.name === slug);
    if (memory) {
      return "[" + candidate + "] " + fullEntry(memory).slice(4);
    }
  }
  throw new Error("No memory named '" + slug + "'. Call memory_recall to see what exists.");
}

function save({ scope = "project", type, name, description, content }) {
  if (scope !== "project" && scope !== "global") {
    throw new Error("scope must be 'project' or 'global'.");
  }
  if (!TYPES.includes(type)) {
    throw new Error("type must be one of: " + TYPES.join(", ") + ".");
  }
  const slug = toSlug(name);
  if (!slug) {
    throw new Error("name must be a short kebab-case slug in latin letters, e.g. 'tests-use-real-db'.");
  }
  const summary = oneLine(description);
  const body = String(content || "").trim();
  if (!summary || !body) {
    throw new Error("description and content are required.");
  }
  if (body.length > MAX_CONTENT) {
    throw new Error("content is " + body.length + " characters; keep one memory under " + MAX_CONTENT + " and split unrelated facts.");
  }

  const dir = scopeDir(scope);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug + ".md");
  const existed = fs.existsSync(file);
  writeAtomic(
    file,
    serializeMemory({
      name: slug,
      description: summary,
      type,
      updated: new Date().toISOString().slice(0, 10),
      body,
    }),
  );
  rebuildIndex(scope);
  return (existed ? "Updated" : "Saved") + " " + scope + " memory '" + slug + "'.";
}

function forget({ name, scope = "project" }) {
  const slug = toSlug(name);
  const file = path.join(scopeDir(scope), slug + ".md");
  if (!fs.existsSync(file)) {
    throw new Error("No " + scope + " memory named '" + slug + "'.");
  }
  fs.rmSync(file);
  rebuildIndex(scope);
  return "Deleted " + scope + " memory '" + slug + "'.";
}

const SCOPE_SCHEMA = {
  type: "string",
  enum: ["project", "global"],
  description:
    "'project' (default) is visible only to agents working on " +
    PROJECT_NAME +
    ". 'global' is visible in every project: use it only for the user's personal, project-independent preferences.",
};

const TOOLS = [
  {
    name: "memory_recall",
    description:
      "Load the persistent memory shared by all agents working on project '" +
      PROJECT_NAME +
      "': the user's past corrections and preferences plus accumulated project knowledge. Call it without arguments at the start of every task, before planning or writing code. Pass a query to search when memory is large.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional keywords to search for." },
      },
    },
    run: recall,
  },
  {
    name: "memory_read",
    description: "Read one memory in full by its name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, scope: SCOPE_SCHEMA },
      required: ["name"],
    },
    run: read,
  },
  {
    name: "memory_save",
    description:
      "Create or overwrite one memory so future agents on this project behave better. Save when the user corrects you, states a preference, or confirms a non-obvious approach (type 'feedback'); when you learn a durable project fact that is not obvious from the repository, such as architecture decisions, conventions, commands, pitfalls, or domain rules (type 'project'); or a pointer to an external resource (type 'reference'). Reuse the existing name to update a memory instead of creating a near-duplicate. One fact per memory.",
    inputSchema: {
      type: "object",
      properties: {
        scope: SCOPE_SCHEMA,
        type: {
          type: "string",
          enum: TYPES,
          description: "feedback: how the user wants agents to work. project: knowledge about the project. reference: external links, dashboards, tickets. user: who the user is.",
        },
        name: { type: "string", description: "Short kebab-case slug in latin letters, e.g. 'tests-use-real-db'." },
        description: { type: "string", description: "One line used to decide relevance when recalling." },
        content: {
          type: "string",
          description: "The fact or rule in markdown. For feedback and project memories add 'Why:' and 'How to apply:' lines.",
        },
      },
      required: ["type", "name", "description", "content"],
    },
    run: save,
  },
  {
    name: "memory_delete",
    description: "Delete a memory that turned out to be wrong or outdated.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, scope: SCOPE_SCHEMA },
      required: ["name"],
    },
    run: forget,
  },
];

const INSTRUCTIONS =
  "Persistent memory shared by all Paseo agents working on project '" +
  PROJECT_NAME +
  "'. Call memory_recall at the start of every task. Call memory_save whenever the user corrects you or you learn a durable, non-obvious project fact.";

function handle(message) {
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: (message.params && message.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "paseo-agent-memory", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      };
    case "tools/call": {
      const tool = TOOLS.find((entry) => entry.name === message.params.name);
      if (!tool) {
        throw Object.assign(new Error("Unknown tool: " + message.params.name), { code: -32602 });
      }
      try {
        const text = tool.run(message.params.arguments || {});
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: String(error.message || error) }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error("Method not found: " + message.method), { code: -32601 });
  }
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

if (!ROOT || !PROJECT) {
  process.stderr.write("PASEO_MEMORY_ROOT and PASEO_MEMORY_PROJECT are required.\n");
  process.exit(1);
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  // Notifications carry no id and get no response.
  if (message.id === undefined || message.id === null) {
    return;
  }
  try {
    send({ jsonrpc: "2.0", id: message.id, result: handle(message) });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: error.code || -32603, message: String(error.message || error) },
    });
  }
});
