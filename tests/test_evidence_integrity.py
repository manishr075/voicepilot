import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class TestEvidenceIntegrity(unittest.TestCase):
    def test_benchmark_is_explicitly_scripted_and_unmeasured(self):
        data = json.loads((ROOT / "benchmarks" / "eval_results.json").read_text(encoding="utf-8"))
        evidence = data["evidence"]
        self.assertEqual(evidence["type"], "scripted_scenario_benchmark")
        self.assertFalse(evidence["live_wispr_trial"])
        self.assertFalse(evidence["human_timing_measured"])
        self.assertIn("predefined", evidence["transcripts_source"])
        self.assertIn("predefined", evidence["timings_source"])
        self.assertIn("avg_scripted_fix_time_sec", data["baseline_uncalibrated"])

    def test_genuine_trial_log_is_empty_and_has_required_fields(self):
        data = json.loads((ROOT / "benchmarks" / "wispr_trials.json").read_text(encoding="utf-8"))
        self.assertEqual(data["trials"], [])
        required = {
            "intended_instruction",
            "actual_wispr_transcript",
            "known_technical_tokens",
            "raw_token_matches",
            "flowguard_recovered_tokens",
            "missed_errors",
            "false_alarms",
            "manually_measured_time_sec",
        }
        self.assertTrue(required.issubset(data["record_template"]))


if __name__ == "__main__":
    unittest.main()
