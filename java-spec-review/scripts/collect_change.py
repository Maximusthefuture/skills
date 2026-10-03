#!/usr/bin/env python3
"""Собирает OpenSpec change для скилла java-spec-review.

Принимает путь к spec.md (дельте в change или главному спеку), к любому файлу или
каталогу change, к корню проекта или просто имя change. Находит change, читает
proposal, design, tasks, дельты спеков и базовые спеки из openspec/specs и печатает:
инвентарь требований и сценариев, трассировку «сценарий ↔ задача» и находки по
формату OpenSpec и правилам java-dev-flow.

Это механическая проверка формы. Смысл артефактов разбирает скилл.

    python3 collect_change.py openspec/changes/add-refunds/specs/refunds/spec.md
    python3 collect_change.py add-refunds            # имя change, поиск от cwd
    python3 collect_change.py . --json

Код выхода: 0 — собрано; 2 — не удалось однозначно найти change (кандидаты в выводе).
Только stdlib, ничего не пишет на диск.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path


class ResolveError(Exception):
    pass


RE_DELTA = re.compile(r"^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$", re.I)
RE_PURPOSE = re.compile(r"^##\s+Purpose\s*$", re.I)
RE_MAIN_REQS = re.compile(r"^##\s+Requirements\s*$", re.I)
RE_H2 = re.compile(r"^##\s")
RE_REQ = re.compile(r"^###\s+Requirement:\s*(.+?)\s*$")
RE_SCEN = re.compile(r"^####\s+Scenario:\s*(.+?)\s*$")
RE_BAD_SCEN = re.compile(r"^\s*(?:#{1,3}\s*|#{5,}\s*|[-*]\s+\**)Scenario\b", re.I)
RE_HEADING = re.compile(r"^(#{1,6})\s")
RE_RENAME = re.compile(r"^\s*[-*]?\s*(FROM|TO):\s*`?\s*(?:###\s*)?(?:Requirement:\s*)?(.+?)\s*`?\s*$", re.I)
RE_SHALL = re.compile(r"\b(SHALL|MUST)\b")
RE_WHEN = re.compile(r"\b(WHEN|КОГДА)\b")
RE_THEN = re.compile(r"\b(THEN|ТОГДА|ТО)\b")
RE_KEYWORDS = re.compile(r"\*\*|\b(GIVEN|WHEN|THEN|AND|КОГДА|ТОГДА|ТО|И)\b")
RE_CONCRETE = re.compile(r"\d|`|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[A-Z]{3,}\b")
RE_VAGUE = re.compile(
    r"корректн|правильн|успешн|должным образом|соответствующ|как ожидается|ожидаем|нормально|"
    r"properly|correctly|successfully|appropriate|as expected", re.I)
RE_CHECKBOX = re.compile(r"^\s*[-*]\s*\[([^\]]*)\]\s*(.*)$")
RE_TASK_ID = re.compile(r"^(\d+(?:\.\d+)+)\s+")
RE_TASK_CHECK = re.compile(r"провер|verif|убедит", re.I)
RE_GROUP_NUM = re.compile(r"^\d+\.?\s*")
RE_TEST_GROUP = re.compile(r"^(тесты|тестирование|tests?|testing)\b", re.I)
RE_CHECK_GROUP = re.compile(r"провер|verif", re.I)
RE_EXEMPT_GROUP = re.compile(r"провер|verif|рефактор|refactor|подготов|setup|настрой", re.I)
RE_ROUTE = re.compile(r"Маршрут:.*")
RE_SIZE = re.compile(r"·\s*([SML])\s*(?:·|$)")
RE_CAP_ITEM = re.compile(r"^\s*[-*]\s+`?([^`:\s]+)`?\s*:?")
RE_PLACEHOLDER = re.compile(r"\bTBD\b|\bTODO\b|<capability-path>|<existing-capability-path>|\?\?\?")

REQ_TEXT_LIMIT = 500
PURPOSE_MIN = 50


# ---------- разбор markdown ----------

def norm(text):
    text = text.lower().replace("ё", "е")
    text = re.sub(r"[«»\"'`“”„]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_spec(text):
    """Разбирает дельту или главный спек: разделы, требования, сценарии, RENAMED."""
    spec = {"sections": [], "purpose_line": None, "purpose_text": "",
            "requirements": [], "renames": [], "bad_scenarios": []}
    section = None
    req = scen = None
    rename = None
    for no, line in enumerate(text.splitlines(), 1):
        m = RE_DELTA.match(line)
        if m:
            section = m.group(1).upper()
            spec["sections"].append(section)
            req = scen = None
            continue
        if RE_PURPOSE.match(line):
            section = "PURPOSE"
            spec["purpose_line"] = no
            req = scen = None
            continue
        if RE_MAIN_REQS.match(line):
            section = "MAIN"
            req = scen = None
            continue
        if RE_H2.match(line):
            section = None
            req = scen = None
            continue
        if section == "PURPOSE":
            if line.strip() and not line.strip().startswith("<!--"):
                spec["purpose_text"] += line.strip() + " "
            continue
        if section == "RENAMED":
            m = RE_RENAME.match(line)
            if m:
                if m.group(1).upper() == "FROM":
                    rename = {"from": m.group(2), "to": None, "line": no}
                    spec["renames"].append(rename)
                elif rename is not None:
                    rename["to"] = m.group(2)
            continue
        m = RE_REQ.match(line)
        if m and section in ("ADDED", "MODIFIED", "REMOVED", "MAIN"):
            req = {"name": m.group(1), "line": no, "op": section, "text": "", "scenarios": []}
            spec["requirements"].append(req)
            scen = None
            continue
        m = RE_SCEN.match(line)
        if m and req is not None:
            scen = {"name": m.group(1), "line": no, "body": ""}
            req["scenarios"].append(scen)
            continue
        if RE_BAD_SCEN.match(line):
            spec["bad_scenarios"].append(no)
            scen = None
            continue
        h = RE_HEADING.match(line)
        if h:
            if len(h.group(1)) <= 3:
                req = None
            scen = None
            continue
        if scen is not None:
            scen["body"] += line + "\n"
        elif req is not None:
            req["text"] += line + "\n"
    for r in spec["requirements"]:
        r["text"] = r["text"].strip()
        for s in r["scenarios"]:
            s["body"] = s["body"].strip()
    return spec


def scenario_flags(body):
    then_at = RE_THEN.search(body)
    then_text = RE_KEYWORDS.sub(" ", body[then_at.start():]) if then_at else ""
    return {
        "when": bool(RE_WHEN.search(body)),
        "then": bool(then_at),
        "vague": bool(then_at) and (bool(RE_VAGUE.search(then_text)) or not RE_CONCRETE.search(then_text)),
    }


def section_lines(text, heading_re):
    """Строки под заголовком, пока не начнётся заголовок того же или более высокого уровня."""
    out, level = [], None
    for no, line in enumerate(text.splitlines(), 1):
        h = RE_HEADING.match(line)
        if level is None:
            if h and re.match(heading_re, line, re.I):
                level = len(h.group(1))
            continue
        if h and len(h.group(1)) <= level:
            break
        out.append((no, line))
    return out


def parse_proposal(text):
    route_line = None
    for no, line in section_lines(text, r"^##\s+Impact") or []:
        m = RE_ROUTE.search(line)
        if m:
            route_line = (no, m.group(0).strip().strip("*").strip())
            break
    if route_line is None:
        for no, line in enumerate(text.splitlines(), 1):
            m = RE_ROUTE.search(line)
            if m:
                route_line = (no, m.group(0).strip().strip("*").strip())
                break
    size = None
    if route_line:
        m = RE_SIZE.search(route_line[1])
        size = m.group(1) if m else None

    def caps(heading):
        items = []
        for _, line in section_lines(text, heading):
            m = RE_CAP_ITEM.match(line)
            if m and "<" not in m.group(1):
                items.append(m.group(1).strip("/"))
        return items

    return {
        "route": route_line[1] if route_line else None,
        "route_line": route_line[0] if route_line else None,
        "size": size,
        "breaking": "BREAKING" in text,
        "capabilities": {"new": caps(r"^###\s+New Capabilities"),
                         "modified": caps(r"^###\s+Modified Capabilities")},
    }


def parse_tasks(text):
    groups, bad = [], []
    group = None
    for no, line in enumerate(text.splitlines(), 1):
        if re.match(r"^##\s", line):
            title = line[2:].strip()
            group = {"title": title, "name": RE_GROUP_NUM.sub("", title), "line": no, "tasks": []}
            groups.append(group)
            continue
        m = RE_CHECKBOX.match(line)
        if not m:
            continue
        marker, body = m.group(1), m.group(2).strip()
        if marker.strip().lower() == "x":
            done = True
        elif marker == " ":
            done = False
        else:
            done = None
            bad.append({"line": no, "marker": marker})
        idm = RE_TASK_ID.match(body)
        task = {"id": idm.group(1) if idm else None, "line": no, "done": done, "text": body,
                "has_check": bool(RE_TASK_CHECK.search(body)), "scenario_refs": []}
        if group is None:
            group = {"title": "(без группы)", "name": "", "line": no, "tasks": []}
            groups.append(group)
        group["tasks"].append(task)
    return {"groups": groups, "bad_checkboxes": bad}


def simple_yaml(text):
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


# ---------- поиск change ----------

def find_openspec_root(start):
    for d in [start, *start.parents]:
        if d.name == "openspec" and ((d / "changes").is_dir() or (d / "specs").is_dir()):
            return d
        cand = d / "openspec"
        if cand.is_dir() and ((cand / "changes").is_dir() or (cand / "specs").is_dir()):
            return cand
    return None


def active_changes(root):
    changes = root / "changes"
    if not changes.is_dir():
        return []
    return sorted(p.name for p in changes.iterdir() if p.is_dir() and p.name != "archive")


def spec_files(change_dir):
    specs = change_dir / "specs"
    if not specs.is_dir():
        return []
    return sorted(p for p in specs.rglob("*.md") if p.is_file())


def capability_of(spec_path, specs_dir):
    return spec_path.parent.relative_to(specs_dir).as_posix()


def changes_touching(root, capability, exclude=None):
    out = []
    for name in active_changes(root):
        if name == exclude:
            continue
        cap_dir = root / "changes" / name / "specs" / capability
        if cap_dir.is_dir() and any(cap_dir.glob("*.md")):
            out.append(name)
    return out


def resolve(target, cwd):
    """Возвращает (root, mode, change_dir|None, main_spec|None, focus|None, resolved_via, candidates)."""
    path = Path(target)
    if not path.is_absolute():
        path = Path(cwd) / path
    path = path.resolve() if path.exists() else path

    if not path.exists():
        root = find_openspec_root(Path(cwd).resolve())
        if root is None:
            raise ResolveError(f"Не найден каталог openspec/ от {cwd}, и '{target}' — не путь.")
        for cand in (root / "changes" / target, root / "changes" / "archive" / target):
            if cand.is_dir():
                return root, "change", cand, None, None, f"имя change «{target}»", []
        raise ResolveError(f"Change «{target}» не найден в {root / 'changes'}. "
                           f"Активные: {', '.join(active_changes(root)) or 'нет'}.")

    root = find_openspec_root(path)
    if root is None:
        raise ResolveError(f"Не найден каталог openspec/ (с changes/ или specs/) от {path} и выше.")

    try:
        parts = path.relative_to(root).parts
    except ValueError:
        parts = ()
    focus = path if path.is_file() and path.suffix == ".md" else None

    if parts and parts[0] == "changes":
        if len(parts) >= 3 and parts[1] == "archive":
            return root, "change", root / "changes" / "archive" / parts[2], None, focus, "путь внутри архивного change", []
        if len(parts) >= 2 and parts[1] != "archive":
            return root, "change", root / "changes" / parts[1], None, focus, "путь внутри change", []

    if parts and parts[0] == "specs" and len(parts) >= 2:
        cap_dir = path.parent if path.is_file() else path
        capability = cap_dir.relative_to(root / "specs").as_posix()
        main_spec = cap_dir / "spec.md"
        rel_main = main_spec.relative_to(root.parent).as_posix()
        touching = changes_touching(root, capability)
        if len(touching) == 1:
            change_dir = root / "changes" / touching[0]
            delta = change_dir / "specs" / capability / "spec.md"
            return (root, "change", change_dir, None, delta if delta.is_file() else None,
                    f"{rel_main} → единственный активный change с дельтой этой capability", [])
        if len(touching) > 1:
            return root, "ambiguous", None, None, None, f"{rel_main} меняют несколько change", touching
        return root, "main-spec", None, main_spec, main_spec, f"{rel_main} — активных change с дельтой нет", []

    names = active_changes(root)
    if len(names) == 1:
        return root, "change", root / "changes" / names[0], None, None, "единственный активный change", []
    if len(names) > 1:
        return root, "ambiguous", None, None, None, "несколько активных change", names
    raise ResolveError(f"В {root / 'changes'} нет активных change.")


# ---------- проверки ----------

class Issues:
    def __init__(self, project_root):
        self.items = []
        self.project_root = project_root

    def add(self, level, path, line, code, message):
        rel = path.relative_to(self.project_root).as_posix() if isinstance(path, Path) else path
        self.items.append({"level": level, "file": rel, "line": line, "code": code, "message": message})


def check_requirement_shape(req, spec_path, issues):
    if req["op"] in ("ADDED", "MODIFIED", "MAIN"):
        if not req["scenarios"]:
            issues.add("error", spec_path, req["line"], "req-no-scenario",
                       f"«{req['name']}»: у требования нет ни одного `#### Scenario:`")
        if not RE_SHALL.search(req["text"]):
            issues.add("error", spec_path, req["line"], "req-no-shall-must",
                       f"«{req['name']}»: в тексте требования нет SHALL или MUST — openspec validate его не примет")
        if len(req["text"]) > REQ_TEXT_LIMIT:
            issues.add("hint", spec_path, req["line"], "req-too-long",
                       f"«{req['name']}»: описание {len(req['text'])} > {REQ_TEXT_LIMIT} символов — "
                       "возможно, в одном требовании несколько поведений")
    for s in req["scenarios"]:
        flags = scenario_flags(s["body"])
        s.update(flags)
        if not flags["when"]:
            issues.add("warn", spec_path, s["line"], "scenario-no-when", f"сценарий «{s['name']}» без WHEN")
        if not flags["then"]:
            issues.add("warn", spec_path, s["line"], "scenario-no-then", f"сценарий «{s['name']}» без THEN")
        if flags["vague"]:
            issues.add("hint", spec_path, s["line"], "scenario-vague",
                       f"сценарий «{s['name']}»: в THEN нет конкретного значения (статус, код, поле, состояние) "
                       "или есть слова вроде «корректно», «успешно»")


def check_placeholders(path, text, issues):
    comments = [no for no, line in enumerate(text.splitlines(), 1) if "<!--" in line]
    if comments:
        issues.add("hint", path, comments[0], "placeholder",
                   f"остались комментарии шаблона: {len(comments)} (первый — строка {comments[0]})")
    for no, line in enumerate(text.splitlines(), 1):
        if RE_PLACEHOLDER.search(line):
            issues.add("warn", path, no, "placeholder", f"заглушка: {line.strip()[:80]}")


def collect(target, cwd=None):
    cwd = cwd or os.getcwd()
    root, mode, change_dir, main_spec, focus, via, candidates = resolve(target, cwd)
    project_root = root.parent
    issues = Issues(project_root)

    def rel(p):
        return p.relative_to(project_root).as_posix() if p else None

    config_path = root / "config.yaml"
    config_text = config_path.read_text(encoding="utf-8") if config_path.is_file() else ""
    config = simple_yaml(config_text)
    result = {
        "input": target, "mode": mode, "resolved_via": via, "candidates": candidates,
        "openspec_root": str(root), "project_root": str(project_root),
        "focus_spec": rel(focus), "config": {"path": rel(config_path) if config_text else None,
                                             "schema": config.get("schema")},
        "change": None, "files": [], "proposal": None, "specs": [], "tasks": None,
        "trace": {"scenarios_without_tasks": [], "tasks_without_scenario": []},
        "issues": issues.items,
    }
    if mode == "ambiguous":
        return result

    if mode == "main-spec":
        text = main_spec.read_text(encoding="utf-8")
        spec = parse_spec(text)
        result["files"].append({"path": rel(main_spec), "lines": len(text.splitlines()), "kind": "spec"})
        for line in spec["bad_scenarios"]:
            issues.add("error", main_spec, line, "scenario-heading",
                       "заголовок сценария не `#### Scenario:` (ровно 4 #) — OpenSpec его не увидит")
        for req in spec["requirements"]:
            check_requirement_shape(req, main_spec, issues)
        if not spec["purpose_text"] or "TBD" in spec["purpose_text"]:
            issues.add("warn", main_spec, spec["purpose_line"] or 1, "purpose-missing",
                       "нет Purpose или осталась заглушка TBD после archive")
        result["specs"].append({"path": rel(main_spec), "capability": capability_of(main_spec, root / "specs"),
                                "base_path": None, "is_new": False, "requirements": spec["requirements"],
                                "renames": spec["renames"]})
        return result

    # ---- change ----
    meta_path = change_dir / ".openspec.yaml"
    meta = simple_yaml(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    skip_specs = meta.get("skip_specs", "").lower() == "true"
    schema = meta.get("schema") or config.get("schema")
    java_flow = schema == "java-flow" or "java-dev-flow" in config_text
    jf = "warn" if java_flow else "hint"
    result["change"] = {"name": change_dir.name, "dir": rel(change_dir),
                        "archived": change_dir.parent.name == "archive",
                        "schema": schema, "skip_specs": skip_specs, "java_flow": java_flow}

    for p in sorted(change_dir.rglob("*")):
        if p.is_file():
            kind = ("spec" if "specs" in p.relative_to(change_dir).parts else
                    {"proposal.md": "proposal", "design.md": "design", "tasks.md": "tasks",
                     ".openspec.yaml": "meta"}.get(p.name, "other"))
            lines = len(p.read_text(encoding="utf-8", errors="replace").splitlines())
            result["files"].append({"path": rel(p), "lines": lines, "kind": kind})

    proposal_path = change_dir / "proposal.md"
    design_path = change_dir / "design.md"
    tasks_path = change_dir / "tasks.md"

    proposal = None
    if proposal_path.is_file():
        ptext = proposal_path.read_text(encoding="utf-8")
        proposal = parse_proposal(ptext)
        result["proposal"] = proposal
        check_placeholders(proposal_path, ptext, issues)
        if not proposal["route"]:
            issues.add(jf, proposal_path, None, "route-missing",
                       "в Impact нет строки классификации «Маршрут: <тип> · <S|M|L> · сигналы: …»")
    else:
        issues.add("error", proposal_path, None, "missing-artifact", "нет proposal.md")

    size = proposal["size"] if proposal else None
    if design_path.is_file():
        dtext = design_path.read_text(encoding="utf-8")
        check_placeholders(design_path, dtext, issues)
        open_q = [line for _, line in section_lines(dtext, r"^##\s+Open Questions")
                  if re.match(r"^\s*([-*]|\d+\.)\s+\S", line)]
        if open_q:
            first = next(no for no, line in enumerate(dtext.splitlines(), 1) if re.match(r"^##\s+Open Questions", line, re.I))
            issues.add("hint", design_path, first, "open-questions",
                       f"пунктов в Open Questions: {len(open_q)}. Каждый должен быть откладываемым, "
                       "то есть не менять specs, подход и tasks")
    elif size in ("M", "L"):
        issues.add(jf, design_path, None, "missing-artifact", f"нет design.md, а размер {size}")
    else:
        issues.add("hint", design_path, None, "missing-artifact", "нет design.md — допустимо только для S без сигналов")

    tasks = None
    if tasks_path.is_file():
        ttext = tasks_path.read_text(encoding="utf-8")
        tasks = parse_tasks(ttext)
        result["tasks"] = tasks
        check_placeholders(tasks_path, ttext, issues)
    else:
        issues.add("warn", tasks_path, None, "missing-artifact", "нет tasks.md")

    # ---- спеки ----
    files = spec_files(change_dir)
    specs_dir = change_dir / "specs"
    if not files and not skip_specs:
        issues.add("error", specs_dir, None, "no-specs",
                   "нет ни одной дельты в specs/ и нет skip_specs: true в .openspec.yaml — openspec validate отклонит change")
    if files and skip_specs:
        issues.add("warn", meta_path, None, "skip-specs-with-specs", "skip_specs: true, но дельты в specs/ есть")

    trace_scenarios = []
    caps_in_change = []
    for spec_path in files:
        text = spec_path.read_text(encoding="utf-8")
        spec = parse_spec(text)
        capability = capability_of(spec_path, specs_dir)
        caps_in_change.append(capability)
        base_path = root / "specs" / capability / "spec.md"
        base = parse_spec(base_path.read_text(encoding="utf-8")) if base_path.is_file() else None
        base_reqs = {norm(r["name"]): r for r in base["requirements"]} if base else {}
        is_new = base is None
        check_placeholders(spec_path, text, issues)

        if not spec["sections"]:
            issues.add("error", spec_path, None, "no-delta-sections",
                       "нет ни одного раздела `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`")
        for line in spec["bad_scenarios"]:
            issues.add("error", spec_path, line, "scenario-heading",
                       "заголовок сценария не `#### Scenario:` (ровно 4 #) — OpenSpec его молча пропустит")
        if is_new:
            if not spec["purpose_text"]:
                issues.add("warn", spec_path, None, "purpose-missing",
                           "новая capability без `## Purpose` — после archive в спеке останется TBD")
            elif len(spec["purpose_text"].strip()) < PURPOSE_MIN:
                issues.add("hint", spec_path, spec["purpose_line"], "purpose-short",
                           f"Purpose короче {PURPOSE_MIN} символов — validate --strict отметит")
        elif spec["purpose_line"]:
            issues.add("hint", spec_path, spec["purpose_line"], "purpose-ignored",
                       "Purpose в дельте существующей capability игнорируется при archive")

        seen = set()
        for req in spec["requirements"]:
            key = norm(req["name"])
            if key in seen:
                issues.add("error", spec_path, req["line"], "duplicate-requirement",
                           f"требование «{req['name']}» встречается в дельте дважды")
            seen.add(key)
            check_requirement_shape(req, spec_path, issues)
            base_req = base_reqs.get(key)
            if req["op"] == "ADDED" and base_req:
                issues.add("error", spec_path, req["line"], "added-exists-in-base",
                           f"«{req['name']}» уже есть в {rel(base_path)} — нужен MODIFIED, иначе archive упадёт")
            if req["op"] in ("MODIFIED", "REMOVED"):
                if base is None:
                    issues.add("error", spec_path, req["line"], "modified-no-base",
                               f"{req['op']} «{req['name']}», но главного спека {rel(base_path)} нет")
                elif base_req is None:
                    issues.add("error", spec_path, req["line"], "delta-header-not-found",
                               f"{req['op']} «{req['name']}»: такого требования нет в {rel(base_path)} — "
                               "заголовок должен совпадать с главным спеком")
            if req["op"] == "MODIFIED" and base_req:
                names = {norm(s["name"]) for s in req["scenarios"]}
                lost = [s["name"] for s in base_req["scenarios"] if norm(s["name"]) not in names]
                if lost:
                    issues.add("warn", spec_path, req["line"], "modified-lost-scenario",
                               f"«{req['name']}»: после archive из спека пропадут сценарии "
                               f"{', '.join('«' + n + '»' for n in lost)} — намеренно?")
            if req["op"] == "REMOVED" and not ("**Reason**" in req["text"] and "**Migration**" in req["text"]):
                issues.add("warn", spec_path, req["line"], "removed-no-reason",
                           f"REMOVED «{req['name']}» без **Reason** и **Migration**")
            if req["op"] in ("ADDED", "MODIFIED"):
                base_bodies = {norm(s["name"]): norm(s["body"]) for s in base_req["scenarios"]} if base_req else {}
                for s in req["scenarios"]:
                    unchanged = base_bodies.get(norm(s["name"])) == norm(s["body"])
                    if not unchanged:
                        trace_scenarios.append({"spec": rel(spec_path), "requirement": req["name"],
                                                "scenario": s["name"], "line": s["line"]})
        for r in spec["renames"]:
            if base is None or norm(r["from"]) not in base_reqs:
                issues.add("error", spec_path, r["line"], "delta-header-not-found",
                           f"RENAMED FROM «{r['from']}»: такого требования нет в {rel(base_path)}")

        result["specs"].append({"path": rel(spec_path), "capability": capability,
                                "base_path": rel(base_path) if base else None, "is_new": is_new,
                                "requirements": spec["requirements"], "renames": spec["renames"]})

    # ---- proposal ↔ specs ----
    if proposal:
        listed_new = proposal["capabilities"]["new"]
        listed_mod = proposal["capabilities"]["modified"]
        for cap in listed_new + listed_mod:
            if cap not in caps_in_change:
                issues.add("error", proposal_path, None, "capability-without-spec",
                           f"capability `{cap}` перечислена в proposal, но specs/{cap}/spec.md нет")
        if listed_new or listed_mod:
            for cap in caps_in_change:
                if cap not in listed_new + listed_mod:
                    issues.add("warn", specs_dir / cap, None, "spec-not-in-proposal",
                               f"дельта specs/{cap}/ не перечислена в Capabilities proposal.md")
        for cap in listed_mod:
            if not (root / "specs" / cap / "spec.md").is_file():
                issues.add("error", proposal_path, None, "modified-cap-not-found",
                           f"Modified capability `{cap}` нет в openspec/specs/ — опечатка или это новая capability")
        for cap in listed_new:
            if (root / "specs" / cap / "spec.md").is_file():
                issues.add("warn", proposal_path, None, "new-cap-exists",
                           f"New capability `{cap}` уже есть в openspec/specs/ — нужна Modified")

    # ---- tasks ----
    if tasks:
        for b in tasks["bad_checkboxes"]:
            issues.add("warn", tasks_path, b["line"], "task-bad-checkbox",
                       f"чекбокс `[{b['marker']}]` OpenSpec считает невыполненной задачей; нужен `[ ]` или `[x]`")
        groups = tasks["groups"]
        for g in groups:
            if RE_TEST_GROUP.match(g["name"]):
                issues.add("warn", tasks_path, g["line"], "tasks-test-group",
                           f"группа «{g['title']}»: тесты собраны отдельно — каждая группа несёт свои тесты")
            for t in g["tasks"]:
                if not t["has_check"]:
                    issues.add("warn", tasks_path, t["line"], "task-no-check",
                               f"задача {t['id'] or t['text'][:40]}: не сказано, как проверить выполнение")
                if t["id"] is None:
                    issues.add("hint", tasks_path, t["line"], "task-no-id", "задача без номера X.Y")
        if groups and not RE_CHECK_GROUP.search(groups[-1]["name"]):
            issues.add(jf, tasks_path, groups[-1]["line"], "tasks-last-group",
                       f"последняя группа «{groups[-1]['title']}», а не «Проверка»")

        all_tasks = [(g, t) for g in groups for t in g["tasks"]]
        for sc in trace_scenarios:
            key = norm(sc["scenario"])
            hits = [t for _, t in all_tasks if key and key in norm(t["text"])]
            for t in hits:
                t["scenario_refs"].append(sc["scenario"])
            if not hits:
                result["trace"]["scenarios_without_tasks"].append(sc)
                issues.add(jf, sc["spec"], sc["line"], "scenario-no-task",
                           f"на сценарий «{sc['scenario']}» не ссылается ни одна задача (сверка по имени)")
        for g, t in all_tasks:
            if not t["scenario_refs"] and not RE_EXEMPT_GROUP.search(g["name"]):
                result["trace"]["tasks_without_scenario"].append({"id": t["id"], "line": t["line"], "text": t["text"]})
                issues.add("hint", tasks_path, t["line"], "task-no-scenario",
                           f"задача {t['id'] or ''} не ссылается на сценарий по имени — поведение без сценария или scope creep?")

    # ---- другие change ----
    if not result["change"]["archived"]:
        for cap in caps_in_change:
            others = changes_touching(root, cap, exclude=change_dir.name)
            if others:
                issues.add("warn", specs_dir / cap, None, "overlapping-change",
                           f"capability `{cap}` меняют и другие активные change: {', '.join(others)} — "
                           "согласуй требования до archive")
    return result


# ---------- вывод ----------

LEVEL_ORDER = {"error": 0, "warn": 1, "hint": 2}


def where(item):
    return f"{item['file']}:{item['line']}" if item.get("line") else item["file"]


def render(result):
    out = []
    if result["mode"] == "ambiguous":
        out.append(f"Несколько кандидатов ({result['resolved_via']}). Укажи change:")
        out += [f"- {c}" for c in result["candidates"]]
        return "\n".join(out) + "\n"

    ch = result["change"]
    if ch:
        title = f"# Change `{ch['name']}`" + (" (архив)" if ch["archived"] else "")
    else:
        title = f"# Главный спек `{result['specs'][0]['capability']}` (без change)"
    out += [title, "",
            f"- Проект: `{result['project_root']}`",
            f"- Вход: `{result['input']}` → {result['resolved_via']}"]
    if result["focus_spec"]:
        out.append(f"- Фокус: `{result['focus_spec']}`")
    if ch:
        out.append(f"- Схема: {ch['schema'] or '—'} · правила java-dev-flow: {'да' if ch['java_flow'] else 'нет'}"
                   f" · skip_specs: {'да' if ch['skip_specs'] else 'нет'}")
    p = result["proposal"]
    if p:
        out.append(f"- {p['route'] or 'Маршрут: — (нет в Impact)'}")
        caps = p["capabilities"]
        out.append(f"- Capabilities: new {', '.join(caps['new']) or '—'}; modified {', '.join(caps['modified']) or '—'}"
                   + (" · есть **BREAKING**" if p["breaking"] else ""))

    out += ["", "## Файлы", ""]
    out += [f"- `{f['path']}` — {f['lines']} стр." for f in result["files"]]

    out += ["", "## Требования и сценарии", ""]
    for s in result["specs"]:
        base = f"база `{s['base_path']}`" if s["base_path"] else "новая capability"
        out.append(f"### `{s['path']}` — {base}")
        for r in s["requirements"]:
            out.append(f"- [{r['op']}] {r['name']} (L{r['line']}) — сценариев: {len(r['scenarios'])}")
            for sc in r["scenarios"]:
                out.append(f"  - {sc['name']} (L{sc['line']})")
        for r in s["renames"]:
            out.append(f"- [RENAMED] {r['from']} → {r['to']} (L{r['line']})")
        out.append("")

    t = result["tasks"]
    if t:
        out += ["## Задачи", ""]
        for g in t["groups"]:
            done = sum(1 for x in g["tasks"] if x["done"])
            out.append(f"- {g['title']} (L{g['line']}): {done}/{len(g['tasks'])} отмечено")
        tr = result["trace"]
        out += ["", "## Трассировка (сверка по имени сценария)", ""]
        out.append(f"- Новых и изменённых сценариев без задачи: {len(tr['scenarios_without_tasks'])}")
        out += [f"  - {x['scenario']} — `{x['spec']}:{x['line']}`" for x in tr["scenarios_without_tasks"]]
        out.append(f"- Задач вне «Проверки» и рефакторинга без сценария: {len(tr['tasks_without_scenario'])}")
        out += [f"  - {x['id'] or '?'} (L{x['line']}): {x['text'][:90]}" for x in tr["tasks_without_scenario"]]
        out.append("")

    issues = sorted(result["issues"], key=lambda i: (LEVEL_ORDER[i["level"]], i["file"], i["line"] or 0))
    counts = {lvl: sum(1 for i in issues if i["level"] == lvl) for lvl in LEVEL_ORDER}
    out += [f"## Находки скрипта — error {counts['error']} · warn {counts['warn']} · hint {counts['hint']}", ""]
    out += [f"- **{i['level']}** `{where(i)}` {i['code']} — {i['message']}" for i in issues] or ["- нет"]
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("target", nargs="?", default=".", help="spec.md, файл или каталог change, корень проекта или имя change")
    ap.add_argument("--json", action="store_true", help="вывести JSON вместо markdown")
    args = ap.parse_args(argv)
    try:
        result = collect(args.target)
    except ResolveError as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else render(result), end="")
    return 2 if result["mode"] == "ambiguous" else 0


if __name__ == "__main__":
    sys.exit(main())
