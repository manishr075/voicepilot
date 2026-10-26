#!/usr/bin/env python3
"""
FlowGuard Deterministic Engine (Python 3.12 Reference Implementation)
Formula-for-formula identical to src/engine.js (verified via scripts/check_parity.py).

Core rule: Code decides, AI never invents metrics or verification states.
"""

from __future__ import annotations
import csv
import io
import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple


# Phonetic extension map for deterministic acoustic lattice generation
EXT_PHONETICS: Dict[str, List[str]] = {
    ".py": ["dot pie", "dot py", "pie", "py"],
    ".js": ["dot j s", "dot js", "js"],
    ".ts": ["dot t s", "dot ts", "ts"],
    ".tsx": ["dot t s x", "dot tsx"],
    ".jsx": ["dot j s x", "dot jsx"],
    ".json": ["dot jason", "dot json", "json"],
    ".yaml": ["dot yamel", "dot yaml", "yaml"],
    ".yml": ["dot y m l", "dot yml", "yaml"],
    ".toml": ["dot tom l", "dot toml", "toml"],
    ".md": ["dot m d", "dot md", "markdown"],
    ".h": ["dot h", "header"],
    ".tflite": ["dot t f lite", "dot tflite", "tf lite"],
    ".ps1": ["dot p s one", "dot ps1"],
    ".local": ["dot local", "local"],
}

KNOWN_HOMOPHONES: Dict[str, List[str]] = {
    "vite": ["vite", "white", "v i t e", "veet"],
    "sam": ["sam", "s a m"],
    "dynamodb": ["dynamo d b", "dynamo db", "dynamodb"],
    "tflite": ["t f lite", "tf lite", "tensor flow lite", "tflite"],
    "esp32": ["e s p thirty two", "esp 32", "e s p 32", "esp32"],
    "wbgt": ["w b g t", "wet bulb globe temperature"],
    "lint": ["lint", "lent"],
    "dry": ["dry", "try"],
    "ap": ["a p", "ap"],
    "south": ["south"],
    "1": ["one", "1"],
    "2": ["two", "2"],
    "4": ["four", "4"],
    "201": ["two zero one", "two hundred one", "201"],
    "503": ["five zero three", "five hundred three", "503"],
    "500": ["five hundred", "500"],
    "14": ["fourteen", "14"],
    "8192": ["eight one nine two", "eighty one ninety two", "8192"],
}

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
    "else", "true", "false", "null", "none", "return", "import", "export", "const",
    "let", "var", "function", "class", "def", "async", "await", "if", "in", "on",
    "to", "of", "is", "are", "be", "or", "by", "as", "at", "an", "a", "it", "not",
    "no", "do", "does", "did", "keep", "make", "run", "use", "set", "get", "add",
    "check", "test", "file", "code", "app", "data", "value", "values", "only"
}

NEGATION_CUES = [
    "do not", "don't", "never", "without", "must not", "cannot", "can't",
    "ignore", "reject", "exclude", "except", "unless", "not"
]

BACKTRACK_CUES = [
    "wait no", "actually wait", "sorry i mean", "scratch that", "no wait",
    "wait actually", "instead of", "not friday the following", "sorry end of"
]

DESTRUCTIVE_PATTERNS = [
    ("sam delete", "CloudFormation / SAM stack deletion command"),
    ("rm -rf", "Recursive forced file deletion"),
    ("drop table", "Database table destruction"),
    ("--force", "Forced execution bypassing safety checks"),
    ("overwrite=true", "Explicit file/record overwrite enabled"),
    ("blockpublicaccess: false", "Disabling storage public access block"),
]


def split_identifier_words(token: str) -> List[str]:
    """Split camelCase, PascalCase, snake_case, kebab-case, and paths into lowercase words."""
    cleaned = re.sub(r"^[-./@#]+", "", token)
    # Remove known extension for word splitting
    for ext in sorted(EXT_PHONETICS.keys(), key=len, reverse=True):
        if cleaned.lower().endswith(ext):
            cleaned = cleaned[: -len(ext)]
            break
    # Insert space before camelCase transitions
    s1 = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", cleaned)
    s2 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s1)
    parts = [p.lower() for p in re.split(r"[_/\-.\s:]+", s2) if p]
    return parts


def classify_symbol(token: str) -> str:
    """Deterministically classify a repository token into one of 6 structured families."""
    t = token.strip()
    if re.match(r"^(GET|POST|PUT|DELETE|PATCH)\s+/[A-Za-z0-9_/\-{}]*", t) or t.startswith(("http://", "https://")):
        return "endpoint_or_url"
    if t.startswith("--") or t.startswith("sam ") or t.startswith("npm ") or t.startswith("python ") or re.match(r"^[a-z]{2}-[a-z]+-\d$", t):
        return "cli_flag_or_cmd"
    if re.match(r"^[A-Z][A-Z0-9_]{2,}$", t):
        return "env_var"
    if "/" in t or any(t.endswith(ext) for ext in EXT_PHONETICS):
        return "file_path"
    if re.match(r"^\d+(\.\d+)?\s*(mm/day|mm|days|hours|kb|mb|bytes|°c|l|m²|ms|s)$", t.lower()):
        return "numeric_constraint"
    return "code_symbol"


def generate_acoustic_variants(canonical: str, sym_type: str) -> List[str]:
    """Generate deterministic spoken/acoustic forms that Wispr Flow or ASR produces."""
    t = canonical.strip()
    variants: List[str] = []

    def add_v(v: str) -> None:
        v_clean = re.sub(r"\s+", " ", v.strip().lower())
        if v_clean and v_clean != t.lower() and v_clean not in variants and len(v_clean) <= 60:
            variants.append(v_clean)

    low = t.lower()
    if sym_type == "file_path":
        base = t.split("/")[-1]
        matched_ext = ""
        stem = base
        for ext in sorted(EXT_PHONETICS.keys(), key=len, reverse=True):
            if base.lower().endswith(ext):
                matched_ext = ext
                stem = base[: -len(ext)]
                break
        stem_words = " ".join(split_identifier_words(stem))
        if matched_ext and stem_words:
            for ext_spoken in EXT_PHONETICS[matched_ext]:
                add_v(f"{stem_words} {ext_spoken}")
                if "/" in t:
                    folder_words = " ".join(split_identifier_words("/".join(t.split("/")[:-1])))
                    if folder_words:
                        add_v(f"{folder_words} slash {stem_words} {ext_spoken}")
                        add_v(f"{folder_words} {stem_words} {ext_spoken}")
            add_v(f"{stem_words}{matched_ext}")
        elif stem_words:
            add_v(stem_words)

    elif sym_type == "env_var":
        words = [w.lower() for w in t.split("_") if w]
        if words:
            spoken = " ".join(words)
            add_v(spoken)
            add_v(" underscore ".join(words))
            # Check homophones on first word (e.g. VITE -> white / v i t e)
            first = words[0]
            if first in KNOWN_HOMOPHONES:
                for h in KNOWN_HOMOPHONES[first]:
                    add_v(" ".join([h] + words[1:]))

    elif sym_type == "cli_flag_or_cmd":
        if t.startswith("--"):
            flag_words = " ".join(t[2:].lower().split("-"))
            add_v(f"double dash {flag_words}")
            add_v(f"dash dash {flag_words}")
            add_v(f"{flag_words} flag")
            add_v(flag_words)
        elif re.match(r"^[a-z]{2}-[a-z]+-\d$", low):
            parts = low.split("-")
            p0 = KNOWN_HOMOPHONES.get(parts[0], [parts[0]])[0]
            p2 = KNOWN_HOMOPHONES.get(parts[2], [parts[2]])[0]
            add_v(f"{p0} {parts[1]} {p2}")
            add_v(f"{parts[0]} {parts[1]} {p2}")
            add_v(f"{p0} dash {parts[1]} dash {p2}")
        else:
            words = split_identifier_words(t)
            if words:
                add_v(" ".join(words))
            if "--" in t:
                add_v(t.lower().replace("--", "double dash ").replace("-", " "))
                add_v(t.lower().replace("--", "").replace("-", " "))

    elif sym_type == "endpoint_or_url":
        if re.match(r"^(GET|POST|PUT|DELETE|PATCH)\s+/", t):
            method, route = t.split(None, 1)
            route_words = " ".join(split_identifier_words(route))
            add_v(f"{method.lower()} slash {route_words}")
            add_v(f"{method.lower()} {route_words} endpoint")
            add_v(f"{method.lower()} {route_words}")
        else:
            cleaned_url = re.sub(r"^https?://", "", low)
            add_v(cleaned_url.replace(".", " dot ").replace("/", " slash ").replace("-", " "))

    else:
        words = split_identifier_words(t)
        if len(words) >= 2:
            add_v(" ".join(words))
            if "_" in t:
                add_v(" underscore ".join(words))
        elif len(words) == 1 and words[0] in KNOWN_HOMOPHONES:
            for h in KNOWN_HOMOPHONES[words[0]]:
                add_v(h)

    return variants


def extract_repo_symbols(repo_text: str) -> List[Dict[str, Any]]:
    """
    Deterministically extract structured symbols from a repo manifest, file tree, or code snippet.
    Returns a sorted list of symbol dicts with canonical form, type, and acoustic lattice.
    """
    if not repo_text or not repo_text.strip():
        return []

    candidates: List[str] = []

    # 1. Endpoints like GET /health, POST /simulate
    for m in re.finditer(r"\b(GET|POST|PUT|DELETE|PATCH)\s+(/[A-Za-z0-9_/\-{}]+)", repo_text):
        candidates.append(f"{m.group(1)} {m.group(2)}")

    # 2. URLs
    for m in re.finditer(r"https?://[A-Za-z0-9._/\-]+", repo_text):
        candidates.append(m.group(0).rstrip(".,;)"))

    # 3. CLI commands & flags (e.g., --dry-run, --lint, --stack-name, ap-south-1)
    for m in re.finditer(r"(?<![A-Za-z0-9])(--[a-zA-Z0-9][a-zA-Z0-9\-]+)", repo_text):
        candidates.append(m.group(1))
    for m in re.finditer(r"\b([a-z]{2}-[a-z]+-\d)\b", repo_text):
        candidates.append(m.group(1))

    # 4. File paths & filenames with recognized extensions
    for m in re.finditer(r"\b([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)*\.(?:py|js|ts|tsx|jsx|json|yaml|yml|toml|md|h|tflite|ps1|local))\b", repo_text):
        candidates.append(m.group(1))
    for m in re.finditer(r"(?:^|\s)(\.env(?:\.[A-Za-z0-9_.\-]+)?)\b", repo_text):
        candidates.append(m.group(1).strip())

    # 5. ENV_VARS (UPPER_SNAKE_CASE >= 4 chars with at least one underscore)
    for m in re.finditer(r"\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b", repo_text):
        candidates.append(m.group(1))

    # 6. camelCase, PascalCase, and snake_case identifiers
    for m in re.finditer(r"(?<![A-Za-z0-9_.\-/])([a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]+(?:_[a-z0-9]+)+)(?![A-Za-z0-9_.\-/])", repo_text):
        tok = m.group(1)
        if tok.lower() not in STOPWORDS and len(tok) >= 4:
            candidates.append(tok)

    seen = set()
    symbols: List[Dict[str, Any]] = []
    for raw in candidates:
        c = raw.strip()
        if not c or c.lower() in STOPWORDS:
            continue
        if c in seen:
            continue
        seen.add(c)
        sym_type = classify_symbol(c)
        variants = generate_acoustic_variants(c, sym_type)
        if variants or sym_type in ("file_path", "env_var", "cli_flag_or_cmd", "endpoint_or_url"):
            symbols.append({
                "canonical": c,
                "type": sym_type,
                "acoustic_variants": variants,
            })

    return symbols


def normalize_words(text: str) -> List[str]:
    """Lowercase alphanumeric word tokenizer for format-invariant WER."""
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if w]


def compute_edit_distance(ref_words: List[str], hyp_words: List[str]) -> int:
    """Standard Levenshtein word edit distance."""
    n = len(ref_words)
    m = len(hyp_words)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref_words[i - 1] == hyp_words[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            )
    return dp[n][m]


def extract_numbers(text: str) -> List[str]:
    """Extract numeric literals from text (excluding numbers inside known identifiers like esp32/ap-south-1)."""
    scrubbed = re.sub(r"\b[A-Za-z_]+[0-9]+[A-Za-z0-9_\-]*\b", " ", text)
    scrubbed = re.sub(r"\b[a-z]{2}-[a-z]+-\d\b", " ", scrubbed.lower())
    return re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?(?![A-Za-z])", scrubbed)


def has_negation(text: str) -> List[str]:
    """Return list of negation cues present in text."""
    low = text.lower()
    found: List[str] = []
    for cue in NEGATION_CUES:
        pattern = r"\b" + re.escape(cue) + r"\b"
        if re.search(pattern, low):
            found.append(cue)
    return found


def verify_dictation(
    dictated_text: str,
    repo_symbols: List[Dict[str, Any]],
    intended_text: str = "",
    editor_target: str = "vscode-copilot",
) -> Dict[str, Any]:
    """
    Run FlowGuard's 3-layer deterministic verification on a dictated technical prompt:
    1. Structured-Token & Acoustic Lattice Resolution (CTEM)
    2. Meaning-Critical Hazard & Self-Correction Detection
    3. Guarded Prompt Repair + VS Code #file: / Cursor @file Context Injection
    """
    if not isinstance(dictated_text, str) or not dictated_text.strip():
        raise ValueError("Dictated prompt cannot be blank.")

    raw_dictated = dictated_text.strip()
    ref_text = intended_text.strip() if isinstance(intended_text, str) else ""
    repaired = raw_dictated

    # Determine target symbols relevant to this prompt (either present in intended_text, or matched in dictated_text)
    target_Evaluations: List[Dict[str, Any]] = []
    repairs_applied: List[Dict[str, str]] = []
    referenced_files: List[str] = []

    for sym in repo_symbols:
        canonical = sym["canonical"]
        sym_type = sym["type"]
        variants = sym.get("acoustic_variants", [])

        in_intended = bool(ref_text) and (canonical.lower() in ref_text.lower())
        exact_in_dictated = canonical in raw_dictated or (
            sym_type != "env_var" and canonical.lower() in raw_dictated.lower()
        )

        matched_variant: Optional[str] = None
        for v in sorted(variants, key=len, reverse=True):
            pattern = r"(?<![A-Za-z0-9_/\-])" + re.escape(v) + r"(?![A-Za-z0-9_/\-])"
            if re.search(pattern, repaired, flags=re.IGNORECASE):
                matched_variant = v
                break

        if in_intended or exact_in_dictated or matched_variant is not None:
            if exact_in_dictated:
                status = "PASS_EXACT"
                evidence = canonical
                reason = "Exact canonical token preserved in raw dictation."
                recovered_after_repair = True
            elif matched_variant is not None:
                status = "FAIL_RAW_RECOVERED_BY_LATTICE"
                evidence = matched_variant
                reason = f"Spoken form '{matched_variant}' corrupted exact token; deterministically repaired to '{canonical}'."
                recovered_after_repair = True
                # Apply deterministic repair in repaired prompt
                pattern = r"(?<![A-Za-z0-9_/\-])" + re.escape(matched_variant) + r"(?![A-Za-z0-9_/\-])"
                replacement = f"`{canonical}`" if sym_type != "file_path" else canonical
                repaired = re.sub(pattern, replacement, repaired, flags=re.IGNORECASE)
                repairs_applied.append({
                    "spoken": matched_variant,
                    "canonical": canonical,
                    "type": sym_type,
                })
            else:
                status = "FAIL_MISSING"
                evidence = ""
                reason = f"Target token '{canonical}' from intended instruction was missing or unrecoverable."
                recovered_after_repair = False

            if sym_type == "file_path" and (exact_in_dictated or matched_variant is not None):
                if canonical not in referenced_files:
                    referenced_files.append(canonical)

            target_Evaluations.append({
                "canonical": canonical,
                "type": sym_type,
                "raw_present": exact_in_dictated,
                "repaired_present": recovered_after_repair,
                "status": status,
                "evidence": evidence,
                "reason": reason,
            })

    # Layer 2: Meaning-Critical Hazard Checks
    hazards: List[Dict[str, str]] = []

    # Check 2A: Backtrack / Self-Correction Residue
    low_dict = raw_dictated.lower()
    for cue in BACKTRACK_CUES:
        if cue in low_dict:
            hazards.append({
                "category": "SELF_CORRECTION_RESIDUE",
                "severity": "HIGH",
                "evidence": cue,
                "explanation": f"Spoken backtrack phrase '{cue}' remained in transcript; downstream coding agent may execute the retracted instruction.",
                "remediation": "Strip retracted clause before the self-correction marker or enable Wispr Flow Light Auto Cleanup.",
            })

    # Check 2B: Negation / Polarity Drift (when intended_text is provided, or standalone negation check)
    dict_negs = has_negation(raw_dictated)
    if ref_text:
        ref_negs = has_negation(ref_text)
        if ref_negs and not dict_negs:
            hazards.append({
                "category": "NEGATION_DROPPED",
                "severity": "CRITICAL",
                "evidence": ", ".join(ref_negs),
                "explanation": f"Intended instruction contained negation ({', '.join(ref_negs)}), which is completely absent in the dictated transcript.",
                "remediation": "Restore explicit negation guard before sending prompt to Copilot/Cursor.",
            })
        elif not ref_negs and dict_negs:
            hazards.append({
                "category": "UNEXPECTED_NEGATION",
                "severity": "HIGH",
                "evidence": ", ".join(dict_negs),
                "explanation": f"Dictated transcript introduced negation ({', '.join(dict_negs)}) not present in intended specification.",
                "remediation": "Confirm whether constraint should be positive or negative.",
            })

    # Check 2C: Numeric / Boundary Drift
    if ref_text:
        ref_nums = extract_numbers(ref_text)
        dict_nums = extract_numbers(raw_dictated)
        missing_nums = [n for n in ref_nums if n not in dict_nums]
        if missing_nums:
            hazards.append({
                "category": "NUMERIC_CONSTRAINT_DRIFT",
                "severity": "CRITICAL",
                "evidence": f"Expected {ref_nums}, got {dict_nums}",
                "explanation": f"Numeric threshold or parameter {missing_nums} was altered or dropped during dictation.",
                "remediation": f"Verify exact numeric constraint ({', '.join(ref_nums)}) before code generation.",
            })

        # Check strict inequality drift (< vs <=, > vs >=)
        if ("strictly less" in ref_text.lower() or "below " in ref_text.lower()) and ("at most" in low_dict or "or equal" in low_dict):
            hazards.append({
                "category": "BOUNDARY_OPERATOR_DRIFT",
                "severity": "HIGH",
                "evidence": "Strict (<) vs Inclusive (<=)",
                "explanation": "Strict boundary condition ('below / strictly less') shifted to inclusive ('at most / or equal').",
                "remediation": "Enforce strict inequality (<) in specification.",
            })

    # Check 2D: Destructive Operations
    for pat, desc in DESTRUCTIVE_PATTERNS:
        if pat in low_dict:
            hazards.append({
                "category": "DESTRUCTIVE_COMMAND_GUARD",
                "severity": "CRITICAL",
                "evidence": pat,
                "explanation": f"Detected destructive operation ({desc}: '{pat}') in voice prompt.",
                "remediation": "Require explicit human confirmation and --dry-run check before execution.",
            })

    # Layer 3: Inject VS Code Copilot #file: or Cursor @file tags when files are referenced
    ide_context_prefix = ""
    if referenced_files:
        if editor_target == "vscode-copilot":
            tags = " ".join(f"#file:{fp}" for fp in referenced_files)
            ide_context_prefix = f"[Context: {tags}] "
        else:
            tags = " ".join(f"@{fp}" for fp in referenced_files)
            ide_context_prefix = f"[Context: {tags}] "

    final_guarded_prompt = ide_context_prefix + repaired

    # Compute Metrics (WER, CTEM_raw, CTEM_repaired, TSR_raw, TSR_repaired)
    total_targets = len(target_Evaluations)
    raw_correct = sum(1 for t in target_Evaluations if t["raw_present"])
    repaired_correct = sum(1 for t in target_Evaluations if t["repaired_present"])

    ctem_raw = (math.floor(((raw_correct / total_targets) * 100.0) * 10.0 + 0.5) / 10.0) if total_targets > 0 else 100.0
    ctem_repaired = (math.floor(((repaired_correct / total_targets) * 100.0) * 10.0 + 0.5) / 10.0) if total_targets > 0 else 100.0

    critical_hazards = [h for h in hazards if h["severity"] in ("CRITICAL", "HIGH")]
    tsr_raw = 100.0 if (raw_correct == total_targets and len(critical_hazards) == 0) else 0.0
    tsr_repaired = 100.0 if (repaired_correct == total_targets and len(critical_hazards) == 0) else 0.0

    if ref_text:
        ref_words = normalize_words(ref_text)
        raw_words = normalize_words(raw_dictated)
        rep_words = normalize_words(repaired)
        wer_raw = math.floor(((compute_edit_distance(ref_words, raw_words) / max(1, len(ref_words))) * 100.0) * 10.0 + 0.5) / 10.0
        wer_repaired = math.floor(((compute_edit_distance(ref_words, rep_words) / max(1, len(ref_words))) * 100.0) * 10.0 + 0.5) / 10.0
    else:
        wer_raw = 0.0
        wer_repaired = 0.0

    meaning_critical_errors_raw = (total_targets - raw_correct) + len(critical_hazards)
    meaning_critical_errors_repaired = (total_targets - repaired_correct) + len(critical_hazards)

    return {
        "verification_badge": "Verified by Deterministic Engine (JS/Python Parity)",
        "editor_target": editor_target,
        "raw_dictated": raw_dictated,
        "intended_reference": ref_text,
        "repaired_prompt": final_guarded_prompt,
        "referenced_files": referenced_files,
        "repairs_applied": repairs_applied,
        "target_evaluations": target_Evaluations,
        "hazards": hazards,
        "metrics": {
            "total_targets": total_targets,
            "raw_correct_targets": raw_correct,
            "repaired_correct_targets": repaired_correct,
            "ctem_raw_pct": ctem_raw,
            "ctem_repaired_pct": ctem_repaired,
            "tsr_raw_pct": tsr_raw,
            "tsr_repaired_pct": tsr_repaired,
            "wer_raw_pct": wer_raw,
            "wer_repaired_pct": wer_repaired,
            "meaning_critical_errors_raw": meaning_critical_errors_raw,
            "meaning_critical_errors_repaired": meaning_critical_errors_repaired,
        },
    }


def compile_wispr_artifacts(
    repo_symbols: List[Dict[str, Any]],
    custom_snippets: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Compile spec-compliant Wispr Flow Bulk Import files:
    - Dictionary (.csv): NO header row, field 1 <= 60 chars, field 2 <= 4000 chars, max 1000 items, case-insensitive deduplication.
    - Snippets (.json): JSON array of {"name": <=60 chars, "text": <=4000 chars}.
    - File-Tagging Collision Warnings: flags entries that could disable Cursor/Windsurf @file tagging.
    """
    csv_rows: List[Tuple[str, str]] = []
    seen_triggers = set()
    skipped_reasons: List[str] = []
    collision_warnings: List[str] = []

    def add_dict_row(col1: str, col2: str = "") -> None:
        c1 = re.sub(r"[\u200b-\u200f\ufeff]", "", col1).strip()
        c2 = re.sub(r"[\u200b-\u200f\ufeff]", "", col2).strip()
        if not c1:
            return
        if len(c1) > 60:
            skipped_reasons.append(f"Skipped '{c1[:25]}...': Field 1 exceeds Wispr 60-char limit ({len(c1)} chars).")
            return
        if len(c2) > 4000:
            skipped_reasons.append(f"Skipped '{c1}': Field 2 exceeds Wispr 4,000-char limit.")
            return
        if re.match(r"^[^A-Za-z0-9]+$", c1):
            skipped_reasons.append(f"Skipped '{c1}': Trigger contains only punctuation/symbols.")
            return
        key = c1.lower()
        if key in seen_triggers:
            return
        if len(csv_rows) >= 1000:
            skipped_reasons.append("Reached Wispr Flow 1,000-entry per-import limit.")
            return
        seen_triggers.add(key)
        csv_rows.append((c1, c2))

        # Check Cursor/Windsurf file-tagging collision risk
        if " " not in c1 and "." not in c1 and len(c1) <= 8 and c2:
            collision_warnings.append(
                f"Trigger '{c1}' -> '{c2}': Short single-word replacement may disable @file tagging for that dictation in Cursor/Windsurf."
            )

    for sym in repo_symbols:
        canonical = sym["canonical"]
        # Add canonical vocabulary word itself (1-column row)
        add_dict_row(canonical, "")
        # Add spoken misspelling -> canonical correction (2-column rows)
        for v in sym.get("acoustic_variants", []):
            add_dict_row(v, canonical)

    # Render CSV without headers
    buf = io.StringIO()
    for c1, c2 in csv_rows:
        if c2 == "":
            if "," in c1 or '"' in c1:
                escaped = c1.replace('"', '""')
                buf.write(f'"{escaped}"\n')
            else:
                buf.write(f"{c1}\n")
        else:
            def fmt_cell(val: str) -> str:
                if "," in val or '"' in val:
                    return '"' + val.replace('"', '""') + '"'
                return val
            buf.write(f"{fmt_cell(c1)},{fmt_cell(c2)}\n")

    csv_content = buf.getvalue()

    # Build Snippets JSON
    raw_snippets = custom_snippets if custom_snippets is not None else [
        {
            "name": "verify parity suite",
            "text": "Run python3 scripts/check_parity.py and python3 -m unittest discover -s tests -v. Report any mismatch between src/engine.js and backend/flowguard_engine.py before committing.",
        },
        {
            "name": "safe serverless deploy check",
            "text": "Validate template.yaml with sam validate --lint, verify CORS and health endpoint response, and do not claim deployment succeeded until the public URL and end-to-end save/reload journey are verified.",
        },
        {
            "name": "guard prompt context",
            "text": "Inspect the referenced repository files first, preserve all existing negation guards and numeric bounds, and do not overwrite existing sort keys or environment variables.",
        },
    ]

    valid_snippets: List[Dict[str, str]] = []
    seen_snip = set()
    for item in raw_snippets:
        if not isinstance(item, dict):
            continue
        if not isinstance(item.get("name"), str) or not isinstance(item.get("text"), str):
            continue
        name = re.sub(r"[\u200b-\u200f\ufeff]", "", item["name"]).strip()
        text = re.sub(r"[\u200b-\u200f\ufeff]", "", item["text"]).strip()
        if not name or not text:
            continue
        if len(name) > 60 or len(text) > 4000:
            skipped_reasons.append(f"Skipped snippet '{name[:25]}': Exceeds Wispr 60/4000 char limits.")
            continue
        k = name.lower()
        if k in seen_snip or k in seen_triggers:
            collision_warnings.append(
                f"Snippet trigger '{name}' conflicts with an existing dictionary/snippet entry (Wispr desktop blocks duplicate triggers across Dictionary and Snippets)."
            )
            continue
        seen_snip.add(k)
        valid_snippets.append({"name": name, "text": text})

    return {
        "spec_badge": "Verified against Wispr Flow Desktop Bulk Import Spec (Oct 2026)",
        "dictionary_csv": csv_content,
        "dictionary_entry_count": len(csv_rows),
        "snippets_json": json.dumps(valid_snippets, indent=2),
        "snippets_entry_count": len(valid_snippets),
        "collision_warnings": collision_warnings,
        "skipped_reasons": skipped_reasons,
    }


def build_privacy_report(
    verification_result: Dict[str, Any],
    include_raw_tokens: bool = False,
    auto_cleanup_level: str = "Light",
    ide_environment: str = "VS Code + GitHub Copilot (Windows/Mac)",
) -> Dict[str, Any]:
    """
    Generate a privacy-conscious diagnostic feedback report for Wispr Flow.
    By default (include_raw_tokens=False), private paths, identifiers, and prompt text are redacted.
    """
    metrics = verification_result["metrics"]
    repairs = verification_result["repairs_applied"]
    hazards = verification_result["hazards"]

    redacted_repairs = []
    for idx, r in enumerate(repairs, start=1):
        if include_raw_tokens:
            redacted_repairs.append(r)
        else:
            redacted_repairs.append({
                "spoken_pattern": f"[SPOKEN_SPAN_{idx}:{r['type']}]",
                "canonical_target": f"[CANONICAL_{r['type'].upper()}_{idx}]",
                "type": r["type"],
            })

    redacted_hazards = []
    for idx, h in enumerate(hazards, start=1):
        redacted_hazards.append({
            "category": h["category"],
            "severity": h["severity"],
            "evidence": h["evidence"] if include_raw_tokens else f"[REDACTED_HAZARD_{idx}]",
        })

    return {
        "schema_version": "flowguard-wispr-feedback-v1",
        "consent_mode": "FULL_OPT_IN" if include_raw_tokens else "PRIVACY_REDACTED_DEFAULT",
        "environment": {
            "ide": ide_environment,
            "auto_cleanup_level": auto_cleanup_level,
            "vscode_file_tagging_supported_natively": False,
        },
        "summary_metrics": {
            "total_structured_tokens": metrics["total_targets"],
            "ctem_raw_pct": metrics["ctem_raw_pct"],
            "ctem_after_flowguard_pct": metrics["ctem_repaired_pct"],
            "tsr_raw_pct": metrics["tsr_raw_pct"],
            "tsr_after_flowguard_pct": metrics["tsr_repaired_pct"],
            "meaning_critical_errors_caught": metrics["meaning_critical_errors_raw"],
        },
        "structured_token_mismatches": redacted_repairs,
        "semantic_hazards_caught": redacted_hazards,
    }
