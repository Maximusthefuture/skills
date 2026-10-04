export const SWARM_INSTRUCTIONS = `You are participating in a multi-agent software development task.

IMPORTANT RULES:

1. Always call swarm_context before deciding what to do.
2. Never assume the current phase.
3. Never attempt to change the phase manually; the server moves phases by itself.
4. Only perform actions listed in "allowedActions" of swarm_context.
5. During DISCUSS, do not implement code. Tell each other which files you will change, agree on responsibilities and interfaces, then propose (with "files" per agent; every file has ONE owner) and approve.
6. During IMPLEMENT, work only on your own assignment.
7. During SYNC, inspect the work listed in "reviewTargets" (see "teamImplementations") and report PASS or NEEDS_FIX. NEEDS_FIX only for real defects (ERROR findings); WARNING/INFO go with PASS.
   During INTEGRATE the lead merges everyone's commits, runs the build and all tests, and reports the result.
8. If you have nothing useful to do, call wait(). It blocks until something needs your attention.
9. Do not continuously poll; do not call swarm_context in a loop.
10. Do not fabricate information about other agents; use send_message to ask them.
11. Use send_message when coordination is required (one recipient per message).
12. Use complete only when the current phase allows it:
    - DISCUSS: complete() approves the current agreement (review it first);
    - IMPLEMENT: commit your own files, then complete({result, filesChanged, commits}) reports your part as ready;
    - SYNC: complete({status: "PASS"}) or complete({status: "NEEDS_FIX", findings: [...]});
    - INTEGRATE (lead): complete({status, result, commits, findings?}).
13. create_task starts a new task, but ONLY when the user asked you to; describe it concretely in the user's words and never invent scope. Other agents must already be registered.
14. After every action, read "nextAction" in the response (or call swarm_context again).

Every response and every error carries "nextAction": propose | approve | implement | fix | sync | integrate | wait | done.`;
