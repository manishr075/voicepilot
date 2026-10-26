# FlowPad — Write by voice. Edit by voice. Stay hands-free.

FlowPad is a **local-first, voice-controlled text editor** built for [Wispr Flow](https://wisprflow.ai). Wispr Flow transcribes your speech; FlowPad receives the resulting text, recognises "Shazam" voice commands, formats with bold/italic/headings/lists hands-free, lets you revise drafts by voice, preview in-place diffs before accepting, and undo/redo through a full revision history.

**Target users:** students, professionals, content creators, and anyone who prefers hands-free text editing for emails, assignments, reports, notes, social posts, and documents.

---

## How it works with Wispr Flow

1. Open `index.html` in your browser and **focus the draft editor**.
2. Activate Wispr Flow using its supported desktop shortcut: **Ctrl+Win** (Windows) or **Fn** (Mac).
3. Wispr Flow transcribes your speech and inserts the text into the focused editor.
4. VoicePilot watches for new insertions using browser input events (`beforeinput`, `input`, `paste`).
5. Text without a "Shazam" prefix is kept as draft content. A valid command is extracted, processed, and its text is removed from the draft automatically.

> **Note:** VoicePilot does not start or stop Wispr Flow. A web page cannot reliably activate another desktop application. Use Wispr's own shortcut for dictation. A future optional desktop companion could listen for a custom wake phrase and trigger the shortcut — but this is not yet implemented and is not claimed.

---

## Command Reference

Say **"Shazam, &lt;command&gt;"** (also works with a colon, different case, or space-only separator):

| Command | What it does |
|---|---|
| `Shazam, edit: [instruction]` | Create an AI-powered revision proposal from the current draft |
| `Shazam, preview` | Show (and optionally speak) the pending revision |
| `Shazam, apply` | Accept the pending proposal and save it to history |
| `Shazam, discard` | Reject the proposal; keep the current draft |
| `Shazam, undo` | Undo the last accepted change |
| `Shazam, redo` | Redo a previously undone change |
| `Shazam, read` | Read the accepted draft aloud (browser speech synthesis) |
| `Shazam, remove last insertion` | Remove the most recent Wispr-inserted segment |
| `Shazam, keep that` | Dismiss the off-topic flag and keep the segment |
| `Shazam, make that a separate note` | Move a flagged segment to the Notes area |
| `Shazam, pause` | Suspend command processing (text still enters as draft) |
| `Shazam, resume` | Resume command processing |
| `Shazam, finish` | End the session; draft is preserved |

The catchword is configurable in Settings (default: "Shazam"). The app name remains VoicePilot.

---

## Setup and Run

### 1. Static mode (no backend — all deterministic commands work)

Simply open `index.html` in any modern browser:

```
file:///path/to/flowguard/index.html
```

Or serve it locally:

```bash
# Python
python -m http.server 5000

# Node.js
npx serve .
```

No build step, no npm install, no framework required.

### 2. With AI editing backend (optional — for "Shazam, edit: …")

Install dependencies:

```bash
pip install flask flask-cors openai   # or: pip install flask flask-cors anthropic
```

Set your API key (never committed, never sent to the browser):

```bash
# Windows
set OPENAI_API_KEY=sk-...
# or
set ANTHROPIC_API_KEY=sk-ant-...

# macOS/Linux
export OPENAI_API_KEY=sk-...
```

Start the backend:

```bash
python backend/voicepilot_server.py
```

Then open `http://localhost:5000` (or keep using the file URL — the backend only handles AI edit requests).

---

## Privacy

- **All deterministic commands** (undo, redo, apply, discard, read, pause, etc.) run 100% locally. No data leaves the browser.
- **"Shazam, edit: …"** sends the current draft and instruction to your configured AI provider (OpenAI or Anthropic) only when you explicitly trigger it. This is clearly disclosed in the UI.
- API keys are set as environment variables on the server; they are **never** sent to the browser.
- The app does not record ambient audio. Wispr Flow is the sole transcription source.
- Draft text is stored only in memory during the session. Use the browser's local storage only for the settings (catchword preference). No automatic cloud sync.
- All dynamic content is rendered using `textContent` and safe DOM APIs — never `innerHTML` with untrusted content.

---

## Tests and Test Commands

### JavaScript tests (requires Node.js)

```bash
node tests/test_voicepilot.js
```

Covers 110 cases across: command parser, segment tracker, editor state, and browser surface contracts.

**Result (as of this release):** 110 passed, 0 failed.

### Python tests (requires Python 3.11+)

```bash
# VoicePilot-specific tests
python -m pytest tests/test_voicepilot.py tests/test_browser_surface.py -v

# Legacy FlowGuard engine tests (still valid; engine preserved)
python -m unittest tests/test_engine.py -v
```

> **Note:** Python is not available on the current Windows machine. Tests are written and ready; results shown after installing Python.

### Full test suite

```bash
# All JS tests
node tests/test_voicepilot.js

# All Python tests (when Python available)
python -m pytest tests/ -v
```

---

## Repository Structure

| Path | Purpose |
|---|---|
| `index.html` | VoicePilot single-page editing workspace |
| `src/command_parser.js` | Parses "Shazam" commands from inserted segments |
| `src/segment_tracker.js` | Tracks newly inserted text in a `<textarea>` |
| `src/editor_state.js` | Manages draft, proposals, undo/redo, flags, notes |
| `src/voice_feedback.js` | Browser speech synthesis wrapper |
| `src/engine.js` | Legacy FlowGuard engine — preserved for reusable utilities |
| `backend/voicepilot_server.py` | Optional Flask backend for AI editing commands |
| `backend/flowguard_engine.py` | Legacy Python engine — preserved |
| `tests/test_voicepilot.js` | Node.js test runner — 110 cases |
| `tests/test_voicepilot.py` | Python port of core logic tests |
| `tests/test_browser_surface.py` | Browser surface contract tests |
| `tests/test_engine.py` | Legacy FlowGuard engine tests (preserved) |
| `.vscode/mcp.json` | Wispr Notetaker MCP configuration (read-only, unrelated to dictation control) |
| `benchmarks/` | Legacy FlowGuard benchmark artifacts — historical only, not VoicePilot claims |

---

## `.vscode/mcp.json` — Accurate Scope

The `.vscode/mcp.json` file points to `https://api.wisprflow.ai/connect/mcp`, which is the **read-only** Wispr Notetaker MCP endpoint. It exposes meeting transcripts and scratchpad notes. It does **not** control desktop dictation, does not write to the Wispr dictionary, and is not used by VoicePilot for any feature. It is retained for users who also use the Wispr Notetaker MCP in their IDE.

---

## Known Limitations

1. **Wispr activation** — VoicePilot cannot start Wispr Flow from a web page. Use Wispr's keyboard shortcut.
2. **Wake-phrase detection** — Detecting "Shazam" while Wispr is off requires a separate desktop companion app, which is not yet implemented.
3. **AI editing without a provider** — "Shazam, edit: …" requires a configured OpenAI or Anthropic key on the backend. All other commands work fully offline.
4. **speechSynthesis** — Browser speech synthesis availability varies. VoicePilot gracefully disables spoken feedback if unavailable.
5. **Segment boundaries** — Wispr may occasionally produce multi-event insertions. VoicePilot uses a 650 ms debounce window and falls back to a safe review state if boundaries are ambiguous.
6. **Cross-application editing** — VoicePilot edits text in its own editor only; it cannot edit text in other apps.

---

## What's Actually Implemented

✅ Light, focused VoicePilot editor UI (warm off-white, single workspace)  
✅ Wispr Flow text insertion workflow (focused textarea receives Wispr dictation)  
✅ "Shazam" command detection from newly inserted segments only  
✅ Safe command extraction (command text removed; surrounding content preserved)  
✅ All 13 commands: edit, undo, redo, preview, apply, discard, read, remove last, keep that, separate note, pause, resume, finish  
✅ Revision proposal flow — preview before apply; never silently overwrites draft  
✅ Full undo/redo history (up to 100 revisions)  
✅ Interruption/off-topic flagging (user-controlled, never auto-deletes)  
✅ Separate notes area for moved segments  
✅ Browser speech synthesis for "read" and command confirmations  
✅ Configurable catchword  
✅ Optional AI backend (OpenAI or Anthropic) for natural-language edits  
✅ Honest status indicators (no fake "Wispr connected" state)  
✅ Privacy-first: no ambient audio capture, no auto-upload, textContent rendering  
✅ Accessible focus states, keyboard fallback, prefers-reduced-motion  
✅ 110 automated tests passing  

❌ Desktop companion for wake-phrase detection (not yet implemented)  
❌ Global hands-free Wispr startup (not possible from browser alone)  
❌ Cross-application voice editing  

---

## Authors and Credits

- **Manish Reddy** (RV University)
- Dictation powered by [Wispr Flow](https://wisprflow.ai)
- Predecessor project: FlowGuard (legacy code preserved in `src/engine.js`, `backend/flowguard_engine.py`, `tests/test_engine.py`)
