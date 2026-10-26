#!/usr/bin/env python3
"""
VoicePilot – Optional AI Edit Backend
Provides a single endpoint: POST /api/edit

Requires:
  pip install flask flask-cors openai   (or anthropic)
  Set environment variable: OPENAI_API_KEY  (or ANTHROPIC_API_KEY)

Privacy: The draft and instruction are sent to the configured provider ONLY when
the user explicitly triggers "Shazam, edit: …". Nothing is sent automatically.
The API key is never exposed to the frontend.

Run:
  python backend/voicepilot_server.py

Then open index.html via http://localhost:5000 (or keep it as a local file —
natural-language edit commands will show a graceful "provider unavailable" notice).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Optional

# ── Flask (required) ─────────────────────────────────────────────────────────
try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    print(
        "Flask not installed. Run: pip install flask flask-cors\n"
        "Note: deterministic VoicePilot commands work without the backend.\n"
        "Only 'Shazam, edit: …' (AI editing) needs this server."
    )
    sys.exit(1)

# ── Optional AI providers ────────────────────────────────────────────────────
_openai_available   = False
_anthropic_available = False

try:
    import openai as _openai_module
    _openai_available = True
except ImportError:
    pass

try:
    import anthropic as _anthropic_module
    _anthropic_available = True
except ImportError:
    pass

# ── Config ────────────────────────────────────────────────────────────────────
OPENAI_API_KEY    = os.environ.get("OPENAI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

OPENAI_MODEL    = os.environ.get("VOICEPILOT_OPENAI_MODEL",    "gpt-4o-mini")
ANTHROPIC_MODEL = os.environ.get("VOICEPILOT_ANTHROPIC_MODEL", "claude-haiku-20240307")

MAX_DRAFT_CHARS = 12_000   # truncate very long drafts before sending
TIMEOUT_SECONDS = 25

logging.basicConfig(level=logging.INFO, format="%(asctime)s [VoicePilot] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Flask app ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


SYSTEM_PROMPT = (
    "You are a writing assistant. The user will provide a draft text and an editing "
    "instruction. Return ONLY the revised draft text — no explanation, no prefix, no "
    "markdown wrapper. Preserve the user's voice and intent. If the instruction is "
    "unclear or the draft is empty, return the original draft unchanged."
)


def _openai_edit(draft: str, instruction: str) -> str:
    """Call OpenAI chat completions. Raises on failure."""
    if not OPENAI_API_KEY:
        raise EnvironmentError("OPENAI_API_KEY not set.")
    client = _openai_module.OpenAI(api_key=OPENAI_API_KEY, timeout=TIMEOUT_SECONDS)
    user_msg = f"Draft:\n{draft[:MAX_DRAFT_CHARS]}\n\nInstruction: {instruction}"
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ],
        max_tokens=4096,
        temperature=0.4,
    )
    result = response.choices[0].message.content
    if not result or not result.strip():
        raise ValueError("Provider returned an empty response.")
    return result.strip()


def _anthropic_edit(draft: str, instruction: str) -> str:
    """Call Anthropic Messages API. Raises on failure."""
    if not ANTHROPIC_API_KEY:
        raise EnvironmentError("ANTHROPIC_API_KEY not set.")
    client = _anthropic_module.Anthropic(api_key=ANTHROPIC_API_KEY, timeout=TIMEOUT_SECONDS)
    user_msg = f"Draft:\n{draft[:MAX_DRAFT_CHARS]}\n\nInstruction: {instruction}"
    message = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    result = message.content[0].text if message.content else ""
    if not result or not result.strip():
        raise ValueError("Provider returned an empty response.")
    return result.strip()


def run_edit(draft: str, instruction: str) -> dict:
    """
    Try configured providers in order: OpenAI → Anthropic.
    Returns {"result": str} on success.
    Returns {"error": str} if no provider is available.
    """
    errors = []

    if OPENAI_API_KEY and _openai_available:
        try:
            text = _openai_edit(draft, instruction)
            return {"result": text}
        except Exception as e:
            log.warning("OpenAI edit failed: %s", e)
            errors.append(f"OpenAI: {e}")

    if ANTHROPIC_API_KEY and _anthropic_available:
        try:
            text = _anthropic_edit(draft, instruction)
            return {"result": text}
        except Exception as e:
            log.warning("Anthropic edit failed: %s", e)
            errors.append(f"Anthropic: {e}")

    if not errors:
        return {"error": "No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY."}
    return {"error": " | ".join(errors)}


@app.route("/api/edit", methods=["POST"])
def api_edit():
    """
    POST /api/edit
    Body JSON: { "draft": "...", "instruction": "..." }
    Response JSON: { "result": "..." } or { "error": "..." }
    """
    data = request.get_json(silent=True) or {}
    draft       = str(data.get("draft", "")).strip()
    instruction = str(data.get("instruction", "")).strip()

    if not instruction:
        return jsonify({"error": "No instruction provided."}), 400

    # Treat model output as plain text; never execute or interpret it.
    t0 = time.monotonic()
    outcome = run_edit(draft, instruction)
    elapsed = round(time.monotonic() - t0, 2)

    if "error" in outcome:
        log.info("Edit failed in %.2fs: %s", elapsed, outcome["error"])
        return jsonify({"error": outcome["error"]}), 503

    log.info("Edit succeeded in %.2fs", elapsed)
    return jsonify({"result": outcome["result"]}), 200


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({
        "status": "ok",
        "openai_configured":    bool(OPENAI_API_KEY and _openai_available),
        "anthropic_configured": bool(ANTHROPIC_API_KEY and _anthropic_available),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info("VoicePilot backend starting on port %d", port)
    if not (OPENAI_API_KEY or ANTHROPIC_API_KEY):
        log.warning(
            "No AI provider key found. 'Shazam, edit:' commands will fail gracefully. "
            "Deterministic commands (undo, redo, apply, discard, read, etc.) work without keys."
        )
    app.run(host="0.0.0.0", port=port, debug=False)
