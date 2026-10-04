import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import collect_change as cc  # noqa: E402


PROPOSAL = """\
# Proposal

## Why

Клиенты не могут отменить оплаченный заказ.

## What Changes

- Отмена заказа в статусе PAID с возвратом денег

## Capabilities

### New Capabilities
- `order-refunds`: возвраты по заказу

### Modified Capabilities
- `order-lifecycle`: отмена PAID теперь создаёт возврат

## Impact

Маршрут: фича · M · сигналы: платёж, вебхук → idempotency-and-side-effects
"""

BASE_LIFECYCLE = """\
# order-lifecycle Specification

## Purpose

Жизненный цикл заказа: создание, оплата, отмена.

## Requirements

### Requirement: Cancel order
The system SHALL cancel an order in status NEW.

#### Scenario: Cancel NEW order
- **WHEN** POST /orders/1/cancel for order in NEW
- **THEN** 200 and status `CANCELLED`

#### Scenario: Cancel foreign order
- **WHEN** POST /orders/1/cancel for order of another customer
- **THEN** 404 `ORDER_NOT_FOUND`

### Requirement: Create order
The system SHALL create an order.

#### Scenario: Create
- **WHEN** POST /orders
- **THEN** 201
"""

DELTA_LIFECYCLE = """\
# Spec Delta

## MODIFIED Requirements

### Requirement: Cancel order
The system SHALL cancel an order in status NEW or PAID.

#### Scenario: Cancel NEW order
- **WHEN** POST /orders/1/cancel for order in NEW
- **THEN** 200 and status `CANCELLED`

#### Scenario: Cancel PAID order
- **WHEN** POST /orders/1/cancel for order in PAID
- **THEN** 200 and status `REFUNDING`
"""

DELTA_REFUNDS = """\
# Spec Delta

## Purpose

Возвраты денег клиенту по оплаченному заказу, полные и частичные.

## ADDED Requirements

### Requirement: Refund paid order
The system SHALL create a refund for a PAID order.

#### Scenario: Full refund
- **WHEN** POST /orders/1/refunds without amount
- **THEN** 202 and refund `PENDING` for the remaining amount
"""

TASKS = """\
# Tasks

## 1. Возвраты

- [ ] 1.1 Сценарий «Full refund» — @WebMvcTest — проверка: `RefundControllerTest#fullRefund`
- [ ] 1.2 Сценарий «Cancel PAID order» — @SpringBootTest + Testcontainers — проверка: `OrderCancelTest#paid`

## 2. Проверка

- [ ] 2.1 Полный прогон `./mvnw verify` — 0 упавших
"""

DESIGN = "# Design\n\n## Context\n\nendpoint\n"


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text), encoding="utf-8")
    return path


def make_project(root: Path, *, tasks=TASKS, design=DESIGN, proposal=PROPOSAL,
                 delta_lifecycle=DELTA_LIFECYCLE, delta_refunds=DELTA_REFUNDS,
                 config="schema: spec-driven\ncontext: |\n  java-dev-flow\n") -> Path:
    write(root, "openspec/config.yaml", config)
    write(root, "openspec/specs/order-lifecycle/spec.md", BASE_LIFECYCLE)
    change = root / "openspec/changes/cancel-paid-order"
    write(root, "openspec/changes/cancel-paid-order/.openspec.yaml",
          "schema: spec-driven\ncreated: 2026-10-03\n")
    if proposal is not None:
        write(change, "proposal.md", proposal)
    if design is not None:
        write(change, "design.md", design)
    if tasks is not None:
        write(change, "tasks.md", tasks)
    if delta_lifecycle is not None:
        write(change, "specs/order-lifecycle/spec.md", delta_lifecycle)
    if delta_refunds is not None:
        write(change, "specs/order-refunds/spec.md", delta_refunds)
    return change


def codes(result, level=None):
    return [i["code"] for i in result["issues"] if level is None or i["level"] == level]


def issue(result, code):
    found = [i for i in result["issues"] if i["code"] == code]
    assert found, f"no finding {code}: {codes(result)}"
    return found[0]


class ResolveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_delta_spec_path_resolves_to_its_change(self):
        change = make_project(self.root)
        result = cc.collect(str(change / "specs/order-lifecycle/spec.md"))
        self.assertEqual(result["mode"], "change")
        self.assertEqual(result["change"]["name"], "cancel-paid-order")
        self.assertEqual(result["focus_spec"],
                         "openspec/changes/cancel-paid-order/specs/order-lifecycle/spec.md")
        self.assertEqual(result["project_root"], str(self.root))

    def test_change_name_resolves_from_cwd(self):
        make_project(self.root)
        result = cc.collect("cancel-paid-order", cwd=str(self.root / "src"))
        self.assertEqual(result["mode"], "change")
        self.assertEqual(result["change"]["name"], "cancel-paid-order")

    def test_main_spec_with_one_change_resolves_to_that_change(self):
        make_project(self.root)
        result = cc.collect(str(self.root / "openspec/specs/order-lifecycle/spec.md"))
        self.assertEqual(result["mode"], "change")
        self.assertEqual(result["change"]["name"], "cancel-paid-order")
        self.assertIn("openspec/specs/order-lifecycle/spec.md", result["resolved_via"])

    def test_main_spec_with_two_changes_is_ambiguous(self):
        make_project(self.root)
        write(self.root, "openspec/changes/other/specs/order-lifecycle/spec.md", DELTA_LIFECYCLE)
        result = cc.collect(str(self.root / "openspec/specs/order-lifecycle/spec.md"))
        self.assertEqual(result["mode"], "ambiguous")
        self.assertEqual(sorted(result["candidates"]), ["cancel-paid-order", "other"])

    def test_main_spec_without_changes_is_reviewed_alone(self):
        write(self.root, "openspec/specs/order-lifecycle/spec.md", BASE_LIFECYCLE)
        result = cc.collect(str(self.root / "openspec/specs/order-lifecycle/spec.md"))
        self.assertEqual(result["mode"], "main-spec")
        self.assertEqual(len(result["specs"]), 1)
        self.assertEqual(len(result["specs"][0]["requirements"]), 2)

    def test_archived_change_is_marked(self):
        write(self.root, "openspec/changes/archive/2026-01-01-old/proposal.md", PROPOSAL)
        result = cc.collect(str(self.root / "openspec/changes/archive/2026-01-01-old/proposal.md"))
        self.assertEqual(result["mode"], "change")
        self.assertTrue(result["change"]["archived"])

    def test_no_openspec_root_is_an_error(self):
        with self.assertRaises(cc.ResolveError):
            cc.collect(str(self.root))


class SpecRulesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def run_with_refunds(self, delta_refunds):
        change = make_project(self.root, delta_refunds=delta_refunds)
        return cc.collect(str(change))

    def test_clean_change_has_no_errors(self):
        result = cc.collect(str(make_project(self.root)))
        self.assertEqual(codes(result, "error"), [])

    def test_scenario_with_three_hashes_is_an_error(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace("#### Scenario", "### Scenario"))
        self.assertIn("scenario-heading", codes(result, "error"))
        self.assertIn("req-no-scenario", codes(result, "error"))

    def test_bad_scenario_heading_does_not_leak_into_previous_scenario(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace(
            "- **THEN** 202 and refund `PENDING` for the remaining amount\n",
            "\n### Scenario: Refund twice\n- **WHEN** same request again\n- **THEN** 200 and the same refund `id`\n"))
        self.assertIn("scenario-heading", codes(result, "error"))
        self.assertIn("scenario-no-then", codes(result))

    def test_requirement_without_shall_or_must_is_an_error(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace("SHALL", "should"))
        self.assertIn("req-no-shall-must", codes(result, "error"))

    def test_scenario_without_then_is_flagged(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace(
            "- **THEN** 202 and refund `PENDING` for the remaining amount\n", ""))
        self.assertIn("scenario-no-then", codes(result))

    def test_vague_then_is_a_hint_and_concrete_then_is_not(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace(
            "202 and refund `PENDING` for the remaining amount", "возврат создаётся корректно"))
        self.assertIn("scenario-vague", codes(result, "hint"))

    def test_concrete_then_is_not_vague(self):
        result = cc.collect(str(make_project(self.root)))
        self.assertNotIn("scenario-vague", codes(result))

    def test_modified_header_missing_in_base_is_an_error(self):
        change = make_project(self.root, delta_lifecycle=DELTA_LIFECYCLE.replace(
            "### Requirement: Cancel order", "### Requirement: Cancel any order"))
        result = cc.collect(str(change))
        self.assertIn("delta-header-not-found", codes(result, "error"))

    def test_modified_that_drops_base_scenario_is_warned(self):
        result = cc.collect(str(make_project(self.root)))
        lost = issue(result, "modified-lost-scenario")
        self.assertIn("Cancel foreign order", lost["message"])

    def test_added_requirement_that_exists_in_base_is_an_error(self):
        change = make_project(self.root, delta_lifecycle="""\
            # Spec Delta

            ## ADDED Requirements

            ### Requirement: Create order
            The system SHALL create an order.

            #### Scenario: Create
            - **WHEN** POST /orders
            - **THEN** 201
            """)
        result = cc.collect(str(change))
        self.assertIn("added-exists-in-base", codes(result, "error"))

    def test_removed_without_reason_is_warned(self):
        change = make_project(self.root, delta_lifecycle="""\
            # Spec Delta

            ## REMOVED Requirements

            ### Requirement: Create order
            """)
        result = cc.collect(str(change))
        self.assertIn("removed-no-reason", codes(result, "warn"))
        self.assertNotIn("req-no-scenario", codes(result))

    def test_renamed_from_missing_in_base_is_an_error(self):
        change = make_project(self.root, delta_lifecycle="""\
            # Spec Delta

            ## RENAMED Requirements

            - FROM: `### Requirement: Missing one`
            - TO: `### Requirement: New name`
            """)
        result = cc.collect(str(change))
        self.assertIn("delta-header-not-found", codes(result, "error"))

    def test_new_capability_without_purpose_is_warned(self):
        result = self.run_with_refunds(DELTA_REFUNDS.replace(
            "## Purpose\n\nВозвраты денег клиенту по оплаченному заказу, полные и частичные.\n\n", ""))
        self.assertIn("purpose-missing", codes(result, "warn"))

    def test_spec_without_delta_sections_is_an_error(self):
        result = self.run_with_refunds("# Spec Delta\n\nтекст без разделов\n")
        self.assertIn("no-delta-sections", codes(result, "error"))

    def test_leftover_template_comment_is_reported(self):
        change = make_project(self.root, design="# Design\n\n## Context\n\n<!-- Тип компонента -->\n")
        result = cc.collect(str(change))
        self.assertIn("placeholder", codes(result))


class ProposalAndTasksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_route_and_size_are_parsed(self):
        result = cc.collect(str(make_project(self.root)))
        self.assertEqual(result["proposal"]["size"], "M")
        self.assertTrue(result["proposal"]["route"].startswith("Маршрут: фича"))
        self.assertEqual(result["proposal"]["capabilities"]["new"], ["order-refunds"])
        self.assertEqual(result["proposal"]["capabilities"]["modified"], ["order-lifecycle"])

    def test_english_route_line_is_parsed(self):
        proposal = PROPOSAL.replace("Маршрут: фича · M · сигналы: платёж, вебхук",
                                    "Route: feature · M · signals: payment, webhook")
        result = cc.collect(str(make_project(self.root, proposal=proposal)))
        self.assertEqual(result["proposal"]["size"], "M")
        self.assertTrue(result["proposal"]["route"].startswith("Route: feature"))
        self.assertNotIn("route-missing", codes(result, "warn"))

    def test_missing_route_is_warned_in_java_flow_project(self):
        change = make_project(self.root, proposal=PROPOSAL.replace("Маршрут:", "Затронуто:"))
        result = cc.collect(str(change))
        self.assertIn("route-missing", codes(result, "warn"))

    def test_missing_design_for_m_is_warned(self):
        result = cc.collect(str(make_project(self.root, design=None)))
        self.assertIn("missing-artifact", codes(result, "warn"))

    def test_capability_listed_without_spec_file_is_an_error(self):
        result = cc.collect(str(make_project(self.root, delta_refunds=None)))
        self.assertIn("capability-without-spec", codes(result, "error"))

    def test_modified_capability_missing_from_main_specs_is_an_error(self):
        change = make_project(self.root, proposal=PROPOSAL.replace(
            "`order-lifecycle`: отмена", "`order-flow`: отмена"))
        result = cc.collect(str(change))
        self.assertIn("modified-cap-not-found", codes(result, "error"))

    def test_no_specs_without_skip_specs_is_an_error(self):
        change = make_project(self.root, delta_lifecycle=None, delta_refunds=None,
                              proposal=PROPOSAL.split("## Capabilities")[0] + "## Impact\n\nМаршрут: рефакторинг · M\n")
        self.assertIn("no-specs", codes(cc.collect(str(change)), "error"))
        write(change, ".openspec.yaml", "schema: spec-driven\nskip_specs: true\n")
        self.assertNotIn("no-specs", codes(cc.collect(str(change))))

    def test_traceability_between_scenarios_and_tasks(self):
        tasks = TASKS.replace(
            "- [ ] 1.2 Сценарий «Cancel PAID order» — @SpringBootTest + Testcontainers — проверка: `OrderCancelTest#paid`",
            "- [ ] 1.2 Добавить метрику возвратов — проверка: `RefundMetricsTest`")
        result = cc.collect(str(make_project(self.root, tasks=tasks)))
        orphan_scenarios = [s["scenario"] for s in result["trace"]["scenarios_without_tasks"]]
        self.assertIn("Cancel PAID order", orphan_scenarios)
        # the scenario was copied into MODIFIED unchanged — it is old behavior, no task is needed
        self.assertNotIn("Cancel NEW order", orphan_scenarios)
        self.assertNotIn("Full refund", orphan_scenarios)
        self.assertEqual([t["id"] for t in result["trace"]["tasks_without_scenario"]], ["1.2"])

    def test_tasks_format_rules(self):
        tasks = """\
            # Tasks

            ## 1. Возвраты

            - [~] 1.1 Сценарий «Full refund» — @WebMvcTest
            - [ ] 1.2 Сценарий «Cancel PAID order» — проверка: `OrderCancelTest#paid`

            ## 2. Тесты

            - [ ] 2.1 Дописать тесты — проверка: `./mvnw test`
            """
        result = cc.collect(str(make_project(self.root, tasks=tasks)))
        self.assertIn("task-bad-checkbox", codes(result))
        self.assertIn("task-no-check", codes(result))
        self.assertIn("tasks-test-group", codes(result))
        self.assertIn("tasks-last-group", codes(result, "warn"))

    def test_other_change_touching_same_capability_is_warned(self):
        change = make_project(self.root)
        write(self.root, "openspec/changes/other/specs/order-lifecycle/spec.md", DELTA_LIFECYCLE)
        result = cc.collect(str(change))
        overlap = issue(result, "overlapping-change")
        self.assertIn("other", overlap["message"])


class CliTest(unittest.TestCase):
    def test_markdown_output_names_the_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            change = make_project(Path(tmp).resolve())
            out = subprocess.run(
                [sys.executable, str(SCRIPTS / "collect_change.py"), str(change)],
                capture_output=True, text=True, check=True)
            self.assertIn("cancel-paid-order", out.stdout)
            self.assertIn("modified-lost-scenario", out.stdout)

    def test_ambiguous_input_exits_with_code_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            make_project(root)
            write(root, "openspec/changes/other/proposal.md", PROPOSAL)
            out = subprocess.run(
                [sys.executable, str(SCRIPTS / "collect_change.py"), str(root)],
                capture_output=True, text=True, env={**os.environ})
            self.assertEqual(out.returncode, 2)
            self.assertIn("other", out.stdout)


if __name__ == "__main__":
    unittest.main()
