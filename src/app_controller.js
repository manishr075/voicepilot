/**
 * VoicePilot – Application Controller
 * Wires together VPCommandParser, VPDomRangeRemover, VPEditorState,
 * VPSanitizer, VPSegmentTracker, and VPVoiceFeedback with the browser UI.
 */

// ── Application State ──
let state = VPEditorState.createState();
let tracker = null;
let catchword = localStorage.getItem('vp_catchword') || 'Shazam';
let backendUrl = localStorage.getItem('vp_backend_url') || 'http://localhost:5000';
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
const backendUrlInput         = document.getElementById('backend-url-input');
const btnCheckBackend         = document.getElementById('btn-check-backend');
const backendStatusIndicator  = document.getElementById('backend-status-indicator');
const spokenFeedbackToggle    = document.getElementById('spoken-feedback-toggle');

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

// ── Render State (Diff & Proposal Banner) ──
function renderState() {
  if (state.pendingProposal) {
    editorWrapper.classList.add('has-proposal');
    draftEditor.style.display = '';
    draftDiffDisplay.style.display = '';
    draftDiffDisplay.innerHTML = VPSanitizer.renderInPlaceDiff(state.acceptedDraft, state.pendingProposal.text);

    proposalReasonBanner.classList.add('visible');
    proposalReasonText.textContent = state.pendingProposal.reason ||
      (state.pendingProposal.isReview ? 'AI grammar & clarity polish proposal' : 'Voice edit proposal');
  } else {
    editorWrapper.classList.remove('has-proposal');
    draftDiffDisplay.style.display = 'none';
    draftEditor.style.display = '';
    proposalReasonBanner.classList.remove('visible');
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

  try {
    const resp = await fetch(backendUrl + '/api/health', { method: 'GET' });
    if (resp.ok) {
      const data = await resp.json();
      const providers = [];
      if (data.gemini_configured) providers.push('Gemini');
      if (data.openai_configured) providers.push('OpenAI');
      if (data.anthropic_configured) providers.push('Anthropic');
      const provStr = providers.length ? ' (' + providers.join(', ') + ')' : ' (No keys configured on server)';
      backendStatusIndicator.textContent = '✓ Connected to ' + data.service + provStr;
      backendStatusIndicator.style.color = '#10b981';
      return true;
    } else {
      backendStatusIndicator.textContent = '⚠️ Backend returned HTTP ' + resp.status;
      backendStatusIndicator.style.color = '#f59e0b';
      return false;
    }
  } catch (e) {
    backendStatusIndicator.textContent = '⚠️ Backend offline (' + backendUrl + '). Local commands active.';
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

// ── Fast Local Targeted Edits (< 5ms latency) ──
function tryLocalFastEdit(draftText, instruction) {
  if (!draftText || !instruction) return null;
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
      return cleanDraft.replace(re, w => w.toUpperCase());
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

  return null;
}

// ── Backend AI Dispatcher ──
async function callAI(draftText, instruction, isReview = false, signal) {
  // Check fast local edit first
  if (!isReview && instruction) {
    const localFast = tryLocalFastEdit(draftText, instruction);
    if (localFast) {
      return { revised: localFast, reason: 'Applied: ' + instruction };
    }
  }

  const endpoint = isReview ? backendUrl + '/api/review' : backendUrl + '/api/edit';
  const payload = isReview ? { draft: draftText } : { draft: draftText, instruction };

  setStatus('thinking', 'Thinking... (Click to stop)');

  let resp;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(
      'AI Backend unavailable (' + backendUrl + '). Run \'python backend/voicepilot_server.py\' with GEMINI_API_KEY. Document text was preserved untouched.'
    );
  }

  if (!resp.ok) {
    let errMsg = 'Backend returned error (' + resp.status + ')';
    try {
      const errJson = await resp.json();
      if (errJson.error) errMsg = errJson.error;
    } catch (e) {}
    throw new Error(errMsg);
  }

  const data = await resp.json();
  return {
    revised: data.result || '',
    reason: data.reason || (isReview ? 'Polished grammar, flow, and clarity.' : 'Applied: ' + instruction),
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
      let currentDraft = (draftEditor.innerText || '').trim();
      if (!currentDraft) {
        showToast('Draft is empty — nothing to polish.');
        return;
      }

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
      let baseDraft = state.pendingProposal ? state.pendingProposal.text : (draftEditor.innerText || '').trim();
      if (!baseDraft) {
        showToast('Draft is empty — dictate some text first.');
        return;
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
        writeToEditor(state.acceptedDraft, true);
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
      state = VPEditorState.undo(state);
      writeToEditor(state.acceptedDraft, true);
      renderState();
      moveCaretToEnd(draftEditor);
      showToast('↶ Undone');
      VPVoiceFeedback.speak('Undone');
      break;
    }

    case 'redo': {
      state = VPEditorState.redo(state);
      writeToEditor(state.acceptedDraft, true);
      renderState();
      moveCaretToEnd(draftEditor);
      showToast('↷ Redone');
      VPVoiceFeedback.speak('Redone');
      break;
    }

    case 'separate_note': {
      // Identify segment to move: selected text > lastSegment > last paragraph
      let noteText = '';
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
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
  const cmd = VPCommandParser.parse(insertedText, catchword);
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
