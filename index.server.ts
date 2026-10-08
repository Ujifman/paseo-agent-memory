import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveProject } from "./server/project";
import { buildMemoryPrompt } from "./server/prompt";
import { ensureMcpScript, ensureProjectDir, memoryRoot } from "./server/store";

const MCP_SERVER = "agent-memory";
const MCP_TOOLS = ["memory_recall", "memory_read", "memory_save", "memory_delete"];

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
          toolPolicy: {
            ...config.toolPolicy,
            preapproved: [
              ...preapproved.filter((ref) => ref.server !== MCP_SERVER),
              ...MCP_TOOLS.map((tool) => ({ kind: "mcp" as const, server: MCP_SERVER, tool })),
            ],
          },
        },
      };
    } catch (error) {
      // Memory is an enhancement: a failure here must not block agent creation.
      console.error("agent-memory: skipped for", config.cwd, error);
      return;
    }
  });

  return () => {};
}
