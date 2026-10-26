/**
 * VoicePilot — Node.js Test Runner
 * Run: node tests/test_voicepilot.js
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');

const VPCommandParser = require(path.join(ROOT, 'src', 'command_parser.js'));

let passed = 0;
let failed = 0;

function assert(cond, desc) {
  if (cond) {
    process.stdout.write(`  ✓ ${desc}\n`);
    passed++;
  } else {
    process.stdout.write(`  ✗ ${desc}\n`);
    failed++;
  }
}

function assertEqual(a, b, desc) {
  assert(a === b, `${desc} (got: ${JSON.stringify(a)}, want: ${JSON.stringify(b)})`);
}

function assertNull(v, desc) {
  assert(v === null || v === undefined, `${desc}`);
}

process.stdout.write('\n── Running Refined VoicePilot Test Suite ──\n');

// 1. Plain text null check
assertNull(VPCommandParser.parse('Hello, this is regular dictation without the catchword.'), 'Plain text returns null');
assertNull(VPCommandParser.parse(''), 'Empty text returns null');

// 2. Shazam review command
const rev = VPCommandParser.parse('Shazam, review');
assert(rev && rev.action === 'review', 'Shazam, review triggers review action');

// 3. Shazam accept / decline & natural voice alternatives
const acc = VPCommandParser.parse('Shazam, accept');
assertEqual(acc && acc.action, 'accept', 'Shazam, accept triggers accept');

const kNew = VPCommandParser.parse('Shazam, keep new');
assertEqual(kNew && kNew.action, 'accept', 'Shazam, keep new triggers accept');

const opt2 = VPCommandParser.parse('Shazam, option two');
assertEqual(opt2 && opt2.action, 'accept', 'Shazam, option two triggers accept');

const dec = VPCommandParser.parse('Shazam, decline');
assertEqual(dec && dec.action, 'decline', 'Shazam, decline triggers decline');

const kPrev = VPCommandParser.parse('Shazam, keep previous');
assertEqual(kPrev && kPrev.action, 'decline', 'Shazam, keep previous triggers decline');

const opt1 = VPCommandParser.parse('Shazam, option one');
assertEqual(opt1 && opt1.action, 'decline', 'Shazam, option one triggers decline');

// 4. Shazam edit with explicit prefix
const ed1 = VPCommandParser.parse('Shazam, edit make this more formal');
assertEqual(ed1 && ed1.action, 'ai_instruction', 'Shazam, edit triggers ai_instruction');
assertEqual(ed1 && ed1.arg, 'make this more formal', 'edit argument parsed correctly');

const ed2 = VPCommandParser.parse('Shazam , edit put comma next to hello');
assertEqual(ed2 && ed2.action, 'ai_instruction', 'Spaced Shazam , edit works');

// 5. Shazam undo / redo / read
const un = VPCommandParser.parse('Shazam, undo');
assertEqual(un && un.action, 'undo', 'Shazam, undo works');

const re = VPCommandParser.parse('Shazam, redo');
assertEqual(re && re.action, 'redo', 'Shazam, redo works');

const rd = VPCommandParser.parse('Shazam, read');
assertEqual(rd && rd.action, 'read', 'Shazam, read works');

// 6. Natural unrecognized Shazam phrases automatically route to AI agent!
const unk1 = VPCommandParser.parse('Shazam, put a comma next to hello');
assertEqual(unk1 && unk1.action, 'ai_instruction', 'Natural command routes to ai_instruction');
assertEqual(unk1 && unk1.arg, 'put a comma next to hello', 'Instruction text captured');

const unk2 = VPCommandParser.parse('Shazam, summarize this into one paragraph');
assertEqual(unk2 && unk2.action, 'ai_instruction', 'Summarize command routes to ai_instruction');
assertEqual(unk2 && unk2.arg, 'summarize this into one paragraph', 'Summarize instruction captured');

// 7. Empty Shazam
const emptyShazam = VPCommandParser.parse('Shazam');
assertEqual(emptyShazam && emptyShazam.action, 'empty_prompt', 'Standalone catchword returns empty_prompt');

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
