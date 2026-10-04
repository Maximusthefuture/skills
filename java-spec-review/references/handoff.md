# Change review by a fresh-context subagent

**Open when:** you start the review — steps 1–3 are done by a subagent by default. Especially if you wrote the change in this same session (via `/opsx:propose` or by hand).

The author misses what is "obvious" to them. A subagent has not seen the conversation and checks only what is written. It does steps 1–3 of the skill and returns findings and candidate questions. The rounds with the user and the edits stay with you.

A subagent does not inherit your skills and does not see this conversation, so pass everything it needs in the prompt. Run `general-purpose` with the prompt below.

```
You review an OpenSpec change before implementation. Change nothing: read only
(Read, Grep, Glob) and Bash for the script, `openspec validate`, `git status/diff/log`.
Do not ask the user questions — return them to me.

Project: <repository root>
Input: <path to spec.md or the change>
Skill: <path to java-spec-review>

1. Run `python3 <skill>/scripts/collect_change.py <input>`, and if the openspec CLI
   exists — `openspec validate <name> --strict`.
2. Read in full: proposal.md, design.md, tasks.md, all deltas in specs/,
   the main specs of capabilities with MODIFIED/REMOVED/RENAMED, openspec/config.yaml,
   the project's CLAUDE.md.
3. Load via the Skill tool (a name may carry a plugin prefix,
   e.g. backend-design-java:migration-safety):
   <think-before-coding if M or L; domain skills by signals>.
   Their Red Flags and checklists are questions to the artifacts; do not write code.
4. Go through the question bank <skill>/references/questions.md (A–G). For every question
   find the answer in the artifacts; check claims about the system against the code.
   No answer and it cannot be derived from the code — it is a question for the user.
5. Try to refute every finding: look for the answer in another artifact and in the code.

Return:
- Status: READY | GAPS | BLOCKERS and one line about the change;
- Blockers and Gaps: title, `file:line`, what is wrong, the risk,
  a ready edit text;
- Remarks — up to 5 lines;
- Checked against the code: claim — what confirmed it (file:line);
- Questions for the user: question, place in the artifact, options, recommended
  answer, which other questions it depends on;
- Skills: loaded / not found;
- Not checked: what and why.
Keep the answer under 80 lines.
```

The subagent's answer is hypotheses. Check every blocker and gap against the artifacts and the code yourself before showing it to the user. Sort the questions into rounds by their dependencies and run the rounds per steps 4–5 of the skill.
