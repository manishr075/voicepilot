/**
 * VoicePilot – Editor State Manager
 * Maintains:
 *   - accepted draft (the "real" document)
 *   - pending proposed revision (before apply/discard)
 *   - undo/redo history of accepted drafts
 *   - most recently identified insertion segment
 *   - flagged potentially-unrelated segment
 *   - pause/resume state
 *   - current operation status
 *
 * All mutations are explicit; no implicit side-effects.
 * Exported (browser global): VPEditorState
 */

const VPEditorState = (() => {
  const MAX_HISTORY = 100;

  function createState() {
    return {
      acceptedDraft:      '',
      pendingProposal:    null,   // { text: string, instruction: string } | null
      undoStack:          [],     // array of accepted draft strings (past states)
      redoStack:          [],     // array of accepted draft strings (future states)
      lastSegment:        null,   // { insertedText, insertStart, insertEnd } | null
      flaggedSegment:     null,   // { text, start, end } | null – interruption candidate
      paused:             false,
      status:             'ready',  // 'ready' | 'command_detected' | 'preparing' | 'review' | 'paused' | 'finished'
      notes:              [],     // separate note entries (strings)
    };
  }

  // ---- Pure state-transition helpers ----

  /** Push current draft onto undo stack, clear redo. */
  function pushUndo(state) {
    const next = { ...state };
    next.undoStack = [...state.undoStack, state.acceptedDraft].slice(-MAX_HISTORY);
    next.redoStack = [];
    return next;
  }

  /** Accept the given text as the new draft (creates undo entry). */
  function acceptDraft(state, newText) {
    const next = pushUndo(state);
    next.acceptedDraft = typeof newText === 'string' ? newText : state.acceptedDraft;
    next.pendingProposal = null;
    next.status = 'ready';
    return next;
  }

  /** Set a pending proposal without touching the accepted draft. */
  function setProposal(state, proposalText, instruction) {
    if (state.pendingProposal !== null && !proposalText) {
      // No change
      return state;
    }
    return {
      ...state,
      pendingProposal: { text: proposalText, instruction: instruction || '' },
      status: 'review',
    };
  }

  /** Apply the pending proposal → becomes new accepted draft. */
  function applyProposal(state) {
    if (!state.pendingProposal) return state; // nothing to apply
    const next = pushUndo(state);
    next.acceptedDraft = state.pendingProposal.text;
    next.pendingProposal = null;
    next.status = 'ready';
    return next;
  }

  /** Discard the pending proposal; accepted draft is unchanged. */
  function discardProposal(state) {
    return { ...state, pendingProposal: null, status: 'ready' };
  }

  /** Undo last accepted change. Returns new state or same state if nothing to undo. */
  function undo(state) {
    if (state.undoStack.length === 0) return state;
    const undoStack = [...state.undoStack];
    const prev = undoStack.pop();
    const redoStack = [state.acceptedDraft, ...state.redoStack];
    return {
      ...state,
      acceptedDraft: prev,
      undoStack,
      redoStack: redoStack.slice(0, MAX_HISTORY),
      pendingProposal: null,
      status: 'ready',
    };
  }

  /** Redo a previously undone change. */
  function redo(state) {
    if (state.redoStack.length === 0) return state;
    const redoStack = [...state.redoStack];
    const next = redoStack.shift();
    const undoStack = [...state.undoStack, state.acceptedDraft].slice(-MAX_HISTORY);
    return {
      ...state,
      acceptedDraft: next,
      undoStack,
      redoStack,
      pendingProposal: null,
      status: 'ready',
    };
  }

  /** Remove the most recent identified insertion from the accepted draft. */
  function removeLastInsertion(state) {
    if (!state.lastSegment) return state; // nothing to remove – do not guess
    const { insertStart, insertEnd } = state.lastSegment;
    const draft = state.acceptedDraft;
    if (insertStart < 0 || insertEnd > draft.length || insertStart >= insertEnd) {
      return state; // bounds invalid – safe no-op
    }
    const newDraft = draft.slice(0, insertStart) + draft.slice(insertEnd);
    const next = pushUndo(state);
    next.acceptedDraft = newDraft;
    next.lastSegment   = null;
    next.flaggedSegment = null;
    next.status = 'ready';
    return next;
  }

  /** Dismiss the flagged segment (keep it, clear the flag). */
  function keepFlaggedSegment(state) {
    return { ...state, flaggedSegment: null };
  }

  /** Move flagged segment to the notes area and remove from draft. */
  function moveFlaggedToNotes(state) {
    if (!state.flaggedSegment) return state;
    const { text, start, end } = state.flaggedSegment;
    const draft = state.acceptedDraft;
    if (start < 0 || end > draft.length) return state;
    const newDraft = draft.slice(0, start) + draft.slice(end);
    const next = pushUndo(state);
    next.acceptedDraft  = newDraft;
    next.flaggedSegment = null;
    next.notes          = [...state.notes, text];
    next.status         = 'ready';
    return next;
  }

  /** Pause command processing. */
  function pause(state) {
    return { ...state, paused: true, status: 'paused' };
  }

  /** Resume command processing. */
  function resume(state) {
    return { ...state, paused: false, status: 'ready' };
  }

  /** Mark session as finished (draft preserved). */
  function finish(state) {
    return { ...state, status: 'finished' };
  }

  return {
    createState,
    acceptDraft,
    setProposal,
    applyProposal,
    discardProposal,
    undo,
    redo,
    removeLastInsertion,
    keepFlaggedSegment,
    moveFlaggedToNotes,
    pause,
    resume,
    finish,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPEditorState;
}
