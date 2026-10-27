/**
 * VoicePilot — Master Automated Test Suite (Node.js)
 * Tests:
 *   1. Command Parser & Ordinary Speech Safety
 *   2. Text-Aware DOM Range Command Boundaries
 *   3. Security & HTML Sanitizer (XSS Prevention & Diff Escaping)
 *   4. Editor State Management (Proposals, Undo/Redo, Notes)
 *   5. Segment Tracker Insertion Calculations
 *
 * Run:
 *   node tests/test_voicepilot.js
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');

const VPCommandParser   = require(path.join(ROOT, 'src', 'command_parser.js'));
const VPSanitizer       = require(path.join(ROOT, 'src', 'sanitizer.js'));
const VPDomRangeRemover = require(path.join(ROOT, 'src', 'dom_range_remover.js'));
const VPEditorState     = require(path.join(ROOT, 'src', 'editor_state.js'));
const VPSegmentTracker  = require(path.join(ROOT, 'src', 'segment_tracker.js'));

let passed = 0;
let failed = 0;

function assert(cond, desc) {
  if (cond) {
    process.stdout.write(`  ✓ ${desc}\n`);
    passed++;
  } else {
    process.stdout.write(`  ✗ FAIL: ${desc}\n`);
    failed++;
  }
}

function assertEqual(a, b, desc) {
  assert(a === b, `${desc} (got: ${JSON.stringify(a)}, want: ${JSON.stringify(b)})`);
}

function assertNull(v, desc) {
  assert(v === null || v === undefined, `${desc} (expected null/undefined, got: ${JSON.stringify(v)})`);
}

process.stdout.write('\n════════════════════ VoicePilot Comprehensive Test Suite ════════════════════\n');

// ── 1. ORDINARY SPEECH DISAMBIGUATION (Critical Requirement 6) ──
process.stdout.write('\n1. Ordinary Speech vs Command Recognition:\n');

assertNull(VPCommandParser.parse('Shazam is a music application.'),
  'Ordinary sentence: "Shazam is a music application." returns null');

assertNull(VPCommandParser.parse('I heard someone mention Shazam yesterday.'),
  'Ordinary sentence: "I heard someone mention Shazam yesterday." returns null');

assertNull(VPCommandParser.parse('The word Shazam appears in this article.'),
  'Ordinary sentence: "The word Shazam appears in this article." returns null');

assertNull(VPCommandParser.parse('Hello, this is regular dictation without the catchword.'),
  'Plain text without catchword returns null');

assertNull(VPCommandParser.parse(''),
  'Empty string returns null');

assertNull(VPCommandParser.parse('Shazam was originally an ancient wizard.'),
  'Declarative sentence starting with "was" returns null');

assertNull(VPCommandParser.parse('We talked about Shazam today in our meeting.'),
  'Sentence with catchword followed by "today" returns null');


// ── 2. EVERY ADVERTISED COMMAND MUST WORK (Critical Requirement 5) ──
process.stdout.write('\n2. Advertised Voice Commands & Natural Variations:\n');

// Review / Polish
const rev1 = VPCommandParser.parse('Shazam, review');
assertEqual(rev1 && rev1.action, 'review', 'Shazam, review routes to review');

const rev2 = VPCommandParser.parse('Shazam, polish.');
assertEqual(rev2 && rev2.action, 'review', 'Shazam, polish. routes to review');

const rev3 = VPCommandParser.parse('Shazam, ai review');
assertEqual(rev3 && rev3.action, 'review', 'Shazam, ai review routes to review');

// Undo & Redo
const un1 = VPCommandParser.parse('Shazam, undo');
assertEqual(un1 && un1.action, 'undo', 'Shazam, undo routes to undo');

const un2 = VPCommandParser.parse('Shazam, undo that.');
assertEqual(un2 && un2.action, 'undo', 'Shazam, undo that. routes to undo');

const re1 = VPCommandParser.parse('Shazam, redo');
assertEqual(re1 && re1.action, 'redo', 'Shazam, redo routes to redo');

const re2 = VPCommandParser.parse('Shazam, redo that.');
assertEqual(re2 && re2.action, 'redo', 'Shazam, redo that. routes to redo');

// Accept / Keep / Apply
const acc1 = VPCommandParser.parse('Shazam, accept');
assertEqual(acc1 && acc1.action, 'accept', 'Shazam, accept routes to accept');

const acc2 = VPCommandParser.parse('Shazam, apply');
assertEqual(acc2 && acc2.action, 'accept', 'Shazam, apply routes to accept');

const acc3 = VPCommandParser.parse('Shazam, keep new.');
assertEqual(acc3 && acc3.action, 'accept', 'Shazam, keep new. routes to accept');

const acc4 = VPCommandParser.parse('Shazam, option two');
assertEqual(acc4 && acc4.action, 'accept', 'Shazam, option two routes to accept');

// Decline / Discard / Reject
const dec1 = VPCommandParser.parse('Shazam, decline');
assertEqual(dec1 && dec1.action, 'decline', 'Shazam, decline routes to decline');

const dec2 = VPCommandParser.parse('Shazam, discard');
assertEqual(dec2 && dec2.action, 'decline', 'Shazam, discard routes to decline');

const dec3 = VPCommandParser.parse('Shazam, reject');
assertEqual(dec3 && dec3.action, 'decline', 'Shazam, reject routes to decline');

const dec4 = VPCommandParser.parse('Shazam, keep previous.');
assertEqual(dec4 && dec4.action, 'decline', 'Shazam, keep previous. routes to decline');

const dec5 = VPCommandParser.parse('Shazam, option one');
assertEqual(dec5 && dec5.action, 'decline', 'Shazam, option one routes to decline');

// Separate Note & Remove Last
const note1 = VPCommandParser.parse('Shazam, make that a separate note');
assertEqual(note1 && note1.action, 'separate_note', 'Shazam, make that a separate note routes to separate_note');

const note2 = VPCommandParser.parse('Shazam, separate note.');
assertEqual(note2 && note2.action, 'separate_note', 'Shazam, separate note. routes to separate_note');

const note3 = VPCommandParser.parse('Hello, my name is Manish Reddy, and I am studying at RV University. My goal is to become a software engineer and win this hackathon. Shazam, make the whole a separate note.');
assertEqual(note3 && note3.action, 'separate_note', 'Dictated paragraph ending with "Shazam, make the whole a separate note." routes to separate_note');

const note4 = VPCommandParser.parse('Shazam, make this a separate note');
assertEqual(note4 && note4.action, 'separate_note', 'Shazam, make this a separate note routes to separate_note');

const note5 = VPCommandParser.parse('Shazam, save to notes.');
assertEqual(note5 && note5.action, 'separate_note', 'Shazam, save to notes. routes to separate_note');

const rem1 = VPCommandParser.parse('Shazam, remove last insertion');
assertEqual(rem1 && rem1.action, 'remove_last', 'Shazam, remove last insertion routes to remove_last');

const rem2 = VPCommandParser.parse('Shazam, remove that.');
assertEqual(rem2 && rem2.action, 'remove_last', 'Shazam, remove that. routes to remove_last');

// Read, Stop, Copy, Clear
const rd1 = VPCommandParser.parse('Shazam, read');
assertEqual(rd1 && rd1.action, 'read', 'Shazam, read routes to read');

const rd2 = VPCommandParser.parse('Shazam, read aloud.');
assertEqual(rd2 && rd2.action, 'read', 'Shazam, read aloud. routes to read');

const st1 = VPCommandParser.parse('Shazam, stop');
assertEqual(st1 && st1.action, 'stop', 'Shazam, stop routes to stop');

const st2 = VPCommandParser.parse('Shazam, silence.');
assertEqual(st2 && st2.action, 'stop', 'Shazam, silence. routes to stop');

const cp1 = VPCommandParser.parse('Shazam, copy');
assertEqual(cp1 && cp1.action, 'copy', 'Shazam, copy routes to copy');

const cp2 = VPCommandParser.parse('Shazam, copy to clipboard.');
assertEqual(cp2 && cp2.action, 'copy', 'Shazam, copy to clipboard. routes to copy');

const cl1 = VPCommandParser.parse('Shazam, clear');
assertEqual(cl1 && cl1.action, 'clear', 'Shazam, clear routes to clear');

const cl2 = VPCommandParser.parse('Shazam, clear draft.');
assertEqual(cl2 && cl2.action, 'clear', 'Shazam, clear draft. routes to clear');

const tw1 = VPCommandParser.parse('Shazam, expand');
assertEqual(tw1 && tw1.action, 'toggle_width', 'Shazam, expand routes to toggle_width');

const tw2 = VPCommandParser.parse('Shazam, toggle width.');
assertEqual(tw2 && tw2.action, 'toggle_width', 'Shazam, toggle width. routes to toggle_width');

// Formatting Commands
const fmt1 = VPCommandParser.parse('Shazam, bold');
assertEqual(fmt1 && fmt1.action, 'format_bold', 'Shazam, bold routes to format_bold');

const fmt2 = VPCommandParser.parse('Shazam, italic');
assertEqual(fmt2 && fmt2.action, 'format_italic', 'Shazam, italic routes to format_italic');

const fmt3 = VPCommandParser.parse('Shazam, heading');
assertEqual(fmt3 && fmt3.action, 'format_heading', 'Shazam, heading routes to format_heading');

const fmt4 = VPCommandParser.parse('Shazam, bullet point');
assertEqual(fmt4 && fmt4.action, 'format_list', 'Shazam, bullet point routes to format_list');

// AI Instructions
const ai1 = VPCommandParser.parse('Shazam, edit: make it concise');
assertEqual(ai1 && ai1.action, 'ai_instruction', 'Shazam, edit: ... routes to ai_instruction');
assertEqual(ai1 && ai1.arg, 'make it concise', 'Edit argument captured cleanly');

const ai2 = VPCommandParser.parse('Shazam, put a comma next to hello');
assertEqual(ai2 && ai2.action, 'ai_instruction', 'Imperative instruction routes to ai_instruction');
assertEqual(ai2 && ai2.arg, 'put a comma next to hello', 'Imperative argument captured cleanly');

// Comma after edit: "Shazam edit, put a comma next to hello."
const ai3 = VPCommandParser.parse('Shazam edit, put a comma next to hello.');
assertEqual(ai3 && ai3.action, 'ai_instruction', 'Shazam edit, ... (with comma) routes to ai_instruction');
assertEqual(ai3 && ai3.arg, 'put a comma next to hello', 'Captured argument without edit prefix');

// Imperative variations: "Shazam, make N capital in my name."
const ai4 = VPCommandParser.parse('Shazam, make N capital in my name.');
assertEqual(ai4 && ai4.action, 'ai_instruction', 'Shazam, make N capital... routes to ai_instruction');

// Imperative variations: "Shazam, make a capital in the name."
const ai5 = VPCommandParser.parse('Shazam, make a capital in the name.');
assertEqual(ai5 && ai5.action, 'ai_instruction', 'Shazam, make a capital... routes to ai_instruction');

// Greeting check: "Shazam, hello."
const greet1 = VPCommandParser.parse('Shazam, hello.');
assertEqual(greet1 && greet1.action, 'greeting', 'Shazam, hello. routes to greeting check');

// Speech burst followed by command
const burst1 = VPCommandParser.parse('This was a great meeting. Shazam, bold');
assertEqual(burst1 && burst1.action, 'format_bold', 'Speech burst + command recognized');
assertEqual(burst1 && burst1.commandText, 'Shazam, bold', 'Command text extracted cleanly from burst');


// ── 3. SAFE DOM RANGE COMMAND BOUNDARIES (Critical Requirement 3) ──
process.stdout.write('\n3. Safe Text-Aware Command Removal Boundaries:\n');

const range1 = VPDomRangeRemover.findCommandRange('Hello world Shazam, bold', 'Shazam, bold', 'Shazam');
assert(range1 && range1.start === 11 && range1.end === 24,
  'Command range at text boundary identified accurately');

// Repeated catchword handling (Must target insertion at end, preserve earlier mention)
const repeatText = 'I really like the movie Shazam. Shazam, bold';
const rangeRepeat = VPDomRangeRemover.findCommandRange(repeatText, 'Shazam, bold', 'Shazam');
assert(rangeRepeat && rangeRepeat.start === 31,
  'Repeated phrase: targets command at end, preserves earlier catchword in text');
const slicedRepeat = repeatText.slice(0, rangeRepeat.start) + repeatText.slice(rangeRepeat.end);
assertEqual(slicedRepeat, 'I really like the movie Shazam.',
  'Preserves earlier catchword occurrence without corruption');

// Trailing punctuation handling
const rangePunct = VPDomRangeRemover.findCommandRange('Good morning. Shazam, review.', 'Shazam, review', 'Shazam');
assert(rangePunct && rangePunct.end >= 28,
  'Swallows trailing dictation punctuation');

// Partial / split catchword prefix ("Shaz") safety
const splitText = 'Draft text. Shaz am, edit: make it concise.';
const rangeSplit = VPDomRangeRemover.findCommandRange(splitText, 'am, edit: make it concise.', 'Shazam');
assert(rangeSplit && rangeSplit.start <= splitText.indexOf('Shaz'),
  'Swallows preceding partial catchword "Shaz" so no fragments remain');

// Ambiguous or missing boundaries
const rangeAmbiguous = VPDomRangeRemover.findCommandRange('Text without match', 'Shazam, bold', 'Shazam');
assertNull(rangeAmbiguous,
  'Unresolvable command boundary safely returns null (does not guess or corrupt)');


// ── 4. SECURITY & SANITIZATION (Critical Requirement 4 & 7) ──
process.stdout.write('\n4. Security, HTML Sanitizer & Diff Escaping:\n');

// Escaping
const esc = VPSanitizer.escapeHtml('<script>alert("xss")</script>&');
assertEqual(esc, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;',
  'HTML entities strictly escaped');

// Diff rendering prevents XSS
const diffXss = VPSanitizer.renderInPlaceDiff('Hello world', 'Hello <img src=x onerror=alert(1)>');
assert(diffXss.includes('&lt;img src=x onerror=alert(1)&gt;'),
  'Diff escapes dangerous HTML tags');
assert(!diffXss.includes('<img'),
  'Diff does not inject raw HTML tags');

// In-place diff styling (soft highlights, no strikethrough)
assert(diffXss.includes('class="diff-added-highlight"'),
  'Diff includes soft green addition highlight');
assert(!diffXss.includes('<del>'),
  'Diff does not use <del> strikethrough tags');
assert(!diffXss.includes('line-through'),
  'Diff does not use line-through style');

// Sanitizer cleans scripts and event handlers
const dirty = '<p>Safe text</p><script>alert(1)</script><div onclick="evil()">Click</div>';
const cleaned = VPSanitizer.sanitize(dirty);
assert(!cleaned.includes('<script>'), 'Sanitizer strips script tags');
assert(!cleaned.includes('onclick'), 'Sanitizer strips inline event handlers');


// ── 5. AI REVISION WORKFLOW & EDITOR STATE (Critical Requirement 5 & 7) ──
process.stdout.write('\n5. AI Revision Workflow & State Model:\n');

let st = VPEditorState.createState('Initial draft text.');
assertEqual(st.acceptedDraft, 'Initial draft text.', 'Initial accepted draft set');
assertNull(st.pendingProposal, 'Pending proposal initially null');

// Propose an AI edit
st = VPEditorState.proposeEdit(st, 'Polished draft text.', 'Grammar polish', true);
assertEqual(st.acceptedDraft, 'Initial draft text.',
  'Accepted draft preserved untouched when proposal is generated');
assert(st.pendingProposal && st.pendingProposal.text === 'Polished draft text.',
  'Pending proposal contains revised text');
assertEqual(st.status, 'review', 'Status updated to review');

// Discard proposal
const discarded = VPEditorState.discardProposal(st);
assertNull(discarded.pendingProposal, 'Discarding proposal clears pending proposal');
assertEqual(discarded.acceptedDraft, 'Initial draft text.', 'Discarding proposal preserves accepted draft');

// Apply proposal
const applied = VPEditorState.applyProposal(st);
assertEqual(applied.acceptedDraft, 'Polished draft text.', 'Applying proposal updates accepted draft');
assertNull(applied.pendingProposal, 'Applying proposal clears pending proposal');
assertEqual(applied.undoStack.length, 1, 'Applying proposal creates undo history entry');

// Undo
const undone = VPEditorState.undo(applied);
assertEqual(undone.acceptedDraft, 'Initial draft text.', 'Undo restores previous accepted draft');
assertEqual(undone.redoStack.length, 1, 'Undo populates redo stack');

// Redo
const redone = VPEditorState.redo(undone);
assertEqual(redone.acceptedDraft, 'Polished draft text.', 'Redo restores draft');

// Separate Notes Management
let stNotes = VPEditorState.createState('Paragraph one.\nIdea for note.');
stNotes = VPEditorState.addNote(stNotes, 'Idea for note.');
assertEqual(stNotes.notes.length, 1, 'addNote adds note to notes collection');
assertEqual(stNotes.notes[0], 'Idea for note.', 'Note text saved accurately');

stNotes = VPEditorState.removeNote(stNotes, 0);
assertEqual(stNotes.notes.length, 0, 'removeNote removes specific note');


// ── 6. SEGMENT TRACKER CALCULATIONS ──
process.stdout.write('\n6. Segment Tracker Diffing:\n');

const ins1 = VPSegmentTracker.computeInsertion('Hello', 'Hello world', 5, 5, 11);
assertEqual(ins1 && ins1.insertedText, ' world', 'Computes simple appended speech segment');

const ins2 = VPSegmentTracker.computeInsertion('Start end', 'Start inserted end', 6, 6, 15);
assertEqual(ins2 && ins2.insertedText, 'inserted ', 'Computes mid-text speech insertion');

const insDel = VPSegmentTracker.computeInsertion('Hello world', 'Hello', 5, 11, 5);
assertNull(insDel, 'Net deletion returns null (not tracked as insertion)');


// ── FINAL SUMMARY ──
process.stdout.write(`\n════════════════════ Results: ${passed} passed, ${failed} failed. ════════════════════\n\n`);
if (failed > 0) {
  process.exit(1);
}
