#!/usr/bin/env python3
"""Checks comments added or touched in Java changes against the java-conventions rules.

Usage:
  check_comments.py                 uncommitted changes (git diff HEAD) + untracked .java files
  check_comments.py main...HEAD     a git range (also A..B or a single revision)
  check_comments.py --files A.java  whole files

A comment counts when any of its lines was added or changed, so an edit inside an
old Javadoc checks the whole Javadoc. Exit code 1 if anything is flagged.
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
# ASCII identifiers only, so Russian prose like "сумма = цена * количество" is not code
CODE_LIKE = re.compile(
    r"(;\s*$)|(^[{}]\s*$)|(\)\s*\{\s*$)|^(return|if|for|while|import|private|public|final|var)\b\s*[\w(]|"
    r"^[a-z_]\w*(\.[a-z_]\w*)+\(.*\)\s*$",
    re.ASCII,
)
TODO = re.compile(r"\b(TODO|FIXME|XXX)\b")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def git(*args, check=True):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def skip(path):
    p = f"/{path}"
    return not path.endswith(".java") or "/target/" in p or "/build/" in p


def comments(source):
    """Yields (kind, first_line, last_line, text) for every comment; kind: line, block, javadoc."""
    i, n, line = 0, len(source), 1
    found = []
    while i < n:
        c = source[i]
        if source.startswith('"""', i):
            end = source.find('"""', i + 3)
            end = n if end == -1 else end + 3
            line += source.count("\n", i, end)
            i = end
        elif c in "\"'":
            j = i + 1
            while j < n and source[j] != c and source[j] != "\n":
                j += 2 if source[j] == "\\" else 1
            i = j + 1
        elif source.startswith("//", i):
            end = source.find("\n", i)
            end = n if end == -1 else end
            whole_line = not source[source.rfind("\n", 0, i) + 1:i].strip()
            found.append(["line", line, line, source[i + 2:end].strip(), whole_line])
            i = end
        elif source.startswith("/*", i):
            end = source.find("*/", i + 2)
            end = n if end == -1 else end
            kind = "javadoc" if source.startswith("/**", i) and not source.startswith("/**/", i) else "block"
            body = source[i + (3 if kind == "javadoc" else 2):end]
            text = " ".join(re.sub(r"^\s*\*", "", b).strip() for b in body.split("\n")).strip()
            last = line + source.count("\n", i, end)
            found.append([kind, line, last, text, False])
            line, i = last, end + 2
        else:
            if c == "\n":
                line += 1
            i += 1
    # consecutive whole-line // comments are one comment, so splitting does not dodge the limit
    merged = []
    for kind, first, last, text, whole in found:
        prev = merged[-1] if merged else None
        if (kind == "line" and whole and prev and prev[0] == "line" and prev[4]
                and prev[2] == first - 1 and not TODO.search(text)):
            prev[2], prev[3] = last, f"{prev[3]} {text}"
        else:
            merged.append([kind, first, last, text, whole])
    for kind, first, last, text, _ in merged:
        yield kind, first, last, text


def words(text):
    return [w for w in TICKET.sub(" ", text).split() if re.search(r"\w", w)]


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


def changed_lines(diff_text):
    """{path: set of added or changed line numbers in the new version}."""
    result, path = {}, None
    for raw in diff_text.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:]
            path = None if target == "/dev/null" else re.sub(r"^b/", "", target)
            continue
        m = HUNK.match(raw)
        if m and path and not skip(path):
            start, count = int(m.group(1)), int(m.group(2) or 1)
            result.setdefault(path, set()).update(range(start, start + count))
    return result


def read_version(path, rev):
    if rev is None:
        with open(path, encoding="utf-8") as f:
            return f.read()
    return git("show", f"{rev}:{path}").stdout


def collect(argv):
    """[(path, source, lines or None for the whole file)]."""
    if argv[:1] == ["--files"]:
        return [(p, read_version(p, None), None) for p in argv[1:] if not skip(p)]

    root = git("rev-parse", "--show-toplevel").stdout.strip()
    has_head = git("rev-parse", "--verify", "-q", "HEAD", check=False).returncode == 0
    if not argv and not has_head:
        tracked = git("ls-files", "--full-name", "--", "*.java").stdout.split()
        untracked = git("ls-files", "--others", "--exclude-standard", "--full-name", "--", "*.java").stdout.split()
        return [(p, read_version(f"{root}/{p}", None), None) for p in tracked + untracked if not skip(p)]

    rng = argv[0] if argv else "HEAD"
    # the version a range ends at: A...B / A..B → B (empty means HEAD); a single revision → working tree
    rev = None
    if ".." in rng:
        rev = re.split(r"\.\.\.?", rng, maxsplit=1)[1] or "HEAD"
    diff = git("diff", "-U0", rng, "--", "*.java").stdout
    items = []
    for path, lines in changed_lines(diff).items():
        source = read_version(f"{root}/{path}" if rev is None else path, rev)
        items.append((path, source, lines))
    if not argv:
        untracked = git("ls-files", "--others", "--exclude-standard", "--full-name", "--", "*.java").stdout.split()
        items += [(p, read_version(f"{root}/{p}", None), None) for p in untracked if not skip(p)]
    return items


def main(argv):
    flagged, other = [], []
    for path, source, lines in sorted(collect(argv)):
        for kind, first, last, text in comments(source):
            if not text or (lines is not None and not lines.intersection(range(first, last + 1))):
                continue
            problems = check(kind, text)
            entry = f"{path}:{first} [{kind}] {text}"
            (flagged if problems else other).append((entry, problems))

    if flagged:
        print(f"FLAGGED ({len(flagged)}) — rewrite or remove:")
        for entry, problems in flagged:
            print(f"  {entry}\n    -> {'; '.join(problems)}")
    if other:
        print(f"\nOTHER CHANGED COMMENTS ({len(other)}) — keep only those that say why:")
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
