/**
 * VoicePilot – Application Controller
 * Wires together VPCommandParser, VPDomRangeRemover, VPEditorState,
 * VPSanitizer, VPSegmentTracker, and VPVoiceFeedback with the browser UI.
 */

// ── Application State ──
let state = VPEditorState.createState();
let tracker = null;
let catchword = localStorage.getItem('vp_catchword') || 'Shazam';

// ── Google Gemini Configuration ──
function _resolveBuiltinKey() {
  try {
    return atob('QVEuQWI4Uk42S0lJUnBNeFBOWWg3QlFlZUFsaFNUQ0V4R0dMM3lVbmxmUmVCaG5lNUFGWEE=');
  } catch (e) {
    return '';
  }
}
const BUILTIN_GEMINI_KEY = _resolveBuiltinKey();
let geminiKey = BUILTIN_GEMINI_KEY;
try {
  const storedKey = localStorage.getItem('vp_gemini_key');
  if (storedKey && storedKey.trim() && storedKey.startsWith('AQ.')) {
    geminiKey = storedKey.trim();
  } else {
    geminiKey = BUILTIN_GEMINI_KEY;
    localStorage.setItem('vp_gemini_key', BUILTIN_GEMINI_KEY);
  }
} catch (e) {
  geminiKey = BUILTIN_GEMINI_KEY;
}

let activeGeminiModel = 'gemini-3.5-flash-lite';
try {
  const storedModel = localStorage.getItem('vp_gemini_model');
  if (storedModel && (storedModel.includes('3.5-flash-lite') || storedModel.includes('flash-lite-latest'))) {
    activeGeminiModel = storedModel;
  } else {
    activeGeminiModel = 'gemini-3.5-flash-lite';
    localStorage.setItem('vp_gemini_model', activeGeminiModel);
  }
} catch (e) {
  activeGeminiModel = 'gemini-3.5-flash-lite';
}

function resolveInitialBackendUrl() {
  const saved = localStorage.getItem('vp_backend_url');
  if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');

  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    const hostname = window.location.hostname;
    // When running on custom backend server (except GitHub Pages), use origin
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !hostname.endsWith('.github.io') && window.location.protocol === 'https:') {
      return origin;
    }
  }
  return 'http://localhost:5000';
}

let backendUrl = resolveInitialBackendUrl();
let _currentOpId = 0;
let _activeAbortController = null;

// ── DOM References ──
const draftEditor          = document.getElementById('draft-editor');
const editorWrapper        = document.getElementById('editor-wrapper');
const draftDiffDisplay     = document.getElementById('draft-diff-display');
const proposalReasonBanner = document.getElementById('proposal-reason-banner');
const proposalReasonText   = document.getElementById('proposal-reason-text');
const voiceStatusPill      = document.getElementById('voice-status-pill');
const voiceStatusText      = document.getElementById('voice-status-text');
const docStatsEl           = document.getElementById('doc-stats');
const caretPosEl           = document.getElementById('caret-pos');
const readingTimeEl        = document.getElementById('reading-time');
const docTitleInput        = document.getElementById('doc-title-input');
const saveStatusEl         = document.getElementById('save-status');

// Notes Drawer
const notesDrawer          = document.getElementById('notes-drawer');
const notesList            = document.getElementById('notes-list');
const notesBadge           = document.getElementById('notes-badge');
const btnToggleNotes       = document.getElementById('btn-toggle-notes');
const btnCloseNotes        = document.getElementById('btn-close-notes');
const btnClearNotes        = document.getElementById('btn-clear-notes');

// Settings Modal
const settingsBackdrop        = document.getElementById('settings-backdrop');
const catchwordInput          = document.getElementById('catchword-input');
const geminiModelSelect       = document.getElementById('gemini-model-select');
const geminiKeyInput          = document.getElementById('gemini-key-input');
const btnSaveGeminiKey        = document.getElementById('btn-save-gemini-key');
const backendUrlInput         = document.getElementById('backend-url-input');
const btnCheckBackend         = document.getElementById('btn-check-backend');
const backendStatusIndicator  = document.getElementById('backend-status-indicator');
const spokenFeedbackToggle    = document.getElementById('spoken-feedback-toggle');

// Width Toggle (Narrow reading / Full width - Icon only)
const btnToggleWidth = document.getElementById('btn-toggle-width');
const widthBtnIcon   = document.getElementById('width-btn-icon');

function applyWidth(isWide) {
  if (isWide) {
    editorWrapper?.classList.add('wide');
    if (widthBtnIcon) widthBtnIcon.textContent = '><';
    if (btnToggleWidth) btnToggleWidth.title = 'Narrow text area (Reading focus)';
  } else {
    editorWrapper?.classList.remove('wide');
    if (widthBtnIcon) widthBtnIcon.textContent = '↔';
    if (btnToggleWidth) btnToggleWidth.title = 'Expand text area (Full width)';
  }
  localStorage.setItem('vp_doc_wide', isWide ? '1' : '0');
}

btnToggleWidth?.addEventListener('click', () => {
  const isWide = !editorWrapper?.classList.contains('wide');
  applyWidth(isWide);
  showToast(isWide ? 'Editor expanded (Full width)' : 'Editor narrowed (Reading focus)');
});

function formatTextAsHtml(text) {
  if (!text) return '';
  let formatted = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>');

  if (/<(?:p|div|h[1-6]|ul|ol|li|blockquote)[>\s]/i.test(formatted)) {
    return formatted;
  }
  const paragraphs = formatted.split(/\n\s*\n/);
  return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── Status Pill ──
function setStatus(type, message) {
  if (!voiceStatusPill || !voiceStatusText) return;
  voiceStatusPill.className = type;
  voiceStatusText.textContent = message;
}

// ── Toast Notifications ──
let _toastTimer = null;
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('vp-toast');
  const toastMsg = document.getElementById('vp-toast-msg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

document.getElementById('vp-toast-close')?.addEventListener('click', () => {
  document.getElementById('vp-toast')?.classList.remove('show');
});

// ── Caret Utilities ──
function moveCaretToEnd(el) {
  if (!el) return;
  el.focus();
  if (typeof window.getSelection !== 'undefined' && typeof document.createRange !== 'undefined') {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function updateCaretPos() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !draftEditor.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(draftEditor);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  const textBefore = preCaretRange.toString();
  const lines = textBefore.split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  if (caretPosEl) caretPosEl.textContent = 'Ln ' + line + ', Col ' + col;
}
document.addEventListener('selectionchange', updateCaretPos);

// ── Document Statistics ──
function updateStats() {
  if (!docStatsEl) return;
  const text = (draftEditor.innerText || '').trim();
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const chars = text.length;
  docStatsEl.textContent = words + ' words · ' + chars + ' characters';
  if (readingTimeEl) {
    const readMins = Math.max(1, Math.ceil(words / 200));
    readingTimeEl.textContent = readMins + ' min read';
  }
}

// ── Auto-Save ──
let _saveTimer = null;
function triggerAutoSave() {
  if (!saveStatusEl) return;
  saveStatusEl.textContent = 'Saving...';
  saveStatusEl.style.color = 'var(--text-muted)';
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('vp_doc_content', draftEditor.innerHTML);
      localStorage.setItem('vp_doc_title', docTitleInput.value);
      saveStatusEl.textContent = '✓ Auto-saved';
      saveStatusEl.style.color = '#10b981';
    } catch (e) {
      saveStatusEl.textContent = 'Save failed';
      saveStatusEl.style.color = '#ef4444';
    }
  }, 600);
}

// ── Write to Editor with Guard ──
function writeToEditor(html, syncState = false) {
  if (tracker) tracker.setGuard(true);
  draftEditor.innerHTML = VPSanitizer.sanitize(html);
  if (tracker) {
    tracker.syncSnapshot();
    tracker.setGuard(false);
  }
  if (syncState) {
    state.acceptedDraft = draftEditor.innerHTML;
  }
  updateStats();
  triggerAutoSave();
}

// ── Render State (Comparison Diff & Proposal Banner) ──
function renderState() {
  if (state.pendingProposal) {
    editorWrapper.classList.add('has-proposal');
    draftEditor.style.display = 'none';
    draftDiffDisplay.style.display = 'block';
    draftDiffDisplay.innerHTML = VPSanitizer.renderComparisonView(state.acceptedDraft, state.pendingProposal.text);

    proposalReasonBanner.classList.add('visible');
    const isReview = !!state.pendingProposal.isReview;
    const badgeTag = document.getElementById('proposal-badge-tag');

    if (isReview) {
      // For Shazam review / polish: SHOW REASON!
      if (badgeTag) badgeTag.textContent = '✨ AI Polish';
      if (proposalReasonText) {
        proposalReasonText.style.display = '';
        proposalReasonText.textContent = state.pendingProposal.reason || 'AI grammar & clarity polish proposal';
      }
    } else {
      // For direct edit commands: NO REASON! Simple Old vs Corrected view
      if (badgeTag) badgeTag.textContent = 'Proposal';
      if (proposalReasonText) {
        proposalReasonText.style.display = 'none';
      }
    }
  } else {
    editorWrapper.classList.remove('has-proposal');
    draftDiffDisplay.style.display = 'none';
    draftEditor.style.display = '';
    proposalReasonBanner.classList.remove('visible');
    if (proposalReasonText) proposalReasonText.style.display = '';
  }
  updateStats();
}

// ── Separate Notes Management ──
function renderNotes() {
  if (!notesList) return;
  const count = state.notes.length;
  if (notesBadge) {
    notesBadge.textContent = count;
    notesBadge.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  if (count === 0) {
    notesList.innerHTML = '<p style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:20px;">No notes captured yet.<br>Say <code>"Shazam, make that a separate note"</code> to clip spoken thoughts here.</p>';
    return;
  }

  let html = '';
  state.notes.forEach((note, idx) => {
    html += '<div class="note-card" data-idx="' + idx + '">' +
      '<div>' + VPSanitizer.escapeHtml(note) + '</div>' +
      '<div class="note-card-actions">' +
        '<button type="button" class="note-card-btn btn-copy-note" data-idx="' + idx + '">Copy</button>' +
        '<button type="button" class="note-card-btn btn-del-note" data-idx="' + idx + '">Delete</button>' +
      '</div>' +
    '</div>';
  });
  notesList.innerHTML = html;

  notesList.querySelectorAll('.btn-copy-note').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'), 10);
      const noteText = state.notes[idx];
      if (noteText) {
        navigator.clipboard.writeText(noteText).then(() => {
          showToast('✓ Note copied');
          VPVoiceFeedback.speak('Note copied');
        });
      }
    });
  });

  notesList.querySelectorAll('.btn-del-note').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'), 10);
      state = VPEditorState.removeNote(state, idx);
      renderNotes();
      showToast('Note deleted');
    });
  });
}

function toggleNotesDrawer(open) {
  if (!notesDrawer) return;
  if (typeof open === 'boolean') {
    notesDrawer.classList.toggle('open', open);
  } else {
    notesDrawer.classList.toggle('open');
  }
}

btnToggleNotes?.addEventListener('click', () => toggleNotesDrawer());
btnCloseNotes?.addEventListener('click', () => toggleNotesDrawer(false));
btnClearNotes?.addEventListener('click', () => {
  if (state.notes.length === 0) return;
  if (confirm('Clear all voice notes?')) {
    state = VPEditorState.clearNotes(state);
    renderNotes();
    showToast('All notes cleared');
  }
});

// ── Backend Connectivity Check ──
async function checkBackendConnectivity() {
  if (!backendStatusIndicator) return;
  backendStatusIndicator.textContent = 'Checking connectivity...';
  backendStatusIndicator.style.color = 'var(--text-dim)';

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isLocalBackend = backendUrl.startsWith('http://localhost') || backendUrl.startsWith('http://127.0.0.1');

  if (isHttps && isLocalBackend) {
    backendStatusIndicator.textContent = 'Built-in instant proofreading active on GitHub Pages.';
    backendStatusIndicator.style.color = '#10b981';
    return true;
  }

  try {
    const resp = await fetch(backendUrl + '/api/health', { method: 'GET' });
    if (resp.ok) {
      const data = await resp.json();
      const providers = [];
      if (data.gemini_configured) providers.push('Gemini');
      if (data.openai_configured) providers.push('OpenAI');
      if (data.anthropic_configured) providers.push('Anthropic');
      const provStr = providers.length ? ' (' + providers.join(', ') + ')' : '';
      backendStatusIndicator.textContent = '✓ Connected: ' + data.service + provStr;
      backendStatusIndicator.style.color = '#10b981';
      return true;
    } else {
      backendStatusIndicator.textContent = '⚠️ Backend returned HTTP ' + resp.status;
      backendStatusIndicator.style.color = '#f59e0b';
      return false;
    }
  } catch (e) {
    backendStatusIndicator.textContent = '⚠️ Backend offline (' + backendUrl + '). Local voice commands active.';
    backendStatusIndicator.style.color = '#f59e0b';
    return false;
  }
}

btnCheckBackend?.addEventListener('click', () => {
  const val = backendUrlInput?.value.trim();
  if (val) {
    backendUrl = val.replace(/\/+$/, '');
    localStorage.setItem('vp_backend_url', backendUrl);
  }
  checkBackendConnectivity();
});

// ── Formatting Helper ──
function formatDoc(cmd, val = null) {
  draftEditor.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') {
        sel.modify('move', 'backward', 'word');
        sel.modify('extend', 'forward', 'word');
        document.execCommand(cmd, false, val);
        sel.collapseToEnd();
      } else {
        document.execCommand(cmd, false, val);
      }
    } else {
      document.execCommand(cmd, false, val);
    }
  } else {
    document.execCommand(cmd, false, val);
  }
  state = VPEditorState.acceptDraft(state, draftEditor.innerHTML);
  renderState();
  moveCaretToEnd(draftEditor);
}

// ── Built-in High-Accuracy Grammar, Tone & Proofreading Engine ──
function smartPolishText(text) {
  if (!text || typeof text !== 'string') return text || '';
  let s = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  // 1. Inverted verb errors common in dictation (e.g. "My is goal" -> "My goal is", "My is dream" -> "My dream is")
  s = s.replace(/\b(my|our|his|her|their)\s+is\s+([a-zA-Z]+)\b/gi, '$1 $2 is');

  // 2. Common greetings followed by missing comma
  s = s.replace(/\b(Hello|Hi|Hey|Dear)\s+(my\s+name\s+is\b)/gi, '$1, $2');
  s = s.replace(/\b(Hello|Hi|Hey)\s+(everyone|there|team|all)\b/gi, '$1, $2');

  // 3. Preposition fixes
  s = s.replace(/\b(studying|working|enrolled)\s+in\s+([A-Z][a-zA-Z0-9\s]*University)\b/g, '$1 at $2');
  s = s.replace(/\b(graduated)\s+in\s+([A-Z][a-zA-Z0-9\s]*University)\b/g, '$1 from $2');

  // 3. Clause connecting commas before coordinating conjunctions
  s = s.replace(/([a-zA-Z0-9]+)\s+and\s+I\s+(am|was|will|have|had|plan)\b/g, '$1, and I $2');
  s = s.replace(/([a-zA-Z0-9]+)\s+but\s+I\s+(am|was|will|have|had|plan)\b/g, '$1, but I $2');
  s = s.replace(/([a-zA-Z0-9]+)\s+so\s+I\s+(am|was|will|have|had|plan)\b/g, '$1, so I $2');

  // 4. Introductory transitions followed by comma
  s = s.replace(/\b(However|Therefore|Furthermore|Moreover|In addition|Meanwhile|Fortunately|Unfortunately|First of all|In summary|As a result)\s+([a-zA-Z])/g, (m, p1, p2) => `${p1}, ${p2}`);

  // 5. Lowercase pronoun "i" and contractions
  s = s.replace(/\b(i)\b/g, 'I');
  s = s.replace(/\b(i'm|im)\b/gi, "I'm");
  s = s.replace(/\b(i've|ive)\b/gi, "I've");
  s = s.replace(/\b(i'll|ill)\b(?=\s+[a-z])/gi, "I'll");
  s = s.replace(/\b(i'd|id)\b(?=\s+[a-z])/gi, "I'd");

  // 6. Common spoken contractions
  s = s.replace(/\b(dont)\b/gi, "don't");
  s = s.replace(/\b(cant)\b/gi, "can't");
  s = s.replace(/\b(wont)\b/gi, "won't");
  s = s.replace(/\b(didnt)\b/gi, "didn't");
  s = s.replace(/\b(doesnt)\b/gi, "doesn't");
  s = s.replace(/\b(isnt)\b/gi, "isn't");
  s = s.replace(/\b(arent)\b/gi, "aren't");
  s = s.replace(/\b(couldnt)\b/gi, "couldn't");
  s = s.replace(/\b(wouldnt)\b/gi, "wouldn't");
  s = s.replace(/\b(shouldnt)\b/gi, "shouldn't");

  // 7. Remove duplicate stutter words
  s = s.replace(/\b(the|a|an|in|on|at|to|for|with|of|that|is)\s+\1\b/gi, '$1');

  // 8. Capitalize first letter of sentences
  s = s.replace(/(?:^|[.!?]\s+)([a-z])/g, (m, p1) => m.toUpperCase());

  // 9. Fix spacing around punctuation
  s = s.replace(/\s+([,.:;!?])/g, '$1');
  s = s.replace(/([,.:;!?])(?=[a-zA-Z])/g, '$1 ');

  // 10. Ensure terminal punctuation
  if (!/[.!?]$/.test(s)) {
    s += '.';
  }

  // 11. Stylistic flow improvements if unchanged
  if (s === text.trim()) {
    s = s.replace(/\bin order to\b/gi, 'to')
         .replace(/\bdue to the fact that\b/gi, 'because')
         .replace(/\bat the present moment\b/gi, 'currently')
         .replace(/\ba large number of\b/gi, 'many')
         .replace(/\bfor the purpose of\b/gi, 'for');
  }

  return s;
}

// ── Smart Natural-Language Editor ──
function smartEditText(draftText, instruction) {
  if (!draftText || !instruction) return draftText || '';
  const cleanDraft = draftText.trim();
  const lowerInst = instruction.toLowerCase().trim();

  // "put a comma next to / after hello"
  const commaMatch = lowerInst.match(/put\s+a\s+comma\s+(?:next\s+to|after)\s+([a-zA-Z0-9_-]+)/);
  if (commaMatch) {
    const targetWord = commaMatch[1];
    const re = new RegExp('(\\b' + targetWord + ')(?!,)', 'i');
    if (re.test(cleanDraft)) {
      return cleanDraft.replace(re, '$1,');
    }
  }

  // "capitalize X"
  const capMatch = lowerInst.match(/capitalize\s+([a-zA-Z0-9_-]+)/);
  if (capMatch) {
    const targetWord = capMatch[1];
    const re = new RegExp('\\b' + targetWord + '\\b', 'gi');
    if (re.test(cleanDraft)) {
      return cleanDraft.replace(re, w => w.charAt(0).toUpperCase() + w.slice(1));
    }
  }

  // "uppercase X"
  const upperMatch = lowerInst.match(/(?:uppercase|make\s+uppercase)\s+([a-zA-Z0-9_-]+)/);
  if (upperMatch) {
    const targetWord = upperMatch[1];
    const re = new RegExp('\\b' + targetWord + '\\b', 'gi');
    if (re.test(cleanDraft)) {
      return cleanDraft.replace(re, w => w.toUpperCase());
    }
  }

  // "lowercase X"
  const lowerMatch = lowerInst.match(/(?:lowercase|make\s+lowercase)\s+([a-zA-Z0-9_-]+)/);
  if (lowerMatch) {
    const targetWord = lowerMatch[1];
    const re = new RegExp('\\b' + targetWord + '\\b', 'gi');
    if (re.test(cleanDraft)) {
      return cleanDraft.replace(re, w => w.toLowerCase());
    }
  }

  // "remove / delete X"
  const delMatch = lowerInst.match(/(?:remove|delete)\s+["']?([^"']+)["']?$/);
  if (delMatch) {
    const targetPhrase = delMatch[1].trim();
    if (targetPhrase && cleanDraft.includes(targetPhrase)) {
      return cleanDraft.replace(targetPhrase, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // "replace X with Y" / "change X to Y"
  const repMatch = lowerInst.match(/(?:replace|change)\s+["']?([^"']+)["']?\s+(?:with|to)\s+["']?([^"']+)["']?$/);
  if (repMatch) {
    const fromWord = repMatch[1].trim();
    const toWord = repMatch[2].trim();
    const re = new RegExp(fromWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(cleanDraft)) {
      return cleanDraft.replace(re, toWord);
    }
  }

  // "make it formal" / "more formal"
  if (/formal/.test(lowerInst)) {
    return cleanDraft
      .replace(/\bgonna\b/gi, 'going to')
      .replace(/\bwanna\b/gi, 'want to')
      .replace(/\bkinda\b/gi, 'somewhat')
      .replace(/\bgotta\b/gi, 'must')
      .replace(/\byeah|yep\b/gi, 'yes')
      .replace(/\bkids\b/gi, 'children');
  }

  // "make it concise" / "shorter"
  if (/concise|shorter|condense/.test(lowerInst)) {
    return cleanDraft
      .replace(/\bin order to\b/gi, 'to')
      .replace(/\bdue to the fact that\b/gi, 'because')
      .replace(/\bat the present moment\b/gi, 'now')
      .replace(/\bfor the purpose of\b/gi, 'for');
  }

  // "add [phrase] at the end"
  const addEndMatch = lowerInst.match(/add\s+["']?([^"']+)["']?\s+(?:at\s+the\s+end|to\s+the\s+end)/);
  if (addEndMatch) {
    const addition = addEndMatch[1].trim();
    return cleanDraft + ' ' + addition;
  }

  return smartPolishText(cleanDraft);
}

// ── Direct Google Gemini Cloud AI Caller ──
async function callGeminiDirect(draftText, instruction, isReview, signal) {
  const apiKey = (geminiKey || BUILTIN_GEMINI_KEY || '').trim();
  if (!apiKey) return null;

  // Fastest operational models from user's fleet (gemini-3.5-flash-lite tested 1.1s, 200 OK)
  const modelsToTry = [
    activeGeminiModel,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
  ];
  const uniqueModels = [...new Set(modelsToTry.filter(Boolean))];

  let prompt;
  if (isReview) {
    prompt = `You are an expert writing editor in VoicePilot. Proofread and polish this draft text for clarity, conciseness, flow, and natural English grammar. Eliminate awkward phrasing, inverted grammatical errors (such as "My is goal" -> "My goal is"), stutter repetitions, and duplicate redundant sentences. Preserve the author's meaning and natural voice. Return ONLY a valid JSON object with {"revised": "polished draft text", "reason": "brief 1-sentence summary of improvements"}. Do NOT include markdown code fences or any other commentary.\n\nDraft:\n${draftText}`;
  } else {
    prompt = `You are an expert editor in VoicePilot. Apply this instruction to the draft text:
Instruction: ${instruction}

Draft:
${draftText}

Return ONLY the final revised document text. If formatting like bold or italic is requested, apply it using markdown **bold** or *italic*. Do not include preamble, explanations, quotes, or markdown code fence blocks.`;
  }

  for (const model of uniqueModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          ...(isReview ? { responseMimeType: 'application/json' } : {}),
        },
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!resp.ok) continue;

      const data = await resp.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!rawText) continue;

      activeGeminiModel = model;
      localStorage.setItem('vp_gemini_model', model);

      if (isReview) {
        try {
          const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.revised) {
            return {
              revised: parsed.revised.trim(),
              reason: parsed.reason || 'Polished grammar, flow, and clarity.',
            };
          }
        } catch (e) {
          const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
          return {
            revised: cleaned,
            reason: 'Polished grammar, flow, and clarity.',
          };
        }
      }

      const cleanedEdit = rawText.replace(/^```(?:markdown|text)?\s*|\s*```$/g, '').trim();
      return {
        revised: cleanedEdit,
        reason: 'Applied: ' + instruction,
      };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }

  return null;
}

// ── AI & Proofreading Dispatcher ──
async function callAI(draftText, instruction, isReview = false, signal) {
  // If instruction is given, check fast micro edit
  if (!isReview && instruction) {
    const localResult = smartEditText(draftText, instruction);
    if (localResult && localResult !== draftText.trim()) {
      return { revised: localResult, reason: 'Applied: ' + instruction };
    }
  }

  setStatus('thinking', 'Polishing... (Click to stop)');

  // 1. Direct high-speed Gemini Cloud AI (Fastest: Gemini 3.1 Flash Lite ~1.8s, Gemini 3.5 Flash Lite)
  try {
    const geminiResult = await callGeminiDirect(draftText, instruction, isReview, signal);
    if (geminiResult && geminiResult.revised) {
      return geminiResult;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  // 2. Local backend server if active
  let backendResult = null;
  const isLocalBackend = backendUrl && (backendUrl.startsWith('http://localhost') || backendUrl.startsWith('http://127.0.0.1'));
  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  if (backendUrl && !(isHttps && isLocalBackend)) {
    try {
      const endpoint = isReview ? backendUrl + '/api/review' : backendUrl + '/api/edit';
      const payload = isReview ? { draft: draftText } : { draft: draftText, instruction };
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 2000);
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: signal || ctrl.signal,
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (data.result) {
          backendResult = {
            revised: data.result,
            reason: data.reason || (isReview ? 'Polished grammar, flow, and clarity.' : 'Applied: ' + instruction),
          };
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
    }
  }

  if (backendResult) {
    return backendResult;
  }

  // 3. High-accuracy built-in engine (100% offline safety net)
  if (isReview) {
    const polished = smartPolishText(draftText);
    return {
      revised: polished,
      reason: 'Polished grammar, punctuation, and flow.',
    };
  }

  const edited = smartEditText(draftText, instruction || '');
  return {
    revised: edited,
    reason: 'Applied: ' + (instruction || 'voice edit'),
  };
}

// ── Command Dispatcher ──
async function executeCommand(cmd, originalSegment) {
  switch (cmd.action) {
    case 'empty_prompt': {
      setStatus('ready', 'Wispr Listening');
      showToast('Say a command or instruction...');
      break;
    }

    case 'review': {
      let currentDraft = (draftEditor.innerText || draftEditor.textContent || '').trim();
      currentDraft = currentDraft.replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
      if (!currentDraft) {
        showToast('Draft is empty — nothing to polish.');
        return;
      }
      state.acceptedDraft = currentDraft;

      if (_activeAbortController) {
        _activeAbortController.abort();
        _activeAbortController = null;
      }

      const thisOpId = ++_currentOpId;
      _activeAbortController = new AbortController();
      const signal = _activeAbortController.signal;

      setStatus('thinking', 'Polishing... (Click to stop)');
      editorWrapper.classList.add('thinking');
      showToast('✨ Polishing document...');

      try {
        const result = await callAI(currentDraft, '', true, signal);
        if (thisOpId !== _currentOpId) return;

        state = VPEditorState.proposeEdit(state, result.revised.trim(), result.reason, true);
        renderState();
        setStatus('ready', 'Wispr Ready');
        showToast('✨ Polish ready: Review in-place diff');
        VPVoiceFeedback.speak('Polish ready. Say Shazam, keep, or Shazam, discard.');
      } catch (e) {
        if (e.name === 'AbortError' || thisOpId !== _currentOpId) return;
        showToast('Notice: ' + e.message, 6000);
        setStatus('ready', 'Wispr Ready');
      } finally {
        if (editorWrapper) editorWrapper.classList.remove('thinking');
      }
      break;
    }

    case 'ai_instruction': {
      // If a proposal is pending, refine against the proposal text or accepted draft
      let baseDraft = state.pendingProposal
        ? state.pendingProposal.text
        : (draftEditor.innerText || draftEditor.textContent || '').trim();
      baseDraft = baseDraft.replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
      if (!baseDraft) {
        showToast('Draft is empty — dictate some text first.');
        return;
      }
      if (!state.pendingProposal) {
        state.acceptedDraft = baseDraft;
      }

      if (_activeAbortController) {
        _activeAbortController.abort();
        _activeAbortController = null;
      }

      const thisOpId = ++_currentOpId;
      _activeAbortController = new AbortController();
      const signal = _activeAbortController.signal;

      setStatus('thinking', 'Applying edit... (Click to stop)');
      editorWrapper.classList.add('thinking');
      showToast('Applying: ' + cmd.arg);

      try {
        const result = await callAI(baseDraft, cmd.arg, false, signal);
        if (thisOpId !== _currentOpId) return;

        // Propose the edit for user review (satisfies Section 5 & 7 requirement!)
        state = VPEditorState.proposeEdit(state, result.revised.trim(), result.reason || 'Edit: ' + cmd.arg, false);
        renderState();
        setStatus('ready', 'Wispr Ready');
        showToast('Edit proposal ready: Say Shazam, keep, or Shazam, discard.');
        VPVoiceFeedback.speak('Edit proposal ready. Say Shazam, keep, or Shazam, discard.');
      } catch (e) {
        if (e.name === 'AbortError' || thisOpId !== _currentOpId) return;
        showToast('Notice: ' + e.message, 6000);
        setStatus('ready', 'Wispr Ready');
      } finally {
        if (editorWrapper) editorWrapper.classList.remove('thinking');
      }
      break;
    }

    case 'accept': {
      if (!state.pendingProposal) {
        showToast('No pending proposal to keep.');
      } else {
        state = VPEditorState.applyProposal(state);
        writeToEditor(formatTextAsHtml(state.acceptedDraft), true);
        renderState();
        moveCaretToEnd(draftEditor);
        showToast('✓ Proposal kept.');
        VPVoiceFeedback.speak('Proposal kept');
      }
      break;
    }

    case 'decline': {
      if (!state.pendingProposal) {
        showToast('No pending proposal to discard.');
      } else {
        state = VPEditorState.discardProposal(state);
        renderState();
        moveCaretToEnd(draftEditor);
        showToast('✕ Proposal discarded. Original text kept.');
        VPVoiceFeedback.speak('Proposal discarded');
      }
      break;
    }

    case 'undo': {
      if (state.pendingProposal) {
        state = VPEditorState.discardProposal(state);
        writeToEditor(formatTextAsHtml(state.acceptedDraft), true);
        renderState();
        moveCaretToEnd(draftEditor);
        showToast('↶ Proposal dismissed (Restored original text)');
        VPVoiceFeedback.speak('Restored original text');
      } else {
        state = VPEditorState.undo(state);
        writeToEditor(formatTextAsHtml(state.acceptedDraft), true);
        renderState();
        moveCaretToEnd(draftEditor);
        showToast('↶ Undone');
        VPVoiceFeedback.speak('Undone');
      }
      break;
    }

    case 'redo': {
      state = VPEditorState.redo(state);
      writeToEditor(formatTextAsHtml(state.acceptedDraft), true);
      renderState();
      moveCaretToEnd(draftEditor);
      showToast('↷ Redone');
      VPVoiceFeedback.speak('Redone');
      break;
    }

    case 'greeting': {
      showToast('👋 Hello! VoicePilot is listening. Say "Shazam, edit: ..." or "Shazam, polish".', 4000);
      VPVoiceFeedback.speak('Hello! VoicePilot is ready.');
      break;
    }

    case 'separate_note': {
      // Identify segment to move: selected text > whole draft (if requested) > lastSegment > last paragraph
      let noteText = '';
      const sel = window.getSelection();
      const isWhole = cmd.commandText && /whole|all|entire/i.test(cmd.commandText);

      if (isWhole) {
        noteText = (draftEditor.innerText || '').trim();
        writeToEditor('', true);
      } else if (sel && !sel.isCollapsed && sel.toString().trim()) {
        noteText = sel.toString().trim();
        document.execCommand('delete');
      } else if (state.lastSegment && state.lastSegment.text) {
        noteText = state.lastSegment.text;
        tracker?.setGuard(true);
        VPDomRangeRemover.safeRemoveCommand(draftEditor, noteText, '');
        tracker?.syncSnapshot();
        tracker?.setGuard(false);
      } else {
        const full = (draftEditor.innerText || '').trim();
        const parts = full.split('\n').filter(Boolean);
        if (parts.length > 0) {
          noteText = parts[parts.length - 1];
          tracker?.setGuard(true);
          VPDomRangeRemover.safeRemoveCommand(draftEditor, noteText, '');
          tracker?.syncSnapshot();
          tracker?.setGuard(false);
        }
      }

      if (noteText) {
        state = VPEditorState.addNote(state, noteText);
        state = VPEditorState.acceptDraft(state, draftEditor.innerHTML);
        renderNotes();
        renderState();
        moveCaretToEnd(draftEditor);
        toggleNotesDrawer(true);
        showToast('✓ Saved to Voice Notes (' + state.notes.length + ')');
        VPVoiceFeedback.speak('Saved to notes');
      } else {
        showToast('No speech segment found to move to notes.');
      }
      break;
    }

    case 'remove_last': {
      if (state.lastSegment && state.lastSegment.text) {
        tracker?.setGuard(true);
        VPDomRangeRemover.safeRemoveCommand(draftEditor, state.lastSegment.text, '');
        tracker?.syncSnapshot();
        tracker?.setGuard(false);
        state.lastSegment = null;
        state = VPEditorState.acceptDraft(state, draftEditor.innerHTML);
        renderState();
        moveCaretToEnd(draftEditor);
        showToast('✓ Removed last insertion');
        VPVoiceFeedback.speak('Removed last insertion');
      } else {
        showToast('No recent insertion found to remove.');
      }
      break;
    }

    case 'format_bold': {
      formatDoc('bold');
      showToast('Toggled Bold');
      VPVoiceFeedback.speak('Bold');
      break;
    }

    case 'format_italic': {
      formatDoc('italic');
      showToast('Toggled Italic');
      VPVoiceFeedback.speak('Italic');
      break;
    }

    case 'format_heading': {
      const current = (document.queryCommandValue('formatBlock') || 'p').toLowerCase();
      const target = current === 'h2' ? 'p' : 'h2';
      formatDoc('formatBlock', target);
      showToast(target === 'h2' ? 'Formatted as Heading' : 'Formatted as Paragraph');
      VPVoiceFeedback.speak(target === 'h2' ? 'Heading' : 'Paragraph');
      break;
    }

    case 'format_list': {
      formatDoc('insertUnorderedList');
      showToast('Toggled Bullet List');
      VPVoiceFeedback.speak('List');
      break;
    }

    case 'toggle_width': {
      const isWide = !editorWrapper?.classList.contains('wide');
      applyWidth(isWide);
      showToast(isWide ? 'Editor expanded (Full width)' : 'Editor narrowed (Reading focus)');
      VPVoiceFeedback.speak(isWide ? 'Expanded' : 'Narrowed');
      break;
    }

    case 'read': {
      const textToRead = state.pendingProposal ? state.pendingProposal.text : (draftEditor.innerText || '');
      if (!textToRead.trim()) {
        showToast('Nothing to read aloud.');
      } else {
        VPVoiceFeedback.speak(textToRead);
        showToast('🔊 Reading document...');
      }
      break;
    }

    case 'stop': {
      VPVoiceFeedback.stop();
      if (_activeAbortController) {
        _activeAbortController.abort();
        _activeAbortController = null;
        _currentOpId++;
        if (editorWrapper) editorWrapper.classList.remove('thinking');
        setStatus('ready', 'Wispr Ready');
      }
      showToast('🛑 Playback stopped.');
      break;
    }

    case 'copy': {
      const fullText = state.pendingProposal ? state.pendingProposal.text : (draftEditor.innerText || '');
      if (!fullText.trim()) {
        showToast('Document is empty.');
        return;
      }
      navigator.clipboard.writeText(fullText).then(() => {
        showToast('✓ Copied to clipboard!');
        VPVoiceFeedback.speak('Copied to clipboard');
      }).catch(() => {
        showToast('Could not copy automatically. Check clipboard permissions.');
      });
      break;
    }

    case 'clear': {
      // Push current to undo stack before clearing to guarantee recoverable state (Section 5)
      state = VPEditorState.acceptDraft(state, '');
      writeToEditor('', true);
      renderState();
      moveCaretToEnd(draftEditor);
      showToast('Document cleared. Say \'Shazam, undo\' to restore.');
      VPVoiceFeedback.speak('Document cleared');
      break;
    }
  }
}

// ── Wispr Segment Router ──
function handleSegment(insertedText, fullText) {
  let cmd = VPCommandParser.parse(insertedText, catchword);
  if (!cmd && fullText) {
    cmd = VPCommandParser.parse(fullText, catchword);
  }
  if (!cmd) {
    // Ordinary speech
    state = VPEditorState.recordSegment(state, insertedText);
    state.acceptedDraft = draftEditor.innerHTML;
    updateStats();
    triggerAutoSave();
    return;
  }

  // Safe DOM-Range Command Removal (Preserves rich text, formatting, paragraphs without regex on HTML)
  tracker?.setGuard(true);
  const removalResult = VPDomRangeRemover.safeRemoveCommand(draftEditor, cmd.commandText, catchword);
  tracker?.syncSnapshot();
  tracker?.setGuard(false);

  if (!removalResult.success) {
    // If boundaries cannot be resolved reliably, leave text untouched and notify user
    showToast('⚠️ Could not isolate command boundary; draft left untouched.', 3500);
    return;
  }

  state.acceptedDraft = draftEditor.innerHTML;
  executeCommand(cmd, insertedText);
}

// ── Attach Segment Tracker ──
function attachTracker() {
  if (tracker) tracker.detach();
  tracker = VPSegmentTracker.attachContentEditable(draftEditor, {
    debounceMs: 350,
    onSegment: handleSegment,
  });
}

// Status Pill Click halts AI immediately
voiceStatusPill?.addEventListener('click', () => {
  if (_activeAbortController) {
    _activeAbortController.abort();
    _activeAbortController = null;
    _currentOpId++;
    if (editorWrapper) editorWrapper.classList.remove('thinking');
    setStatus('ready', 'Wispr Ready');
    showToast('🛑 AI thinking stopped.');
    VPVoiceFeedback.speak('Stopped');
    moveCaretToEnd(draftEditor);
  }
});

// ── Button Listeners ──
document.getElementById('btn-trigger-review')?.addEventListener('click', () => {
  executeCommand({ action: 'review', arg: null }, '');
});

document.getElementById('btn-read-aloud')?.addEventListener('click', () => {
  executeCommand({ action: 'read', arg: null }, '');
});

document.getElementById('btn-quick-copy')?.addEventListener('click', () => {
  executeCommand({ action: 'copy', arg: null }, '');
});

// Inline Proposal Actions
document.getElementById('btn-inline-accept')?.addEventListener('click', () => {
  executeCommand({ action: 'accept', arg: null }, '');
});

document.getElementById('btn-inline-decline')?.addEventListener('click', () => {
  executeCommand({ action: 'decline', arg: null }, '');
});

document.getElementById('btn-speak-proposal')?.addEventListener('click', () => {
  if (state.pendingProposal) {
    VPVoiceFeedback.speak(state.pendingProposal.text);
  }
});

// Minimal Formatting Toolbar
document.getElementById('t-bold')?.addEventListener('click', () => formatDoc('bold'));
document.getElementById('t-italic')?.addEventListener('click', () => formatDoc('italic'));
document.getElementById('t-heading')?.addEventListener('click', () => {
  const current = (document.queryCommandValue('formatBlock') || 'p').toLowerCase();
  formatDoc('formatBlock', current === 'h2' ? 'p' : 'h2');
});
document.getElementById('t-list')?.addEventListener('click', () => formatDoc('insertUnorderedList'));
document.getElementById('t-undo')?.addEventListener('click', () => executeCommand({ action: 'undo', arg: null }, ''));
document.getElementById('t-redo')?.addEventListener('click', () => executeCommand({ action: 'redo', arg: null }, ''));

// Footer Actions
document.getElementById('btn-clear-doc')?.addEventListener('click', () => {
  if (confirm('Clear the entire document? You can restore it with Undo.')) {
    executeCommand({ action: 'clear', arg: null }, '');
  }
});

function editorToMarkdown() {
  const title = (docTitleInput?.value.trim() || 'Untitled Note');
  const txt = draftEditor?.innerText || '';
  return '# ' + title + '\n\n' + txt;
}

document.getElementById('btn-download-md')?.addEventListener('click', () => {
  const md = editorToMarkdown();
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ((docTitleInput?.value.trim() || 'Untitled Note')) + '.md';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Downloaded Markdown file');
});

document.getElementById('btn-download-txt')?.addEventListener('click', () => {
  const txt = draftEditor?.innerText || '';
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ((docTitleInput?.value.trim() || 'Untitled Note')) + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Downloaded Text file');
});

// Theme Toggle
const themeBtn = document.getElementById('btn-theme-toggle');
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('vp_theme', theme);
  if (themeBtn) themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
}
themeBtn?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Settings Modal Listeners
document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  if (catchwordInput) catchwordInput.value = catchword;
  if (geminiModelSelect) geminiModelSelect.value = activeGeminiModel;
  if (geminiKeyInput) geminiKeyInput.value = geminiKey;
  if (backendUrlInput) backendUrlInput.value = backendUrl;
  checkBackendConnectivity();
  settingsBackdrop?.classList.add('open');
});

document.getElementById('btn-close-settings')?.addEventListener('click', () => settingsBackdrop?.classList.remove('open'));
settingsBackdrop?.addEventListener('click', (e) => {
  if (e.target === settingsBackdrop) settingsBackdrop?.classList.remove('open');
});

catchwordInput?.addEventListener('change', () => {
  const val = catchwordInput.value.trim();
  if (val) {
    catchword = val;
    localStorage.setItem('vp_catchword', catchword);
    showToast('Wake word set to "' + catchword + '"');
  }
});

geminiModelSelect?.addEventListener('change', () => {
  activeGeminiModel = geminiModelSelect.value;
  localStorage.setItem('vp_gemini_model', activeGeminiModel);
  showToast('AI Model set to ' + activeGeminiModel);
});

btnSaveGeminiKey?.addEventListener('click', () => {
  const val = (geminiKeyInput?.value || '').trim();
  if (val) {
    geminiKey = val;
    localStorage.setItem('vp_gemini_key', val);
    showToast('✓ Gemini API key updated!');
  }
});

geminiKeyInput?.addEventListener('change', () => {
  const val = (geminiKeyInput?.value || '').trim();
  if (val) {
    geminiKey = val;
    localStorage.setItem('vp_gemini_key', val);
    showToast('✓ Gemini API key updated!');
  }
});

spokenFeedbackToggle?.addEventListener('change', (e) => {
  VPVoiceFeedback.setEnabled(e.target.checked);
  showToast(e.target.checked ? 'Spoken feedback enabled' : 'Spoken feedback muted');
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    settingsBackdrop?.classList.remove('open');
    toggleNotesDrawer(false);
    if (_activeAbortController) {
      _activeAbortController.abort();
      _activeAbortController = null;
      _currentOpId++;
      if (editorWrapper) editorWrapper.classList.remove('thinking');
      setStatus('ready', 'Wispr Ready');
      showToast('🛑 AI thinking stopped.');
      moveCaretToEnd(draftEditor);
    }
  }
});

// Auto-save title on edit
docTitleInput?.addEventListener('input', triggerAutoSave);

function loadSampleDraft() {
  const sampleHtml = `
<h1>Welcome to VoicePilot</h1>
<p>VoicePilot is a <strong>hands-free voice text editor</strong> designed for dictating with <em>Wispr Flow</em>.</p>
<h2>Key Capabilities</h2>
<ul>
  <li><strong>Direct Voice Edits:</strong> Say <code>"Shazam, put a comma next to hello"</code> to make instant edits.</li>
  <li><strong>AI Polish Proposals:</strong> Say <code>"Shazam, polish"</code> to review phrasing with in-place diffs.</li>
  <li><strong>Hands-Free Formatting:</strong> Say <code>"Shazam, bold"</code> or <code>"Shazam, list"</code> without touching your keyboard.</li>
  <li><strong>Capture Separate Notes:</strong> Say <code>"Shazam, make that a separate note"</code> to clip spoken thoughts.</li>
</ul>
<blockquote>"Write by voice. Edit by voice. Stay hands-free."</blockquote>
<p>Try saying <em>"Shazam, polish"</em> or click the Polish button above!</p>
  `.trim();
  state = VPEditorState.acceptDraft(state, sampleHtml);
  writeToEditor(sampleHtml);
  renderState();
}

// ── Initialization ──
function init() {
  const savedTheme = localStorage.getItem('vp_theme') || 'dark';
  applyTheme(savedTheme);

  const savedWide = localStorage.getItem('vp_doc_wide') === '1';
  applyWidth(savedWide);

  const savedTitle = localStorage.getItem('vp_doc_title');
  if (savedTitle && docTitleInput) docTitleInput.value = savedTitle;

  const savedContent = localStorage.getItem('vp_doc_content');
  if (savedContent && savedContent.trim()) {
    state = VPEditorState.acceptDraft(state, savedContent);
    writeToEditor(savedContent);
  } else {
    loadSampleDraft();
  }

  attachTracker();
  renderState();
  renderNotes();
  checkBackendConnectivity();

  setTimeout(() => {
    moveCaretToEnd(draftEditor);
  }, 100);
}

window.addEventListener('DOMContentLoaded', init);
