# VoicePilot — Write by voice. Edit by voice. Stay hands-free.

VoicePilot is a **local-first, voice-controlled rich text editor** designed specifically for [Wispr Flow](https://wisprflow.ai). Wispr Flow provides real-time speech transcription; VoicePilot interprets "Shazam" voice commands, applies rich-text formatting (bold, italics, headings, bullet lists), manages revision proposals with in-place diffs, captures spoken interruptions into separate voice notes, and enables hands-free undo, redo, audio playback, and clipboard actions.

**Target users:** Students, professionals, writers, and accessibility-first users dictating emails, essays, meeting notes, reports, articles, and personal documents hands-free.

---

## How It Works with Wispr Flow

1. Open `index.html` in your browser (or host it locally) and **focus the draft editor**.
2. Activate Wispr Flow using your native desktop shortcut: **Ctrl+Win** (Windows) or **Fn** (Mac).
3. Wispr Flow transcribes your voice directly into the editor.
4. VoicePilot continuously watches for completed speech bursts.
5. Ordinary speech flows directly into your draft. Sentences mentioning the catchword declaratively (e.g. *"Shazam is a music app"*) remain untouched as ordinary text.
6. Spoken commands (e.g. *"Shazam, bold"*, *"Shazam, polish"*, *"Shazam, make that a separate note"*) are detected, isolated, and safely removed using **text-aware DOM Range operations** before executing the corresponding action.

> **Honest Wispr Flow Note:** VoicePilot runs as a web application and does not start or stop the Wispr Flow desktop process. Web applications cannot globally synthesize keyboard events to launch external desktop software. Use Wispr Flow's native shortcut to toggle dictation.

---

## Master Voice Command Reference

Trigger phrase is configurable in Settings (default: **"Shazam"**):

| Command | Action Category | What It Does |
|---|---|---|
| `Shazam, bold` | Rich Formatting | Bolds current selection or preceding word |
| `Shazam, italic` | Rich Formatting | Italicizes current selection or preceding word |
| `Shazam, heading` | Rich Formatting | Formats current block as a Heading (H2) |
| `Shazam, bullet point` / `list` | Rich Formatting | Formats current block as an unordered bullet list |
| `Shazam, review` / `polish` | AI Proposal | Proposes a full-document polish for grammar, clarity, and tone |
| `Shazam, edit: [instruction]` | AI Proposal | Proposes targeted revision based on your natural-language instruction |
| `Shazam, put a comma next to [word]` | Instant Edit | Adds comma after target word without waiting for cloud roundtrips |
| `Shazam, accept` / `keep` | Revision Review | Commits the pending proposed revision into the accepted draft |
| `Shazam, decline` / `discard` | Revision Review | Rejects the proposed revision; keeps the accepted draft intact |
| `Shazam, make that a separate note` | Voice Clipping | Extracts last speech burst or selected text into the Voice Notes drawer |
| `Shazam, remove last insertion` | Error Recovery | Removes the most recently dictated speech burst from the document |
| `Shazam, undo` / `undo that` | Revision History | Reverses the last accepted change |
| `Shazam, redo` / `redo that` | Revision History | Re-applies a previously undone revision |
| `Shazam, read` / `read aloud` | Audio Feedback | Reads the accepted document (or pending proposal) via SpeechSynthesis |
| `Shazam, stop` / `silence` | Audio Feedback | Immediately stops speech synthesis and halts any pending AI request |
| `Shazam, copy` | Clipboard | Copies full document text to clipboard |
| `Shazam, clear` | Document Safety | Clears document draft while saving a recoverable snapshot to undo history |

---

## Key Architecture & Safety Upgrades

### 1. Safe Command Removal (No innerHTML String Replacement)
Older implementations stripped commands via naive regex replacements on `innerHTML`, which mangled nested HTML tags, broke paragraphs, and left trailing leftovers like *"Shaz"*.
VoicePilot uses `VPDomRangeRemover`:
- Maps character positions directly to DOM text nodes.
- Uses native browser DOM `Range.deleteContents()`.
- Preserves all valid tags (`<p>`, `<strong>`, `<em>`, `<h2>`, `<ul>`, `<li>`, `<a>`).
- Handles repeated occurrences correctly (targets the command at utterance end, preserving earlier text mentions).
- Leaves text completely untouched if boundaries are ambiguous.

### 2. Disambiguating Ordinary Speech from Commands
Ordinary sentences containing the wake word (e.g. *"Shazam is a music application"*, *"I heard someone mention Shazam yesterday"*, *"The word Shazam appears in this article"*) are recognized as non-commands and preserved as regular text. Commands are executed only when followed by recognized verbs or imperative instructions.

### 3. Server-Side AI API Key Security
- **Zero API keys in client storage:** Permanent provider API keys are never stored in browser `localStorage`.
- Credentials live exclusively on your backend server (`voicepilot_server.py`) as environment variables:
  - `GEMINI_API_KEY` (Google Gemini 1.5 Flash / 2.0 Flash)
  - `OPENAI_API_KEY` (OpenAI GPT-4o-mini)
  - `ANTHROPIC_API_KEY` (Anthropic Claude Haiku)
- Plaintext AI output is sanitized and treated as untrusted text.
- If the backend server is offline, VoicePilot provides a truthful disclosure while all local commands (formatting, undo/redo, notes, read aloud, copy, clear) remain 100% operational.

### 4. Non-Destructive Proposal Workflow
- `Shazam, review` and `Shazam, edit: ...` never overwrite the document silently.
- A `pendingProposal` is created with an in-place visual diff:
  - **Soft green** background for additions.
  - **Soft red** background for removals (**no strikethrough** for visual cleanliness).
  - All diff tokens are HTML-escaped through `VPSanitizer` to prevent XSS.
- Subsequent voice instructions refine the pending proposal against the accepted draft.
- The user retains final authority: `Shazam, accept` commits to draft; `Shazam, decline` drops it.

### 5. Separate Voice Notes Drawer
- Spoken side-thoughts and tangents can be clipped using `Shazam, make that a separate note`.
- Extracted notes are stored in a dedicated sidebar drawer with individual copy and delete controls.

---

## Setup and Quickstart

### 1. Client-Side (All Local Voice Commands)
Simply open `index.html` in your browser:
```bash
# Serve locally with any static server or open file directly:
npx serve .
# or
python -m http.server 5000
```
Open `http://localhost:5000/` or `index.html`. All deterministic commands (formatting, notes, undo/redo, TTS reading, copy, clear) work locally with zero configuration.

### 2. AI Editing Backend (Optional for "Shazam, edit:" and "Shazam, polish")
Install backend requirements:
```bash
pip install flask flask-cors
```
Set your preferred provider API key:
```bash
# Google Gemini (Default recommended: zero extra pip dependencies)
export GEMINI_API_KEY="your-gemini-key"

# Or OpenAI
pip install openai
export OPENAI_API_KEY="sk-..."

# Or Anthropic
pip install anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```
Start the server:
```bash
python backend/voicepilot_server.py
```
The server runs on `http://localhost:5000`. VoicePilot automatically connects to the local server if running, or uses the built-in instant proofreading engine when running standalone on GitHub Pages (`https://manishr075.github.io/voicepilot/`).

---

## Test Suite

Run the Node.js test suite covering parser rules, DOM range boundaries, XSS sanitization, proposal state transitions, and segment tracker diffing:

```bash
node tests/test_voicepilot.js
```

**Results:**
```
════════════════════ Results: 77 passed, 0 failed. ════════════════════
```

---

## Repository Structure

```
flowguard/
├── index.html                   # VoicePilot application surface
├── src/
│   ├── command_parser.js        # Catchword & grammar parser with ordinary speech safety
│   ├── dom_range_remover.js     # Text-aware DOM Range command remover
│   ├── editor_state.js          # Immutable editor state manager (draft, proposals, undo, notes)
│   ├── sanitizer.js             # HTML allowlist sanitizer & XSS-safe diff renderer
│   ├── segment_tracker.js       # Wispr Flow contenteditable & textarea input burst tracker
│   ├── voice_feedback.js        # SpeechSynthesis TTS feedback wrapper
│   └── app_controller.js        # UI controller wiring DOM, voice events, and backend
├── backend/
│   └── voicepilot_server.py     # Secure Flask backend with Gemini, OpenAI, & Anthropic support
├── assets/
│   ├── logo.png                 # VoicePilot brand soundwave logo
│   └── app-icon.png             # Application icon
└── tests/
    └── test_voicepilot.js       # 77 automated test assertions verifying all critical requirements
```

---

## License & Credits

- **VoicePilot** developed by **Manish Reddy**.
- Designed for use with [Wispr Flow](https://wisprflow.ai).
- MIT License.
