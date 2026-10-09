// Stand-in for an agent CLI session in runner tests. It records how it was started (env, argv) and then either
// finishes the task (writes phase DONE, status COMPLETED) or exits early.
// argv: <log file> <attempt from which it finishes the task; 0 = never; "all" = every ACTIVE task, like a session that
// goes on to a follow-up by itself> [prompt and other args...]
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { NETWORK_DIR, AGENT_ID, AGENT_NETWORK_TASK_ID: taskId, AGENT_NETWORK_ATTEMPT } = process.env;
const [log, finishArg, ...rest] = process.argv.slice(2);
const attempt = Number(AGENT_NETWORK_ATTEMPT);
appendFileSync(log, JSON.stringify({ agent: AGENT_ID, networkDir: NETWORK_DIR, taskId, attempt, args: rest }) + "\n");

const finish = (id) => {
  const path = join(NETWORK_DIR, "tasks", id, "task.json");
  const task = JSON.parse(readFileSync(path, "utf8"));
  if (task.status === "ACTIVE") writeFileSync(path, JSON.stringify({ ...task, phase: "DONE", status: "COMPLETED", updatedAt: new Date().toISOString() }));
};
if (finishArg === "all") {
  for (const id of readdirSync(join(NETWORK_DIR, "tasks"))) finish(id);
  process.exit(0);
}
const finishOn = Number(finishArg);
if (finishOn > 0 && attempt >= finishOn) {
  finish(taskId);
  process.exit(0);
}
process.exit(3);
