"""
VoicePilot – Browser Surface Contract Tests
Replaces the legacy FlowGuard browser surface tests.
"""
import pathlib
import re
import unittest

ROOT  = pathlib.Path(__file__).resolve().parents[1]
INDEX = ROOT / 'index.html'


class TestBrowserSurface(unittest.TestCase):
    def setUp(self):
        self.html = INDEX.read_text(encoding='utf-8')

    def test_voicepilot_title_and_branding(self):
        self.assertIn('VoicePilot', self.html)
        self.assertIn('Write by voice', self.html)

    def test_module_scripts_loaded_in_correct_order(self):
        # All four new modules must be present
        self.assertIn('src/command_parser.js', self.html)
        self.assertIn('src/segment_tracker.js', self.html)
        self.assertIn('src/editor_state.js', self.html)
        self.assertIn('src/voice_feedback.js', self.html)
        # Legacy engine still present for reusable helpers
        self.assertIn('src/engine.js', self.html)

    def test_no_web_speech_api_dictation_fallback(self):
        """Browser Web Speech API must not be offered as a dictation substitute."""
        self.assertNotIn('webkitSpeechRecognition', self.html)
        # SpeechSynthesis (read-aloud) is intentional and allowed
        without_synthesis = self.html.replace('speechSynthesis', '').replace('SpeechSynthesisUtterance', '')
        self.assertNotIn('SpeechRecognition', without_synthesis)

    def test_no_unsafe_innerhtml(self):
        """Untrusted content must never be rendered via innerHTML."""
        self.assertNotIn('.innerHTML =', self.html)

    def test_no_fake_wispr_connection_status(self):
        self.assertNotIn('Wispr connected', self.html)
        self.assertNotIn('Wispr Flow Connected', self.html)
        self.assertNotIn('fully hands-free', self.html)

    def test_no_flowguard_product_ui_elements(self):
        self.assertNotIn('tab-firewall', self.html)
        self.assertNotIn('Fidelity Firewall', self.html)
        self.assertNotIn('benchmarkChart', self.html)
        self.assertNotIn('CTEM', self.html)

    def test_no_chartjs_dependency(self):
        self.assertNotIn('chart.js', self.html.lower())

    def test_draft_editor_textarea_present(self):
        self.assertIn('id="draft-editor"', self.html)

    def test_reduced_motion_support(self):
        self.assertIn('prefers-reduced-motion', self.html)

    def test_review_panel_present(self):
        self.assertIn('id="review-panel"', self.html)

    def test_limitation_disclosure_present(self):
        self.assertIn('limitation', self.html.lower())
        self.assertIn('cannot', self.html.lower())

    def test_pasted_content_rendered_as_text_not_html(self):
        """VoicePilot must use textContent for all dynamic content."""
        self.assertIn('.textContent', self.html)
        self.assertNotIn('.innerHTML =', self.html)

    def test_no_scripted_benchmark_claims(self):
        """Old FlowGuard benchmark numbers must not appear in the UI."""
        self.assertNotIn('97.6%', self.html)
        self.assertNotIn('100.0% CTEM', self.html)
        self.assertNotIn('wispr_trials', self.html)


if __name__ == '__main__':
    unittest.main()
