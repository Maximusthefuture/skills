"""
Shared plumbing for the backend-design-java hooks.

All hooks run on PostToolUse for Write / Edit / MultiEdit. They read the file
from disk (so an Edit is checked in the context of the whole file), and report
findings back to Claude through `hookSpecificOutput.additionalContext`. Plain
stderr with exit 0 is NOT shown to the model, which is why the upstream plugin's
warnings never reached Claude.

Hooks never block: they always exit 0. Any internal error is swallowed so a
hook bug can never break the user's session.
"""

import json
import os
import re
import sys
from typing import List, Optional, Tuple

PLUGIN = "backend-design-java"

SKIP_PATH_MARKERS = (
    "/src/test/", "/src/it/", "/src/integrationtest/", "/src/testfixtures/",
    "/target/", "/build/", "/generated/", "/generated-sources/",
    "/.git/", "/node_modules/", "/.gradle/", "/.idea/",
)


def read_payload() -> Optional[dict]:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return None
    if payload.get("tool_name") not in ("Write", "Edit", "MultiEdit"):
        return None
    return payload


def norm_path(path: str) -> str:
    return path.replace("\\", "/")


def is_test_or_generated(path: str) -> bool:
    p = norm_path(path).lower()
    if any(m in p for m in SKIP_PATH_MARKERS):
        return True
    base = os.path.basename(p)
    return base.endswith(("test.java", "tests.java", "it.java", "test.kt", "it.kt"))


def file_path(payload: dict) -> str:
    return (payload.get("tool_input") or {}).get("file_path", "") or ""


def current_content(payload: dict) -> str:
    """Content of the file after the tool ran. Falls back to the tool input."""
    path = file_path(payload)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except Exception:
        ti = payload.get("tool_input") or {}
        return ti.get("content") or ti.get("new_string") or ""


def original_content(payload: dict, current: str) -> Optional[str]:
    """Best-effort content of the file before the tool ran. None = new file or unknown."""
    tool = payload.get("tool_name")
    ti = payload.get("tool_input") or {}
    resp = payload.get("tool_response") or {}
    if tool == "Write":
        orig = resp.get("originalFile") if isinstance(resp, dict) else None
        return orig if isinstance(orig, str) else None
    edits: List[Tuple[str, str, bool]] = []
    if tool == "Edit":
        edits.append((ti.get("old_string") or "", ti.get("new_string") or "", bool(ti.get("replace_all"))))
    elif tool == "MultiEdit":
        for e in ti.get("edits") or []:
            edits.append((e.get("old_string") or "", e.get("new_string") or "", bool(e.get("replace_all"))))
    text = current
    for old, new, replace_all in reversed(edits):
        if not new or new not in text:
            return None
        text = text.replace(new, old) if replace_all else text.replace(new, old, 1)
    return text


def emit(kind: str, path: str, findings: List[Tuple[str, str, str]], footer: str) -> None:
    """findings: (severity, rule_id, message). severity in {blocking, risk, note}."""
    if not findings:
        return
    order = {"blocking": 0, "risk": 1, "note": 2}
    findings = sorted(findings, key=lambda f: order.get(f[0], 3))
    lines = ["[{}] {} review for {}".format(PLUGIN, kind, path)]
    for severity, rule_id, message in findings:
        lines.append("- [{}][{}] {}".format(severity, rule_id, message))
    lines.append(footer)
    lines.append("These are heuristics: fix real issues now, or say briefly why a finding does not apply.")
    counts = {}
    for severity, _, _ in findings:
        counts[severity] = counts.get(severity, 0) + 1
    summary = ", ".join("{} {}".format(n, s) for s, n in sorted(counts.items(), key=lambda kv: order.get(kv[0], 3)))
    out = {
        "systemMessage": "[{}] {}: {} in {}".format(PLUGIN, kind, summary, os.path.basename(path)),
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n".join(lines),
        },
    }
    print(json.dumps(out))


def strip_java_comments(src: str) -> str:
    """Remove // and /* */ comments, keep string literals and line structure."""
    out = []
    i, n = 0, len(src)
    in_str = None
    while i < n:
        c = src[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if src.startswith(in_str, i):
                out.append(src[i + 1:i + len(in_str)])
                i += len(in_str)
                in_str = None
                continue
            i += 1
            continue
        if src.startswith('"""', i):
            in_str = '"""'
            out.append('"""')
            i += 3
            continue
        if c == '"':
            in_str = '"'
            out.append(c)
            i += 1
            continue
        if c == "'":  # char literal, e.g. '"' or '\''
            j = i + 1
            while j < n and src[j] != "'" and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
            continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j == -1 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            chunk = src[i:n if j == -1 else j + 2]
            out.append("\n" * chunk.count("\n"))
            i = n if j == -1 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def block_after(src: str, start: int) -> Tuple[int, int]:
    """Return (open, close) index of the first {...} block at or after start."""
    open_idx = src.find("{", start)
    if open_idx == -1:
        return -1, -1
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return open_idx, i
    return open_idx, len(src) - 1


def line_of(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


def run(main) -> None:
    try:
        main()
    except Exception:
        pass
    sys.exit(0)


__all__ = [
    "PLUGIN", "re", "read_payload", "file_path", "current_content", "original_content",
    "emit", "is_test_or_generated", "norm_path", "strip_java_comments", "block_after",
    "line_of", "run",
]
