/**
 * VoicePilot – Segment Tracker
 * Watches editable surfaces (contenteditable or textarea) for text inserted
 * by Wispr Flow and emits newly inserted segments while ignoring programmatic
 * edits made by VoicePilot itself.
 *
 * Exported (browser global & CommonJS): VPSegmentTracker
 */

const VPSegmentTracker = (() => {

  /**
   * Compute the text that was inserted between oldValue and newValue.
   * Returns { insertedText: string, insertStart: number, insertEnd: number } or null.
   */
  function computeInsertion(oldVal, newVal, oldSelStart, oldSelEnd, newSelStart) {
    if (typeof oldVal !== 'string' || typeof newVal !== 'string') return null;

    const lenDelta = newVal.length - oldVal.length;
    if (lenDelta < 0) return null; // Net deletion

    if (lenDelta === 0) {
      const selectedOld = oldVal.slice(oldSelStart, oldSelEnd);
      const newContent  = newVal.slice(oldSelStart, oldSelEnd);
      if (selectedOld === newContent) return null;
      return { insertedText: newContent, insertStart: oldSelStart, insertEnd: oldSelEnd };
    }

    const insertStart = typeof oldSelStart === 'number' ? oldSelStart : 0;
    const replacedLen = typeof oldSelEnd === 'number' && typeof oldSelStart === 'number' ? oldSelEnd - oldSelStart : 0;
    const pre  = oldVal.slice(0, insertStart);
    const post = oldVal.slice(insertStart + replacedLen);

    if (!newVal.startsWith(pre) || !newVal.endsWith(post)) {
      return null;
    }

    const insertedText = newVal.slice(insertStart, insertStart + lenDelta + replacedLen);
    if (!insertedText) return null;

    return { insertedText, insertStart, insertEnd: insertStart + insertedText.length };
  }

  /**
   * Attach segment tracker to a contenteditable DOM element.
   * Emits onSegment(insertedText, fullText) after debounce settles.
   */
  function attachContentEditable(element, { debounceMs = 350, onSegment } = {}) {
    let _guard = false;
    let _snapshot = element ? (element.innerText || element.textContent || '') : '';
    let _timer = null;

    function getText() {
      return element ? (element.innerText || element.textContent || '') : '';
    }

    function onInput() {
      if (_guard) return;
      clearTimeout(_timer);
      _timer = setTimeout(() => {
        const current = getText();
        const prev = _snapshot;
        if (current === prev) return;

        let prefixLen = 0;
        while (prefixLen < prev.length && prefixLen < current.length && prev[prefixLen] === current[prefixLen]) {
          prefixLen++;
        }

        let prevSuffix = prev.length;
        let currSuffix = current.length;
        while (prevSuffix > prefixLen && currSuffix > prefixLen && prev[prevSuffix - 1] === current[currSuffix - 1]) {
          prevSuffix--;
          currSuffix--;
        }

        const inserted = current.slice(prefixLen, currSuffix);
        _snapshot = current;

        if (inserted && inserted.trim().length > 0 && typeof onSegment === 'function') {
          onSegment(inserted, current);
        }
      }, debounceMs);
    }

    if (element) {
      element.addEventListener('input', onInput);
    }

    function detach() {
      clearTimeout(_timer);
      if (element) {
        element.removeEventListener('input', onInput);
      }
    }

    function setGuard(val) {
      _guard = !!val;
    }

    function syncSnapshot() {
      _snapshot = getText();
    }

    return { detach, setGuard, syncSnapshot };
  }

  /**
   * Attach segment tracker to a textarea element.
   */
  function attachTextarea(textarea, { debounceMs = 500, onSegment } = {}) {
    let _guard = false;
    let _snapshot = null;
    let _pendingSegment = null;
    let _debounceTimer = null;

    function setGuard(val) { _guard = !!val; }

    function flushSegment() {
      if (!_pendingSegment) return;
      const seg = _pendingSegment;
      _pendingSegment = null;
      if (typeof onSegment === 'function') {
        onSegment(seg.insertedText, seg.textarea.value);
      }
    }

    function scheduleFlush() {
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(flushSegment, debounceMs);
    }

    function onBeforeInput() {
      if (_guard) return;
      _snapshot = {
        value: textarea.value,
        selStart: textarea.selectionStart,
        selEnd: textarea.selectionEnd,
      };
    }

    function onInput() {
      if (_guard) return;
      const newVal = textarea.value;
      if (!_snapshot) {
        _snapshot = { value: newVal, selStart: textarea.selectionStart, selEnd: textarea.selectionEnd };
        return;
      }
      const result = computeInsertion(_snapshot.value, newVal, _snapshot.selStart, _snapshot.selEnd, textarea.selectionStart);
      _snapshot = null;
      if (!result) return;

      if (_pendingSegment) {
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
    }

    textarea.addEventListener('beforeinput', onBeforeInput);
    textarea.addEventListener('input', onInput);

    function detach() {
      clearTimeout(_debounceTimer);
      textarea.removeEventListener('beforeinput', onBeforeInput);
      textarea.removeEventListener('input', onInput);
    }

    return { detach, setGuard };
  }

  return {
    computeInsertion,
    attach: attachTextarea,
    attachTextarea,
    attachContentEditable,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPSegmentTracker;
}
