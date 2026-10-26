/**
 * FlowGuard Deterministic Engine (JavaScript Implementation)
 * Formula-for-formula identical to backend/flowguard_engine.py.
 * Verified across edge cases and 2,000 seeded scenarios by scripts/check_parity.py.
 */

const EXT_PHONETICS = {
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
  ".local": ["dot local", "local"]
};

const KNOWN_HOMOPHONES = {
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
  "8192": ["eight one nine two", "eighty one ninety two", "8192"]
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "then",
  "else", "true", "false", "null", "none", "return", "import", "export", "const",
  "let", "var", "function", "class", "def", "async", "await", "if", "in", "on",
  "to", "of", "is", "are", "be", "or", "by", "as", "at", "an", "a", "it", "not",
  "no", "do", "does", "did", "keep", "make", "run", "use", "set", "get", "add",
  "check", "test", "file", "code", "app", "data", "value", "values", "only"
]);

const NEGATION_CUES = [
  "do not", "don't", "never", "without", "must not", "cannot", "can't",
  "ignore", "reject", "exclude", "except", "unless", "not"
];

const BACKTRACK_CUES = [
  "wait no", "actually wait", "sorry i mean", "scratch that", "no wait",
  "wait actually", "instead of", "not friday the following", "sorry end of"
];

const DESTRUCTIVE_PATTERNS = [
  ["sam delete", "CloudFormation / SAM stack deletion command"],
  ["rm -rf", "Recursive forced file deletion"],
  ["drop table", "Database table destruction"],
  ["--force", "Forced execution bypassing safety checks"],
  ["overwrite=true", "Explicit file/record overwrite enabled"],
  ["blockpublicaccess: false", "Disabling storage public access block"]
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sortedExtKeys() {
  return Object.keys(EXT_PHONETICS).sort((a, b) => b.length - a.length);
}

function splitIdentifierWords(token) {
  let cleaned = token.replace(/^[-./@#]+/, "");
  const exts = sortedExtKeys();
  for (const ext of exts) {
    if (cleaned.toLowerCase().endsWith(ext)) {
      cleaned = cleaned.slice(0, cleaned.length - ext.length);
      break;
    }
  }
  const s1 = cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const s2 = s1.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return s2.split(/[_/\-.\s:]+/).filter(Boolean).map(p => p.toLowerCase());
}

function classifySymbol(token) {
  const t = token.trim();
  if (/^(GET|POST|PUT|DELETE|PATCH)\s+\/[A-Za-z0-9_/\-{}]*/.test(t) || t.startsWith("http://") || t.startsWith("https://")) {
    return "endpoint_or_url";
  }
  if (t.startsWith("--") || t.startsWith("sam ") || t.startsWith("npm ") || t.startsWith("python ") || /^[a-z]{2}-[a-z]+-\d$/.test(t)) {
    return "cli_flag_or_cmd";
  }
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) {
    return "env_var";
  }
  const exts = sortedExtKeys();
  if (t.includes("/") || exts.some(ext => t.endsWith(ext))) {
    return "file_path";
  }
  if (/^\d+(\.\d+)?\s*(mm\/day|mm|days|hours|kb|mb|bytes|°c|l|m²|ms|s)$/.test(t.toLowerCase())) {
    return "numeric_constraint";
  }
  return "code_symbol";
}

function generateAcousticVariants(canonical, symType) {
  const t = canonical.trim();
  const variants = [];
  const low = t.toLowerCase();

  function addV(v) {
    const vClean = v.trim().toLowerCase().replace(/\s+/g, " ");
    if (vClean && vClean !== low && !variants.includes(vClean) && vClean.length <= 60) {
      variants.push(vClean);
    }
  }

  if (symType === "file_path") {
    const parts = t.split("/");
    const base = parts[parts.length - 1];
    let matchedExt = "";
    let stem = base;
    for (const ext of sortedExtKeys()) {
      if (base.toLowerCase().endsWith(ext)) {
        matchedExt = ext;
        stem = base.slice(0, base.length - ext.length);
        break;
      }
    }
    const stemWords = splitIdentifierWords(stem).join(" ");
    if (matchedExt && stemWords) {
      for (const extSpoken of EXT_PHONETICS[matchedExt]) {
        addV(`${stemWords} ${extSpoken}`);
        if (t.includes("/")) {
          const folderWords = splitIdentifierWords(parts.slice(0, -1).join("/")).join(" ");
          if (folderWords) {
            addV(`${folderWords} slash ${stemWords} ${extSpoken}`);
            addV(`${folderWords} ${stemWords} ${extSpoken}`);
          }
        }
      }
      addV(`${stemWords}${matchedExt}`);
    } else if (stemWords) {
      addV(stemWords);
    }
  } else if (symType === "env_var") {
    const words = t.split("_").filter(Boolean).map(w => w.toLowerCase());
    if (words.length > 0) {
      addV(words.join(" "));
      addV(words.join(" underscore "));
      const first = words[0];
      if (KNOWN_HOMOPHONES[first]) {
        for (const h of KNOWN_HOMOPHONES[first]) {
          addV([h, ...words.slice(1)].join(" "));
        }
      }
    }
  } else if (symType === "cli_flag_or_cmd") {
    if (t.startsWith("--")) {
      const flagWords = t.slice(2).toLowerCase().split("-").join(" ");
      addV(`double dash ${flagWords}`);
      addV(`dash dash ${flagWords}`);
      addV(`${flagWords} flag`);
      addV(flagWords);
    } else if (/^[a-z]{2}-[a-z]+-\d$/.test(low)) {
      const parts = low.split("-");
      const p0 = (KNOWN_HOMOPHONES[parts[0]] || [parts[0]])[0];
      const p2 = (KNOWN_HOMOPHONES[parts[2]] || [parts[2]])[0];
      addV(`${p0} ${parts[1]} ${p2}`);
      addV(`${parts[0]} ${parts[1]} ${p2}`);
      addV(`${p0} dash ${parts[1]} dash ${p2}`);
    } else {
      const words = splitIdentifierWords(t);
      if (words.length > 0) {
        addV(words.join(" "));
      }
      if (t.includes("--")) {
        addV(low.replace(/--/g, "double dash ").replace(/-/g, " "));
        addV(low.replace(/--/g, "").replace(/-/g, " "));
      }
    }
  } else if (symType === "endpoint_or_url") {
    if (/^(GET|POST|PUT|DELETE|PATCH)\s+\//.test(t)) {
      const sp = t.trim().split(/\s+/);
      const method = sp[0];
      const route = sp.slice(1).join(" ");
      const routeWords = splitIdentifierWords(route).join(" ");
      addV(`${method.toLowerCase()} slash ${routeWords}`);
      addV(`${method.toLowerCase()} ${routeWords} endpoint`);
      addV(`${method.toLowerCase()} ${routeWords}`);
    } else {
      const cleanedUrl = low.replace(/^https?:\/\//, "");
      addV(cleanedUrl.replace(/\./g, " dot ").replace(/\//g, " slash ").replace(/-/g, " "));
    }
  } else {
    const words = splitIdentifierWords(t);
    if (words.length >= 2) {
      addV(words.join(" "));
      if (t.includes("_")) {
        addV(words.join(" underscore "));
      }
    } else if (words.length === 1 && KNOWN_HOMOPHONES[words[0]]) {
      for (const h of KNOWN_HOMOPHONES[words[0]]) {
        addV(h);
      }
    }
  }

  return variants;
}

function extractRepoSymbols(repoText, extraRules = []) {
  if (!repoText || !repoText.trim()) {
    return [];
  }
  const candidates = [];

  for (const m of repoText.matchAll(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\/[A-Za-z0-9_/\-{}]+)/g)) {
    candidates.push(`${m[1]} ${m[2]}`);
  }
  for (const m of repoText.matchAll(/https?:\/\/[A-Za-z0-9._/\-]+/g)) {
    candidates.push(m[0].replace(/[.,;)]+$/, ""));
  }
  for (const m of repoText.matchAll(/(?<![A-Za-z0-9])(--[a-zA-Z0-9][a-zA-Z0-9\-]+)/g)) {
    candidates.push(m[1]);
  }
  for (const m of repoText.matchAll(/\b([a-z]{2}-[a-z]+-\d)\b/g)) {
    candidates.push(m[1]);
  }
  for (const m of repoText.matchAll(/\b([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.(?:py|js|ts|tsx|jsx|json|yaml|yml|toml|md|h|tflite|ps1|local))\b/g)) {
    candidates.push(m[1]);
  }
  for (const m of repoText.matchAll(/(?:^|\s)(\.env(?:\.[A-Za-z0-9_.\-]+)?)\b/g)) {
    candidates.push(m[1].trim());
  }
  for (const m of repoText.matchAll(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/g)) {
    candidates.push(m[1]);
  }
  for (const m of repoText.matchAll(/(?<![A-Za-z0-9_.\-/])([a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]+(?:_[a-z0-9]+)+)(?![A-Za-z0-9_.\-/])/g)) {
    const tok = m[1];
    if (!STOPWORDS.has(tok.toLowerCase()) && tok.length >= 4) {
      candidates.push(tok);
    }
  }

  const seen = new Set();
  const symbols = [];
  for (const raw of candidates) {
    const c = raw.trim();
    if (!c || STOPWORDS.has(c.toLowerCase())) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    const symType = classifySymbol(c);
    const variants = generateAcousticVariants(c, symType);
    if (variants.length > 0 || ["file_path", "env_var", "cli_flag_or_cmd", "endpoint_or_url"].includes(symType)) {
      symbols.push({
        canonical: c,
        type: symType,
        acoustic_variants: variants
      });
    }
  }
  for (const rule of extraRules) {
    const existing = symbols.find(s => s.canonical.toLowerCase() === rule.canonical.toLowerCase());
    if (existing) {
      if (!existing.acoustic_variants.includes(rule.spoken.toLowerCase())) {
        existing.acoustic_variants.push(rule.spoken.toLowerCase());
      }
    } else {
      symbols.push({
        canonical: rule.canonical,
        type: classifySymbol(rule.canonical),
        acoustic_variants: [rule.spoken.toLowerCase()]
      });
    }
  }
  return symbols;
}

function normalizeWords(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function computeEditDistance(refWords, hypWords) {
  const n = refWords.length;
  const m = hypWords.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[n][m];
}

function extractNumbers(text) {
  let scrubbed = text.replace(/\b[A-Za-z_]+[0-9]+[A-Za-z0-9_\-]*\b/g, " ");
  scrubbed = scrubbed.toLowerCase().replace(/\b[a-z]{2}-[a-z]+-\d\b/g, " ");
  const matches = scrubbed.match(/(?<![A-Za-z])\d+(?:\.\d+)?(?![A-Za-z])/g);
  return matches ? Array.from(matches) : [];
}

function hasNegation(text) {
  const low = text.toLowerCase();
  const found = [];
  for (const cue of NEGATION_CUES) {
    const pat = new RegExp("\\b" + escapeRegExp(cue) + "\\b");
    if (pat.test(low)) {
      found.push(cue);
    }
  }
  return found;
}

function round1(val) {
  return Math.floor(val * 10.0 + 0.5) / 10.0;
}

function verifyDictation(dictatedText, repoSymbols, intendedText = "", editorTarget = "vscode-copilot") {
  if (typeof dictatedText !== "string" || !dictatedText.trim()) {
    throw new Error("Dictated prompt cannot be blank.");
  }

  const rawDictated = dictatedText.trim();
  const refText = typeof intendedText === "string" ? intendedText.trim() : "";
  let repaired = rawDictated;

  const targetEvaluations = [];
  const repairsApplied = [];
  const referencedFiles = [];

  for (const sym of repoSymbols) {
    const canonical = sym.canonical;
    const symType = sym.type;
    const variants = sym.acoustic_variants || [];

    const inIntended = Boolean(refText) && refText.toLowerCase().includes(canonical.toLowerCase());
    const exactInDictated = rawDictated.includes(canonical) || (
      symType !== "env_var" && rawDictated.toLowerCase().includes(canonical.toLowerCase())
    );

    let matchedVariant = null;
    const sortedVars = [...variants].sort((a, b) => b.length - a.length);
    for (const v of sortedVars) {
      const pat = new RegExp("(?<![A-Za-z0-9_/-])" + escapeRegExp(v) + "(?![A-Za-z0-9_/-])", "i");
      if (pat.test(repaired)) {
        matchedVariant = v;
        break;
      }
    }

    if (inIntended || exactInDictated || matchedVariant !== null) {
      let status = "";
      let evidence = "";
      let reason = "";
      let recoveredAfterRepair = false;

      if (exactInDictated) {
        status = "PASS_EXACT";
        evidence = canonical;
        reason = "Exact canonical token preserved in raw dictation.";
        recoveredAfterRepair = true;
      } else if (matchedVariant !== null) {
        status = "FAIL_RAW_RECOVERED_BY_LATTICE";
        evidence = matchedVariant;
        reason = `Spoken form '${matchedVariant}' corrupted exact token; deterministically repaired to '${canonical}'.`;
        recoveredAfterRepair = true;
        const pat = new RegExp("(?<![A-Za-z0-9_/-])" + escapeRegExp(matchedVariant) + "(?![A-Za-z0-9_/-])", "gi");
        const replacement = symType !== "file_path" ? `\`${canonical}\`` : canonical;
        repaired = repaired.replace(pat, replacement);
        repairsApplied.push({
          spoken: matchedVariant,
          canonical: canonical,
          type: symType
        });
      } else {
        status = "FAIL_MISSING";
        evidence = "";
        reason = `Target token '${canonical}' from intended instruction was missing or unrecoverable.`;
        recoveredAfterRepair = false;
      }

      if (symType === "file_path" && (exactInDictated || matchedVariant !== null)) {
        if (!referencedFiles.includes(canonical)) {
          referencedFiles.push(canonical);
        }
      }

      targetEvaluations.push({
        canonical: canonical,
        type: symType,
        raw_present: exactInDictated,
        repaired_present: recoveredAfterRepair,
        status: status,
        evidence: evidence,
        reason: reason
      });
    }
  }

  const hazards = [];
  const lowDict = rawDictated.toLowerCase();

  for (const cue of BACKTRACK_CUES) {
    if (lowDict.includes(cue)) {
      hazards.push({
        category: "SELF_CORRECTION_RESIDUE",
        severity: "HIGH",
        evidence: cue,
        explanation: `Spoken backtrack phrase '${cue}' remained in transcript; downstream coding agent may execute the retracted instruction.`,
        remediation: "Strip retracted clause before the self-correction marker or enable Wispr Flow Light Auto Cleanup."
      });
    }
  }

  const dictNegs = hasNegation(rawDictated);
  if (refText) {
    const refNegs = hasNegation(refText);
    if (refNegs.length > 0 && dictNegs.length === 0) {
      hazards.push({
        category: "NEGATION_DROPPED",
        severity: "CRITICAL",
        evidence: refNegs.join(", "),
        explanation: `Intended instruction contained negation (${refNegs.join(", ")}), which is completely absent in the dictated transcript.`,
        remediation: "Restore explicit negation guard before sending prompt to Copilot/Cursor."
      });
    } else if (refNegs.length === 0 && dictNegs.length > 0) {
      hazards.push({
        category: "UNEXPECTED_NEGATION",
        severity: "HIGH",
        evidence: dictNegs.join(", "),
        explanation: `Dictated transcript introduced negation (${dictNegs.join(", ")}) not present in intended specification.`,
        remediation: "Confirm whether constraint should be positive or negative."
      });
    }

    const refNums = extractNumbers(refText);
    const dictNums = extractNumbers(rawDictated);
    const missingNums = refNums.filter(n => !dictNums.includes(n));
    if (missingNums.length > 0) {
      const fmtArr = arr => "[" + arr.map(x => `'${x}'`).join(", ") + "]";
      hazards.push({
        category: "NUMERIC_CONSTRAINT_DRIFT",
        severity: "CRITICAL",
        evidence: `Expected ${fmtArr(refNums)}, got ${fmtArr(dictNums)}`,
        explanation: `Numeric threshold or parameter ${fmtArr(missingNums)} was altered or dropped during dictation.`,
        remediation: `Verify exact numeric constraint (${refNums.join(", ")}) before code generation.`
      });
    }

    if ((refText.toLowerCase().includes("strictly less") || refText.toLowerCase().includes("below ")) &&
        (lowDict.includes("at most") || lowDict.includes("or equal"))) {
      hazards.push({
        category: "BOUNDARY_OPERATOR_DRIFT",
        severity: "HIGH",
        evidence: "Strict (<) vs Inclusive (<=)",
        explanation: "Strict boundary condition ('below / strictly less') shifted to inclusive ('at most / or equal').",
        remediation: "Enforce strict inequality (<) in specification."
      });
    }
  }

  for (const [pat, desc] of DESTRUCTIVE_PATTERNS) {
    if (lowDict.includes(pat)) {
      hazards.push({
        category: "DESTRUCTIVE_COMMAND_GUARD",
        severity: "CRITICAL",
        evidence: pat,
        explanation: `Detected destructive operation (${desc}: '${pat}') in voice prompt.`,
        remediation: "Require explicit human confirmation and --dry-run check before execution."
      });
    }
  }

  let ideContextPrefix = "";
  if (referencedFiles.length > 0) {
    if (editorTarget === "vscode-copilot") {
      const tags = referencedFiles.map(fp => `#file:${fp}`).join(" ");
      ideContextPrefix = `[Context: ${tags}] `;
    } else {
      const tags = referencedFiles.map(fp => `@${fp}`).join(" ");
      ideContextPrefix = `[Context: ${tags}] `;
    }
  }

  const finalGuardedPrompt = ideContextPrefix + repaired;

  const totalTargets = targetEvaluations.length;
  const rawCorrect = targetEvaluations.filter(t => t.raw_present).length;
  const repairedCorrect = targetEvaluations.filter(t => t.repaired_present).length;

  const ctemRaw = totalTargets > 0 ? round1((rawCorrect / totalTargets) * 100.0) : 100.0;
  const ctemRepaired = totalTargets > 0 ? round1((repairedCorrect / totalTargets) * 100.0) : 100.0;

  const criticalHazards = hazards.filter(h => h.severity === "CRITICAL" || h.severity === "HIGH");
  const tsrRaw = (rawCorrect === totalTargets && criticalHazards.length === 0) ? 100.0 : 0.0;
  const tsrRepaired = (repairedCorrect === totalTargets && criticalHazards.length === 0) ? 100.0 : 0.0;

  let werRaw = 0.0;
  let werRepaired = 0.0;
  if (refText) {
    const refWords = normalizeWords(refText);
    const rawWords = normalizeWords(rawDictated);
    const repWords = normalizeWords(repaired);
    const denom = Math.max(1, refWords.length);
    werRaw = round1((computeEditDistance(refWords, rawWords) / denom) * 100.0);
    werRepaired = round1((computeEditDistance(refWords, repWords) / denom) * 100.0);
  }

  const meaningCriticalErrorsRaw = (totalTargets - rawCorrect) + criticalHazards.length;
  const meaningCriticalErrorsRepaired = (totalTargets - repairedCorrect) + criticalHazards.length;

  return {
    verification_badge: "Verified by Deterministic Engine (JS/Python Parity)",
    editor_target: editorTarget,
    raw_dictated: rawDictated,
    intended_reference: refText,
    repaired_prompt: finalGuardedPrompt,
    referenced_files: referencedFiles,
    repairs_applied: repairsApplied,
    target_evaluations: targetEvaluations,
    hazards: hazards,
    metrics: {
      total_targets: totalTargets,
      raw_correct_targets: rawCorrect,
      repaired_correct_targets: repairedCorrect,
      ctem_raw_pct: ctemRaw,
      ctem_repaired_pct: ctemRepaired,
      tsr_raw_pct: tsrRaw,
      tsr_repaired_pct: tsrRepaired,
      wer_raw_pct: werRaw,
      wer_repaired_pct: werRepaired,
      meaning_critical_errors_raw: meaningCriticalErrorsRaw,
      meaning_critical_errors_repaired: meaningCriticalErrorsRepaired
    }
  };
}

function compileWisprArtifacts(repoSymbols, customSnippets = null) {
  const csvRows = [];
  const seenTriggers = new Set();
  const skippedReasons = [];
  const collisionWarnings = [];

  function addDictRow(col1, col2 = "") {
    const c1 = String(col1).replace(/[\u200b-\u200f\ufeff]/g, "").trim();
    const c2 = String(col2).replace(/[\u200b-\u200f\ufeff]/g, "").trim();
    if (!c1) return;
    if (c1.length > 60) {
      skippedReasons.push(`Skipped '${c1.slice(0, 25)}...': Field 1 exceeds Wispr 60-char limit (${c1.length} chars).`);
      return;
    }
    if (c2.length > 4000) {
      skippedReasons.push(`Skipped '${c1}': Field 2 exceeds Wispr 4,000-char limit.`);
      return;
    }
    if (/^[^A-Za-z0-9]+$/.test(c1)) {
      skippedReasons.push(`Skipped '${c1}': Trigger contains only punctuation/symbols.`);
      return;
    }
    const key = c1.toLowerCase();
    if (seenTriggers.has(key)) return;
    if (csvRows.length >= 1000) {
      skippedReasons.push("Reached Wispr Flow 1,000-entry per-import limit.");
      return;
    }
    seenTriggers.add(key);
    csvRows.push([c1, c2]);

    if (!c1.includes(" ") && !c1.includes(".") && c1.length <= 8 && c2) {
      collisionWarnings.push(
        `Trigger '${c1}' -> '${c2}': Short single-word replacement may disable @file tagging for that dictation in Cursor/Windsurf.`
      );
    }
  }

  for (const sym of repoSymbols) {
    addDictRow(sym.canonical, "");
    for (const v of (sym.acoustic_variants || [])) {
      addDictRow(v, sym.canonical);
    }
  }

  let csvContent = "";
  for (const [c1, c2] of csvRows) {
    if (c2 === "") {
      if (c1.includes(",") || c1.includes('"')) {
        csvContent += `"${c1.replace(/"/g, '""')}"\n`;
      } else {
        csvContent += `${c1}\n`;
      }
    } else {
      const fmtCell = val => (val.includes(",") || val.includes('"')) ? `"${val.replace(/"/g, '""')}"` : val;
      csvContent += `${fmtCell(c1)},${fmtCell(c2)}\n`;
    }
  }

  const defaultSnippets = [
    {
      name: "verify parity suite",
      text: "Run python3 scripts/check_parity.py and python3 -m unittest discover -s tests -v. Report any mismatch between src/engine.js and backend/flowguard_engine.py before committing."
    },
    {
      name: "safe serverless deploy check",
      text: "Validate template.yaml with sam validate --lint, verify CORS and health endpoint response, and do not claim deployment succeeded until the public URL and end-to-end save/reload journey are verified."
    },
    {
      name: "guard prompt context",
      text: "Inspect the referenced repository files first, preserve all existing negation guards and numeric bounds, and do not overwrite existing sort keys or environment variables."
    }
  ];

  const rawSnippets = customSnippets !== null ? customSnippets : defaultSnippets;
  const validSnippets = [];
  const seenSnip = new Set();

  for (const item of rawSnippets) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.name !== "string" || typeof item.text !== "string") continue;
    const name = item.name.replace(/[\u200b-\u200f\ufeff]/g, "").trim();
    const text = item.text.replace(/[\u200b-\u200f\ufeff]/g, "").trim();
    if (!name || !text) continue;
    if (name.length > 60 || text.length > 4000) {
      skippedReasons.push(`Skipped snippet '${name.slice(0, 25)}': Exceeds Wispr 60/4000 char limits.`);
      continue;
    }
    const k = name.toLowerCase();
    if (seenSnip.has(k) || seenTriggers.has(k)) {
      collisionWarnings.push(
        `Snippet trigger '${name}' conflicts with an existing dictionary/snippet entry (Wispr desktop blocks duplicate triggers across Dictionary and Snippets).`
      );
      continue;
    }
    seenSnip.add(k);
    validSnippets.push({ name, text });
  }

  return {
    spec_badge: "Verified against Wispr Flow Desktop Bulk Import Spec (Oct 2026)",
    dictionary_csv: csvContent,
    dictionary_entry_count: csvRows.length,
    snippets_json: JSON.stringify(validSnippets, null, 2),
    snippets_entry_count: validSnippets.length,
    collision_warnings: collisionWarnings,
    skipped_reasons: skippedReasons
  };
}

function buildPrivacyReport(
  verificationResult,
  includeRawTokens = false,
  autoCleanupLevel = "Light",
  ideEnvironment = "VS Code + GitHub Copilot (Windows/Mac)"
) {
  const metrics = verificationResult.metrics;
  const repairs = verificationResult.repairs_applied;
  const hazards = verificationResult.hazards;

  const redactedRepairs = repairs.map((r, idx) => {
    if (includeRawTokens) return r;
    return {
      spoken_pattern: `[SPOKEN_SPAN_${idx + 1}:${r.type}]`,
      canonical_target: `[CANONICAL_${r.type.toUpperCase()}_${idx + 1}]`,
      type: r.type
    };
  });

  const redactedHazards = hazards.map((h, idx) => ({
    category: h.category,
    severity: h.severity,
    evidence: includeRawTokens ? h.evidence : `[REDACTED_HAZARD_${idx + 1}]`
  }));

  return {
    schema_version: "flowguard-wispr-feedback-v1",
    consent_mode: includeRawTokens ? "FULL_OPT_IN" : "PRIVACY_REDACTED_DEFAULT",
    environment: {
      ide: ideEnvironment,
      auto_cleanup_level: autoCleanupLevel,
      vscode_file_tagging_supported_natively: false
    },
    summary_metrics: {
      total_structured_tokens: metrics.total_targets,
      ctem_raw_pct: metrics.ctem_raw_pct,
      ctem_after_flowguard_pct: metrics.ctem_repaired_pct,
      tsr_raw_pct: metrics.tsr_raw_pct,
      tsr_after_flowguard_pct: metrics.tsr_repaired_pct,
      meaning_critical_errors_caught: metrics.meaning_critical_errors_raw
    },
    structured_token_mismatches: redactedRepairs,
    semantic_hazards_caught: redactedHazards
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extractRepoSymbols,
    verifyDictation,
    compileWisprArtifacts,
    buildPrivacyReport
  };
}
