#!/usr/bin/env python3
"""evidence-guard — Stop hook: does not let a turn end if the last test run failed and the report is silent about it.

The hook reads the transcript since the last user prompt and finds the last Maven or Gradle
run with tests (test, verify, check, build, install, package, integrationTest) and the last
full run (without -Dtest / --tests). A green single-test run after a red full run does not
hide the red full run. If the run failed, did not run (no Docker, a compilation error) or skipped tests,
and Claude's final message says nothing about it ("failed", "did not run", "Docker",
"skipped", «упал», «не запускались»…), the hook blocks the stop (decision=block) and asks
to name the failed and not-run tests. At most one reminder per user prompt.

Configuration — environment variables in "env" of .claude/settings.json:
  EVIDENCE_GUARD=off        disable
  EVIDENCE_GUARD_DEBUG=1    print hook errors to stderr

Any internal error is a silent exit with code 0: the hook must not break the session.
"""

import json
import os
import re
import sys
import tempfile
import traceback

STATE_DIR = os.environ.get("EVIDENCE_GUARD_STATE_DIR") or os.path.join(tempfile.gettempdir(), "claude-evidence-guard")
SHOWN_FAILURES = 5

BUILD_RE = re.compile(r"(?:^|[\s;&|(/])(?:mvnw|mvn|gradlew|gradle)(?:\.cmd|\.bat)?(?=[\s\"']|$)")
TEST_GOAL_RE = re.compile(r"(?:^|\s)(?:[\w:.-]*:)?(?:test|verify|check|build|install|package|integrationTest)(?=\s|$)")
SELECTED_TESTS_RE = re.compile(r"-D(?:it\.)?test=|(?:^|\s)--tests(?=[\s=])")
SKIP_TESTS_RE = re.compile(r"-DskipTests(?:=true)?(?=\s|$)|-Dmaven\.test\.skip=true|(?:^|\s)-x\s+test(?=\s|$)")

FAILURE_RES = [
    re.compile(r"BUILD FAILURE"),
    re.compile(r"BUILD FAILED"),
    re.compile(r"FAILURE: Build failed"),
    re.compile(r"There (?:are|were) test failures"),
    re.compile(r"Tests run: \d+, Failures: [1-9]"),
    re.compile(r"Tests run: \d+, Failures: \d+, Errors: [1-9]"),
    re.compile(r"\d+ tests? completed, \d+ failed"),
    re.compile(r"COMPILATION ERROR"),
]
DOCKER_RE = re.compile(r"Could not find a valid Docker environment|Cannot connect to the Docker daemon|"
                       r"Docker environment should have more than", re.IGNORECASE)
SKIPPED_RE = re.compile(r"Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: ([1-9]\d*)")
FAILED_TEST_RE = re.compile(r"(<<< (?:FAILURE|ERROR)!.*$|^\[ERROR\]\s+[\w$.]+[.#][\w$]+(?::\d+)?\b.*$|^.*\bFAILED$)", re.MULTILINE)

# Words an honest report uses to name a failure or tests that did not run (RU + EN).
# "red" / «красный» are not here: a report uses them to describe the RED phase of each behavior.
ACK_RE = re.compile(
    r"упал|не запуск|не запущ|не прош|не проход|пропущ|не собира|docker|докер|не зелён|не зелен|"
    r"\bfail|not run|didn't run|did not run|skipped|\bbroken",
    re.IGNORECASE,
)
SYSTEM_PREFIXES = (
    "<task-notification", "<local-command", "<bash-stdout", "<bash-stderr",
    "Stop hook feedback", "[Request interrupted", "Caveat:",
)


def is_human_prompt(entry):
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain"):
        return False
    origin = entry.get("origin")
    if isinstance(origin, dict) and origin.get("kind"):
        return origin.get("kind") == "human"
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return False
        text = " ".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text")
    else:
        return False
    text = text.lstrip()
    return bool(text) and not text.startswith(SYSTEM_PREFIXES)


def result_text(block):
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def is_test_run(command):
    if not isinstance(command, str) or not BUILD_RE.search(command):
        return False
    return bool(TEST_GOAL_RE.search(command)) and not SKIP_TESTS_RE.search(command)


def read_turn(transcript_path):
    """Entries of the current turn in chronological order and the user prompt id."""
    with open(transcript_path, "rb") as transcript:
        raw_lines = transcript.read().splitlines()
    turn = []
    for raw in reversed(raw_lines):
        if not raw.strip():
            continue
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        if is_human_prompt(entry):
            prompt_id = str(entry.get("uuid") or entry.get("promptId") or entry.get("timestamp"))
            return list(reversed(turn)), prompt_id
        turn.append(entry)
    return None, None


def test_runs(entries):
    """(command, output, is_error) of every test run in the turn, in order."""
    commands, runs = {}, []
    for entry in entries:
        content = (entry.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("name") == "Bash":
                command = (block.get("input") or {}).get("command")
                if is_test_run(command):
                    commands[block.get("id")] = command
            elif block.get("type") == "tool_result" and block.get("tool_use_id") in commands:
                runs.append((commands[block.get("tool_use_id")], result_text(block), bool(block.get("is_error"))))
    return runs


def red_run(runs):
    """(command, problem, output) of the run that is not green, or None.
    The last run counts; so does the last full run, even if single tests passed after it."""
    full = [run for run in runs if not SELECTED_TESTS_RE.search(run[0])]
    candidates = runs[-1:] + full[-1:]
    for command, output, is_error in candidates:
        problem = diagnose(output, is_error)
        if problem:
            return command, problem, output
    return None


def last_assistant_text(entries):
    for entry in reversed(entries):
        if entry.get("type") != "assistant":
            continue
        content = (entry.get("message") or {}).get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            text = "\n".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text")
            if text.strip():
                return text
    return ""


def diagnose(output, is_error):
    """A description of the run's problem, or None if the run is clean."""
    problems = []
    if DOCKER_RE.search(output):
        problems.append("Testcontainers found no Docker — integration tests did not run")
    if any(rx.search(output) for rx in FAILURE_RES):
        problems.append("the build or tests failed")
    elif is_error and not problems:
        problems.append("the command exited with an error")
    skipped = sum(int(n) for n in SKIPPED_RE.findall(output))
    if skipped:
        problems.append("tests skipped: %d" % skipped)
    return "; ".join(problems) or None


def failed_tests(output):
    seen, lines = set(), []
    for match in FAILED_TEST_RE.finditer(output):
        line = match.group(0).strip()[:160]
        if line not in seen:
            seen.add(line)
            lines.append(line)
        if len(lines) >= SHOWN_FAILURES:
            break
    return lines


def state_file(session_id):
    return os.path.join(STATE_DIR, re.sub(r"[^A-Za-z0-9_.-]", "_", session_id) or "unknown")


def already_reminded(session_id, prompt_id):
    try:
        with open(state_file(session_id), encoding="utf-8") as state:
            return state.read().strip() == prompt_id
    except OSError:
        return False


def remember(session_id, prompt_id):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(state_file(session_id), "w", encoding="utf-8") as state:
            state.write(prompt_id)
    except OSError:
        pass


def build_reason(command, problem, failures):
    text = ("evidence-guard: a test run in this turn — `{cmd}` — is not green: {problem}. "
            "The final message says nothing about it.").format(cmd=command.strip()[:200], problem=problem)
    if failures:
        text += "\nFrom the output:\n" + "\n".join("  " + line for line in failures)
    text += ("\n\nBefore answering, name the failed and not-run tests in the report and why (e.g. no Docker). "
             "Do not write \"tests are green\" or \"done\" until a full run after the last edit has passed. "
             "If the failure is unrelated to the task, say so, but name it.")
    return text


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    if not isinstance(payload, dict) or payload.get("stop_hook_active"):
        return
    if os.environ.get("EVIDENCE_GUARD", "").strip().lower() in ("0", "off", "false", "no"):
        return
    transcript = payload.get("transcript_path")
    if not isinstance(transcript, str) or not os.path.isfile(transcript):
        return
    entries, prompt_id = read_turn(transcript)
    if entries is None:
        return
    red = red_run(test_runs(entries))
    if red is None:
        return
    command, problem, output = red
    message = payload.get("last_assistant_message")
    if not isinstance(message, str) or not message.strip():
        message = last_assistant_text(entries)
    if ACK_RE.search(message or ""):
        return
    session_id = str(payload.get("session_id") or "unknown")
    if already_reminded(session_id, prompt_id):
        return
    remember(session_id, prompt_id)
    print(json.dumps({"decision": "block", "reason": build_reason(command, problem, failed_tests(output))}))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # the hook must not break the session
        if os.environ.get("EVIDENCE_GUARD_DEBUG"):
            traceback.print_exc()
    sys.exit(0)
