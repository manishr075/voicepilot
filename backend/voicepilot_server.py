#!/usr/bin/env python3
"""
VoicePilot – Secure AI Backend Server
Provides local endpoints for voice-instructed writing revisions:
  - POST /api/edit     (natural-language instruction edits)
  - POST /api/review   (grammar, flow, and clarity polishing)
  - GET  /api/health   (provider status and connectivity check)

Security & Privacy:
  - API keys remain strictly server-side in environment variables:
      GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY
  - Drafts and instructions are transmitted to AI providers ONLY on explicit
    user command ("Shazam, edit: ..." or "Shazam, review").
  - Client-side code and browser localStorage NEVER store permanent provider keys.
  - In-memory rate limiting and request payload validation prevent abuse.
  - Plain-text response output is treated as untrusted text, never executable.

Usage:
  pip install flask flask-cors
  export GEMINI_API_KEY="your-key-here"   # or OPENAI_API_KEY / ANTHROPIC_API_KEY
  python backend/voicepilot_server.py
"""

from __future__ import annotations

import collections
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Dict, List, Optional, Tuple

# ── Flask & CORS ─────────────────────────────────────────────────────────────
try:
    from flask import Flask, jsonify, request
    from flask_cors import CORS
except ImportError:
    print(
        "Flask is required to run the VoicePilot backend.\n"
        "Run: pip install flask flask-cors\n"
        "Note: Deterministic local voice commands (formatting, undo/redo, copy,\n"
        "read aloud, notes) function in VoicePilot without running this server."
    )
    sys.exit(1)

# ── Optional Provider Modules ────────────────────────────────────────────────
_openai_module = None
try:
    import openai as _openai_module
except ImportError:
    pass

_anthropic_module = None
try:
    import anthropic as _anthropic_module
except ImportError:
    pass

# ── Configuration & Credentials ──────────────────────────────────────────────
GEMINI_API_KEY    = os.environ.get("GEMINI_API_KEY", "").strip()
OPENAI_API_KEY    = os.environ.get("OPENAI_API_KEY", "").strip()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

GEMINI_MODEL      = os.environ.get("VOICEPILOT_GEMINI_MODEL", "gemini-1.5-flash")
OPENAI_MODEL      = os.environ.get("VOICEPILOT_OPENAI_MODEL", "gpt-4o-mini")
ANTHROPIC_MODEL   = os.environ.get("VOICEPILOT_ANTHROPIC_MODEL", "claude-haiku-20240307")

MAX_DRAFT_CHARS   = 12_000   # Truncation boundary for single prompt
MAX_PAYLOAD_CHARS = 50_000   # Hard limit before rejecting with 413
TIMEOUT_SECONDS   = 25

RATE_LIMIT_WINDOW = 60       # seconds
RATE_LIMIT_MAX_REQ = 40      # requests per window per IP

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [VoicePilot Backend] %(levelname)s: %(message)s"
)
log = logging.getLogger("voicepilot")

# ── Rate Limiter ─────────────────────────────────────────────────────────────
_ip_requests: Dict[str, collections.deque] = collections.defaultdict(collections.deque)

def check_rate_limit(ip: str) -> bool:
    """Returns True if within rate limit, False if exceeded."""
    now = time.time()
    queue = _ip_requests[ip]
    while queue and queue[0] < now - RATE_LIMIT_WINDOW:
        queue.popleft()
    if len(queue) >= RATE_LIMIT_MAX_REQ:
        return False
    queue.append(now)
    return True

# ── Prompts ──────────────────────────────────────────────────────────────────
SYSTEM_EDIT_PROMPT = (
    "You are an expert writing assistant in the VoicePilot editor. The user provides "
    "a draft text and an editing instruction. Return ONLY the final revised draft text. "
    "Do NOT include any commentary, explanations, greetings, quotes, or markdown wrappers. "
    "Preserve the author's original voice, style, and intent. If the instruction is unclear, "
    "return the original draft unchanged."
)

SYSTEM_REVIEW_PROMPT = (
    "You are an expert editor in the VoicePilot editor. Proofread and polish the provided "
    "draft for clarity, conciseness, flow, and grammar. Return ONLY a valid JSON object "
    "with this exact shape:\n"
    '{"revised": "polished draft text here", "reason": "brief 1-sentence summary of improvements"}\n'
    "Do NOT wrap in markdown fences or include any extra text."
)

# ── Provider Implementations ─────────────────────────────────────────────────

def _gemini_generate(system_prompt: str, user_content: str, json_mode: bool = False) -> str:
    """Call Google Gemini REST API using urllib (zero extra dependencies)."""
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY not configured.")

    models_to_try = [
        GEMINI_MODEL,
        "gemini-1.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
    ]
    seen = set()
    unique_models = [m for m in models_to_try if not (m in seen or seen.add(m))]

    full_prompt = f"{system_prompt}\n\nContent:\n{user_content}"
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4096,
        }
    }
    if json_mode:
        payload["generationConfig"]["responseMimeType"] = "application/json"

    data_bytes = json.dumps(payload).encode("utf-8")
    last_err = None

    for model_name in unique_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                if resp.status == 200:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    candidates = resp_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            return parts[0]["text"].strip()
                    raise ValueError("Gemini returned empty candidate text.")
        except urllib.error.HTTPError as http_err:
            if http_err.code == 404:
                last_err = http_err
                continue  # Try next fallback model
            err_body = http_err.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Gemini HTTP {http_err.code}: {err_body}") from http_err
        except Exception as e:
            last_err = e
            break

    raise RuntimeError(f"Gemini generation failed: {last_err}")


def _openai_generate(system_prompt: str, user_content: str, json_mode: bool = False) -> str:
    """Call OpenAI chat completions."""
    if not OPENAI_API_KEY:
        raise EnvironmentError("OPENAI_API_KEY not configured.")
    if not _openai_module:
        raise ImportError("openai package not installed. Run: pip install openai")

    client = _openai_module.OpenAI(api_key=OPENAI_API_KEY, timeout=TIMEOUT_SECONDS)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_content},
    ]
    kwargs = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.2,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**kwargs)
    text = response.choices[0].message.content or ""
    if not text.strip():
        raise ValueError("OpenAI returned an empty response.")
    return text.strip()


def _anthropic_generate(system_prompt: str, user_content: str) -> str:
    """Call Anthropic Messages API."""
    if not ANTHROPIC_API_KEY:
        raise EnvironmentError("ANTHROPIC_API_KEY not configured.")
    if not _anthropic_module:
        raise ImportError("anthropic package not installed. Run: pip install anthropic")

    client = _anthropic_module.Anthropic(api_key=ANTHROPIC_API_KEY, timeout=TIMEOUT_SECONDS)
    message = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    result = message.content[0].text if message.content else ""
    if not result.strip():
        raise ValueError("Anthropic returned an empty response.")
    return result.strip()


def run_pipeline(system_prompt: str, user_content: str, json_mode: bool = False) -> Tuple[Optional[str], Optional[str]]:
    """
    Executes request using available providers in priority:
    1. Gemini (native support, zero extra pip deps)
    2. OpenAI
    3. Anthropic
    Returns (result_string, error_message).
    """
    errors: List[str] = []

    # Priority 1: Gemini
    if GEMINI_API_KEY:
        try:
            return _gemini_generate(system_prompt, user_content, json_mode), None
        except Exception as e:
            log.warning("Gemini execution failed: %s", e)
            errors.append(f"Gemini: {e}")

    # Priority 2: OpenAI
    if OPENAI_API_KEY and _openai_module:
        try:
            return _openai_generate(system_prompt, user_content, json_mode), None
        except Exception as e:
            log.warning("OpenAI execution failed: %s", e)
            errors.append(f"OpenAI: {e}")

    # Priority 3: Anthropic
    if ANTHROPIC_API_KEY and _anthropic_module:
        try:
            return _anthropic_generate(system_prompt, user_content), None
        except Exception as e:
            log.warning("Anthropic execution failed: %s", e)
            errors.append(f"Anthropic: {e}")

    if not errors:
        return None, (
            "No AI provider key configured on backend. Set GEMINI_API_KEY, "
            "OPENAI_API_KEY, or ANTHROPIC_API_KEY in your server environment."
        )
    return None, " | ".join(errors)

# ── Flask Application ────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.before_request
def rate_limit_guard():
    client_ip = request.remote_addr or "127.0.0.1"
    if not check_rate_limit(client_ip):
        return jsonify({
            "error": "Rate limit exceeded (max 40 requests/minute). Please wait a moment."
        }), 429


@app.route("/api/edit", methods=["POST"])
def api_edit():
    """
    POST /api/edit
    Request body: { "draft": str, "instruction": str }
    Response:     { "result": str }
    """
    data = request.get_json(silent=True) or {}
    draft = str(data.get("draft", ""))
    instruction = str(data.get("instruction", "")).strip()

    if not instruction:
        return jsonify({"error": "No instruction provided."}), 400

    if len(draft) > MAX_PAYLOAD_CHARS:
        return jsonify({"error": f"Draft exceeds payload limit of {MAX_PAYLOAD_CHARS} characters."}), 413

    truncated_draft = draft[:MAX_DRAFT_CHARS]
    user_payload = f"Draft:\n{truncated_draft}\n\nInstruction: {instruction}"

    t0 = time.monotonic()
    result, err = run_pipeline(SYSTEM_EDIT_PROMPT, user_payload, json_mode=False)
    elapsed = round(time.monotonic() - t0, 2)

    if err:
        log.warning("Edit failed in %.2fs: %s", elapsed, err)
        return jsonify({"error": err}), 503

    log.info("Edit succeeded in %.2fs (length: %d chars)", elapsed, len(result or ""))
    return jsonify({"result": result}), 200


@app.route("/api/review", methods=["POST"])
def api_review():
    """
    POST /api/review
    Request body: { "draft": str }
    Response:     { "result": str, "reason": str }
    """
    data = request.get_json(silent=True) or {}
    draft = str(data.get("draft", "")).strip()

    if not draft:
        return jsonify({"error": "Draft is empty — nothing to review."}), 400

    if len(draft) > MAX_PAYLOAD_CHARS:
        return jsonify({"error": f"Draft exceeds payload limit of {MAX_PAYLOAD_CHARS} characters."}), 413

    truncated_draft = draft[:MAX_DRAFT_CHARS]
    t0 = time.monotonic()
    raw_output, err = run_pipeline(SYSTEM_REVIEW_PROMPT, truncated_draft, json_mode=True)
    elapsed = round(time.monotonic() - t0, 2)

    if err:
        log.warning("Review failed in %.2fs: %s", elapsed, err)
        return jsonify({"error": err}), 503

    revised_text = raw_output or ""
    reason_text = "Polished grammar, structure, and tone."

    # Parse JSON output if returned as structured object
    try:
        cleaned = revised_text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and "revised" in parsed:
            revised_text = str(parsed["revised"]).strip()
            reason_text = str(parsed.get("reason", reason_text)).strip()
    except Exception:
        pass

    log.info("Review succeeded in %.2fs", elapsed)
    return jsonify({"result": revised_text, "reason": reason_text}), 200


@app.route("/api/health", methods=["GET"])
def api_health():
    """Returns connectivity health and provider configuration disclosures."""
    return jsonify({
        "status": "ok",
        "service": "VoicePilot AI Backend",
        "version": "2.0.0",
        "gemini_configured": bool(GEMINI_API_KEY),
        "openai_configured": bool(OPENAI_API_KEY and _openai_module),
        "anthropic_configured": bool(ANTHROPIC_API_KEY and _anthropic_module),
        "disclosure": "Draft and instruction are sent only on explicit voice command.",
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    configured = []
    if GEMINI_API_KEY:
        configured.append(f"Gemini ({GEMINI_MODEL})")
    if OPENAI_API_KEY and _openai_module:
        configured.append(f"OpenAI ({OPENAI_MODEL})")
    if ANTHROPIC_API_KEY and _anthropic_module:
        configured.append(f"Anthropic ({ANTHROPIC_MODEL})")

    log.info("Starting VoicePilot backend on http://0.0.0.0:%d", port)
    if configured:
        log.info("Active providers: %s", ", ".join(configured))
    else:
        log.warning(
            "No AI provider keys detected in environment variables.\n"
            "Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY to enable AI edits.\n"
            "Local commands (formatting, undo/redo, notes, copy, read) operate without keys."
        )

    app.run(host="0.0.0.0", port=port, debug=False)
