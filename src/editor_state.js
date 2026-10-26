/**
 * VoicePilot – Editor State Manager
 * Maintains:
 *   - acceptedDraft:      The verified, accepted document content
 *   - pendingProposal:    The proposed revision awaiting user review { text, reason, isReview }
 *   - undoStack / redoStack: Full undo/redo history of accepted drafts
 *   - notes:              Array of separate captured notes
 *   - lastSegment:        The most recently inserted speech segment { text, start, end }
 *   - status:             'ready' | 'thinking' | 'review' | 'paused' | 'finished'
 *
 * All state mutations are pure functions returning a new immutable state object.
 * Exported for browser global and CommonJS.
 */

const VPEditorState = (() => {
  const MAX_HISTORY = 100;

  function createState(initialText = '') {
    return {
      acceptedDraft:   typeof initialText === 'string' ? initialText : '',
      pendingProposal: null,   // null | { text: string, reason: string, isReview: boolean }
      undoStack:       [],     // string[]
      redoStack:       [],     // string[]
      notes:           [],     // string[]
      lastSegment:     null,   // null | { text: string, timestamp: number }
      status:          'ready',
    };
  }

  /** Push current draft to undo stack; resets redo stack. */
  function pushUndo(state) {
    const nextUndo = [...state.undoStack, state.acceptedDraft].slice(-MAX_HISTORY);
    return {
      ...state,
      undoStack: nextUndo,
      redoStack: [],
    };
  }

  /** Commit a new accepted draft (records undo history, clears proposal). */
  function acceptDraft(state, newText) {
    if (typeof newText !== 'string') return state;
    if (newText === state.acceptedDraft && !state.pendingProposal) return state;

    const withUndo = pushUndo(state);
    return {
      ...withUndo,
      acceptedDraft:   newText,
      pendingProposal: null,
      status:          'ready',
    };
  }

  /**
   * Propose a revision for user review.
   * If a proposal is already pending, refines it against the accepted draft.
   */
  function proposeEdit(state, proposalText, reason = '', isReview = false) {
    if (typeof proposalText !== 'string') return state;
    return {
      ...state,
      pendingProposal: {
        text: proposalText,
        reason: reason || (isReview ? 'AI grammar and clarity polish' : 'AI voice edit proposal'),
        isReview: !!isReview,
      },
      status: 'review',
    };
  }

  /** Accept and apply the pending proposal into the accepted draft. */
  function applyProposal(state) {
    if (!state.pendingProposal) return state;
    const withUndo = pushUndo(state);
    return {
      ...withUndo,
      acceptedDraft:   state.pendingProposal.text,
      pendingProposal: null,
      status:          'ready',
    };
  }

  /** Discard pending proposal; accepted draft remains completely untouched. */
  function discardProposal(state) {
    if (!state.pendingProposal) return state;
    return {
      ...state,
      pendingProposal: null,
      status:          'ready',
    };
  }

  /** Undo last accepted change. */
  function undo(state) {
    if (state.undoStack.length === 0) return state;
    const nextUndo = [...state.undoStack];
    const prevDraft = nextUndo.pop();
    const nextRedo = [state.acceptedDraft, ...state.redoStack].slice(0, MAX_HISTORY);

    return {
      ...state,
      acceptedDraft:   prevDraft,
      undoStack:       nextUndo,
      redoStack:       nextRedo,
      pendingProposal: null,
      status:          'ready',
    };
  }

  /** Redo previously undone change. */
  function redo(state) {
    if (state.redoStack.length === 0) return state;
    const nextRedo = [...state.redoStack];
    const nextDraft = nextRedo.shift();
    const nextUndo = [...state.undoStack, state.acceptedDraft].slice(-MAX_HISTORY);

    return {
      ...state,
      acceptedDraft:   nextDraft,
      undoStack:       nextUndo,
      redoStack:       nextRedo,
      pendingProposal: null,
      status:          'ready',
    };
  }

  /** Record a segment of newly inserted speech. */
  function recordSegment(state, text) {
    if (!text || typeof text !== 'string') return state;
    return {
      ...state,
      lastSegment: { text: text.trim(), timestamp: Date.now() },
    };
  }

  /** Add an entry directly to the separate notes collection. */
  function addNote(state, noteText) {
    const trimmed = typeof noteText === 'string' ? noteText.trim() : '';
    if (!trimmed) return state;
    return {
      ...state,
      notes: [...state.notes, trimmed],
    };
  }

  /** Move a segment from the draft to separate notes. */
  function moveSegmentToNotes(state, segmentText, newDraftText) {
    const note = typeof segmentText === 'string' ? segmentText.trim() : '';
    if (!note) return state;

    const nextNotes = [...state.notes, note];
    if (typeof newDraftText === 'string' && newDraftText !== state.acceptedDraft) {
      const withUndo = pushUndo(state);
      return {
        ...withUndo,
        acceptedDraft: newDraftText,
        notes:         nextNotes,
        lastSegment:   null,
        status:        'ready',
      };
    }

    return {
      ...state,
      notes:       nextNotes,
      lastSegment: null,
      status:      'ready',
    };
  }

  /** Remove a specific note by index. */
  function removeNote(state, index) {
    if (index < 0 || index >= state.notes.length) return state;
    const nextNotes = state.notes.filter((_, i) => i !== index);
    return {
      ...state,
      notes: nextNotes,
    };
  }

  /** Clear all notes. */
  function clearNotes(state) {
    if (state.notes.length === 0) return state;
    return {
      ...state,
      notes: [],
    };
  }

  return {
    createState,
    acceptDraft,
    proposeEdit,
    applyProposal,
    discardProposal,
    undo,
    redo,
    recordSegment,
    addNote,
    moveSegmentToNotes,
    removeNote,
    clearNotes,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPEditorState;
}
