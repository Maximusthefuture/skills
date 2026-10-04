---
name: java-code-review
description: "Local review of changes in a Java / Spring Boot project — instead of the built-in code-review for Java: a branch's git diff, a single file, a commit range or a GitHub PR, with every finding checked against the code and a confidence score. Use this skill whenever the user asks to review, check or audit code changes in a Java, Kotlin-free JVM or Spring project, even casually - \"review my changes\", \"check this PR\", \"code review\", «сделай ревью», «проверь мои изменения», «посмотри diff перед PR», «что не так с этой веткой», \"/java-code-review\", or before committing, pushing or opening a pull request. Also use it with \"--fix\" to apply the fixes it finds. Covers correctness, null-safety, concurrency, Spring and JPA/Hibernate pitfalls, transactions, security, API contracts, performance and the project's own CLAUDE.md rules."
compatibility: Claude Code (or any agent with bash and file read access) in a git repository. gh CLI is optional and needed only for reviewing GitHub PRs by number.
---

# Java Code Review

Review of changes in a Java / Spring Boot project. The goal is to find few but real problems: bugs, regressions, security holes and violations of the project's rules. A review with 30 style remarks is read by nobody, so precision matters more than completeness here.

## 1. Decide what to review

Parse the arguments from the user's request:

| Request | What to review |
|---|---|
| no arguments | the branch against upstream (or main/master) + uncommitted and staged changes |
| a file path | only that file: its diff, and if the diff is empty — the whole file |
| `A...B` or `A..B` | `git diff A...B` |
| a number (`123`, `#123`) | a GitHub PR: `gh pr diff 123` and `gh pr view 123` |
| `--staged` | only `git diff --cached` (handy for pre-commit) |
| `--fix` | fix the findings after the review (see section 6) |

Collect the diff with `scripts/collect_diff.sh` — it finds the base (an empty tree in a repository without commits), filters out generated files and prints the list of changed files and the diff itself:

```bash
bash <skill-path>/scripts/collect_diff.sh            # default
bash <skill-path>/scripts/collect_diff.sh main...feature
bash <skill-path>/scripts/collect_diff.sh --staged
```

The diff is empty — say so and stop, do not invent remarks.
The diff is huge (more than ~3000 lines) — first show the user the file list and propose narrowing the scope or reviewing module by module.

## 2. Collect the project context

Before judging the code, learn the rules it is written by:

- `CLAUDE.md` at the root and in the directories of changed files — these are the project's rules, and their violations are full findings.
- `pom.xml` / `build.gradle(.kts)`: the Java version (decides whether records, sealed, pattern matching, virtual threads fit), the Spring Boot version (2.x — `javax.*`, 3.x — `jakarta.*`), the libraries in use (Lombok, MapStruct, Flyway/Liquibase, Testcontainers).
- Linter and formatter configs (Checkstyle, Spotless, PMD, ErrorProne). Do not duplicate what they already catch.

The diff shows only changed lines, and most serious bugs are visible only in context. For every changed method open the whole file and find the calling code (`grep -rn "methodName(" src/`), especially if the signature, contract, nullability, exceptions or transaction behavior changed.

## 3. Go through the areas

For every changed file check in order. Detailed checklists are in `references/`; open the one you need when the diff has the matching code, not all at once.

1. **Correctness** — logic, edge cases, null, equals/hashCode, exceptions, resources. → `references/java-core.md`
2. **Concurrency** — shared mutable state in singletons, `@Async`, thread pools, races. → `references/java-core.md`
3. **Spring** — beans, transactions, proxies and self-invocation, configuration, validation. → `references/spring-jpa.md`
4. **Persistence** — N+1, lazy loading outside a transaction, migrations, locks. → `references/spring-jpa.md`
5. **Security** — injections, endpoint authorization, secrets, logging PII, deserialization. → `references/security.md`
6. **API contracts** — backward compatibility of REST/DTOs/events, response codes, versioning.
7. **Tests** — is the new behavior covered. If the environment has the `test-audit` skill, judge the quality of the tests themselves by it, and here only note missing tests for risky logic.
8. **Project rules** — everything CLAUDE.md explicitly demands.

Do not look for problems in unchanged code unless the change breaks it (e.g. a new call of an old method with null).

## 4. Check every finding and estimate confidence

This is the most important step: before reporting, try to refute every potential remark.

- Open the code you refer to and make sure the line and the behavior are exactly so.
- Check whether the case is handled higher up the stack (validation in the controller, `@NotNull`, a global `@ControllerAdvice`, a security filter).
- For a "possible NPE", find where the value really comes from.
- If a run can check it cheaply — check: `./mvnw -q -DskipTests compile`, `./gradlew compileJava`, or a single test run.

Then assign a confidence from 0 to 100:

- **90–100** — confirmed by the code or a run, clear how to reproduce.
- **80–89** — very likely, the context is checked, a little uncertainty remains.
- **50–79** — plausible but not fully checked.
- **below 50** — a guess.

Only findings with confidence **80 and above** go into the report. Collect findings at 50–79 as one short line each in "Worth rechecking" (at most 5). Drop the rest.

Do not include: style a formatter catches; taste without an explicit rule in CLAUDE.md; "could have used Optional/stream"; problems that existed before the diff; hypothetical problems without a concrete scenario.

## 5. Write the report

Write in the user's language. Use this template:

```markdown
## Review: <what was reviewed, e.g. "feature/payments vs origin/main, 14 files">

**Verdict:** <one sentence: can it be merged and what blocks it>

### 🔴 Blocking
**1. <short title>** — `src/main/java/.../OrderService.java:142` · confidence 95
<what is wrong and in which scenario it breaks, 1–3 sentences>
<how to fix: concretely, a short code fragment if needed>

### 🟡 Important
...

### 🔵 Improvements
(only if they are really worth attention; at most 3)

### Worth rechecking
- `File.java:88` — <one line>

### Done well
<1–2 sentences, only if there is something concrete>
```

Severity criteria:
- 🔴 **Blocking** — a bug, data loss or corruption, a vulnerability, a breaking contract change, a violation of a mandatory CLAUDE.md rule.
- 🟡 **Important** — the problem shows up under realistic conditions (load, concurrency, edge data), missing tests for risky logic.
- 🔵 **Improvements** — a notable simplification or performance gain without a bug.

No findings — say so briefly and list what exactly you checked. An empty review is a normal result.

## 6. `--fix` mode

If the user passed `--fix` or asked to fix after the report:

1. Fix only findings with confidence 80+, starting with blocking ones. Improvements — only if the user asked.
2. Every fix is minimal, without side refactoring.
3. After the edits run the build and the tests of the affected modules (`./mvnw -q test -pl <module>` or `./gradlew :<module>:test`). If there are no tests for the fixed behavior and the finding is blocking — add a test.
4. Do not commit or push — show the final `git diff` and briefly list what was fixed and what was not and why.

## 7. PR mode (`--comment`)

If the user asks to leave comments on a GitHub PR, first show the report, then ask for confirmation and only then publish via `gh pr review <number> --comment --body-file <file>`. Never use `--approve` or `--request-changes` without an explicit request.
