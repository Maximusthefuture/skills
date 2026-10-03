#!/usr/bin/env python3
"""
PostToolUse check for Liquibase changelogs (formatted SQL, XML, YAML) and plain
SQL migrations on PostgreSQL.

Only changesets that are new or changed by this write are checked, so editing
one changeset does not re-report every old one in the file. Editing a changeset
that already existed is itself reported: Liquibase stores a checksum per
changeset and refuses to start on any environment where the old version ran.

Warns through additionalContext, never blocks. See skills/migration-safety.
"""

import os
import re
from collections import OrderedDict

from _common import (
    current_content, emit, file_path, norm_path, original_content, read_payload, run,
)

MIGRATION_DIR = re.compile(
    r"/(db/changelog|changelogs?|liquibase|changesets?|migrations?|db/migration)/", re.IGNORECASE)
MIGRATION_NAME = re.compile(r"(^V\d+(_\d+)*__|changelog|changeset|^\d{4,}[_-])", re.IGNORECASE)
EXTENSIONS = (".sql", ".xml", ".yaml", ".yml")

FMT_SQL_CHANGESET = re.compile(r"^--\s*changeset\s+([^\s:]+):(\S+)(.*)$", re.IGNORECASE | re.MULTILINE)
XML_CHANGESET = re.compile(r"<changeSet\b([^>]*)>(.*?)</changeSet>", re.IGNORECASE | re.DOTALL)
YAML_CHANGESET_SPLIT = re.compile(r"^\s*-\s*changeSet\s*:\s*$", re.MULTILINE)


def is_migration(path: str, content: str) -> bool:
    p = norm_path(path)
    if not p.lower().endswith(EXTENSIONS):
        return False
    head = content[:400].lower()
    if "--liquibase formatted sql" in head or "databasechangelog" in content[:2000].lower():
        return True
    return bool(MIGRATION_DIR.search(p) or MIGRATION_NAME.search(os.path.basename(p)))


def split_changesets(content: str):
    """Return OrderedDict key -> (attrs, body). Empty dict if not changeset-structured."""
    sets = OrderedDict()
    matches = list(FMT_SQL_CHANGESET.finditer(content))
    if matches:
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
            sets["{}:{}".format(m.group(1), m.group(2))] = (m.group(3), content[m.end():end])
        return sets
    for m in XML_CHANGESET.finditer(content):
        attrs = m.group(1)
        cid = re.search(r'\bid\s*=\s*"([^"]*)"', attrs)
        author = re.search(r'\bauthor\s*=\s*"([^"]*)"', attrs)
        key = "{}:{}".format(author.group(1) if author else "?", cid.group(1) if cid else len(sets))
        sets[key] = (attrs, m.group(2))
    if sets:
        return sets
    parts = YAML_CHANGESET_SPLIT.split(content)
    if len(parts) > 1:
        for chunk in parts[1:]:
            cid = re.search(r"^\s*id\s*:\s*['\"]?([^'\"\s]+)", chunk, re.MULTILINE)
            author = re.search(r"^\s*author\s*:\s*['\"]?([^'\"\s]+)", chunk, re.MULTILINE)
            key = "{}:{}".format(author.group(1) if author else "?", cid.group(1) if cid else len(sets))
            sets[key] = (chunk, chunk)
    return sets


def norm_body(body: str) -> str:
    return "\n".join(line.rstrip() for line in body.strip().splitlines() if line.strip())


def executable_text(body: str) -> str:
    """Strip rollback blocks and comments: what Liquibase actually runs forward."""
    text = re.sub(r"<rollback>.*?</rollback>", " ", body, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"^\s*rollback\s*:.*?(?=^\s*-\s*\w+\s*:|\Z)", " ", text, flags=re.DOTALL | re.MULTILINE)
    text = re.sub(r"^\s*--.*$", " ", text, flags=re.MULTILINE)
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    return text


def statements(sql: str):
    return [s.strip() for s in sql.split(";") if s.strip()]


VOLATILE_DEFAULT = re.compile(
    r"\bDEFAULT\s+(clock_timestamp|random|gen_random_uuid|uuid_generate_v[14]|uuidv7|timeofday|nextval)\s*\(",
    re.IGNORECASE)


def check_changeset(attrs: str, body: str, fmt: str):
    """Return list of (severity, rule_id, message) for one changeset."""
    out = []
    text = executable_text(body)
    attrs_all = attrs + "\n" + body
    no_tx = re.search(r"runInTransaction\s*[:=]\s*\"?false", attrs_all, re.IGNORECASE)
    creates_table = re.search(r"\bCREATE\s+TABLE\b|<createTable\b|createTable\s*:", text, re.IGNORECASE)
    stmts = statements(text)

    # --- indexes ---
    plain_index = re.search(r"\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)", text, re.IGNORECASE) \
        or re.search(r"<createIndex\b|createIndex\s*:", text, re.IGNORECASE)
    if plain_index and not creates_table:
        out.append(("risk", "index-not-concurrently",
                    "CREATE INDEX without CONCURRENTLY blocks writes for the whole build. On an existing table use "
                    "formatted SQL `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` in its own changeset with "
                    "`runInTransaction:false` (Liquibase <createIndex> cannot do CONCURRENTLY). Ignore if the table is new or tiny."))
    if re.search(r"\bCONCURRENTLY\b", text, re.IGNORECASE):
        if not no_tx:
            out.append(("blocking", "concurrently-in-transaction",
                        "CONCURRENTLY cannot run inside a transaction block and Liquibase wraps every changeset in one. "
                        "Add `runInTransaction:false` to the changeset header (formatted SQL) or attribute (XML/YAML)."))
        elif len(stmts) > 1:
            out.append(("risk", "concurrently-not-alone",
                        "A runInTransaction:false changeset with several statements can apply partially and will not be "
                        "recorded as run. Keep exactly one CONCURRENTLY statement per such changeset, with IF NOT EXISTS."))

    # --- columns ---
    for s in stmts:
        if re.search(r"\bADD\s+(COLUMN\s+)?(?!CONSTRAINT\b)\w+\s+[^,]*\bNOT\s+NULL\b", s, re.IGNORECASE) \
                and re.search(r"\bALTER\s+TABLE\b", s, re.IGNORECASE) \
                and not re.search(r"\bDEFAULT\b", s, re.IGNORECASE):
            out.append(("blocking", "add-not-null-no-default",
                        "ADD COLUMN ... NOT NULL without DEFAULT fails on a non-empty table. Either add a constant DEFAULT "
                        "(fast on PG11+), or: add nullable -> backfill outside Liquibase in batches -> enforce NOT NULL."))
            break
    if re.search(r"<addColumn\b.*?nullable\s*=\s*\"false\"", text, re.IGNORECASE | re.DOTALL) \
            and not re.search(r"<addColumn\b.*?defaultValue", text, re.IGNORECASE | re.DOTALL):
        out.append(("blocking", "add-not-null-no-default",
                    "<addColumn> with nullable=\"false\" and no defaultValue* fails on a non-empty table. Add nullable, "
                    "backfill outside Liquibase, then enforce NOT NULL."))
    if VOLATILE_DEFAULT.search(text):
        out.append(("risk", "volatile-default",
                    "ADD COLUMN with a volatile DEFAULT (gen_random_uuid(), clock_timestamp(), random(), nextval()) "
                    "rewrites the whole table under ACCESS EXCLUSIVE. now()/CURRENT_TIMESTAMP and constants are fine. "
                    "Add the column without default, backfill in batches, then SET DEFAULT for new rows."))
    if re.search(r"\bALTER\s+COLUMN\s+\w+\s+SET\s+NOT\s+NULL\b|<addNotNullConstraint\b|addNotNullConstraint\s*:",
                 text, re.IGNORECASE):
        msg = ("SET NOT NULL scans the whole table under ACCESS EXCLUSIVE. On PG12+: ADD CONSTRAINT c CHECK (col IS NOT NULL) "
               "NOT VALID -> VALIDATE CONSTRAINT c (separate changeset) -> SET NOT NULL (now instant) -> DROP CONSTRAINT c.")
        if re.search(r"defaultNullValue", text, re.IGNORECASE):
            msg += " Also: defaultNullValue makes Liquibase run an UPDATE of every NULL row inside this transaction."
        out.append(("risk", "set-not-null-scan", msg))
    if re.search(r"\bALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE\b|<modifyDataType\b|modifyDataType\s*:", text, re.IGNORECASE):
        out.append(("risk", "alter-column-type",
                    "Changing a column type usually rewrites the table and its indexes under ACCESS EXCLUSIVE "
                    "(int->bigint, text->uuid, ...). Safe without rewrite: varchar(n)->varchar(bigger)/text. "
                    "Otherwise use expand/contract: new column, dual write, backfill, switch, drop old."))

    # --- destructive / breaking ---
    if re.search(r"\bDROP\s+COLUMN\b|<dropColumn\b|dropColumn\s*:", text, re.IGNORECASE):
        out.append(("risk", "drop-column",
                    "DROP COLUMN breaks the previous app version during a rolling deploy, and Hibernate fails "
                    "ddl-auto=validate or selects if the entity still maps it. First ship code that no longer reads/writes "
                    "the column (@Transient or removed), then drop in a later release."))
    if re.search(r"\bDROP\s+TABLE\b|<dropTable\b|dropTable\s*:", text, re.IGNORECASE):
        out.append(("risk", "drop-table",
                    "DROP TABLE is irreversible without a backup. Confirm no entity, native query or other service uses it, "
                    "and state the rollback plan in the PR."))
    if re.search(r"\bRENAME\s+(COLUMN\s+\w+\s+)?TO\b|<renameColumn\b|<renameTable\b|rename(Column|Table)\s*:",
                 text, re.IGNORECASE):
        out.append(("risk", "rename",
                    "A one-shot rename breaks every running instance of the previous version (and its @Column/@Table "
                    "mappings). Use expand/contract: add new, dual-write, backfill, switch reads, drop old."))

    # --- constraints ---
    if not creates_table:
        for s in stmts:
            if re.search(r"\bADD\s+(CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\b", s, re.IGNORECASE) \
                    and not re.search(r"\bNOT\s+VALID\b", s, re.IGNORECASE):
                out.append(("risk", "fk-without-not-valid",
                            "ADD FOREIGN KEY scans the child table while holding SHARE ROW EXCLUSIVE on BOTH tables. Use "
                            "`... NOT VALID`, then `VALIDATE CONSTRAINT` in a separate changeset. Index the FK column too."))
                break
        if re.search(r"<addForeignKeyConstraint\b|addForeignKeyConstraint\s*:", text, re.IGNORECASE):
            out.append(("risk", "fk-without-not-valid",
                        "<addForeignKeyConstraint> validates all existing rows under a lock on both tables. For a "
                        "non-empty table use formatted SQL with NOT VALID + a separate VALIDATE CONSTRAINT changeset."))
    for s in stmts:
        if re.search(r"\bADD\s+CONSTRAINT\s+\S+\s+CHECK\b", s, re.IGNORECASE) \
                and not re.search(r"\bNOT\s+VALID\b", s, re.IGNORECASE) and not creates_table:
            out.append(("risk", "check-without-not-valid",
                        "ADD CONSTRAINT ... CHECK scans every row under ACCESS EXCLUSIVE. Add it NOT VALID, then "
                        "VALIDATE CONSTRAINT in a later changeset."))
            break

    # --- data changes ---
    if re.search(r"^\s*(UPDATE\s+\w|DELETE\s+FROM\b)", text, re.IGNORECASE | re.MULTILINE) \
            or re.search(r"<update\b|<delete\b|^\s*-\s*(update|delete)\s*:", text, re.IGNORECASE | re.MULTILINE):
        out.append(("risk", "data-change-in-migration",
                    "UPDATE/DELETE inside a changeset runs in one transaction holding row locks for its whole duration, "
                    "and blocks app startup if Liquibase runs on boot. Small reference-data fixes are fine; anything "
                    "proportional to table size goes to a batched, restartable job."))

    # --- liquibase hygiene ---
    if fmt == "sql" and not re.search(r"^\s*--\s*rollback\b", body, re.IGNORECASE | re.MULTILINE):
        out.append(("note", "no-rollback",
                    "Formatted-SQL changeset without `--rollback`. Write the reverse statement, or "
                    "`--rollback not required` / an explicit note if the change is irreversible."))
    if fmt == "xml" and re.search(r"<sql\b|<sqlFile\b", body, re.IGNORECASE) \
            and not re.search(r"<rollback\b", body, re.IGNORECASE):
        out.append(("note", "no-rollback",
                    "<sql>/<sqlFile> has no automatic rollback. Add a <rollback> block or state that it is irreversible."))
    if re.search(r"validCheckSum", attrs_all, re.IGNORECASE):
        out.append(("risk", "valid-checksum",
                    "validCheckSum hides an edit to an already-applied changeset: environments that ran the old version "
                    "keep the old schema. Prefer a new changeset that moves the schema forward."))
    if re.search(r"runOnChange\s*[:=]\s*\"?true", attrs_all, re.IGNORECASE) \
            and not re.search(r"CREATE\s+(OR\s+REPLACE\s+)?(VIEW|FUNCTION|PROCEDURE|TRIGGER)|<createView|<createProcedure",
                              text, re.IGNORECASE):
        out.append(("risk", "run-on-change",
                    "runOnChange is for idempotent definitions (views, functions). On DDL/DML it re-runs the changeset "
                    "on every edit."))
    alters_existing = re.search(r"\bALTER\s+TABLE\b", text, re.IGNORECASE) or (plain_index and not creates_table)
    if alters_existing and not re.search(r"lock_timeout", text, re.IGNORECASE):
        out.append(("note", "no-lock-timeout",
                    "DDL on an existing table waits for ACCESS EXCLUSIVE; while it waits, every query on that table queues "
                    "behind it. Start the changeset with `SET LOCAL lock_timeout = '5s';` (or set lock_timeout on the "
                    "migration role) so it fails fast and can be retried instead of stalling production."))
    return out


def main():
    payload = read_payload()
    if not payload:
        return
    path = file_path(payload)
    content = current_content(payload)
    if not path or not content.strip() or not is_migration(path, content):
        return
    original = original_content(payload, content)

    lower = path.lower()
    fmt = "xml" if lower.endswith(".xml") else ("yaml" if lower.endswith((".yaml", ".yml")) else "sql")
    current_sets = split_changesets(content)
    original_sets = split_changesets(original) if original else OrderedDict()

    merged = OrderedDict()  # (severity, rule) -> [changeset keys] + message

    def add(severity, rule, message, key):
        k = (severity, rule)
        if k not in merged:
            merged[k] = [message, []]
        if key and key not in merged[k][1]:
            merged[k][1].append(key)

    if current_sets:
        for key, (attrs, body) in current_sets.items():
            old = original_sets.get(key)
            if old is not None and norm_body(old[1]) == norm_body(body) and old[0] == attrs:
                continue  # untouched changeset
            if old is not None:
                add("blocking", "edited-existing-changeset",
                    "An existing changeset was modified. If it has run on ANY environment, Liquibase fails startup "
                    "with a checksum ValidationFailedException there, and the environments diverge. Revert the edit and "
                    "add a new changeset instead (editing is fine only if the changeset never left your machine).", key)
            for severity, rule, msg in check_changeset(attrs, body, fmt):
                add(severity, rule, msg, key)
    else:
        if original is not None and original.strip() and original != content \
                and re.match(r"^V\d", os.path.basename(path)):
            add("blocking", "edited-existing-changeset",
                "A versioned migration file was modified. If it has been applied anywhere, the checksum check fails "
                "there. Add a new migration instead.", None)
        # Not changeset-structured (Flyway-style plain SQL): no Liquibase rollback rules.
        for severity, rule, msg in check_changeset("", content, "plain"):
            add(severity, rule, msg, None)

    findings = []
    for (severity, rule), (msg, keys) in merged.items():
        if keys:
            msg = "{} (changeset {})".format(msg, ", ".join(keys))
        findings.append((severity, rule, msg))
    emit("migration-safety", path, findings,
         "See skills/migration-safety. Run `/backend-design-java:review-migration {}` for a full review.".format(
             os.path.basename(path)))


if __name__ == "__main__":
    run(main)
