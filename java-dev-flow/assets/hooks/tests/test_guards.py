"""Tests for evidence_guard.py and tdd_guard.py. Run from assets/hooks: python3 -m unittest discover -s tests"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HOOKS)
import evidence_guard as eg  # noqa: E402
import tdd_guard as tg  # noqa: E402

MVN_FAIL = ("[INFO] Running com.acme.DiscountPolicyTest\n"
            "[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0 <<< FAILURE! - in com.acme.DiscountPolicyTest\n"
            "[ERROR] com.acme.DiscountPolicyTest.appliesDiscountAbove2000:31 expected: 1800 but was: 2000\n"
            "[ERROR] BUILD FAILURE\n")
MVN_DOCKER = ("[ERROR] OrderIntegrationTest » IllegalState Could not find a valid Docker environment\n"
              "[ERROR] Tests run: 30, Failures: 0, Errors: 12, Skipped: 0\n[ERROR] BUILD FAILURE\n")
MVN_OK = "[INFO] Tests run: 42, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS\n"
MVN_SKIPPED = "[WARNING] Tests run: 42, Failures: 0, Errors: 0, Skipped: 12\n[INFO] BUILD SUCCESS\n"


def human(text, uuid="u1"):
    return {"type": "user", "uuid": uuid, "timestamp": "2026-10-04T10:00:00.000Z",
            "message": {"role": "user", "content": text}}


def bash(command, tid):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": tid, "name": "Bash", "input": {"command": command}}]}}


def edit(path, tid):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": tid, "name": "Edit", "input": {"file_path": path, "old_string": "a", "new_string": "b"}}]}}


def result(tid, text, is_error=False):
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tid, "content": text, "is_error": is_error}]}}


def say(text):
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}


class Harness(object):
    def __init__(self, script, state_var):
        self.dir = tempfile.mkdtemp(prefix="guard-")
        self.script = os.path.join(HOOKS, script)
        self.state_var = state_var

    def run(self, entries, **payload):
        transcript = os.path.join(self.dir, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as f:
            f.write("\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n")
        data = {"session_id": "s1", "transcript_path": transcript, "cwd": self.dir}
        data.update(payload)
        env = dict(os.environ)
        env[self.state_var] = os.path.join(self.dir, "state")
        for name in ("EVIDENCE_GUARD", "TDD_GUARD"):
            env.pop(name, None)
        env.update(payload.pop("_env", {}) if "_env" in payload else {})
        proc = subprocess.run([sys.executable, self.script], input=json.dumps(data, ensure_ascii=False),
                              capture_output=True, text=True, env=env, timeout=30)
        assert proc.returncode == 0, proc.stderr
        return json.loads(proc.stdout) if proc.stdout.strip() else None

    def cleanup(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class EvidenceUnitTests(unittest.TestCase):
    def test_detects_test_runs(self):
        self.assertTrue(eg.is_test_run("./mvnw -q test"))
        self.assertTrue(eg.is_test_run("mvn verify"))
        self.assertTrue(eg.is_test_run("cd svc && ./gradlew check"))
        self.assertTrue(eg.is_test_run('"/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn" test'))
        self.assertTrue(eg.is_test_run("./mvnw -q test -Dtest=FooTest -Dsurefire.failIfNoSpecifiedTests=false"))

    def test_ignores_non_test_commands(self):
        self.assertFalse(eg.is_test_run("./mvnw -q -DskipTests compile"))
        self.assertFalse(eg.is_test_run("./mvnw -q -DskipTests package"))
        self.assertFalse(eg.is_test_run("./gradlew build -x test"))
        self.assertFalse(eg.is_test_run("git status"))
        self.assertFalse(eg.is_test_run("grep -r test src"))

    def test_diagnose(self):
        self.assertIn("failed", eg.diagnose(MVN_FAIL, True))
        self.assertIn("Docker", eg.diagnose(MVN_DOCKER, True))
        self.assertIn("tests skipped: 12", eg.diagnose(MVN_SKIPPED, False))
        self.assertIsNone(eg.diagnose(MVN_OK, False))

    def test_failed_test_lines(self):
        lines = eg.failed_tests(MVN_FAIL)
        self.assertTrue(any("appliesDiscountAbove2000" in line for line in lines))

    def test_ack_words(self):
        self.assertTrue(eg.ACK_RE.search("Полный прогон упал: 12 тестов не запускались — нет Docker"))
        self.assertTrue(eg.ACK_RE.search("Integration tests did not run: Docker is not available"))
        self.assertTrue(eg.ACK_RE.search("Full run: 4 tests failed (unrelated, outbox WIP)"))
        self.assertFalse(eg.ACK_RE.search("Готово. Тесты DiscountPolicy зелёные (5/5). Тест был красным: expected 1800"))


class EvidenceHookTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness("evidence_guard.py", "EVIDENCE_GUARD_STATE_DIR")

    def tearDown(self):
        self.h.cleanup()

    def turn(self, output, is_error, final):
        return [human("подними порог"), bash("./mvnw test", "b1"), result("b1", output, is_error), say(final)]

    def test_blocks_when_failed_run_is_hidden(self):
        out = self.h.run(self.turn(MVN_FAIL, True, "Готово, тесты DiscountPolicy зелёные."),
                         last_assistant_message="Готово, тесты DiscountPolicy зелёные.")
        self.assertEqual(out["decision"], "block")
        self.assertIn("./mvnw test", out["reason"])
        self.assertIn("appliesDiscountAbove2000", out["reason"])

    def test_blocks_when_docker_missing_is_hidden(self):
        out = self.h.run(self.turn(MVN_DOCKER, True, "Сделано, unit-тесты проходят."))
        self.assertEqual(out["decision"], "block")
        self.assertIn("Docker", out["reason"])

    def test_passes_when_report_names_failure(self):
        final = "Unit-тесты зелёные; 12 интеграционных не запускались — нет Docker."
        self.assertIsNone(self.h.run(self.turn(MVN_DOCKER, True, final), last_assistant_message=final))

    def test_passes_when_last_run_green(self):
        entries = [human("x"), bash("./mvnw test", "b1"), result("b1", MVN_FAIL, True),
                   bash("./mvnw test", "b2"), result("b2", MVN_OK), say("Готово, 42 теста зелёные.")]
        self.assertIsNone(self.h.run(entries))

    def test_blocks_when_single_test_hides_red_full_run(self):
        # S-cycle 2026-10-04: full run failed, then only DiscountPolicyTest was rerun and reported green
        entries = [human("x"), bash("./mvnw test 2>&1 | tail -20", "b1"), result("b1", MVN_FAIL, True),
                   bash("./mvnw -q test -Dtest='DiscountPolicyTest'", "b2"), result("b2", MVN_OK),
                   say("Готово! DiscountPolicyTest успешно прошёл ✓")]
        out = self.h.run(entries)
        self.assertEqual(out["decision"], "block")
        self.assertIn("./mvnw test 2>&1", out["reason"])

    def test_red_single_test_before_green_full_run_passes(self):
        entries = [human("x"), bash("./mvnw test -Dtest=DiscountPolicyTest", "b1"), result("b1", MVN_FAIL, True),
                   bash("./mvnw test", "b2"), result("b2", MVN_OK), say("Готово, 42 теста зелёные.")]
        self.assertIsNone(self.h.run(entries))

    def test_blocks_on_skipped_tests_silence(self):
        self.assertEqual(self.h.run(self.turn(MVN_SKIPPED, False, "Готово."))["decision"], "block")

    def test_ignores_runs_from_previous_prompt(self):
        entries = [human("x", "u0"), bash("./mvnw test", "b1"), result("b1", MVN_FAIL, True),
                   human("теперь просто ответь", "u1"), say("Ответ.")]
        self.assertIsNone(self.h.run(entries))

    def test_stop_hook_active_passes(self):
        self.assertIsNone(self.h.run(self.turn(MVN_FAIL, True, "Готово."), stop_hook_active=True))

    def test_env_off_passes(self):
        self.assertIsNone(self.h.run(self.turn(MVN_FAIL, True, "Готово."), _env={"EVIDENCE_GUARD": "off"}))

    def test_reminds_once_per_prompt(self):
        entries = self.turn(MVN_FAIL, True, "Готово.")
        self.assertIsNotNone(self.h.run(entries))
        self.assertIsNone(self.h.run(entries))

    def test_no_test_run_passes(self):
        self.assertIsNone(self.h.run([human("x"), bash("git status", "b1"), result("b1", "clean"), say("ok")]))


class TddUnitTests(unittest.TestCase):
    def test_main_and_test_paths(self):
        self.assertTrue(tg.MAIN_RE.search("/p/src/main/java/com/acme/DiscountPolicy.java"))
        self.assertFalse(tg.MAIN_RE.search("/p/src/main/resources/application.yml"))
        self.assertTrue(tg.TEST_FILE_RE.search("/p/src/test/java/com/acme/DiscountPolicyTest.java"))
        self.assertTrue(tg.TEST_FILE_RE.search("/p/module/src/it/java/FooIT.java"))
        self.assertFalse(tg.TEST_FILE_RE.search("/p/src/main/java/com/acme/Testing.java"))


class TddHookTests(unittest.TestCase):
    MAIN = "/p/src/main/java/com/acme/DiscountPolicy.java"
    TEST = "/p/src/test/java/com/acme/DiscountPolicyTest.java"

    def setUp(self):
        self.h = Harness("tdd_guard.py", "TDD_GUARD_STATE_DIR")

    def tearDown(self):
        self.h.cleanup()

    def fire(self, entries, path=None, tool="Edit"):
        return self.h.run(entries, tool_name=tool, tool_input={"file_path": path or self.MAIN})

    def test_warns_when_code_follows_test_without_run(self):
        out = self.fire([human("x"), edit(self.TEST, "e1"), result("e1", "ok"), edit(self.MAIN, "e2")])
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "PostToolUse")
        self.assertIn("RED", ctx)
        self.assertIn("DiscountPolicy.java", ctx)

    def test_silent_after_red_run(self):
        entries = [human("x"), edit(self.TEST, "e1"), result("e1", "ok"),
                   bash("./mvnw -q test -Dtest=DiscountPolicyTest", "b1"), result("b1", MVN_FAIL, True),
                   edit(self.MAIN, "e2")]
        self.assertIsNone(self.fire(entries))

    def test_green_run_is_not_red(self):
        entries = [human("x"), edit(self.TEST, "e1"), result("e1", "ok"),
                   bash("./mvnw -q test -Dtest=DiscountPolicyTest", "b1"), result("b1", MVN_OK),
                   edit(self.MAIN, "e2")]
        self.assertIsNotNone(self.fire(entries))

    def test_compile_error_is_not_red(self):
        compile_err = "[ERROR] COMPILATION ERROR :\n[ERROR] cannot find symbol\n[ERROR] BUILD FAILURE\n"
        entries = [human("x"), edit(self.TEST, "e1"), result("e1", "ok"),
                   bash("./mvnw -q test", "b1"), result("b1", compile_err, True), edit(self.MAIN, "e2")]
        self.assertIsNotNone(self.fire(entries))

    def test_new_test_edit_requires_new_red(self):
        entries = [human("x"), edit(self.TEST, "e1"), bash("./mvnw test", "b1"), result("b1", MVN_FAIL, True),
                   edit(self.MAIN, "e2"), edit(self.TEST, "e3"), edit(self.MAIN, "e4")]
        self.assertIsNotNone(self.fire(entries))

    def test_warns_once_per_test_edit(self):
        entries = [human("x"), edit(self.TEST, "e1"), edit(self.MAIN, "e2")]
        self.assertIsNotNone(self.fire(entries))
        self.assertIsNone(self.fire(entries + [edit(self.MAIN, "e3")]))

    def test_no_test_in_session_warns_once(self):
        out = self.fire([human("x"), edit(self.MAIN, "e1")])
        self.assertIn("no test was edited", out["hookSpecificOutput"]["additionalContext"])
        self.assertIsNone(self.fire([human("x"), edit(self.MAIN, "e1"), edit(self.MAIN, "e2")]))

    def test_ignores_non_main_files(self):
        self.assertIsNone(self.fire([human("x")], path=self.TEST))
        self.assertIsNone(self.fire([human("x")], path="/p/src/main/resources/application.yml"))
        self.assertIsNone(self.fire([human("x")], path="/p/README.md"))

    def test_ignores_other_tools(self):
        self.assertIsNone(self.fire([human("x")], tool="Read"))

    def test_env_off(self):
        self.assertIsNone(self.h.run([human("x")], tool_name="Edit", tool_input={"file_path": self.MAIN},
                                     _env={"TDD_GUARD": "off"}))


if __name__ == "__main__":
    unittest.main()
