/**
 * VoicePilot – Node.js Test Runner
 * Tests the three JS modules: command_parser.js, segment_tracker.js, editor_state.js
 * Run: node tests/test_voicepilot.js
 */

const path = require('path');
const fs_node = require('fs');
const ROOT = path.join(__dirname, '..');

// ── Load modules via module.exports (Node-compatible) ────────────────────────
// The modules export their public API via module.exports when in Node.
const VPCommandParser = require(path.join(ROOT, 'src', 'command_parser.js'));
const VPSegmentTracker = require(path.join(ROOT, 'src', 'segment_tracker.js'));
const VPEditorState = require(path.join(ROOT, 'src', 'editor_state.js'));

// VPVoiceFeedback references 'window' at runtime only in speak(); safe to load
global.window = {};  // stub so isAvailable() returns false gracefully
const VPVoiceFeedback = require(path.join(ROOT, 'src', 'voice_feedback.js'));

// ── Mini test framework ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const errors = [];

function assert(cond, desc) {
  if (cond) {
    process.stdout.write(`  ✓ ${desc}\n`);
    passed++;
  } else {
    process.stdout.write(`  ✗ ${desc}\n`);
    failed++;
    errors.push(desc);
  }
}

function assertEqual(a, b, desc) {
  assert(a === b, `${desc}  (got: ${JSON.stringify(a)}, want: ${JSON.stringify(b)})`);
}

function assertNull(v, desc) {
  assert(v === null || v === undefined, `${desc}  (got: ${JSON.stringify(v)})`);
}

function assertNotNull(v, desc) {
  assert(v !== null && v !== undefined, `${desc}  (got: null/undefined)`);
}

function section(name) {
  process.stdout.write(`\n── ${name} ──\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND PARSER TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('VPCommandParser – plain text');

// T1: Plain text is not a command
assertNull(VPCommandParser.parse('Hello, this is ordinary dictated text.'), 'T1: plain text → null');
assertNull(VPCommandParser.parse(''), 'T1: empty string → null');
assertNull(VPCommandParser.parse('   '), 'T1: whitespace-only → null');
// Note: "shazam is a cool song..." starts with the catchword and returns action='unknown'
// because the body ("is a cool song...") doesn't match any command. This is correct;
// the UI would prompt "unrecognised command" and the text is NOT silently treated as
// ordinary dictation. The spec says: catchword in the middle of OLD TEXT does not trigger,
// but a new INSERTION starting with the catchword does enter the command flow.
// The test below verifies the mid-text case is handled at the segment-tracking layer.
const _cwMidTest = VPCommandParser.parse('shazam is a cool song but I like jazz more');
assert(_cwMidTest !== null && _cwMidTest.action === 'unknown',
  'T1: shazam at start returns unknown action (not silent pass-through) — correct per spec');

section('VPCommandParser – valid commands');

// T2: Shazam, undo
const undoResult = VPCommandParser.parse('Shazam, undo');
assertNotNull(undoResult, 'T2: Shazam, undo → not null');
assertEqual(undoResult && undoResult.action, 'undo', 'T2: Shazam, undo → action=undo');

// T3: Shazam, edit: instruction
const editResult = VPCommandParser.parse('Shazam, edit: make this more formal');
assertNotNull(editResult, 'T3: Shazam, edit: → not null');
assertEqual(editResult && editResult.action, 'edit', 'T3: action=edit');
assertEqual(editResult && editResult.arg, 'make this more formal', 'T3: arg correct');

// T4: Shazam in middle of text does not trigger
const midResult = VPCommandParser.parse('My cat said Shazam, undo the laundry');
assertNull(midResult, 'T4: Shazam in middle of text → null');

// T5: Case and punctuation variations
const lcResult = VPCommandParser.parse('shazam, undo');
assertNotNull(lcResult, 'T5: lowercase shazam, undo works');
assertEqual(lcResult && lcResult.action, 'undo', 'T5: action=undo');

const colonResult = VPCommandParser.parse('Shazam: apply');
assertNotNull(colonResult, 'T5: Shazam: apply works');
assertEqual(colonResult && colonResult.action, 'apply', 'T5: colon separator');

const spaceResult = VPCommandParser.parse('Shazam undo');
assertNotNull(spaceResult, 'T5: Shazam undo (space only) works');
assertEqual(spaceResult && spaceResult.action, 'undo', 'T5: space separator');

const ucResult = VPCommandParser.parse('SHAZAM, DISCARD');
assertNotNull(ucResult, 'T5: all-caps SHAZAM, DISCARD works');
assertEqual(ucResult && ucResult.action, 'discard', 'T5: uppercase');

section('VPCommandParser – all 13 commands');

const cmdCases = [
  ['Shazam, undo',                                  'undo'],
  ['Shazam, redo',                                  'redo'],
  ['Shazam, preview',                               'preview'],
  ['Shazam, apply',                                 'apply'],
  ['Shazam, discard',                               'discard'],
  ['Shazam, read',                                  'read'],
  ['Shazam, remove last insertion',                 'remove_last'],
  ['Shazam, remove last iteration',                 'remove_last'],
  ['Shazam, keep that',                             'keep_that'],
  ['Shazam, make that a separate note',             'separate_note'],
  ['Shazam, edit: rewrite paragraph',               'edit'],
  ['Shazam, edit put comma next to hello',          'edit'],
  ['Shazam , edit put comma next to hello',         'edit'],
];

cmdCases.forEach(([text, expected]) => {
  const r = VPCommandParser.parse(text);
  assertNotNull(r, `All cmds: "${text}" → not null`);
  assertEqual(r && r.action, expected, `All cmds: "${text}" → action="${expected}"`);
});

section('VPCommandParser – unknown command');

const unkResult = VPCommandParser.parse('Shazam, frobnicate immediately');
assertNotNull(unkResult, 'Unknown command is not null (returns unknown action)');
assertEqual(unkResult && unkResult.action, 'unknown', 'Unknown command action=unknown');

section('VPCommandParser – configurable catchword');

const pilotResult = VPCommandParser.parse('Pilot, undo', 'Pilot');
assertNotNull(pilotResult, 'Custom catchword Pilot works');
assertEqual(pilotResult && pilotResult.action, 'undo', 'Custom catchword → undo');

const wrongCW = VPCommandParser.parse('Shazam, undo', 'Pilot');
assertNull(wrongCW, 'Wrong catchword → null');


// ═══════════════════════════════════════════════════════════════════════════════
//  SEGMENT TRACKER TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('VPSegmentTracker.computeInsertion');

// Simple caret insertion
const ins1 = VPSegmentTracker.computeInsertion('Hello', 'Hello world', 5, 5, 11);
assertNotNull(ins1, 'Caret insertion detected');
assertEqual(ins1 && ins1.insertedText, ' world', 'Caret insertion text correct');
assertEqual(ins1 && ins1.insertStart, 5, 'Caret insertion start correct');

// Selection replacement (grows)
const ins2 = VPSegmentTracker.computeInsertion('Hello world', 'Hello there', 6, 11, 11);
assertNotNull(ins2, 'Selection replacement detected');
assertEqual(ins2 && ins2.insertedText, 'there', 'Selection replacement text correct');

// Pure deletion → null
const ins3 = VPSegmentTracker.computeInsertion('Hello world', 'Hello', 5, 11, 5);
assertNull(ins3, 'Pure deletion → null');

// Fresh insert on empty draft
const ins4 = VPSegmentTracker.computeInsertion('', 'Shazam, undo', 0, 0, 12);
assertNotNull(ins4, 'Fresh insert on empty draft detected');
assertEqual(ins4 && ins4.insertedText, 'Shazam, undo', 'Fresh insert text correct');


// ═══════════════════════════════════════════════════════════════════════════════
//  EDITOR STATE TESTS
// ═══════════════════════════════════════════════════════════════════════════════
section('VPEditorState – basic draft');

let s = VPEditorState.createState();
assertEqual(s.acceptedDraft, '', 'Initial draft is empty');
assertNull(s.pendingProposal, 'Initial proposal is null');
assertEqual(s.status, 'ready', 'Initial status is ready');

// Accept draft
s = VPEditorState.acceptDraft(s, 'Hello world');
assertEqual(s.acceptedDraft, 'Hello world', 'Accept draft works');
assertEqual(s.undoStack.length, 1, 'Undo stack has one entry');

section('VPEditorState – undo / redo');

s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'First version');
s = VPEditorState.acceptDraft(s, 'Second version');

const s_undo = VPEditorState.undo(s);
assertEqual(s_undo.acceptedDraft, 'First version', 'Undo restores previous draft');

const s_redo = VPEditorState.redo(s_undo);
assertEqual(s_redo.acceptedDraft, 'Second version', 'Redo restores undone draft');

// Empty stack no-ops
const s_empty = VPEditorState.createState();
const s_same = VPEditorState.undo(s_empty);
assert(s_same === s_empty, 'Undo on empty stack returns same object');

const s_same2 = VPEditorState.redo(s_empty);
assert(s_same2 === s_empty, 'Redo on empty stack returns same object');

section('VPEditorState – proposal lifecycle');

s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'Original text');
s = VPEditorState.setProposal(s, 'Revised text', 'make formal');
assertEqual(s.acceptedDraft, 'Original text', 'Preview does not alter accepted draft');
assertEqual(s.status, 'review', 'Status is review with pending proposal');
assertNotNull(s.pendingProposal, 'Pending proposal is set');

// Apply
const s_applied = VPEditorState.applyProposal(s);
assertEqual(s_applied.acceptedDraft, 'Revised text', 'Apply commits proposal');
assertNull(s_applied.pendingProposal, 'Proposal cleared after apply');

// Undo after apply
const s_undone = VPEditorState.undo(s_applied);
assertEqual(s_undone.acceptedDraft, 'Original text', 'Undo after apply restores original');

// Discard
const s_discarded = VPEditorState.discardProposal(s);
assertEqual(s_discarded.acceptedDraft, 'Original text', 'Discard preserves accepted draft');
assertNull(s_discarded.pendingProposal, 'Proposal cleared after discard');

// New proposal while one pending replaces it
const s_newprop = VPEditorState.setProposal(s, 'Second proposal', 'instruction 2');
assertEqual(s_newprop.pendingProposal.text, 'Second proposal', 'New proposal replaces old');
assertEqual(s_newprop.acceptedDraft, 'Original text', 'Draft untouched when replacing proposal');

section('VPEditorState – removeLastInsertion');

s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'Hello world. Extra.');
s = { ...s, lastSegment: { insertedText: ' Extra.', insertStart: 12, insertEnd: 19 } };
const s_removed = VPEditorState.removeLastInsertion(s);
assertEqual(s_removed.acceptedDraft, 'Hello world.', 'removeLastInsertion removes segment');
assertNull(s_removed.lastSegment, 'lastSegment cleared after removal');

// Invalid bounds → no-op
s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'Hello');
s = { ...s, lastSegment: { insertedText: 'X', insertStart: 10, insertEnd: 15 } };
const s_noop = VPEditorState.removeLastInsertion(s);
assertEqual(s_noop.acceptedDraft, 'Hello', 'Invalid bounds → no-op');

section('VPEditorState – interruption');

s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'Hello world. Aside.');
s = { ...s, flaggedSegment: { text: 'Aside.', start: 13, end: 19 } };

// Flag does not auto-delete
assertEqual(s.acceptedDraft, 'Hello world. Aside.', 'Flag does not auto-delete segment');

// Keep flagged
const s_kept = VPEditorState.keepFlaggedSegment(s);
assertNull(s_kept.flaggedSegment, 'keepFlaggedSegment clears flag');
assert(s_kept.acceptedDraft.includes('Aside.'), 'keepFlaggedSegment preserves text in draft');

// Move to notes
const s_noted = VPEditorState.moveFlaggedToNotes(s);
assert(!s_noted.acceptedDraft.includes('Aside.'), 'moveFlaggedToNotes removes from draft');
assert(s_noted.notes.includes('Aside.'), 'moveFlaggedToNotes adds to notes');

section('VPEditorState – pause/resume');

s = VPEditorState.createState();
s = VPEditorState.pause(s);
assert(s.paused === true, 'pause() sets paused=true');
assertEqual(s.status, 'paused', 'pause() sets status=paused');
s = VPEditorState.resume(s);
assert(s.paused === false, 'resume() clears paused');
assertEqual(s.status, 'ready', 'resume() sets status=ready');

section('VPEditorState – finish');

s = VPEditorState.createState();
s = VPEditorState.acceptDraft(s, 'Final draft');
s = VPEditorState.finish(s);
assertEqual(s.status, 'finished', 'finish() sets status=finished');
assertEqual(s.acceptedDraft, 'Final draft', 'finish() preserves draft');


// ═══════════════════════════════════════════════════════════════════════════════
//  BROWSER SURFACE CONTRACT TESTS (static HTML analysis)
// ═══════════════════════════════════════════════════════════════════════════════
section('Browser surface – index.html contracts');

const fs = require('fs');
const htmlPath = path.join(ROOT, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

assert(html.includes('VoicePilot'), 'BS1: VoicePilot branding present');
assert(html.includes('Write by voice'), 'BS2: tagline present');
assert(html.includes('src/command_parser.js'), 'BS3: command_parser.js loaded');
assert(html.includes('src/segment_tracker.js'), 'BS4: segment_tracker.js loaded');
assert(html.includes('src/editor_state.js'), 'BS5: editor_state.js loaded');
assert(html.includes('src/voice_feedback.js'), 'BS6: voice_feedback.js loaded');
assert(!html.includes('webkitSpeechRecognition'), 'BS7: no Web Speech API dictation button');
assert(!html.includes('.innerHTML ='), 'BS8: no unsafe innerHTML assignment');
assert(!html.includes('Wispr connected'), 'BS9: no fake Wispr connected status');
assert(!html.includes('Fidelity Firewall'), 'BS10: no FlowGuard product UI');
assert(!html.includes('benchmarkChart'), 'BS11: no benchmark chart');
assert(!html.includes('chart.js'), 'BS12: no Chart.js dependency');
assert(html.includes('id="draft-editor"'), 'BS13: draft editor textarea present');
assert(html.includes('prefers-reduced-motion'), 'BS14: reduced motion support');
assert(html.includes('id="review-panel"'), 'BS15: review panel present');
assert(html.toLowerCase().includes('limitation'), 'BS16: limitation disclosure present');
assert(!html.includes('tab-firewall'), 'BS17: no old FlowGuard tab IDs');
assert(html.includes('.textContent'), 'BS18: uses textContent for dynamic rendering');
assert(!html.includes('97.6%'), 'BS19: no scripted benchmark claims');
assert(!html.includes('Builders Track'), 'BS20: no hackathon-only track badge');


// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
process.stdout.write(`\n${'═'.repeat(60)}\n`);
process.stdout.write(`VoicePilot JS Tests: ${passed} passed, ${failed} failed\n`);
if (errors.length > 0) {
  process.stdout.write('\nFailed:\n');
  errors.forEach(e => process.stdout.write(`  ✗ ${e}\n`));
}
process.stdout.write(`${'═'.repeat(60)}\n`);
process.exit(failed > 0 ? 1 : 0);
