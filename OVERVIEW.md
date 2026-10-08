Agent memory gives every agent in Paseo a persistent memory that is shared between providers and kept separate for each project. When you correct an agent or state a preference, the agent saves it, and every agent you start later in the same project follows it. Agents also record what they learn about a project, such as why a design decision was made, how to run the tests, and known pitfalls.

Memory belongs to the Paseo project, so a Claude agent and a Cursor agent working on the same project read and write the same notes, and worktrees share the memory of their repository. Nothing saved in one project is visible in another. A separate global scope holds personal preferences that apply everywhere.

## How it works

When an agent is created, the plugin adds memory instructions to its system prompt and attaches a small MCP server with four tools: recall, read, save and delete. The tools are approved automatically, so agents are not interrupted by permission prompts for memory. Memories are markdown files in the `memory` folder of the Paseo home directory on the daemon host, one folder per project. You can read and edit them with any editor.

## Setup

Requires Paseo 0.10.3 or later. No accounts, tokens or settings are needed. Having `git` on the daemon's `PATH` lets worktrees stored outside a repository resolve to their project.

Only agents created after the plugin is enabled get memory. If a provider has its own memory, such as Claude Code auto memory, turn it off so corrections are not stored where other providers cannot see them. The repository README explains how.

## Limits

The plugin reads and writes only the memory folder on the daemon host and makes no network requests. Memories are unencrypted text, and whatever is saved is shown to later agents in that project. In testing, the Cursor agent did not see the system prompt instructions, so ACP providers also receive them through the tool descriptions and recall output, which is a weaker reminder. Search is keyword based, and there is no screen in the app for browsing memory.
