/**
 * VoicePilot – Segment Tracker
 * Watches a <textarea> for new text inserted by Wispr Flow and emits the
 * newly inserted segment while ignoring programmatic edits made by VoicePilot
 * itself.
 *
 * Design notes:
 *  - Listens to `beforeinput`, `input`, and `paste` events.
 *  - Stores a pre-edit snapshot (value + selectionStart/End) in beforeinput.
 *  - On input fires, computes the inserted diff against the snapshot.
 *  - Debounces rapid successive events (configurable idle window) so that
 *    multi-event Wispr insertions are treated as one segment.
 *  - Uses an internal _guard flag to ignore programmatic edits.
 *  - Deduplicates: will not re-emit a segment whose content was already
 *    processed in the same insertion sequence.
 *
 * Exported (browser global): VPSegmentTracker
 */

const VPSegmentTracker = (() => {

  /**
   * Compute the text that was inserted between oldValue and newValue
   * given the old selection range and the new caret position.
   *
   * Returns { insertedText: string, insertStart: number, insertEnd: number }
   * or null if the change was a pure deletion or is ambiguous.
   */
  function computeInsertion(oldVal, newVal, oldSelStart, oldSelEnd, newSelStart) {
    if (typeof oldVal !== 'string' || typeof newVal !== 'string') return null;

    // Length change
    const lenDelta = newVal.length - oldVal.length;

    if (lenDelta < 0) {
      // Net deletion – no new insertion to track.
      return null;
    }

    // lenDelta === 0 means a pure same-length replacement (selection replaced with
    // text of equal length). We still want to track this as an insertion.
    // Check whether the selected range was actually replaced with different content.
    if (lenDelta === 0) {
      // Verify it's a replacement, not just a no-op
      const selectedOld = oldVal.slice(oldSelStart, oldSelEnd);
      const newContent  = newVal.slice(oldSelStart, oldSelEnd);
      if (selectedOld === newContent) return null; // no actual change
      // It's a same-length replacement
      const insertedText = newContent;
      if (!insertedText) return null;
      return { insertedText, insertStart: oldSelStart, insertEnd: oldSelEnd };
    }

    // The inserted region in newVal runs from oldSelStart to oldSelStart + lenDelta
    // (for a simple insertion at caret) OR from oldSelStart to oldSelStart + lenDelta
    // (for a selection replacement that grew).
    const insertStart = oldSelStart;
    const replacedLen = oldSelEnd - oldSelStart;           // chars that were selected
    const insertEnd   = insertStart + replacedLen + lenDelta; // end of new region

    // Guard: check that the surrounding context matches
    const pre  = oldVal.slice(0, oldSelStart);
    const post = oldVal.slice(oldSelEnd);
    if (!newVal.startsWith(pre) || !newVal.endsWith(post)) {
      // Multi-point change – ambiguous; return null to be safe.
      return null;
    }

    const insertedText = newVal.slice(insertStart, insertStart + lenDelta + replacedLen);
    if (!insertedText) return null;

    return { insertedText, insertStart, insertEnd: insertStart + insertedText.length };
  }

  /**
   * Attach a segment tracker to a given <textarea> element.
   *
   * @param {HTMLTextAreaElement} textarea
   * @param {object} options
   *   debounceMs   {number}  – idle window before emitting a segment (default 600 ms)
   *   onSegment    {function} – callback({insertedText, insertStart, insertEnd, textarea})
   *   onStatus     {function} – callback(statusString) for status display
   * @returns {{ detach: function, setGuard: function }}
   */
  function attach(textarea, { debounceMs = 600, onSegment, onStatus } = {}) {
    let _guard = false;                // true while VoicePilot writes programmatically
    let _snapshot = null;              // { value, selStart, selEnd } captured in beforeinput
    let _pendingSegment = null;        // accumulated inserted text across rapid events
    let _debounceTimer = null;
    let _lastEmittedText = null;       // deduplication: last emitted segment text

    function setGuard(val) { _guard = !!val; }

    function emitStatus(msg) {
      if (typeof onStatus === 'function') onStatus(msg);
    }

    function flushSegment() {
      if (!_pendingSegment) return;
      const seg = _pendingSegment;
      _pendingSegment = null;

      // Deduplication: skip if this exact text was already emitted
      if (seg.insertedText === _lastEmittedText) return;
      _lastEmittedText = seg.insertedText;

      emitStatus('Segment detected — checking for command…');
      if (typeof onSegment === 'function') onSegment(seg);
    }

    function scheduleFlush() {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(flushSegment, debounceMs);
    }

    // --- Event handlers ---

    function onBeforeInput(evt) {
      if (_guard) return;
      // Snapshot current state before edit
      _snapshot = {
        value:    textarea.value,
        selStart: textarea.selectionStart,
        selEnd:   textarea.selectionEnd,
      };
    }

    function onPaste(evt) {
      if (_guard) return;
      // Paste gives us the full pasted text directly – more reliable than diffing
      const pasted = evt.clipboardData && evt.clipboardData.getData('text/plain');
      if (!pasted) return;

      // We'll still let `input` fire, but store the pasted text for cross-reference
      // so we can use it if the diff is ambiguous.
      textarea._vpPastedText = pasted;
    }

    function onInput() {
      if (_guard) return;

      const newVal = textarea.value;

      // Check if we have a reliable pasted text to use
      const pastedText = textarea._vpPastedText;
      if (pastedText) {
        textarea._vpPastedText = null;
        // The pasted text IS the insertion; verify it appears in the new value
        if (newVal.includes(pastedText) || newVal.endsWith(pastedText)) {
          const seg = {
            insertedText: pastedText,
            insertStart: newVal.indexOf(pastedText),
            insertEnd: newVal.indexOf(pastedText) + pastedText.length,
            textarea,
          };
          _pendingSegment = seg;
          scheduleFlush();
          emitStatus('Input received — waiting for Wispr burst to settle…');
          return;
        }
      }

      if (!_snapshot) {
        // No beforeinput snapshot – store current as snapshot and wait
        _snapshot = { value: newVal, selStart: textarea.selectionStart, selEnd: textarea.selectionEnd };
        return;
      }

      const result = computeInsertion(
        _snapshot.value,
        newVal,
        _snapshot.selStart,
        _snapshot.selEnd,
        textarea.selectionStart,
      );

      _snapshot = null;

      if (!result) return; // pure deletion or ambiguous

      // Accumulate into pending segment (same position range preferred)
      if (_pendingSegment) {
        // Extend if the new insertion is contiguous
        _pendingSegment = {
          insertedText: _pendingSegment.insertedText + result.insertedText,
          insertStart:  _pendingSegment.insertStart,
          insertEnd:    result.insertEnd,
          textarea,
        };
      } else {
        _pendingSegment = { ...result, textarea };
      }

      scheduleFlush();
      emitStatus('Input received — waiting for Wispr burst to settle…');
    }

    textarea.addEventListener('beforeinput', onBeforeInput);
    textarea.addEventListener('paste',       onPaste);
    textarea.addEventListener('input',       onInput);

    function detach() {
      clearTimeout(_debounceTimer);
      textarea.removeEventListener('beforeinput', onBeforeInput);
      textarea.removeEventListener('paste',       onPaste);
      textarea.removeEventListener('input',       onInput);
    }

    return { detach, setGuard };
  }

  return { attach, computeInsertion };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPSegmentTracker;
}
