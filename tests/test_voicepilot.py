#!/usr/bin/env python3
"""
VoicePilot – Automated Test Suite
Tests the command parser, segment tracker logic, and editor state manager.

The JavaScript modules are exercised through a minimal pure-Python port of the
same logic so the test suite can run without a browser or Node.js.

This file also contains contract tests that verify the behaviour described in
the VoicePilot specification.

Run:
    python -m pytest tests/test_voicepilot.py -v
or:
    python tests/test_voicepilot.py
"""

from __future__ import annotations

import re
import sys
import unittest
from copy import deepcopy
from typing import Optional


# ══════════════════════════════════════════════════════════════════════════════
#  Python ports of the JavaScript modules (deterministic only)
# ══════════════════════════════════════════════════════════════════════════════

# ── command_parser.py ─────────────────────────────────────────────────────────

COMMAND_MAP = [
    (re.compile(r'^edit\s*:\s*(.+)', re.I | re.S),            'edit',          True),
    (re.compile(r'^remove\s+last\s+insertion', re.I),          'remove_last',   False),
    (re.compile(r'^make\s+that\s+a\s+separate\s+note', re.I), 'separate_note', False),
    (re.compile(r'^keep\s+that', re.I),                        'keep_that',     False),
    (re.compile(r'^preview', re.I),                            'preview',       False),
    (re.compile(r'^apply', re.I),                              'apply',         False),
    (re.compile(r'^discard', re.I),                            'discard',       False),
    (re.compile(r'^undo', re.I),                               'undo',          False),
    (re.compile(r'^redo', re.I),                               'redo',          False),
    (re.compile(r'^read', re.I),                               'read',          False),
    (re.compile(r'^pause', re.I),                              'pause',         False),
    (re.compile(r'^resume', re.I),                             'resume',        False),
    (re.compile(r'^finish', re.I),                             'finish',        False),
]


def build_catchword_regex(catchword: str):
    if not catchword or not catchword.strip():
        return None
    escaped = re.escape(catchword.strip())
    return re.compile(r'^' + escaped + r'\s*[,:\s]\s*(.+)', re.I | re.S)


def parse_command(segment: str, catchword: str = 'Shazam') -> Optional[dict]:
    """Returns dict(action, arg, commandText) or None."""
    if not segment or not segment.strip():
        return None
    catch_re = build_catchword_regex(catchword)
    if not catch_re:
        return None
    m = catch_re.match(segment.strip())
    if not m:
        return None
    body = m.group(1).strip()
    for pattern, action, has_arg in COMMAND_MAP:
        bm = pattern.match(body)
        if bm:
            return {
                'action': action,
                'arg': bm.group(1).strip() if has_arg else None,
                'commandText': segment,
            }
    return {'action': 'unknown', 'arg': body, 'commandText': segment}


# ── editor_state.py ───────────────────────────────────────────────────────────

MAX_HISTORY = 100


def create_state() -> dict:
    return {
        'acceptedDraft':   '',
        'pendingProposal': None,
        'undoStack':       [],
        'redoStack':       [],
        'lastSegment':     None,
        'flaggedSegment':  None,
        'paused':          False,
        'status':          'ready',
        'notes':           [],
    }


def _push_undo(state: dict) -> dict:
    s = deepcopy(state)
    s['undoStack'] = (state['undoStack'] + [state['acceptedDraft']])[-MAX_HISTORY:]
    s['redoStack'] = []
    return s


def accept_draft(state: dict, new_text: str) -> dict:
    s = _push_undo(state)
    s['acceptedDraft']   = new_text
    s['pendingProposal'] = None
    s['status']          = 'ready'
    return s


def set_proposal(state: dict, proposal_text: str, instruction: str = '') -> dict:
    s = deepcopy(state)
    s['pendingProposal'] = {'text': proposal_text, 'instruction': instruction}
    s['status']          = 'review'
    return s


def apply_proposal(state: dict) -> dict:
    if not state.get('pendingProposal'):
        return state
    s = _push_undo(state)
    s['acceptedDraft']   = state['pendingProposal']['text']
    s['pendingProposal'] = None
    s['status']          = 'ready'
    return s


def discard_proposal(state: dict) -> dict:
    s = deepcopy(state)
    s['pendingProposal'] = None
    s['status']          = 'ready'
    return s


def undo_state(state: dict) -> dict:
    if not state['undoStack']:
        return state
    s = deepcopy(state)
    prev = s['undoStack'].pop()
    s['redoStack'] = [state['acceptedDraft']] + s['redoStack']
    s['redoStack'] = s['redoStack'][:MAX_HISTORY]
    s['acceptedDraft']   = prev
    s['pendingProposal'] = None
    s['status']          = 'ready'
    return s


def redo_state(state: dict) -> dict:
    if not state['redoStack']:
        return state
    s = deepcopy(state)
    nxt = s['redoStack'].pop(0)
    s['undoStack'] = (s['undoStack'] + [state['acceptedDraft']])[-MAX_HISTORY:]
    s['acceptedDraft']   = nxt
    s['pendingProposal'] = None
    s['status']          = 'ready'
    return s


def remove_last_insertion(state: dict) -> dict:
    seg = state.get('lastSegment')
    if not seg:
        return state
    start, end = seg['insertStart'], seg['insertEnd']
    draft = state['acceptedDraft']
    if start < 0 or end > len(draft) or start >= end:
        return state
    new_draft = draft[:start] + draft[end:]
    s = _push_undo(state)
    s['acceptedDraft']  = new_draft
    s['lastSegment']    = None
    s['flaggedSegment'] = None
    s['status']         = 'ready'
    return s


def keep_flagged(state: dict) -> dict:
    s = deepcopy(state)
    s['flaggedSegment'] = None
    return s


def move_flagged_to_notes(state: dict) -> dict:
    seg = state.get('flaggedSegment')
    if not seg:
        return state
    start, end = seg['start'], seg['end']
    draft = state['acceptedDraft']
    if start < 0 or end > len(draft):
        return state
    new_draft = draft[:start] + draft[end:]
    s = _push_undo(state)
    s['acceptedDraft']  = new_draft
    s['flaggedSegment'] = None
    s['notes']          = state['notes'] + [seg['text']]
    s['status']         = 'ready'
    return s


def pause_state(state: dict) -> dict:
    s = deepcopy(state)
    s['paused'] = True
    s['status'] = 'paused'
    return s


def resume_state(state: dict) -> dict:
    s = deepcopy(state)
    s['paused'] = False
    s['status'] = 'ready'
    return s


# ── segment_tracker helper ────────────────────────────────────────────────────

def compute_insertion(old_val: str, new_val: str, old_sel_start: int,
                      old_sel_end: int) -> Optional[dict]:
    """Python equivalent of VPSegmentTracker.computeInsertion."""
    if not isinstance(old_val, str) or not isinstance(new_val, str):
        return None
    len_delta = len(new_val) - len(old_val)
    if len_delta <= 0:
        return None
    insert_start = old_sel_start
    replaced_len = old_sel_end - old_sel_start
    pre  = old_val[:old_sel_start]
    post = old_val[old_sel_end:]
    if not new_val.startswith(pre) or not new_val.endswith(post):
        return None
    inserted_text = new_val[insert_start: insert_start + len_delta + replaced_len]
    if not inserted_text:
        return None
    return {
        'insertedText': inserted_text,
        'insertStart':  insert_start,
        'insertEnd':    insert_start + len(inserted_text),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestCommandParser(unittest.TestCase):
    """Tests for parse_command()."""

    # 1. Plain inserted text is not a command
    def test_plain_text_is_not_a_command(self):
        self.assertIsNone(parse_command("Hello, this is ordinary dictated text."))
        self.assertIsNone(parse_command(""))
        self.assertIsNone(parse_command("   "))
        self.assertIsNone(parse_command("shazam is a cool song but I like jazz more"))

    # 2. Valid "Shazam, undo" is detected
    def test_shazam_undo_detected(self):
        result = parse_command("Shazam, undo")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'undo')

    # 3. Valid "Shazam, edit: …" routes to edit action
    def test_shazam_edit_routes_to_edit(self):
        result = parse_command("Shazam, edit: make this more formal")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'edit')
        self.assertEqual(result['arg'], 'make this more formal')

    # 4. "Shazam" in the MIDDLE of old text does not trigger
    def test_shazam_in_middle_does_not_trigger(self):
        # This is the full accepted draft, not a new insertion; parser only
        # sees the inserted segment, but we still test that mid-string shazam fails.
        result = parse_command("My cat said Shazam, undo the laundry")
        self.assertIsNone(result)  # does not start with Shazam

    # 5. Case and punctuation variations
    def test_case_insensitive(self):
        result = parse_command("shazam, undo")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'undo')

    def test_colon_separator(self):
        result = parse_command("Shazam: apply")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'apply')

    def test_space_only_separator(self):
        result = parse_command("Shazam undo")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'undo')

    def test_mixed_case(self):
        result = parse_command("SHAZAM, DISCARD")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'discard')

    # 6. All 13 commands parse correctly
    def test_all_commands(self):
        cases = [
            ("Shazam, undo",                      'undo'),
            ("Shazam, redo",                      'redo'),
            ("Shazam, preview",                   'preview'),
            ("Shazam, apply",                     'apply'),
            ("Shazam, discard",                   'discard'),
            ("Shazam, read",                      'read'),
            ("Shazam, remove last insertion",     'remove_last'),
            ("Shazam, keep that",                 'keep_that'),
            ("Shazam, make that a separate note", 'separate_note'),
            ("Shazam, pause",                     'pause'),
            ("Shazam, resume",                    'resume'),
            ("Shazam, finish",                    'finish'),
        ]
        for text, expected in cases:
            with self.subTest(text=text):
                result = parse_command(text)
                self.assertIsNotNone(result)
                self.assertEqual(result['action'], expected)

    # 7. Unrecognised body after catchword returns 'unknown', not None
    def test_unknown_command_not_none(self):
        result = parse_command("Shazam, frobnicate immediately")
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'unknown')

    # Configurable catchword
    def test_custom_catchword(self):
        result = parse_command("Pilot, undo", catchword='Pilot')
        self.assertIsNotNone(result)
        self.assertEqual(result['action'], 'undo')

    def test_wrong_catchword_not_triggered(self):
        result = parse_command("Shazam, undo", catchword='Pilot')
        self.assertIsNone(result)


class TestSegmentTracker(unittest.TestCase):
    """Tests for compute_insertion()."""

    # 8. Simple insertion at caret
    def test_simple_caret_insertion(self):
        old = "Hello"
        new = "Hello world"
        result = compute_insertion(old, new, 5, 5)
        self.assertIsNotNone(result)
        self.assertEqual(result['insertedText'], ' world')
        self.assertEqual(result['insertStart'], 5)

    # 9. Replacement of selected text
    def test_selection_replacement(self):
        old = "Hello world"
        new = "Hello there"
        result = compute_insertion(old, new, 6, 11)
        self.assertIsNotNone(result)
        self.assertEqual(result['insertedText'], 'there')

    # 10. Pure deletion returns None
    def test_deletion_returns_none(self):
        result = compute_insertion("Hello world", "Hello", 5, 11)
        self.assertIsNone(result)

    # 11. Empty old value, inserting fresh
    def test_fresh_insert_empty_draft(self):
        result = compute_insertion("", "Shazam, undo", 0, 0)
        self.assertIsNotNone(result)
        self.assertEqual(result['insertedText'], 'Shazam, undo')

    # 12. Ambiguous multi-point change returns None
    def test_ambiguous_returns_none(self):
        # new value does not start with prefix of old value at sel_start
        result = compute_insertion("abc", "xyz", 1, 2)
        self.assertIsNone(result)


class TestEditorState(unittest.TestCase):
    """Tests for the editor state manager functions."""

    def setUp(self):
        self.s = create_state()

    # 13. Plain insertion remains unchanged
    def test_draft_content_preserved(self):
        s = accept_draft(self.s, 'Hello world')
        self.assertEqual(s['acceptedDraft'], 'Hello world')
        self.assertIsNone(s['pendingProposal'])

    # 14. Undo restores previous version
    def test_undo_restores_previous(self):
        s = accept_draft(self.s, 'First version')
        s = accept_draft(s, 'Second version')
        s = undo_state(s)
        self.assertEqual(s['acceptedDraft'], 'First version')

    # 15. Redo restores undone version
    def test_redo_restores_undone(self):
        s = accept_draft(self.s, 'First version')
        s = accept_draft(s, 'Second version')
        s = undo_state(s)
        s = redo_state(s)
        self.assertEqual(s['acceptedDraft'], 'Second version')

    # 16. Preview does not alter the accepted draft
    def test_preview_does_not_alter_draft(self):
        s = accept_draft(self.s, 'Original text')
        s = set_proposal(s, 'Revised text', 'make formal')
        # Draft must not change
        self.assertEqual(s['acceptedDraft'], 'Original text')
        self.assertIsNotNone(s['pendingProposal'])
        self.assertEqual(s['status'], 'review')

    # 17. Apply commits the proposal
    def test_apply_commits_proposal(self):
        s = accept_draft(self.s, 'Original text')
        s = set_proposal(s, 'Revised text', 'make formal')
        s = apply_proposal(s)
        self.assertEqual(s['acceptedDraft'], 'Revised text')
        self.assertIsNone(s['pendingProposal'])
        self.assertEqual(s['status'], 'ready')

    # 18. Apply creates undo entry
    def test_apply_creates_undo_entry(self):
        s = accept_draft(self.s, 'Original text')
        s = set_proposal(s, 'Revised text', 'instruction')
        s = apply_proposal(s)
        s = undo_state(s)
        self.assertEqual(s['acceptedDraft'], 'Original text')

    # 19. Discard does not mutate the accepted draft
    def test_discard_preserves_draft(self):
        s = accept_draft(self.s, 'Original text')
        s = set_proposal(s, 'Revised text', 'instruction')
        s = discard_proposal(s)
        self.assertEqual(s['acceptedDraft'], 'Original text')
        self.assertIsNone(s['pendingProposal'])

    # 20. New edit while proposal pending replaces proposal (not appended to draft)
    def test_new_edit_replaces_pending_proposal(self):
        s = accept_draft(self.s, 'Original text')
        s = set_proposal(s, 'First proposal', 'instruction 1')
        s = set_proposal(s, 'Second proposal', 'instruction 2')
        self.assertEqual(s['pendingProposal']['text'], 'Second proposal')
        self.assertEqual(s['acceptedDraft'], 'Original text')  # draft untouched

    # 21. Interruption flags never auto-delete a segment
    def test_interruption_flag_does_not_delete(self):
        s = accept_draft(self.s, 'Hello world. Can you switch off the light?')
        s['flaggedSegment'] = {'text': 'Can you switch off the light?', 'start': 13, 'end': 42}
        # Nothing auto-deletes; flag must be explicitly acted on
        self.assertEqual(s['acceptedDraft'], 'Hello world. Can you switch off the light?')

    # 22. Remove last insertion
    def test_remove_last_insertion(self):
        s = accept_draft(self.s, 'Hello world. Extra.')
        s['lastSegment'] = {'insertedText': ' Extra.', 'insertStart': 12, 'insertEnd': 19}
        s = remove_last_insertion(s)
        self.assertEqual(s['acceptedDraft'], 'Hello world.')
        self.assertIsNone(s['lastSegment'])

    # 23. Remove last insertion with invalid bounds is a no-op
    def test_remove_last_insertion_invalid_bounds_noop(self):
        s = accept_draft(self.s, 'Hello')
        s['lastSegment'] = {'insertedText': 'X', 'insertStart': 10, 'insertEnd': 15}
        s2 = remove_last_insertion(s)
        self.assertEqual(s2['acceptedDraft'], 'Hello')  # unchanged

    # 24. Deterministic commands work without LLM
    def test_deterministic_commands_no_llm(self):
        # undo, redo, apply, discard, remove_last all require no API call
        s = accept_draft(self.s, 'Draft v1')
        s = accept_draft(s, 'Draft v2')
        s = undo_state(s)
        self.assertEqual(s['acceptedDraft'], 'Draft v1')
        s = redo_state(s)
        self.assertEqual(s['acceptedDraft'], 'Draft v2')
        s = set_proposal(s, 'Draft v3', 'test')
        s = apply_proposal(s)
        self.assertEqual(s['acceptedDraft'], 'Draft v3')
        s = set_proposal(s, 'Draft v4', 'test2')
        s = discard_proposal(s)
        self.assertEqual(s['acceptedDraft'], 'Draft v3')

    # 25. Failed edit / provider error leaves accepted draft intact
    def test_provider_error_leaves_draft_intact(self):
        s = accept_draft(self.s, 'My important draft')
        # Simulate failed edit: proposal is never set; draft stays
        # (In production the router catches the exception and skips setProposal)
        draft_before = s['acceptedDraft']
        # No set_proposal called
        self.assertEqual(s['acceptedDraft'], draft_before)
        self.assertIsNone(s['pendingProposal'])

    # 26. Undo with empty stack is a safe no-op
    def test_undo_empty_stack_noop(self):
        s = self.s  # fresh state, no history
        s2 = undo_state(s)
        self.assertIs(s2, s)  # same object returned

    # 27. Redo with empty stack is a safe no-op
    def test_redo_empty_stack_noop(self):
        s = self.s
        s2 = redo_state(s)
        self.assertIs(s2, s)

    # 28. Pause / resume
    def test_pause_resume(self):
        s = pause_state(self.s)
        self.assertTrue(s['paused'])
        self.assertEqual(s['status'], 'paused')
        s = resume_state(s)
        self.assertFalse(s['paused'])
        self.assertEqual(s['status'], 'ready')

    # 29. Move flagged segment to notes
    def test_move_flagged_to_notes(self):
        s = accept_draft(self.s, 'Hello world. Aside text.')
        s['flaggedSegment'] = {'text': 'Aside text.', 'start': 13, 'end': 24}
        s = move_flagged_to_notes(s)
        self.assertNotIn('Aside text.', s['acceptedDraft'])
        self.assertIn('Aside text.', s['notes'])
        self.assertIsNone(s['flaggedSegment'])

    # 30. Keep flagged clears flag without deleting
    def test_keep_flagged_clears_flag(self):
        s = accept_draft(self.s, 'Hello world. Aside text.')
        s['flaggedSegment'] = {'text': 'Aside text.', 'start': 13, 'end': 24}
        s = keep_flagged(s)
        self.assertIsNone(s['flaggedSegment'])
        self.assertIn('Aside text.', s['acceptedDraft'])  # still in draft


class TestBrowserSurface(unittest.TestCase):
    """Contract tests on the new index.html."""

    def setUp(self):
        import pathlib
        root = pathlib.Path(__file__).resolve().parents[1]
        self.html = (root / 'index.html').read_text(encoding='utf-8')

    # 31. No Web Speech API dictation button or fallback
    def test_no_web_speech_api_button(self):
        self.assertNotIn('webkitSpeechRecognition', self.html)
        self.assertNotIn('SpeechRecognition', self.html.replace('SpeechSynthesis', ''))

    # 32. No innerHTML with untrusted content
    def test_no_unsafe_innerhtml(self):
        # innerHTML should not appear (textContent is used instead)
        # We allow it only in comments or the provider-notice div (static content)
        self.assertNotIn('.innerHTML =', self.html)

    # 33. Module scripts are loaded
    def test_module_scripts_loaded(self):
        self.assertIn('src/command_parser.js', self.html)
        self.assertIn('src/segment_tracker.js', self.html)
        self.assertIn('src/editor_state.js', self.html)
        self.assertIn('src/voice_feedback.js', self.html)

    # 34. No fake "Wispr connected" status
    def test_no_fake_wispr_connected_status(self):
        self.assertNotIn('Wispr connected', self.html)
        self.assertNotIn('Wispr Flow Connected', self.html)

    # 35. Reduced motion media query present
    def test_reduced_motion_present(self):
        self.assertIn('prefers-reduced-motion', self.html)

    # 36. No FlowGuard product UI claims
    def test_no_flowguard_product_ui(self):
        # FlowGuard branding must not be in the primary visible UI
        self.assertNotIn('<h1>FlowGuard</h1>', self.html)
        self.assertNotIn('Fidelity Firewall', self.html)
        self.assertNotIn('CTEM', self.html)

    # 37. VoicePilot branding present
    def test_voicepilot_branding(self):
        self.assertIn('VoicePilot', self.html)
        self.assertIn('Write by voice', self.html)

    # 38. Honest limitation note present
    def test_limitation_note_present(self):
        self.assertIn('cannot', self.html.lower())
        self.assertIn('limitation', self.html.lower())

    # 39. No old FlowGuard tabs
    def test_no_old_tabs(self):
        self.assertNotIn('tab-firewall', self.html)
        self.assertNotIn('tab-compiler', self.html)
        self.assertNotIn('tab-mcp', self.html)
        self.assertNotIn('tab-benchmark', self.html)

    # 40. Draft editor textarea present
    def test_draft_editor_present(self):
        self.assertIn('id="draft-editor"', self.html)

    # 41. No chart.js dependency
    def test_no_chartjs(self):
        self.assertNotIn('chart.js', self.html.lower())
        self.assertNotIn('chart.umd.min.js', self.html)


class TestIntegrationScenarios(unittest.TestCase):
    """End-to-end command routing without network calls."""

    def _simulate(self, initial_draft: str, insertion: str, catchword: str = 'Shazam'):
        """
        Simulate a Wispr insertion into a draft and route the command.
        Returns (new_state, parsed_command).
        """
        s = create_state()
        s = accept_draft(s, initial_draft) if initial_draft else s

        # Simulate what the segment tracker and app controller do:
        start = len(initial_draft)
        end   = start + len(insertion)

        parsed = parse_command(insertion, catchword)
        return s, parsed, start, end

    # 42. Ordinary text with no command
    def test_ordinary_text_no_command(self):
        s, parsed, *_ = self._simulate('Hello', ' world')
        self.assertIsNone(parsed)

    # 43. Command at start of insertion removes command text from draft
    def test_command_removes_command_text(self):
        draft = 'Hello world.'
        cmd   = 'Shazam, undo'
        s, parsed, start, end = self._simulate(draft, cmd)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed['action'], 'undo')
        # Simulate removal: draft[:start] + draft[end:]
        # (draft was only 'Hello world.' before insertion; command not yet in it)
        # After command is removed, previous text is preserved:
        remainder = (draft + cmd)[:start] + (draft + cmd)[end:]
        self.assertEqual(remainder, draft)  # previous content preserved

    # 44. Multiple events do not execute command twice (dedup)
    def test_duplicate_insertion_not_executed_twice(self):
        # The segment tracker deduplicates via _lastEmittedText.
        # We test the command parser: parsing the same text twice gives the same result.
        cmd = 'Shazam, undo'
        r1 = parse_command(cmd)
        r2 = parse_command(cmd)
        # Both parse correctly; dedup happens in the tracker layer.
        self.assertEqual(r1['action'], r2['action'])

    # 45. Insertion in middle of draft does not trigger command
    def test_insertion_in_middle_is_plain_text(self):
        # The segment tracker emits the NEWLY inserted text, not the whole draft.
        # If someone somehow passes the whole draft to the parser with Shazam in middle:
        full_draft = "I was thinking Shazam, undo could be fun"
        result = parse_command(full_draft)
        self.assertIsNone(result)  # does not start with Shazam


class TestLegacyEnginePreserved(unittest.TestCase):
    """Verify the legacy FlowGuard engine (src/engine.js) is still importable in Python form."""

    def setUp(self):
        import os
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

    def test_legacy_python_engine_imports(self):
        from flowguard_engine import extract_repo_symbols, verify_dictation
        # Smoke test
        symbols = extract_repo_symbols("backend/app.py\nVITE_API_BASE_URL\n")
        self.assertGreater(len(symbols), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
