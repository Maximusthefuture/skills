#!/usr/bin/env python3
"""Copy this repository's skills and agents into a project (<project>/.claude) or for all projects (~/.claude).

    python3 sync-skills.py <project>            # or ~ for ~/.claude
    python3 sync-skills.py <project> --only java-spec-intake,grilling
    python3 sync-skills.py <project> --force    # also overwrite copies that differ (local edits there are lost)
    python3 sync-skills.py --archives           # rebuild the *.skill archives from the folders

A copy that differs from the repository is left alone without --force and listed: a project may have edited its copy
on purpose. evals/ and .DS_Store are not copied. --dry-run shows what would happen.
"""
import argparse
import filecmp
import hashlib
import os
import shutil
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent
SKIP = {"evals", ".DS_Store", "__pycache__", "node_modules"}
# third-party skills copied by default: grilling is needed by java-dev-flow, grill-me is its manual entry, handoff is used by the swarm
THIRD_PARTY = ["mattpocock-skills/grilling", "mattpocock-skills/grill-me", "mattpocock-skills/handoff"]
# own skills that are archived for claude.ai (*.skill): every top-level folder with a SKILL.md
OWN = sorted(p.parent.name for p in REPO.glob("*/SKILL.md"))


def sources() -> dict[str, Path]:
    """Skill name -> folder: own skills, the default third-party ones, the backend-design-java plugin's skills."""
    found = {name: REPO / name for name in OWN}
    for rel in THIRD_PARTY:
        found[Path(rel).name] = REPO / rel
    for p in sorted((REPO / "backend-design-java" / "skills").glob("*/SKILL.md")):
        found[p.parent.name] = p.parent
    return found


def agents() -> list[Path]:
    return sorted((REPO / "java-dev-flow" / "assets" / "agents").glob("*.md")) + sorted((REPO / "backend-design-java" / "agents").glob("*.md"))


def files(folder: Path) -> list[Path]:
    out = []
    for root, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        out += [Path(root) / n for n in sorted(names) if n not in SKIP]
    return out


def digest(folder: Path) -> str:
    h = hashlib.sha256()
    for f in files(folder):
        h.update(str(f.relative_to(folder)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    for f in files(src):
        target = dst / f.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)


def sync(target: Path, only: set[str] | None, force: bool, dry: bool) -> int:
    claude = target if target.name == ".claude" else target / ".claude"
    plan: list[tuple[str, str]] = []
    differs: list[str] = []
    for name, src in sources().items():
        if only and name not in only:
            continue
        dst = claude / "skills" / name
        if not dst.exists():
            plan.append(("new", name))
        elif digest(dst) == digest(src):
            plan.append(("same", name))
        elif force:
            plan.append(("overwrite", name))
        else:
            differs.append(name)
            continue
        if not dry and plan[-1][0] != "same":
            copy_tree(src, dst)
    for src in agents():
        if only and src.stem not in only:
            continue
        dst = claude / "agents" / src.name
        state = "new" if not dst.exists() else "same" if filecmp.cmp(src, dst, shallow=False) else "overwrite" if force else None
        if state is None:
            differs.append(f"agents/{src.name}")
            continue
        plan.append((state, f"agents/{src.name}"))
        if not dry and state != "same":
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    for state in ("new", "overwrite", "same"):
        names = [n for s, n in plan if s == state]
        if names:
            print(f"{'would be ' if dry and state != 'same' else ''}{state}: {', '.join(names)}")
    if differs:
        print(f"differs, left as it is (--force overwrites): {', '.join(differs)}")
    print(f"-> {claude}")
    return 0


def archives(dry: bool) -> int:
    for name in OWN:
        out = REPO / f"{name}.skill"
        if dry:
            print(f"would rebuild {out.name}")
            continue
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files(REPO / name):
                z.write(f, Path(name) / f.relative_to(REPO / name))
        print(f"rebuilt {out.name}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="project folder, or ~ for ~/.claude")
    ap.add_argument("--only", help="comma-separated skill names (or agent file names without .md)")
    ap.add_argument("--force", action="store_true", help="overwrite copies that differ from the repository")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--archives", action="store_true", help="rebuild the *.skill archives of the own skills")
    a = ap.parse_args()
    if a.archives:
        archives(a.dry_run)
    if a.target:
        target = Path(os.path.expanduser(a.target)).resolve()
        if not target.is_dir():
            print(f"no such folder: {target}", file=sys.stderr)
            return 2
        return sync(target, set(a.only.split(",")) if a.only else None, a.force, a.dry_run)
    if not a.archives:
        ap.print_help()
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
