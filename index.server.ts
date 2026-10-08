import type { PluginServerContext } from "@getpaseo/plugin/server";
import { allowAction, isMemoryToolCall } from "./server/permissions";
import { resolveProject } from "./server/project";
import { buildMemoryPrompt } from "./server/prompt";
import { ensureMcpScript, ensureProjectDir, memoryRoot } from "./server/store";

const MCP_SERVER = "agent-memory";
const MCP_TOOLS = ["memory_recall", "memory_read", "memory_save", "memory_delete"];
// Paseo rejects exact-tool preapprovals for any other provider and fails agent creation.
const PREAPPROVAL_PROVIDERS = new Set(["claude", "codex", "opencode"]);

export default function contribute(server: PluginServerContext) {
  server.before("agent.create", async ({ request }, { paseo }) => {
    const { config } = request;
    if (config.internal) {
      return;
    }

    try {
      const project = await resolveProject(paseo, config.cwd);
      const projectDir = await ensureProjectDir(project);
      const script = await ensureMcpScript();
      const memoryPrompt = await buildMemoryPrompt(project.displayName, projectDir);
      const preapproved = config.toolPolicy?.preapproved ?? [];
      const toolPolicy = PREAPPROVAL_PROVIDERS.has(config.provider)
        ? {
            ...config.toolPolicy,
            preapproved: [
              ...preapproved.filter((ref) => ref.server !== MCP_SERVER),
              ...MCP_TOOLS.map((tool) => ({ kind: "mcp" as const, server: MCP_SERVER, tool })),
            ],
          }
        : config.toolPolicy;

      return {
        ...request,
        config: {
          ...config,
          systemPrompt: [config.systemPrompt, memoryPrompt].filter(Boolean).join("\n\n"),
          mcpServers: {
            ...config.mcpServers,
            [MCP_SERVER]: {
              type: "stdio",
              // The daemon may run on Electron's bundled Node; this makes it act as plain Node.
              command: process.execPath,
              args: [script],
              env: {
                ELECTRON_RUN_AS_NODE: "1",
                PASEO_MEMORY_ROOT: memoryRoot(),
                PASEO_MEMORY_PROJECT: projectDir,
                PASEO_MEMORY_PROJECT_NAME: project.displayName,
              },
              alwaysLoad: true,
            },
          },
          toolPolicy,
        },
      };
    } catch (error) {
      // Memory is an enhancement: a failure here must not block agent creation.
      console.error("agent-memory: skipped for", config.cwd, error);
      return;
    }
  });

  // Providers without preapprovals would otherwise ask the user on every memory call.
  server.on("agent.permission_requested", async ({ agent, request }, { paseo }) => {
    if (!isMemoryToolCall(request, MCP_SERVER, MCP_TOOLS)) {
      return;
    }
    await paseo.agents.ref(agent.id).respondToPermission({
      requestId: request.id,
      response: { behavior: "allow", selectedActionId: allowAction(request) },
    });
  });

  return () => {};
}
