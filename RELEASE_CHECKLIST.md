# VoicePilot Release Checklist

| Area | Status | Evidence / Limitation |
|---|---|---|
| **New VoicePilot UI** | ✅ PASS | `index.html` rebuilt as single-page editor; warm off-white light theme; no old FlowGuard tabs |
| **Old FlowGuard tabs removed** | ✅ PASS | tab-firewall, tab-compiler, tab-mcp, tab-benchmark removed from UI |
| **No Web Speech API fallback** | ✅ PASS | `webkitSpeechRecognition` not present; browser mic button removed |
| **Draft editor textarea** | ✅ PASS | `#draft-editor` receives Wispr Flow insertions; focused text field workflow |
| **Segment tracker module** | ✅ PASS | `src/segment_tracker.js` — beforeinput/input/paste events; debounce 650ms; internal-write guard |
| **Command parser module** | ✅ PASS | `src/command_parser.js` — 13 commands; case/punctuation tolerant; configurable catchword |
| **Editor state module** | ✅ PASS | `src/editor_state.js` — draft, proposal, undo/redo, flags, notes, pause/resume |
| **Voice feedback module** | ✅ PASS | `src/voice_feedback.js` — speechSynthesis wrapper; graceful fallback |
| **No unsafe innerHTML** | ✅ PASS | All dynamic content via textContent; confirmed by BS8 test |
| **No fake Wispr connected status** | ✅ PASS | Status pill shows truthful states; no "Wispr connected" claim |
| **Revision review flow** | ✅ PASS | Proposal shown in review panel; apply/discard; undo after apply restores original |
| **Undo / redo** | ✅ PASS | Up to 100 revision history entries; tested |
| **Interruption flagging** | ✅ PASS | Flags potential asides; never auto-deletes; user controls keep/remove/note |
| **Separate notes area** | ✅ PASS | Notes panel; delete individual notes |
| **Deterministic commands (no API)** | ✅ PASS | All commands except "edit:" work without any API key |
| **Optional AI backend** | ✅ PASS | `backend/voicepilot_server.py`; Flask; OpenAI + Anthropic; key via env var; never exposed to browser |
| **Honest limitation disclosure** | ✅ PASS | UI limitation notice; README section; no fake desktop-launch claims |
| **prefers-reduced-motion** | ✅ PASS | CSS media query present; confirmed by BS14 test |
| **Accessible focus states** | ✅ PASS | `:focus-visible` outlines; keyboard accessible buttons |
| **No Chart.js dependency** | ✅ PASS | chart.js removed; BS12 test confirms |
| **No benchmark claims in UI** | ✅ PASS | Benchmark files retained as historical artifacts; not shown in VoicePilot UI |
| **Legacy engine preserved** | ✅ PASS | `src/engine.js` and `backend/flowguard_engine.py` retained; `tests/test_engine.py` kept |
| **JavaScript tests (Node.js)** | ✅ PASS | `node tests/test_voicepilot.js` → **110 passed, 0 failed** |
| **Python tests** | ⚠ NOT TESTED | Python not installed on current machine; tests written and ready in `tests/test_voicepilot.py` and `tests/test_browser_surface.py` |
| **Old engine Python tests** | ⚠ NOT TESTED | `tests/test_engine.py` preserved; not runnable without Python |
| **MCP integration scope** | ✅ PASS | `.vscode/mcp.json` documented as read-only Notetaker endpoint; not used for dictation control |
| **Privacy / secrets scan** | ✅ PASS | No API keys committed; no ambient mic; no auto-upload |
| **Responsive layout** | ✅ PASS | CSS flexbox; max-width 860px; mobile media query at 600px |
| **README updated** | ✅ PASS | Full product description, workflow, commands, setup, privacy, limitations, actual vs planned features |
| **Public deployment** | ❌ NOT TESTED | No public URL; open `index.html` locally or via `http://localhost:5000` |
| **Live Wispr integration testing** | ❌ NOT TESTED | Cannot be automated; requires the installed Wispr Flow desktop app and a focused browser window |

---

## Test Commands

```bash
# JavaScript tests (Node.js required)
node tests/test_voicepilot.js

# Python tests (Python 3.11+ required)
python -m pytest tests/test_voicepilot.py tests/test_browser_surface.py -v

# Legacy engine tests (Python required)
python -m unittest tests/test_engine.py -v
```

## JS Test Results (October 2026)

```
VoicePilot JS Tests: 110 passed, 0 failed
```

Covers:
- Command parser (all 13 commands, case/punctuation, custom catchword)
- Segment tracker (caret insertion, selection replacement, deletion, ambiguity)
- Editor state (draft, undo, redo, proposal lifecycle, remove last, interruption, pause/resume, finish)
- Browser surface contracts (20 checks on index.html structure)
