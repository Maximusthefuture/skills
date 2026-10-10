// Stand-in for an agent CLI session in runner tests. It records how it was started (env, argv) and then either
// finishes the task (writes phase DONE, status COMPLETED) or exits early.
// argv: <log file> <attempt from which it finishes the task; 0 = never; "all" = every ACTIVE task, like a session that
// goes on to a follow-up by itself; "handoff:N" = the first session moves the task into SYNC and is told to hand it over
// (writes the server's handoff marker), sessions from attempt N finish it (0 = never); "block:N" = the first session
// leaves the task BLOCKED, sessions from attempt N finish it> [prompt and other args...]
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { NETWORK_DIR, AGENT_ID, AGENT_NETWORK_TASK_ID: taskId, AGENT_NETWORK_ATTEMPT, AGENT_NETWORK_FRESH_PHASES, AGENT_NETWORK_RUNNER } = process.env;
const [log, finishArg, ...rest] = process.argv.slice(2);
const attempt = Number(AGENT_NETWORK_ATTEMPT);
appendFileSync(log, JSON.stringify({ agent: AGENT_ID, networkDir: NETWORK_DIR, taskId, attempt, fresh: AGENT_NETWORK_FRESH_PHASES ?? null, runner: AGENT_NETWORK_RUNNER ?? null, args: rest }) + "\n");

const finish = (id) => {
  const path = join(NETWORK_DIR, "tasks", id, "task.json");
  const task = JSON.parse(readFileSync(path, "utf8"));
  if (task.status === "ACTIVE") writeFileSync(path, JSON.stringify({ ...task, phase: "DONE", status: "COMPLETED", updatedAt: new Date().toISOString() }));
};
if (finishArg === "all") {
  for (const id of readdirSync(join(NETWORK_DIR, "tasks"))) finish(id);
  process.exit(0);
}
if (finishArg.startsWith("handoff:") && attempt === 1) {
  const path = join(NETWORK_DIR, "tasks", taskId, "task.json");
  const task = JSON.parse(readFileSync(path, "utf8"));
  const phaseHistory = [...(task.phaseHistory ?? []), { phase: "SYNC", at: new Date().toISOString() }];
  writeFileSync(path, JSON.stringify({ ...task, phase: "SYNC", phaseHistory, updatedAt: new Date().toISOString() }));
  mkdirSync(join(NETWORK_DIR, "hooks"), { recursive: true });
  writeFileSync(join(NETWORK_DIR, "hooks", `${AGENT_ID}.handoff.json`), JSON.stringify({ taskId, epoch: phaseHistory.length, at: new Date().toISOString() }));
  process.exit(0);
}
if (finishArg.startsWith("block:") && attempt === 1) {
  const path = join(NETWORK_DIR, "tasks", taskId, "task.json");
  const task = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...task, status: "BLOCKED", blockedReason: "fix-round limit", updatedAt: new Date().toISOString() }));
  process.exit(0);
}
const finishOn = Number(finishArg.replace(/^(handoff|block):/, ""));
if (finishOn > 0 && attempt >= finishOn) {
  finish(taskId);
  process.exit(0);
}
process.exit(3);
