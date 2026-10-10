// A fake agent CLI with stream-json output: prints an assistant event and a result with usage, then finishes its task.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { NETWORK_DIR, AGENT_NETWORK_TASK_ID: taskId } = process.env;
const say = (o) => process.stdout.write(JSON.stringify(o) + "\n");
say({ type: "system", subtype: "init", model: "fake-model" });
say({ type: "assistant", message: { content: [{ type: "text", text: "Working on " + taskId }] } });
say({ type: "result", subtype: "success", result: "done", num_turns: 2, total_cost_usd: 0.5, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const path = join(NETWORK_DIR, "tasks", taskId, "task.json");
const task = JSON.parse(readFileSync(path, "utf8"));
writeFileSync(path, JSON.stringify({ ...task, phase: "DONE", status: "COMPLETED", updatedAt: new Date().toISOString() }));
