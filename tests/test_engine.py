#!/usr/bin/env python3
"""
Unit Test Suite for FlowGuard Deterministic Engine (Milestones A through F).
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from flowguard_engine import (
    build_privacy_report,
    compile_wispr_artifacts,
    extract_repo_symbols,
    verify_dictation,
)


TANKWISE_MANIFEST = """
frontend/src/engine.js
frontend/src/api.js
backend/water_balance.py
backend/app.py
scripts/check_parity.py
scripts/local_api.py
template.yaml
samconfig.toml
VITE_API_BASE_URL
SCHEDULE_GROUP
ANNOUNCE_FN_ARN
building_id
sort_key
calculateBookingWindow
waitForTaskToken
GET /health
POST /simulate
POST /records
GET /history
--dry-run
--lint
--stack-name
ap-south-1
"""


class TestFlowGuardEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.symbols = extract_repo_symbols(TANKWISE_MANIFEST)

    def test_extract_repo_symbols_classifications(self) -> None:
        by_canonical = {s["canonical"]: s for s in self.symbols}
        self.assertIn("backend/water_balance.py", by_canonical)
        self.assertEqual(by_canonical["backend/water_balance.py"]["type"], "file_path")
        self.assertIn("water balance dot pie", by_canonical["backend/water_balance.py"]["acoustic_variants"])

        self.assertIn("VITE_API_BASE_URL", by_canonical)
        self.assertEqual(by_canonical["VITE_API_BASE_URL"]["type"], "env_var")
        self.assertIn("vite api base url", by_canonical["VITE_API_BASE_URL"]["acoustic_variants"])
        self.assertIn("white api base url", by_canonical["VITE_API_BASE_URL"]["acoustic_variants"])

        self.assertIn("--dry-run", by_canonical)
        self.assertEqual(by_canonical["--dry-run"]["type"], "cli_flag_or_cmd")
        self.assertIn("double dash dry run", by_canonical["--dry-run"]["acoustic_variants"])

        self.assertIn("POST /simulate", by_canonical)
        self.assertEqual(by_canonical["POST /simulate"]["type"], "endpoint_or_url")

    def test_verify_dictation_repairs_spoken_tokens_and_injects_vscode_file_tags(self) -> None:
        intended = "Update backend/water_balance.py and scripts/check_parity.py to validate VITE_API_BASE_URL in ap-south-1 with --dry-run."
        dictated = "Update water balance dot pie and check parity dot pie to validate white api base url in a p south one with double dash dry run."
        res = verify_dictation(dictated, self.symbols, intended, editor_target="vscode-copilot")

        self.assertEqual(res["metrics"]["total_targets"], 5)
        self.assertEqual(res["metrics"]["raw_correct_targets"], 0)
        self.assertEqual(res["metrics"]["repaired_correct_targets"], 5)
        self.assertEqual(res["metrics"]["ctem_raw_pct"], 0.0)
        self.assertEqual(res["metrics"]["ctem_repaired_pct"], 100.0)
        self.assertEqual(res["metrics"]["tsr_raw_pct"], 0.0)
        self.assertEqual(res["metrics"]["tsr_repaired_pct"], 100.0)
        self.assertIn("#file:backend/water_balance.py", res["repaired_prompt"])
        self.assertIn("#file:scripts/check_parity.py", res["repaired_prompt"])
        self.assertIn("`VITE_API_BASE_URL`", res["repaired_prompt"])
        self.assertIn("`--dry-run`", res["repaired_prompt"])

    def test_cursor_editor_target_uses_at_mentions(self) -> None:
        dictated = "Check water balance dot pie for overflow logic."
        res = verify_dictation(dictated, self.symbols, "", editor_target="cursor")
        self.assertTrue(res["repaired_prompt"].startswith("[Context: @backend/water_balance.py] "))

    def test_negation_drop_hazard_detected(self) -> None:
        intended = "In backend/app.py, do not overwrite sort_key when saving rapid requests to POST /records."
        dictated = "In app dot pie, overwrite sort key when saving rapid requests to post slash records."
        res = verify_dictation(dictated, self.symbols, intended)
        categories = [h["category"] for h in res["hazards"]]
        self.assertIn("NEGATION_DROPPED", categories)
        self.assertEqual(res["metrics"]["tsr_repaired_pct"], 0.0)

    def test_self_correction_residue_detected(self) -> None:
        dictated = "Set the forecast horizon in water balance dot pie to 7 days wait no 14 days."
        res = verify_dictation(dictated, self.symbols, "")
        categories = [h["category"] for h in res["hazards"]]
        self.assertIn("SELF_CORRECTION_RESIDUE", categories)

    def test_numeric_and_boundary_drift_detected(self) -> None:
        intended = "Reject rainfall input strictly less than 500 mm/day and cap forecast at 14 days."
        dictated = "Reject rainfall input at most 50 mm/day and cap forecast at 14 days."
        res = verify_dictation(dictated, self.symbols, intended)
        categories = [h["category"] for h in res["hazards"]]
        self.assertIn("NUMERIC_CONSTRAINT_DRIFT", categories)
        self.assertIn("BOUNDARY_OPERATOR_DRIFT", categories)

    def test_destructive_command_guard_detected(self) -> None:
        dictated = "Run sam delete with --force on stack in a p south one."
        res = verify_dictation(dictated, self.symbols, "")
        categories = [h["category"] for h in res["hazards"]]
        self.assertIn("DESTRUCTIVE_COMMAND_GUARD", categories)

    def test_blank_input_raises_error(self) -> None:
        with self.assertRaises(ValueError):
            verify_dictation("   ", self.symbols)

    def test_wispr_bulk_import_csv_and_json_spec_compliance(self) -> None:
        artifacts = compile_wispr_artifacts(self.symbols)
        csv_lines = [line for line in artifacts["dictionary_csv"].splitlines() if line.strip()]
        self.assertGreater(len(csv_lines), 10)
        # Rule: No header row ("misspelling,correction" must NOT be line 0)
        self.assertNotEqual(csv_lines[0].lower(), "misspelling,correction")
        self.assertNotEqual(csv_lines[0].lower(), "vocabulary")

        # Validate Snippets JSON
        snippets = json.loads(artifacts["snippets_json"])
        self.assertIsInstance(snippets, list)
        self.assertEqual(len(snippets), 3)
        for snip in snippets:
            self.assertIn("name", snip)
            self.assertIn("text", snip)
            self.assertLessEqual(len(snip["name"]), 60)
            self.assertLessEqual(len(snip["text"]), 4000)

    def test_wispr_snippets_skip_non_string_fields(self) -> None:
        artifacts = compile_wispr_artifacts(
            self.symbols,
            custom_snippets=[
                {"name": "valid", "text": "plain text"},
                {"name": 123, "text": "must be skipped"},
                {"name": "also skipped", "text": False},
            ],
        )
        snippets = json.loads(artifacts["snippets_json"])
        self.assertEqual(snippets, [{"name": "valid", "text": "plain text"}])

    def test_privacy_report_redacts_by_default(self) -> None:
        dictated = "Update water balance dot pie and white api base url."
        res = verify_dictation(dictated, self.symbols, "")
        redacted = build_privacy_report(res, include_raw_tokens=False)
        self.assertEqual(redacted["consent_mode"], "PRIVACY_REDACTED_DEFAULT")
        dump = json.dumps(redacted)
        self.assertNotIn("water_balance.py", dump)
        self.assertNotIn("VITE_API_BASE_URL", dump)
        self.assertIn("[CANONICAL_FILE_PATH_1]", dump)

        full_opt_in = build_privacy_report(res, include_raw_tokens=True)
        self.assertEqual(full_opt_in["consent_mode"], "FULL_OPT_IN")
        self.assertIn("VITE_API_BASE_URL", json.dumps(full_opt_in))


if __name__ == "__main__":
    unittest.main()
