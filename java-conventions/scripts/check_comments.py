#!/usr/bin/env python3
"""Checks comments added in Java changes against the java-conventions rules.

Usage:
  check_comments.py                 uncommitted changes (git diff HEAD) + untracked .java files
  check_comments.py main...HEAD     a git range
  check_comments.py --files A.java  whole files

Exit code 1 if anything is flagged.
"""
import re
import subprocess
import sys

LINE_LIMIT = 5
JAVADOC_LIMIT = 20

TICKET = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
FORBIDDEN_TAG = re.compile(r"@(author|since|version)\b")
LABEL = re.compile(
    r"^(=+|-+|\*+)|(=====|-----)|^(геттеры?|сеттеры?|конструкторы?|поля|методы|импорты|"
    r"getters?|setters?|constructors?|fields|methods|imports)\b",
    re.IGNORECASE,
)
CODE_LIKE = re.compile(
    r"(;\s*$)|(^[{}]\s*$)|(\)\s*\{\s*$)|^(return|if\s*\(|for\s*\(|while\s*\(|import\s|private\s|public\s|"
    r"final\s|var\s)|^[\w.<>\[\]]+\s*=\s*.+|^[\w.]+\(.*\)\s*$"
)
TODO = re.compile(r"\b(TODO|FIXME|XXX)\b")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def skip(path):
    return not path.endswith(".java") or "/target/" in f"/{path}" or "/build/" in f"/{path}"


def added_lines_from_diff(diff_text):
    """{path: [(line_no, text), ...]} for added lines."""
    result, path, line_no = {}, None, 0
    for raw in diff_text.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:]
            path = None if target == "/dev/null" else re.sub(r"^b/", "", target)
            continue
        m = HUNK.match(raw)
        if m:
            line_no = int(m.group(1))
            continue
        if path is None or skip(path):
            continue
        if raw.startswith("+"):
            result.setdefault(path, []).append((line_no, raw[1:]))
            line_no += 1
        elif not raw.startswith("-") and not raw.startswith("\\"):
            line_no += 1
    return result


def whole_files(paths):
    result = {}
    for p in paths:
        if skip(p):
            continue
        with open(p, encoding="utf-8") as f:
            result[p] = [(i, line.rstrip("\n")) for i, line in enumerate(f, 1)]
    return result


def code_and_comment(line):
    """Splits a line at the first // outside a string or char literal."""
    in_str = in_chr = False
    i = 0
    while i < len(line):
        c = line[i]
        if c == "\\" and (in_str or in_chr):
            i += 2
            continue
        if c == '"' and not in_chr:
            in_str = not in_str
        elif c == "'" and not in_str:
            in_chr = not in_chr
        elif not in_str and not in_chr and line.startswith("//", i):
            return line[:i], line[i + 2:]
        elif not in_str and not in_chr and line.startswith("/*", i):
            return line[:i], None  # block comment start, handled by caller
        i += 1
    return line, None


def words(text):
    text = TICKET.sub(" ", text)
    return [w for w in text.split() if re.search(r"\w", w)]


def extract_comments(lines):
    """Yields (kind, start_line, text): kind is 'line', 'block' or 'javadoc'."""
    i = 0
    while i < len(lines):
        no, line = lines[i]
        stripped = line.strip()
        start = line.find("/*")
        code, comment = code_and_comment(line)
        if comment is not None:
            parts = [comment.strip()]
            # consecutive whole-line // comments are one comment, so splitting does not dodge the limit
            while not code.strip() and i + 1 < len(lines) and lines[i + 1][0] == no + len(parts):
                next_code, next_comment = code_and_comment(lines[i + 1][1])
                if next_comment is None or next_code.strip() or TODO.search(next_comment):
                    break
                parts.append(next_comment.strip())
                i += 1
            yield "line", no, " ".join(parts)
            i += 1
            continue
        if start != -1 and code.rstrip() == line[:start].rstrip():
            kind = "javadoc" if line[start:].startswith("/**") else "block"
            body, first = [], no
            rest = line[start + (3 if kind == "javadoc" else 2):]
            while True:
                end = rest.find("*/")
                if end != -1:
                    body.append(rest[:end])
                    break
                body.append(rest)
                i += 1
                if i >= len(lines) or lines[i][0] != lines[i - 1][0] + 1:
                    break  # block continues outside the added lines
                rest = lines[i][1]
            text = " ".join(re.sub(r"^\s*\*", "", b).strip() for b in body).strip()
            yield kind, first, text
        i += 1


def check(kind, text):
    problems = []
    n = len(words(text))
    limit = JAVADOC_LIMIT if kind == "javadoc" else LINE_LIMIT
    if n > limit:
        problems.append(f"{n} words, limit {limit}")
    if FORBIDDEN_TAG.search(text):
        problems.append("@author / @since / @version")
    if kind != "javadoc" and LABEL.search(text):
        problems.append("label or divider")
    if kind != "javadoc" and CODE_LIKE.search(text):
        problems.append("looks like commented-out code")
    if TODO.search(text) and not TICKET.search(text):
        problems.append("TODO without a ticket key")
    if kind == "javadoc" and not words(re.sub(r"@\w+\s+\w+", "", text)):
        problems.append("Javadoc with tags only")
    return problems


def main(argv):
    if argv[:1] == ["--files"]:
        files = whole_files(argv[1:])
    else:
        rng = argv[:1] or ["HEAD"]
        files = added_lines_from_diff(git("diff", "-U0", *rng, "--", "*.java"))
        if not argv:
            untracked = git("ls-files", "--others", "--exclude-standard", "--", "*.java").split()
            files.update(whole_files(untracked))

    flagged, other = [], []
    for path, lines in sorted(files.items()):
        for kind, no, text in extract_comments(lines):
            if not text:
                continue
            problems = check(kind, text)
            entry = f"{path}:{no} [{kind}] {text}"
            (flagged if problems else other).append((entry, problems))

    if flagged:
        print(f"FLAGGED ({len(flagged)}) — rewrite or remove:")
        for entry, problems in flagged:
            print(f"  {entry}\n    -> {'; '.join(problems)}")
    if other:
        print(f"\nOTHER ADDED COMMENTS ({len(other)}) — keep only those that say why:")
        for entry, _ in other:
            print(f"  {entry}")
    if not flagged and not other:
        print("No added comments.")
    return 1 if flagged else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except subprocess.CalledProcessError as e:
        sys.exit(f"git failed: {e.stderr.strip()}")
