#!/usr/bin/env python3
"""tdd-guard — PostToolUse hook on Write/Edit/MultiEdit: reminds to show RED before editing production code.

Fires on a write to src/main/** (Java, Kotlin, Groovy, Scala). Reads the session transcript:
  - when a test was last edited (src/test/**, *Test.java, *IT.java);
  - whether a Maven or Gradle test run that failed came after that.
If a test was edited and no failure followed, or no test was edited in the session at all,
the hook returns additional context to Claude: "RED was not shown". It blocks nothing.
One reminder per test edit (and one per session while there were no tests),
so it does not fire on every write.

A refactoring (java-tdd mode C) and edits without behavior change need no RED —
the reminder says so, and it can be ignored.

Configuration — environment variables in "env" of .claude/settings.json:
  TDD_GUARD=off        disable
  TDD_GUARD_DEBUG=1    print hook errors to stderr

Any internal error is a silent exit with code 0: the hook must not break the session.
"""

import json
import os
import re
import sys
import tempfile
import traceback

STATE_DIR = os.environ.get("TDD_GUARD_STATE_DIR") or os.path.join(tempfile.gettempdir(), "claude-tdd-guard")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}

MAIN_RE = re.compile(r"(^|/)src/main/(java|kotlin|groovy|scala)/.+\.(java|kt|groovy|scala)$")
GENERATED_RE = re.compile(r"(^|/)(generated|generated-sources|target|build)/")
TEST_FILE_RE = re.compile(
    r"(^|/)src/(test|it|integration-?[tT]est|testFixtures)/"
    r"|[A-Za-z0-9](Test|Tests|IT|ITCase|Spec)\.(java|kt|groovy|scala)$"
)
BUILD_RE = re.compile(r"(?:^|[\s;&|(/])(?:mvnw|mvn|gradlew|gradle)(?:\.cmd|\.bat)?(?=[\s\"']|$)")
TEST_GOAL_RE = re.compile(r"(?:^|\s)(?:[\w:.-]*:)?(?:test|verify|check|build|integrationTest)(?=\s|$)")
SKIP_TESTS_RE = re.compile(r"-DskipTests(?:=true)?(?=\s|$)|-Dmaven\.test\.skip=true|(?:^|\s)-x\s+test(?=\s|$)")
TEST_FAILURE_RE = re.compile(
    r"Tests run: \d+, Failures: [1-9]|Tests run: \d+, Failures: \d+, Errors: [1-9]|There (?:are|were) test failures"
    r"|\d+ tests? completed, \d+ failed|<<< (?:FAILURE|ERROR)!|AssertionFailedError|AssertionError|\bFAILED\b"
)


def norm(path):
    return path.replace(os.sep, "/") if isinstance(path, str) else ""


def is_test_run(command):
    if not isinstance(command, str) or not BUILD_RE.search(command):
        return False
    return bool(TEST_GOAL_RE.search(command)) and not SKIP_TESTS_RE.search(command)


def result_text(block):
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text") or "" for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def scan(transcript_path):
    """Returns (id of the last test edit or None, whether a failing run came after it)."""
    with open(transcript_path, "rb") as transcript:
        raw_lines = transcript.read().splitlines()
    last_test_edit = None
    red_after = False
    runs = {}
    for raw in raw_lines:
        if not raw.strip():
            continue
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(entry, dict) or entry.get("isSidechain"):
            continue
        content = (entry.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                name = block.get("name")
                tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
                if name in EDIT_TOOLS and TEST_FILE_RE.search(norm(tool_input.get("file_path"))):
                    last_test_edit = block.get("id") or raw[:64].decode("utf-8", "replace")
                    red_after = False
                elif name == "Bash" and is_test_run(tool_input.get("command")):
                    runs[block.get("id")] = True
            elif block.get("type") == "tool_result" and block.get("tool_use_id") in runs:
                if last_test_edit is not None and TEST_FAILURE_RE.search(result_text(block)):
                    red_after = True
    return last_test_edit, red_after


def state_file(session_id):
    return os.path.join(STATE_DIR, re.sub(r"[^A-Za-z0-9_.-]", "_", session_id) or "unknown")


def already_warned(session_id, key):
    try:
        with open(state_file(session_id), encoding="utf-8") as state:
            return state.read().strip() == key
    except OSError:
        return False


def remember(session_id, key):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(state_file(session_id), "w", encoding="utf-8") as state:
            state.write(key)
    except OSError:
        pass


def message(path, no_test):
    rel = path.rsplit("/src/main/", 1)[-1]
    if no_test:
        reason = "no test was edited in this session yet"
    else:
        reason = "no run with a failing test followed the last test edit"
    return (
        "tdd-guard: production code edited at `src/main/{rel}`, but RED was not shown — {reason}. "
        "Per java-tdd: first a test for the behavior, run only that test, see it fail on an assertion "
        "for the expected reason (a compilation error or a failed context is not RED), then minimal code. "
        "The code is already written — prove the test can fail without it: git stash push -- <files>, run, git stash pop. "
        "If this is a refactoring without behavior change (mode C) or an edit without behavior, the reminder does not apply."
    ).format(rel=rel, reason=reason)


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    if os.environ.get("TDD_GUARD", "").strip().lower() in ("0", "off", "false", "no"):
        return
    if payload.get("tool_name") not in EDIT_TOOLS:
        return
    path = norm((payload.get("tool_input") or {}).get("file_path"))
    if not MAIN_RE.search(path) or GENERATED_RE.search(path.rsplit("/src/main/", 1)[-1]):
        return
    transcript = payload.get("transcript_path")
    if not isinstance(transcript, str) or not os.path.isfile(transcript):
        return
    last_test_edit, red_after = scan(transcript)
    if red_after:
        return
    session_id = str(payload.get("session_id") or "unknown")
    key = last_test_edit or "no-test"
    if already_warned(session_id, key):
        return
    remember(session_id, key)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": message(path, last_test_edit is None),
    }}))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # the hook must not break the session
        if os.environ.get("TDD_GUARD_DEBUG"):
            traceback.print_exc()
    sys.exit(0)
