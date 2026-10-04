"""Tests for critic_gate.py. Run from assets/hooks: python3 -m unittest discover -s tests"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HOOKS)
import critic_gate as cg  # noqa: E402

SCRIPT = os.path.join(HOOKS, "critic_gate.py")


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def human(text, ts, uuid="u1"):
    return {"type": "user", "uuid": uuid, "timestamp": iso(ts), "message": {"role": "user", "content": text}}


def tool_use(name, tool_input, tid="t1"):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": tid, "name": name, "input": tool_input}]}}


def tool_result(tid="t1", text="ok"):
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tid, "content": text}]}}


class Repo(object):
    """A temporary git repository with a base commit and a transcript."""

    def __init__(self, git=True):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="cg-repo-"))
        self.state = tempfile.mkdtemp(prefix="cg-state-")
        self.git = git
        if git:
            self.run("git", "init", "-q")
            self.run("git", "config", "user.email", "t@t")
            self.run("git", "config", "user.name", "t")
            self.write("src/main/java/com/acme/Base.java", "class Base {}\n")
            self.run("git", "add", "-A")
            self.run("git", "commit", "-q", "-m", "base")
        self.prompt_ts = time.time() - 30
        self.entries = [human("сделай фичу", self.prompt_ts)]

    def run(self, *args):
        subprocess.run(args, cwd=self.root, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def write(self, rel, text, mtime=None):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def java(self, rel, lines=5):
        body = "".join("    int f%d = %d;\n" % (i, i) for i in range(lines))
        return self.write(rel, "class X {\n" + body + "}\n")

    def hook(self, extra_env=None, **payload):
        transcript = os.path.join(self.state, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as f:
            for entry in self.entries:
                f.write(json.dumps(entry) + "\n")
        data = {"session_id": "s1", "transcript_path": transcript, "cwd": self.root, "stop_hook_active": False}
        data.update(payload)
        env = dict(os.environ, CRITIC_GATE_STATE_DIR=self.state)
        env.pop("CRITIC_GATE", None)
        env.update(extra_env or {})
        proc = subprocess.run([sys.executable, SCRIPT], input=json.dumps(data), cwd=self.root,
                              capture_output=True, text=True, env=env, timeout=30)
        self.last_rc = proc.returncode
        return json.loads(proc.stdout) if proc.stdout.strip() else None

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)
        shutil.rmtree(self.state, ignore_errors=True)


class UnitTests(unittest.TestCase):
    def test_human_prompt_plain_text(self):
        self.assertTrue(cg.is_human_prompt(human("привет", time.time())))

    def test_tool_result_is_not_human(self):
        self.assertFalse(cg.is_human_prompt(tool_result()))

    def test_system_prefix_is_not_human(self):
        self.assertFalse(cg.is_human_prompt(human("<task-notification>done</task-notification>", time.time())))

    def test_origin_kind_wins(self):
        entry = human("text", time.time())
        entry["origin"] = {"kind": "hook"}
        self.assertFalse(cg.is_human_prompt(entry))

    def test_meta_is_not_human(self):
        entry = human("text", time.time())
        entry["isMeta"] = True
        self.assertFalse(cg.is_human_prompt(entry))

    def test_is_critic_accepts_plugin_prefix_only(self):
        self.assertTrue(cg.is_critic("critic"))
        self.assertTrue(cg.is_critic("java-dev-flow:critic"))
        self.assertFalse(cg.is_critic("critic-lite"))
        self.assertFalse(cg.is_critic(None))

    def test_count_lines(self):
        self.assertEqual(cg.count_lines("a\nb\n"), 2)
        self.assertEqual(cg.count_lines("a\nb"), 2)
        self.assertEqual(cg.count_lines(""), 0)

    def test_edit_size_for_each_tool(self):
        self.assertEqual(cg.edit_size("Write", {"file_path": "/r/A.java", "content": "a\nb\nc\n"}, "/r")[1], 3)
        self.assertEqual(cg.edit_size("Edit", {"file_path": "A.java", "old_string": "a", "new_string": "a\nb"}, "/r"),
                         (os.path.realpath("/r/A.java"), 2))
        multi = {"file_path": "/r/A.java", "edits": [{"old_string": "a", "new_string": "b"}, {"old_string": "x\ny", "new_string": "z"}]}
        self.assertEqual(cg.edit_size("MultiEdit", multi, "/r")[1], 3)

    def test_production_classification(self):
        self.assertTrue(cg.is_production("src/main/java/com/acme/OrderService.java"))
        self.assertTrue(cg.is_production("src/main/resources/application.yml"))
        self.assertFalse(cg.is_production("src/test/java/com/acme/OrderServiceTest.java"))
        self.assertFalse(cg.is_production("src/main/java/com/acme/OrderIT.java"))
        self.assertFalse(cg.is_production("README.md"))
        self.assertFalse(cg.is_production("target/classes/A.java"))
        self.assertFalse(cg.is_production(".claude/skills/x/run.py"))
        self.assertFalse(cg.is_production("package-lock.json"))

    def test_migration_and_security_patterns(self):
        self.assertTrue(cg.MIGRATION_RE.search("src/main/resources/db/changelog/2026-10-03-007-x.yml"))
        self.assertTrue(cg.MIGRATION_RE.search("src/main/resources/db/migration/V1__init.sql"))
        self.assertFalse(cg.MIGRATION_RE.search("src/main/java/com/acme/OrderService.java"))
        self.assertTrue(cg.SECURITY_RE.search("src/main/java/com/acme/SecurityConfig.java"))
        self.assertTrue(cg.SECURITY_RE.search("src/main/java/com/acme/JwtFilter.java"))
        self.assertFalse(cg.SECURITY_RE.search("src/main/java/com/acme/Author.java"))

    def test_trivial_lines(self):
        prefixes = cg.trivial_prefixes("src/main/java/A.java")
        self.assertTrue(cg.is_trivial_line("import java.util.List;", prefixes))
        self.assertTrue(cg.is_trivial_line("   // comment", prefixes))
        self.assertTrue(cg.is_trivial_line("   ", prefixes))
        self.assertFalse(cg.is_trivial_line("int x = 1;", prefixes))

    def test_parse_ts_with_zone(self):
        self.assertEqual(cg.parse_ts("2026-10-03T10:00:00Z"), cg.parse_ts("2026-10-03T13:00:00+03:00"))
        self.assertIsNone(cg.parse_ts("yesterday"))

    def test_header_path(self):
        self.assertEqual(cg.header_path("diff --git a/src/A.java b/src/A.java"), "src/A.java")
        self.assertIsNone(cg.header_path("diff --git a/x b/y"))

    def test_read_turn_sees_only_current_prompt(self):
        state = tempfile.mkdtemp()
        try:
            now = time.time()
            entries = [human("старый запрос", now - 100, "u0"), tool_use("Agent", {"subagent_type": "critic"}, "a0"),
                       human("новый запрос", now - 10, "u1"),
                       tool_use("Write", {"file_path": "/r/A.java", "content": "a\nb\n"}, "w1")]
            path = os.path.join(state, "t.jsonl")
            with open(path, "w") as f:
                f.write("\n".join(json.dumps(e) for e in entries))
            turn = cg.read_turn(path, "/r")
            self.assertFalse(turn.critic_launched)
            self.assertEqual(turn.prompt_id, "u1")
            self.assertEqual(list(turn.edits.values()), [2])
        finally:
            shutil.rmtree(state)


class HookTests(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()

    def tearDown(self):
        self.repo.cleanup()

    def four_files(self):
        for name in ("A", "B", "C", "D"):
            self.repo.java("src/main/java/com/acme/%s.java" % name)

    def test_blocks_on_four_production_files_written_via_shell(self):
        self.four_files()  # edits bypassing Edit/Write: as if via Bash or a subagent
        out = self.repo.hook()
        self.assertEqual(out["decision"], "block")
        self.assertIn("critic", out["reason"])
        self.assertIn("src/main/java/com/acme/A.java", out["reason"])

    def test_small_change_passes(self):
        self.repo.java("src/main/java/com/acme/A.java")
        self.repo.java("src/main/java/com/acme/B.java")
        self.assertIsNone(self.repo.hook())

    def test_migration_alone_blocks(self):
        self.repo.write("src/main/resources/db/changelog/007-add-column.yml", "databaseChangeLog:\n  - changeSet:\n      id: 7\n")
        out = self.repo.hook()
        self.assertEqual(out["decision"], "block")
        self.assertIn("007-add-column.yml", out["reason"])

    def test_line_threshold_blocks_single_big_file(self):
        self.repo.java("src/main/java/com/acme/Big.java", lines=200)
        self.assertEqual(self.repo.hook()["decision"], "block")

    def test_stop_hook_active_passes(self):
        self.four_files()
        self.assertIsNone(self.repo.hook(stop_hook_active=True))

    def test_env_off_passes(self):
        self.four_files()
        self.assertIsNone(self.repo.hook(extra_env={"CRITIC_GATE": "off"}))

    def test_critic_launched_in_turn_passes(self):
        self.four_files()
        self.repo.entries.append(tool_use("Agent", {"subagent_type": "critic", "prompt": "..."}, "a1"))
        self.assertIsNone(self.repo.hook())

    def test_reminds_once_per_prompt(self):
        self.four_files()
        self.assertIsNotNone(self.repo.hook())
        self.assertIsNone(self.repo.hook())

    def test_new_prompt_resets_reminder(self):
        self.four_files()
        self.assertIsNotNone(self.repo.hook())
        self.repo.prompt_ts = time.time() - 5
        self.repo.entries.append(human("ещё", self.repo.prompt_ts, "u2"))
        for name in ("E", "F", "G", "H"):
            self.repo.java("src/main/java/com/acme/%s.java" % name)
        self.assertIsNotNone(self.repo.hook())

    def test_tests_and_docs_do_not_count(self):
        for name in ("A", "B", "C", "D"):
            self.repo.java("src/test/java/com/acme/%sTest.java" % name)
        self.repo.write("docs/design.md", "# x\n" * 300)
        self.assertIsNone(self.repo.hook())

    def test_comment_only_change_in_tracked_file_does_not_count(self):
        for name in ("A", "B", "C", "D"):
            self.repo.java("src/main/java/com/acme/%s.java" % name)
        self.repo.run("git", "add", "-A")
        self.repo.run("git", "commit", "-q", "-m", "more")
        old = time.time() - 300
        for name in ("A", "B", "C", "D"):
            path = os.path.join(self.repo.root, "src/main/java/com/acme/%s.java" % name)
            os.utime(path, (old, old))
        for name in ("A", "B", "C", "D"):
            path = os.path.join(self.repo.root, "src/main/java/com/acme/%s.java" % name)
            with open(path, "a") as f:
                f.write("// comment only\n\n")
        self.assertIsNone(self.repo.hook())

    def test_generated_files_ignored(self):
        for name in ("A", "B", "C", "D"):
            self.repo.write("src/main/java/com/acme/%s.java" % name, "// Code generated by protoc. DO NOT EDIT.\nclass %s { int x; }\n" % name)
        self.assertIsNone(self.repo.hook())

    def test_files_inside_skill_package_ignored(self):
        self.repo.write("tools/my-skill/SKILL.md", "---\nname: x\n---\n")
        for name in ("a", "b", "c", "d"):
            self.repo.write("tools/my-skill/scripts/%s.py" % name, "x = 1\ny = 2\n")
        self.assertIsNone(self.repo.hook())

    def test_files_changed_before_prompt_ignored(self):
        old = self.repo.prompt_ts - 120
        for name in ("A", "B", "C", "D"):
            path = self.repo.java("src/main/java/com/acme/%s.java" % name)
            os.utime(path, (old, old))
        self.assertIsNone(self.repo.hook())

    def test_malformed_stdin_is_silent(self):
        proc = subprocess.run([sys.executable, SCRIPT], input="not json", capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout.strip(), "")

    def test_missing_transcript_is_silent(self):
        self.four_files()
        self.assertIsNone(self.repo.hook(transcript_path="/nonexistent/t.jsonl"))
        self.assertEqual(self.repo.last_rc, 0)


class NoGitTests(unittest.TestCase):
    def test_walk_mode_blocks_on_new_files(self):
        repo = Repo(git=False)
        try:
            for name in ("A", "B", "C", "D"):
                repo.java("src/main/java/com/acme/%s.java" % name)
            out = repo.hook()
            self.assertEqual(out["decision"], "block")
        finally:
            repo.cleanup()


if __name__ == "__main__":
    unittest.main()
