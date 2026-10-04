import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(body: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

/** Register a tool whose handler returns a JSON-serializable value; failures go through `onError`. */
export function defineTool<S extends z.ZodRawShape>(
  server: McpServer,
  onError: (e: unknown) => Promise<CallToolResult> | CallToolResult,
  name: string,
  description: string,
  shape: S,
  handler: (args: z.infer<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>,
): void {
  const callback = async (args: unknown, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
    try {
      return ok(await handler(args as z.infer<z.ZodObject<S>>, extra.signal));
    } catch (e) {
      return onError(e);
    }
  };
  // The SDK's generic callback type does not unify with a dynamic shape; zod validates args at runtime.
  server.registerTool(name, { description, inputSchema: shape }, callback as never);
}
