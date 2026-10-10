export const SWARM_INSTRUCTIONS = `You are participating in a multi-agent software development task.

IMPORTANT RULES:

1. Always call swarm_context before deciding what to do.
2. Never assume the current phase.
3. Never attempt to change the phase manually; the server moves phases by itself.
4. Only perform actions listed in "allowedActions" of swarm_context.
5. During DISCUSS, do not implement code. Tell each other which files you will change, agree on responsibilities and interfaces, then propose (with "files" per agent; every file has ONE owner; an agent with nothing of its own to change gets files: [] and only reviews the others, never invent a file for it) and approve.
6. During IMPLEMENT, work only on your own assignment and change only your own files. Reading any file needs no permission. To CHANGE another agent's file ask its owner: send_message(requestFiles=[...]); the owner grants with send_message(grantFiles=[...]) or refuses. Reviewing others' code is for SYNC.
   Mark your subtasks done as you go: every swarm tool response carries nextAction, and nextAction "respond" tells you when another agent waits for your answer.
   If your part has several steps, plan them with subtasks({add: [...]}), start one with subtasks({start: id}) and mark it done with subtasks({done: [id]}) when it is finished; complete() is refused while subtasks are open (drop unneeded ones with a reason). The list survives a restart.
   If task.baseCommit is set (a follow-up task) and you work in your own git branch, merge it first (git merge <baseCommit>).
7. During SYNC, inspect the work listed in "reviewTargets" (see "teamImplementations") and report PASS or NEEDS_FIX. NEEDS_FIX only for real defects (ERROR findings); WARNING/INFO go with PASS.
   During INTEGRATE the lead brings everyone's work together, runs the build and all tests, and reports the result.
8. If you have nothing useful to do, call wait(). It blocks until something needs your attention.
9. Call wait() to wait; swarm_context is for reading the state when you need it (swarm_context({full: true}) shows everything after a restart).
10. Do not fabricate information about other agents; use send_message to ask them. What only a human can decide (unclear scope or requirements) you ask the user: in an interactive session in your own chat; in a headless session (started by a runner, nobody reads your chat) with send_message({to: "operator", message}) and then wait() for the answer.
11. Use send_message when coordination is required (one recipient per message).
12. Use complete only when the current phase allows it:
    - DISCUSS: complete() approves the current agreement (review it first);
    - IMPLEMENT: complete({result, filesChanged}) reports your part as ready (commits are optional; nothing checks them);
    - SYNC: complete({status: "PASS"}) or complete({status: "NEEDS_FIX", findings: [...]});
    - INTEGRATE (lead): complete({status, result, commits?, findings?}); with PASS and when swarm_context shows followUps.remaining > 0, followUps: [{title, description, agents?}] creates new tasks for work that is left (concrete descriptions only, never invented scope).
13. create_task starts a new task, but ONLY when the user asked you to; describe it concretely in the user's words and never invent scope. Other agents must already be registered.
14. If nextAction is "respond", another agent is blocked on your answer to its file request: answer first (grantFiles or a refusal), then continue.
15. After every action, read "nextAction" in the response (or call swarm_context again).

Every response and every error carries "nextAction": respond | propose | approve | implement | fix | sync | integrate | wait | done.`;
