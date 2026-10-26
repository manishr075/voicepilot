const VPCommandParser = (() => {
  const COMMAND_MAP = [
    { pattern: /^review/i,                               action: 'review',       hasArg: false },
    { pattern: /^edit(?:\s*:\s*|\s+)(.+)/is,             action: 'edit',         hasArg: true  },
    { pattern: /^(?:accept|apply)/i,                     action: 'accept',       hasArg: false },
    { pattern: /^(?:decline|discard)/i,                  action: 'decline',      hasArg: false },
    { pattern: /^undo/i,                                  action: 'undo',         hasArg: false },
    { pattern: /^redo/i,                                  action: 'redo',         hasArg: false },
    { pattern: /^read/i,                                  action: 'read',         hasArg: false },
    { pattern: /^make\s+that\s+a\s+separate\s+note/i,   action: 'separate_note',hasArg: false },
  ];

  function buildCatchwordRegex(catchword) {
    if (!catchword || !catchword.trim()) return null;
    const escaped = catchword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + escaped + '\\s*[,.:;\\-]?\\s*(.*)', 'is');
  }

  function parse(segment, catchword = 'Shazam') {
    if (!segment || !segment.trim()) return null;
    const catchRe = buildCatchwordRegex(catchword);
    if (!catchRe) return null;

    const m = catchRe.exec(segment.trim());
    if (!m) return null;

    const body = m[1].trim();
    if (!body) return { action: 'unknown', arg: '', commandText: segment };

    for (const { pattern, action, hasArg } of COMMAND_MAP) {
      const bm = pattern.exec(body);
      if (bm) {
        return {
          action,
          arg: hasArg ? (bm[1] || '').trim() : null,
          commandText: segment,
        };
      }
    }

    return { action: 'unknown', arg: body, commandText: segment };
  }

  return { parse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPCommandParser;
}
