import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

type PermissionRequest = PluginLifecycleEvents["agent.permission_requested"]["request"];

/**
 * True when the request is a call to one of the memory tools. Providers that
 * cannot take preapprovals (ACP agents such as Cursor) report MCP calls as an
 * unknown tool whose input names the MCP server and tool; only that exact
 * shape matches, so a shell command that merely mentions a tool name does not.
 */
export function isMemoryToolCall(
  request: PermissionRequest,
  mcpServer: string,
  tools: readonly string[],
): boolean {
  if (request.kind !== "tool" || request.detail?.type !== "unknown") {
    return false;
  }
  const input = request.detail.input;
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const { providerIdentifier, toolName } = input as Record<string, unknown>;
  return providerIdentifier === mcpServer && typeof toolName === "string" && tools.includes(toolName);
}

/** Prefers the provider's "always allow" action so the tool stops prompting in this session. */
export function allowAction(request: PermissionRequest): string | undefined {
  const allow = request.actions?.filter((action) => action.behavior === "allow") ?? [];
  return (allow.find((action) => action.id.includes("always")) ?? allow[0])?.id;
}
