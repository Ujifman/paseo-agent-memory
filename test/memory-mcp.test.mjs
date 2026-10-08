import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp", "memory-mcp.mjs");
let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-memory-"));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function connect(project) {
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PASEO_MEMORY_ROOT: root,
      PASEO_MEMORY_PROJECT: project,
      PASEO_MEMORY_PROJECT_NAME: project,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    pending.get(message.id)(message);
    pending.delete(message.id);
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  return {
    request,
    async call(name, args = {}) {
      const { result } = await request("tools/call", { name, arguments: args });
      return { text: result.content[0].text, isError: result.isError === true };
    },
    close: () => child.kill(),
  };
}

test("handshake lists the memory tools", async () => {
  const client = connect("alpha");
  const init = await client.request("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const { result } = await client.request("tools/list");
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ["memory_recall", "memory_read", "memory_save", "memory_delete"],
  );
  client.close();
});

test("project memory is shared within a project and hidden from others", async () => {
  const alpha = connect("alpha");
  const beta = connect("beta");

  const saved = await alpha.call("memory_save", {
    type: "feedback",
    name: "Tests use real DB",
    description: "Integration tests must hit a real database",
    content: "Не мокать базу в интеграционных тестах.\n\nWhy: моки скрыли сломанную миграцию.",
  });
  assert.equal(saved.text, "Saved project memory 'tests-use-real-db'.");

  const sameProject = connect("alpha");
  assert.match((await sameProject.call("memory_recall")).text, /Не мокать базу/);
  assert.doesNotMatch((await beta.call("memory_recall")).text, /tests-use-real-db/);

  const index = fs.readFileSync(path.join(root, "alpha", "MEMORY.md"), "utf8");
  assert.match(index, /\[tests-use-real-db\]\(tests-use-real-db\.md\) \(feedback\)/);

  alpha.close();
  beta.close();
  sameProject.close();
});

test("global memory is visible in every project", async () => {
  const alpha = connect("alpha");
  const beta = connect("beta");
  await alpha.call("memory_save", {
    scope: "global",
    type: "user",
    name: "reply-in-russian",
    description: "User wants replies in Russian",
    content: "Отвечать по-русски.",
  });
  assert.match((await beta.call("memory_recall")).text, /Отвечать по-русски/);
  alpha.close();
  beta.close();
});

test("saving under an existing name updates it; search, read and delete work", async () => {
  const client = connect("alpha");
  const updated = await client.call("memory_save", {
    type: "feedback",
    name: "tests-use-real-db",
    description: "Integration tests must hit a real database",
    content: "Использовать testcontainers, не моки.",
  });
  assert.equal(updated.text, "Updated project memory 'tests-use-real-db'.");

  assert.match((await client.call("memory_recall", { query: "testcontainers" })).text, /testcontainers/);
  assert.match((await client.call("memory_recall", { query: "nonexistentword" })).text, /No memories match/);
  assert.match((await client.call("memory_read", { name: "tests-use-real-db" })).text, /^\[project\] tests-use-real-db/);

  assert.equal((await client.call("memory_delete", { name: "tests-use-real-db" })).isError, false);
  assert.equal((await client.call("memory_read", { name: "tests-use-real-db" })).isError, true);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "alpha", "MEMORY.md"), "utf8"), /tests-use-real-db/);
  client.close();
});

test("invalid input is reported as a tool error", async () => {
  const client = connect("alpha");
  const noSlug = await client.call("memory_save", {
    type: "project",
    name: "заметка",
    description: "x",
    content: "y",
  });
  assert.equal(noSlug.isError, true);
  const badType = await client.call("memory_save", { type: "note", name: "a", description: "x", content: "y" });
  assert.equal(badType.isError, true);
  client.close();
});
