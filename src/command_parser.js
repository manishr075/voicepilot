/**
 * VoicePilot – Command Parser
 * Parses "Shazam" (or configured catchword) prefixed commands from an
 * inserted text segment.  All logic is purely deterministic; no network calls.
 *
 * Exported (browser global): VPCommandParser
 */

const VPCommandParser = (() => {
  // Recognised command keywords → internal action names
  const COMMAND_MAP = [
    // Must be tried in order; longest/most-specific patterns first.
    { pattern: /^edit\s*:\s*(.+)/is,           action: 'edit',               hasArg: true  },
    { pattern: /^remove\s+last\s+insertion/i,   action: 'remove_last',        hasArg: false },
    { pattern: /^make\s+that\s+a\s+separate\s+note/i, action: 'separate_note', hasArg: false },
    { pattern: /^keep\s+that/i,                 action: 'keep_that',          hasArg: false },
    { pattern: /^preview/i,                     action: 'preview',            hasArg: false },
    { pattern: /^apply/i,                       action: 'apply',              hasArg: false },
    { pattern: /^discard/i,                     action: 'discard',            hasArg: false },
    { pattern: /^undo/i,                        action: 'undo',               hasArg: false },
    { pattern: /^redo/i,                        action: 'redo',               hasArg: false },
    { pattern: /^read/i,                        action: 'read',               hasArg: false },
    { pattern: /^pause/i,                       action: 'pause',              hasArg: false },
    { pattern: /^resume/i,                      action: 'resume',             hasArg: false },
    { pattern: /^finish/i,                      action: 'finish',             hasArg: false },
  ];

  /**
   * Build a regex that matches the catchword at the START of a string,
   * tolerating case variations and punctuation separators (comma, colon, space).
   * Returns null if catchword is empty/invalid.
   */
  function buildCatchwordRegex(catchword) {
    if (!catchword || !catchword.trim()) return null;
    const escaped = catchword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // After the catchword: separator (comma, colon, or space followed by non-space)
    // Requires at least one of: comma, colon, OR space before a non-space char.
    // This prevents "shazam is" (bare word followed by space+word) from matching
    // when the catchword is itself a common word used in context.
    // For multi-word catchwords this is less of an issue.
    return new RegExp(
      '^' + escaped + '(?:[,:]\\s*|\\s+)(.+)',
      'is'
    );
  }

  /**
   * Parse a newly inserted segment for a command.
   *
   * @param {string} segment   – The newly inserted text (may include leading/trailing whitespace).
   * @param {string} catchword – Configured catchword (default "Shazam").
   * @returns {{ action: string, arg: string|null, commandText: string }|null}
   *   null = not a command; object = recognised command.
   */
  function parse(segment, catchword = 'Shazam') {
    if (!segment || !segment.trim()) return null;

    const catchRe = buildCatchwordRegex(catchword);
    if (!catchRe) return null;

    const m = catchRe.exec(segment.trim());
    if (!m) return null;

    const body = m[1].trim();

    for (const { pattern, action, hasArg } of COMMAND_MAP) {
      const bm = pattern.exec(body);
      if (bm) {
        return {
          action,
          arg: hasArg ? (bm[1] || '').trim() : null,
          commandText: segment,   // full text of the inserted segment
        };
      }
    }

    // Catchword present but unrecognised command body – still NOT ordinary text.
    // Return a special 'unknown' action so the UI can prompt.
    return {
      action: 'unknown',
      arg: body,
      commandText: segment,
    };
  }

  /**
   * Quick test: does the segment START with the catchword (roughly)?
   * Used to short-circuit scanning without building full parse objects.
   */
  function startsWithCatchword(segment, catchword = 'Shazam') {
    if (!segment || !catchword) return false;
    const re = new RegExp('^\\s*' + catchword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    return re.test(segment.trim());
  }

  return { parse, startsWithCatchword, buildCatchwordRegex };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPCommandParser;
}
