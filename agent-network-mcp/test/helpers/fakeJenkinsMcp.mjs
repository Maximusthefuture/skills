// A Jenkins MCP server for the tests: trigger_build starts build #42, get_build answers "building" once and then
// FAKE_RESULT (SUCCESS by default), get_build_log returns a failure log. Every call is appended to FAKE_CALLS as JSON,
// together with the JENKINS_TOKEN it got from its environment.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-jenkins", version: "1.0.0" });
const log = (tool, args) => process.env.FAKE_CALLS && appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ tool, args, token: process.env.JENKINS_TOKEN ?? null }) + "\n");
const text = (t) => ({ content: [{ type: "text", text: t }] });
let polls = 0;

server.registerTool("trigger_build", { description: "start a job", inputSchema: { jobName: z.string(), parameters: z.record(z.string(), z.string()).optional() } }, async (args) => {
  log("trigger_build", args);
  return text(JSON.stringify({ queueId: 7, number: 42, url: `https://jenkins.example.com/job/${args.jobName}/42/` }));
});
server.registerTool("get_build", { description: "build state", inputSchema: { jobName: z.string(), buildNumber: z.number().optional() } }, async (args) => {
  log("get_build", args);
  polls += 1;
  if (polls === 1) return text(JSON.stringify({ number: 42, building: true, result: null }));
  return text(JSON.stringify({ number: 42, building: false, result: process.env.FAKE_RESULT ?? "SUCCESS", duration: 61000 }));
});
server.registerTool("get_build_log", { description: "console log", inputSchema: { jobName: z.string(), buildNumber: z.number().optional() } }, async (args) => {
  log("get_build_log", args);
  return text("Started by user\n+ helm upgrade orders-service ./chart\nError: UPGRADE FAILED: timed out waiting for the condition\nFinished: FAILURE");
});

await server.connect(new StdioServerTransport());
