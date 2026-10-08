# paseo-agent-memory

A [Paseo](https://paseo.sh) plugin that gives every agent a persistent memory which is
**shared across providers** and **isolated per project**.

Agents remember the corrections you give them and the knowledge they gather about a
project. A Claude agent that was told "never mock the database in integration tests" on
Monday passes that on to the Cursor agent you start on Tuesday, in the same project and
nowhere else.

## Contents

- [Why](#why)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Using it](#using-it)
- [Where memory is stored](#where-memory-is-stored)
- [How a project is identified](#how-a-project-is-identified)
- [Memory tools](#memory-tools)
- [Provider support](#provider-support)
- [Turn off the agents' built-in memory](#turn-off-the-agents-built-in-memory)
- [Configuration](#configuration)
- [Security and privacy](#security-and-privacy)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)
- [Development](#development)
- [License](#license)

## Why

Coding agents start every session from zero. Some providers ship their own memory, but
each one is private to that provider and keyed by its own idea of a project, so feedback
given to one agent never reaches another.

This plugin moves memory to the layer that already knows about all your agents and
projects: the Paseo daemon.

- **One memory for all agents.** Every provider Paseo launches reads and writes the same
  store, including sub-agents created by other agents.
- **No leaks between projects.** Each Paseo project has its own memory. Worktrees share
  the memory of the repository they were created from.
- **A small global layer.** Personal preferences that hold everywhere, such as the
  language you want replies in, live in a separate scope visible in every project.
- **Plain files.** Memories are markdown files on disk. Read, edit, version or delete
  them with any tool.

## How it works

```text
agent is created
  └─ plugin hook "agent.create"
       ├─ resolves the agent's working directory to a Paseo project
       ├─ appends memory instructions and the current memory index to the system prompt
       └─ attaches the "agent-memory" MCP server, scoped to that project
            └─ memory_recall / memory_read / memory_save / memory_delete
                 └─ markdown files under <paseo home>/memory/
```

1. When Paseo creates an agent, the plugin's `agent.create` hook finds the project that
   owns the agent's working directory.
2. It appends instructions to the agent's system prompt: recall memory at the start of
   every task, save a memory when the user corrects you or when you learn a durable
   project fact. The current memory index is included so the agent sees what exists.
3. It attaches a small stdio MCP server that exposes four memory tools. The server is
   started with the project's memory directory, so an agent cannot address another
   project's memory through the tools.
4. Memory tools are approved automatically, so agents are never blocked on a permission
   prompt for reading or writing memory.

The MCP server has no dependencies and runs on the daemon's own Node runtime, so nothing
needs to be installed on the daemon host besides the plugin.

## Requirements

- Paseo daemon **0.10.3 or later**.
- Plugins enabled on the daemon: **Settings → Plugins → Enable plugins**.
- `git` on the daemon's `PATH` is recommended. It is used to map a worktree to its main
  repository. Without it, agents in worktrees outside a registered project root get a
  memory of their own.

## Install

Plugins are trusted, unsandboxed code. Read the source before you install it: the server
part of a plugin can access files, processes, credentials and the network on the daemon
host.

From GitHub:

```bash
paseo plugin install git:Ujifman/paseo-agent-memory
```

From a local checkout:

```bash
git clone https://github.com/Ujifman/paseo-agent-memory.git
paseo plugin install /absolute/path/to/paseo-agent-memory
```

Check that it is running:

```bash
paseo plugin ls
```

The plugin applies to agents **created after it is installed**. Existing agents keep the
configuration they were created with.

## Using it

There is nothing to operate. Work with your agents as usual:

- Correct an agent, state a preference, or confirm an unusual choice. The agent saves it
  as a `feedback` memory, and every later agent in that project follows it.
- As agents explore a project they record durable facts the repository does not make
  obvious: why an architecture decision was made, how to run the tests, known pitfalls,
  domain rules.
- You can be explicit: "remember that we deploy from the `release` branch", "forget the
  note about the staging database", "what do you remember about this project?".

To review or curate memory yourself, open the files described below. They are ordinary
markdown, and your edits are picked up on the next recall.

## Where memory is stored

```text
<paseo home>/memory/
  _global/                      personal preferences, visible in every project
    MEMORY.md
    reply-in-english.md
  MyService-3fa2b1c9/           one directory per project
    project.json                which project owns this directory
    MEMORY.md                   index, regenerated on every write
    tests-use-real-db.md        one memory per file
  .runtime/
    memory-mcp-<hash>.mjs       the MCP server the agents launch
```

`<paseo home>` is `~/.paseo` by default, or the value of `PASEO_HOME`.

A memory file looks like this:

```markdown
---
name: tests-use-real-db
description: Integration tests must hit a real database
type: feedback
updated: 2026-01-15
---

Do not mock the database in integration tests.

Why: mocked tests passed while a production migration was broken.
How to apply: use the docker-compose test database for anything under tests/integration.
```

| Type        | Holds                                                       |
| ----------- | ----------------------------------------------------------- |
| `feedback`  | How you want agents to work: corrections, preferences       |
| `project`   | Knowledge about the project that is not obvious from the repository |
| `reference` | Pointers to external resources: dashboards, tickets, documents |
| `user`      | Who you are: role, expertise                                |

`MEMORY.md` is derived from the memory files each time a memory is saved or deleted
through the tools. If you add or remove files by hand, the index catches up on the next
save; recall always reads the files themselves.

## How a project is identified

Memory follows **Paseo's project**, not the folder name.

1. The agent's working directory is matched against the projects registered in Paseo.
   When projects are nested, the most specific one wins, so a project that lives inside
   another project's folder keeps its own memory.
2. If nothing matches, the plugin asks Git for the main checkout of the working directory
   and matches that. This is how a worktree stored outside the repository still resolves
   to its project.
3. If there is still no match, the main checkout path (or the working directory itself)
   becomes the project.

The directory name is the project's display name plus a short hash of Paseo's project
key. For a repository with a remote, that key is derived from the remote URL, so the
memory survives moving the checkout to another folder.

## Memory tools

The plugin attaches an MCP server named `agent-memory`:

| Tool            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `memory_recall` | Without arguments: everything in the global and project scopes. With `query`: the best matching memories. |
| `memory_read`   | One memory in full, by name.                                            |
| `memory_save`   | Create or overwrite a memory. Arguments: `type`, `name`, `description`, `content`, optional `scope` (`project` by default, or `global`). |
| `memory_delete` | Remove a memory that is wrong or outdated.                              |

While the memory of a project is small (under about 20,000 characters), `memory_recall`
returns every memory in full. Beyond that it returns the index, and agents read
individual memories or search with a query. A single memory is limited to 8,000
characters.

## Provider support

Every provider receives the MCP server and can use the memory tools. Two details differ:

| Provider                              | Memory instructions                         | Tool approval                         |
| ------------------------------------- | ------------------------------------------- | ------------------------------------- |
| Claude Code, Codex, OpenCode          | System prompt, tool descriptions, recall output | Preapproved when the agent is created |
| ACP providers such as Cursor          | Tool descriptions and recall output only    | Approved by the plugin when requested |

In testing, the Cursor agent did not see the instructions added to the system prompt, and
Paseo does not accept tool preapprovals for ACP providers. The plugin compensates: the rules are repeated in the tool
descriptions and at the end of every full recall, and a permission hook approves memory
tool calls as they are requested. In practice ACP agents use the memory, but the reminder
to do so is weaker than a system prompt.

Tested with Claude Code and Cursor.

## Turn off the agents' built-in memory

Some providers have a memory of their own. Leaving it on does not break anything, but
then an agent may store your correction in its private memory, where agents of other
providers never see it. For a single shared memory, turn the built-in one off.

### Claude Code

Claude Code has **auto memory**: notes it writes on its own under
`~/.claude/projects/<project>/memory/`. It is on by default. Disable it in one of these
ways:

- **For all projects.** Run `/memory` in a Claude Code session and switch the auto memory
  toggle off, or add this to `~/.claude/settings.json`:

  ```json
  {
    "autoMemoryEnabled": false
  }
  ```

- **For one project.** Put the same setting in that project's `.claude/settings.json`.

- **Only for agents started by Paseo.** Set the environment variable
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for the Claude provider in the daemon's
  `config.json`, and keep auto memory for the Claude Code sessions you start yourself:

  ```json
  {
    "agents": {
      "providers": {
        "claude": {
          "env": { "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1" }
        }
      }
    }
  }
  ```

  Apply the change with `paseo reload`. Provider `env` is described in Paseo's
  [custom providers](https://paseo.sh/docs/custom-providers) documentation; if you run
  Claude through a provider entry of your own, put the variable on that entry.

Memories Claude Code has already written stay in `~/.claude/projects/<project>/memory/`.
To keep them, ask an agent to read that folder and save what still matters with
`memory_save`.

See the [Claude Code memory documentation](https://code.claude.com/docs/en/memory) for
the current options.

### Codex

Codex has a **memories** feature: it summarizes past threads in the background and
injects what it learned into later sessions. It is off by default, so there is nothing to
do unless you turned it on, either with the **Enable Codex memories** toggle under
Settings → Personalization in the ChatGPT desktop app or in `~/.codex/config.toml`
(or `$CODEX_HOME/config.toml`):

```toml
[features]
memories = true
```

Disable it in one of these ways:

- **Completely.** Switch the **Enable Codex memories** toggle off, or set the feature
  flag to `false` (removing the line has the same effect):

  ```toml
  [features]
  memories = false
  ```

- **Partly.** Keep the feature but stop one half of it in the `[memories]` section:

  ```toml
  [memories]
  generate_memories = false   # new threads are not turned into memories
  use_memories = false        # existing memories are not injected into prompts
  ```

- **For one chat.** Run `/memories` in the Codex CLI or the desktop app to choose whether
  the current chat may read existing memories or contribute to future ones.

- **Only for agents started by Paseo.** Leave your own `config.toml` alone and pass the
  override through the Codex provider entry in the daemon's `config.json`, for example by
  adding `-c features.memories=false` to its `command`. See Paseo's
  [custom providers](https://paseo.sh/docs/custom-providers) documentation for the
  provider fields.

Memories Codex has already generated stay in `~/.codex/memories/`. To keep them, ask an
agent to read that folder and save what still matters with `memory_save`. To remove them,
use **Delete Codex memories** under Settings → Personalization in the desktop app.

See the [Codex memories documentation](https://developers.openai.com/codex/memories) for
the current options.

### Cursor

The Cursor agent Paseo runs through ACP has no automatic memory, so there is nothing to
turn off. If you use the Memories feature of the Cursor editor, it is separate from the
agents Paseo launches.

### Keep your instruction files

Do **not** remove `CLAUDE.md`, `AGENTS.md` or `.cursor/rules`. Those are instructions you
write and version with the repository, and they work alongside this plugin. A good split:
rules you want reviewed and shared with your team belong in those files; what agents
learn while working belongs in memory.

## Configuration

| Environment variable     | Effect                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `PASEO_AGENT_MEMORY_DIR` | Store memory in this directory instead of `<paseo home>/memory`.                |
| `PASEO_HOME`             | Paseo's own home directory; memory defaults to its `memory` subdirectory.       |

Both are read from the daemon's environment. Restart the daemon after changing them.

## Security and privacy

- Memory never leaves the daemon host. The plugin makes no network requests.
- Memories are plain text and unencrypted. Agents are told not to store task progress,
  but nothing prevents an agent from writing down a secret it encountered. Review the
  files if that matters to you, and do not publish the memory directory.
- The memory tools are approved automatically. They can only create, overwrite and delete
  markdown files inside the memory directory.
- Project isolation is enforced by how each MCP server is started, not by an access
  control system. An agent with shell access can read any file its user can read,
  including other projects' memory directories.
- Anything in memory is injected into future agents' context, so it has the same
  influence as an instruction file. Treat write access to the memory directory
  accordingly.

## Limitations

- Only agents created after installation get memory. Recreate long-lived agents to add it.
- Memory instructions are written into the system prompt when the agent is created; the
  index in it is a snapshot. Agents call `memory_recall` to get the current state.
- There is no automatic consolidation yet. Agents update and delete memories as they
  work, but nothing periodically merges or prunes them.
- Search is plain keyword matching, not semantic search.
- Concurrent writes to the same memory are last-writer-wins.
- There is no user interface in the Paseo app; memory is managed through agents or by
  editing the files.

## Troubleshooting

| Symptom                                   | Check                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Agent has no memory tools                 | `paseo plugin ls` shows `running`; the agent was created after the plugin was installed. |
| Plugin failed to load                     | `paseo plugin logs paseo-agent-memory`; the daemon is 0.10.3 or later.                |
| Memory was skipped for one agent          | The log has a line starting with `agent-memory: skipped for`. Agent creation is never blocked by a memory failure. |
| Two checkouts of one project have separate memory | Register the project in Paseo, and make sure `git` is on the daemon's `PATH`. |
| An agent ignores memory                   | Ask it to call `memory_recall`. ACP providers get a weaker reminder; see [Provider support](#provider-support). |

## Uninstall

```bash
paseo plugin remove paseo-agent-memory
```

Memory files stay in `<paseo home>/memory`; delete that directory to remove them. Agents
created while the plugin was installed keep the `agent-memory` MCP server in their saved
configuration and keep working, because the server script lives in the memory directory.

## Development

```bash
npm install
npm run typecheck     # embeds the MCP server, then runs tsc
npm test              # exercises the MCP server over stdio
paseo plugin install "$PWD"
paseo plugin reload paseo-agent-memory   # after editing the source
```

| Path                    | Role                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `index.server.ts`       | Plugin entry: the `agent.create` hook and the permission hook           |
| `server/project.ts`     | Maps a working directory to a Paseo project                             |
| `server/prompt.ts`      | Memory instructions appended to the system prompt                       |
| `server/permissions.ts` | Recognizes memory tool calls from providers without preapprovals        |
| `server/store.ts`       | Memory directory layout and installation of the MCP server script       |
| `mcp/memory-mcp.mjs`    | The dependency-free stdio MCP server                                    |
| `server/mcp-source.ts`  | Generated copy of the MCP server embedded into the plugin               |
| `scripts/embed-mcp.mjs` | Regenerates `server/mcp-source.ts`                                      |

Paseo bundles the server entry, so the plugin cannot count on files staying next to it.
The MCP server is therefore embedded as a string and written to
`<paseo home>/memory/.runtime/` at startup. Run `npm run embed` (or `npm run typecheck`)
after editing `mcp/memory-mcp.mjs`, and commit the regenerated `server/mcp-source.ts`.
The script's file name carries a content hash: agents store its path in their saved
configuration, so a plugin update must not rewrite a script that existing agents launch.

## License

[MIT](LICENSE)
