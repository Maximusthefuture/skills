// Stand-in for an agent CLI session in runner tests. It records how it was started (env, argv) and then either
// finishes the task (writes phase DONE, status COMPLETED) or exits early.
// argv: <log file> <attempt from which it finishes the task; 0 = never; "all" = every ACTIVE task, like a session that
// goes on to a follow-up by itself; "handoff:N" = the first session moves the task into SYNC and is told to hand it over
// (writes the server's handoff marker), sessions from attempt N finish it (0 = never); "block:N" = the first session
// leaves the task BLOCKED, sessions from attempt N finish it; "turns:N" = sessions before attempt N tick a subtask and stop
// at the turn limit (stream-json result error_max_turns), from attempt N they finish it; "turns-idle:N" = the same
// without touching anything (no progress)> [prompt and other args...]
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
if (/^turns(-idle)?:/.test(finishArg) && attempt < Number(finishArg.split(":")[1]) || finishArg === "turns-idle:0") {
  if (!finishArg.startsWith("turns-idle")) {
    const dir = join(NETWORK_DIR, "tasks", taskId, "subtasks");
    mkdirSync(dir, { recursive: true });
    const items = Array.from({ length: attempt }, (_, i) => ({ id: `s${i + 1}`, title: `step ${i + 1}`, status: "DONE", updatedAt: new Date().toISOString() }));
    writeFileSync(join(dir, `${AGENT_ID}.json`), JSON.stringify({ taskId, agentId: AGENT_ID, items, nextSeq: attempt + 1 }));
  }
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 3, usage: { input_tokens: 10, output_tokens: 1 } }) + "\n");
  process.exit(1);
}
const finishOn = Number(finishArg.replace(/^(handoff|block|turns|turns-idle):/, ""));
if (finishOn > 0 && attempt >= finishOn) {
  finish(taskId);
  process.exit(0);
}
process.exit(3);
