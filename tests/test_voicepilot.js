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

// 2. Shazam review command (with and without punctuation)
const rev1 = VPCommandParser.parse('Shazam, review');
assertEqual(rev1 && rev1.action, 'review', 'Shazam, review triggers local review action');

const rev2 = VPCommandParser.parse('Shazam, review.');
assertEqual(rev2 && rev2.action, 'review', 'Shazam, review. with period triggers local review action');

// 3. Local Undo & Redo (MUST work locally even with dictation punctuation)
const un1 = VPCommandParser.parse('Shazam, undo');
assertEqual(un1 && un1.action, 'undo', 'Shazam, undo works locally');

const un2 = VPCommandParser.parse('Shazam, undo.');
assertEqual(un2 && un2.action, 'undo', 'Shazam, undo. with period works locally (NEVER sends to AI)');

const un3 = VPCommandParser.parse('Shazam, undo that');
assertEqual(un3 && un3.action, 'undo', 'Shazam, undo that works locally');

const re1 = VPCommandParser.parse('Shazam, redo');
assertEqual(re1 && re1.action, 'redo', 'Shazam, redo works locally');

const re2 = VPCommandParser.parse('Shazam, redo.');
assertEqual(re2 && re2.action, 'redo', 'Shazam, redo. with period works locally');

// 4. Local Read, Stop & Silence
const rd1 = VPCommandParser.parse('Shazam, read');
assertEqual(rd1 && rd1.action, 'read', 'Shazam, read works locally');

const rd2 = VPCommandParser.parse('Shazam, read.');
assertEqual(rd2 && rd2.action, 'read', 'Shazam, read. with period works locally');

const rd3 = VPCommandParser.parse('Shazam, read aloud.');
assertEqual(rd3 && rd3.action, 'read', 'Shazam, read aloud. works locally');

const st1 = VPCommandParser.parse('Shazam, stop');
assertEqual(st1 && st1.action, 'stop', 'Shazam, stop works locally');

const st2 = VPCommandParser.parse('Shazam, silence.');
assertEqual(st2 && st2.action, 'stop', 'Shazam, silence. works locally');

// 5. Local Copy & Clear (Shazam, clear)
const cp1 = VPCommandParser.parse('Shazam, copy');
assertEqual(cp1 && cp1.action, 'copy', 'Shazam, copy works locally');

const cp2 = VPCommandParser.parse('Shazam, copy to clipboard.');
assertEqual(cp2 && cp2.action, 'copy', 'Shazam, copy to clipboard. works locally');

const cl0 = VPCommandParser.parse('Shazam, clear');
assertEqual(cl0 && cl0.action, 'clear', 'Shazam, clear works locally');

const cl1 = VPCommandParser.parse('Shazam, clear draft.');
assertEqual(cl1 && cl1.action, 'clear', 'Shazam, clear draft. works locally');

const cl2 = VPCommandParser.parse('Shazam, clear all');
assertEqual(cl2 && cl2.action, 'clear', 'Shazam, clear all works locally');

const cl3 = VPCommandParser.parse('Shazam, clear text.');
assertEqual(cl3 && cl3.action, 'clear', 'Shazam, clear text. works locally');

const cl4 = VPCommandParser.parse('Shazam, clear document');
assertEqual(cl4 && cl4.action, 'clear', 'Shazam, clear document works locally');

// 6. Local Accept & Decline (MUST work locally with all natural variations)
const acc1 = VPCommandParser.parse('Shazam, accept');
assertEqual(acc1 && acc1.action, 'accept', 'Shazam, accept works locally');

const acc2 = VPCommandParser.parse('Shazam, accept.');
assertEqual(acc2 && acc2.action, 'accept', 'Shazam, accept. with period works locally');

const acc3 = VPCommandParser.parse('Shazam, keep new.');
assertEqual(acc3 && acc3.action, 'accept', 'Shazam, keep new. works locally');

const acc4 = VPCommandParser.parse('Shazam, option two.');
assertEqual(acc4 && acc4.action, 'accept', 'Shazam, option two. works locally');

const acc5 = VPCommandParser.parse('Shazam, accept this');
assertEqual(acc5 && acc5.action, 'accept', 'Shazam, accept this works locally');

const acc6 = VPCommandParser.parse('Shazam, apply changes');
assertEqual(acc6 && acc6.action, 'accept', 'Shazam, apply changes works locally');

const acc7 = VPCommandParser.parse('Shazam, keep');
assertEqual(acc7 && acc7.action, 'accept', 'Shazam, keep works locally');

const dec1 = VPCommandParser.parse('Shazam, decline');
assertEqual(dec1 && dec1.action, 'decline', 'Shazam, decline works locally');

const dec2 = VPCommandParser.parse('Shazam, decline.');
assertEqual(dec2 && dec2.action, 'decline', 'Shazam, decline. with period works locally');

const dec3 = VPCommandParser.parse('Shazam, keep previous.');
assertEqual(dec3 && dec3.action, 'decline', 'Shazam, keep previous. works locally');

const dec4 = VPCommandParser.parse('Shazam, option one.');
assertEqual(dec4 && dec4.action, 'decline', 'Shazam, option one. works locally');

const dec5 = VPCommandParser.parse('Shazam, reject');
assertEqual(dec5 && dec5.action, 'decline', 'Shazam, reject works locally');

const dec6 = VPCommandParser.parse('Shazam, discard');
assertEqual(dec6 && dec6.action, 'decline', 'Shazam, discard works locally');

// 7. Rich Text Formatting Commands (Local, instant)
const fmt1 = VPCommandParser.parse('Shazam, bold');
assertEqual(fmt1 && fmt1.action, 'format_bold', 'Shazam, bold works locally');

const fmt2 = VPCommandParser.parse('Shazam, make this bold.');
assertEqual(fmt2 && fmt2.action, 'format_bold', 'Shazam, make this bold. works locally');

const fmt3 = VPCommandParser.parse('Shazam, italic');
assertEqual(fmt3 && fmt3.action, 'format_italic', 'Shazam, italic works locally');

const fmt4 = VPCommandParser.parse('Shazam, heading');
assertEqual(fmt4 && fmt4.action, 'format_heading', 'Shazam, heading works locally');

const fmt5 = VPCommandParser.parse('Shazam, bullet point');
assertEqual(fmt5 && fmt5.action, 'format_list', 'Shazam, bullet point works locally');

// 8. Natural AI instructions (Only actual instructions are sent to AI)
const ai1 = VPCommandParser.parse('Shazam, put a comma next to hello');
assertEqual(ai1 && ai1.action, 'ai_instruction', 'Natural command routes to ai_instruction');
assertEqual(ai1 && ai1.arg, 'put a comma next to hello', 'Instruction text captured cleanly');

const ai2 = VPCommandParser.parse('Shazam, edit add exclamation mark at the end.');
assertEqual(ai2 && ai2.action, 'ai_instruction', 'Explicit edit command routes to ai_instruction');

// 9. Empty Shazam
const emptyShazam = VPCommandParser.parse('Shazam');
assertEqual(emptyShazam && emptyShazam.action, 'empty_prompt', 'Standalone catchword returns empty_prompt');

// 10. Speech-preceded commands (speech + command in same dictation burst)
const pre1 = VPCommandParser.parse('Here is a sentence. Shazam, bold');
assertEqual(pre1 && pre1.action, 'format_bold', 'Dictated sentence followed by Shazam, bold works');
assertEqual(pre1 && pre1.commandText, 'Shazam, bold', 'Command text extracted cleanly from sentence');

const pre2 = VPCommandParser.parse('I want to improve this paragraph. Shazam, review.');
assertEqual(pre2 && pre2.action, 'review', 'Dictated sentence followed by Shazam, review. works');

// 11. Verification that leftover 'Shaz' / 'Shazam' is scrubbed from HTML/text
function cleanCommandFromHtml(html, cmdText, catchword) {
  let cleaned = html || '';
  if (cmdText && cleaned.includes(cmdText)) {
    const idx = cleaned.lastIndexOf(cmdText);
    cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + cmdText.length);
  } else if (cmdText) {
    const escCmd = cmdText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escCmd, 'gi'), '');
  }
  const escCatch = (catchword || 'Shazam').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cleaned = cleaned.replace(new RegExp('\\b' + escCatch + '\\b[\\s,.:;!?-]*', 'gi'), '');
  cleaned = cleaned.replace(/\bShaz(?:a|am)?\b[\s,.:;!?-]*/gi, '');
  cleaned = cleaned.replace(/<(?:div|p|span)[^>]*>\s*<\/(?:div|p|span)>/gi, '');
  cleaned = cleaned.replace(/(?:&nbsp;|\s)+$/, '');
  return cleaned.trim();
}

const cleaned1 = cleanCommandFromHtml('Hello world Shazam, bold', 'Shazam, bold', 'Shazam');
assertEqual(cleaned1, 'Hello world', 'cleanCommandFromHtml removes full command without residual');

const cleaned2 = cleanCommandFromHtml('<div>Hello world Shaz</div>', 'Shazam, bold', 'Shazam');
assertEqual(cleaned2, '<div>Hello world </div>', 'cleanCommandFromHtml removes orphaned Shaz leftover');

const cleaned3 = cleanCommandFromHtml('<p>Meeting tomorrow at five Shaz</p>', 'Shazam, review', 'Shazam');
assertEqual(cleaned3, '<p>Meeting tomorrow at five </p>', 'cleanCommandFromHtml removes trailing Shaz from paragraph');

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
