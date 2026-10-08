import { GLOBAL_SCOPE, readIndex } from "./store";

const MAX_INDEX_CHARS = 4000;

function clip(index: string): string {
  if (!index) {
    return "(empty)";
  }
  return index.length > MAX_INDEX_CHARS
    ? `${index.slice(0, MAX_INDEX_CHARS)}\n… (truncated; call memory_recall for the rest)`
    : index;
}

/** Instructions appended to every agent's system prompt, with the memory index at creation time. */
export async function buildMemoryPrompt(projectName: string, projectDir: string): Promise<string> {
  const [globalIndex, projectIndex] = await Promise.all([
    readIndex(GLOBAL_SCOPE),
    readIndex(projectDir),
  ]);

  return `# Shared agent memory

You have a persistent memory shared with every other agent that works on the project "${projectName}", across providers and sessions. It holds the user's past corrections and the knowledge agents accumulated about this project. Memory of other projects is not visible here.

Use the \`memory_recall\`, \`memory_read\`, \`memory_save\` and \`memory_delete\` tools of the agent-memory MCP server.

At the start of every task, before planning or editing, call \`memory_recall\` and follow what it returns. Feedback memories are standing instructions from the user: apply them without being reminded.

Save a memory as soon as one of these happens, not at the end of the task:
- The user corrects you, rejects an approach, states a preference, or confirms a non-obvious choice. Save it as \`feedback\`, with the reason and when it applies, so no agent repeats the mistake.
- You learn a durable fact about the project that the repository does not already make obvious: an architecture decision and its reason, a convention, how to build, run or test, a pitfall, a domain rule, who owns what. Save it as \`project\`.
- You find an external resource future agents will need, such as a dashboard, ticket or document. Save it as \`reference\`.

Keep memory worth reading:
- Recall first, then update the existing memory under the same name rather than adding a near-duplicate. Delete memories that turn out to be wrong.
- One fact per memory, written so an agent with no context understands it.
- Do not save what the code, git history or project docs already record, and do not save task progress or anything that only matters to this conversation.
- Use scope \`project\` by default. Use scope \`global\` only for the user's personal preferences that hold in every project, never for facts about this project.
- Write memories in the language the user writes in.

Memory index when this agent was created (it may have grown since):

## Global
${clip(globalIndex)}

## Project: ${projectName}
${clip(projectIndex)}`;
}
