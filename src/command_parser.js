/**
 * VoicePilot Command Parser
 * Parses Wispr Flow dictated segments for catchword triggers and commands.
 * 
 * Rules:
 * - Fixed commands: review, accept, decline, undo, redo, read, make that a separate note
 * - Natural selection alternatives: keep new, option two, yes (accept) / keep previous, option one, no, reject (decline)
 * - ANY OTHER PHRASE following the catchword is automatically treated as an AI instruction!
 */
const VPCommandParser = (() => {
  const COMMAND_MAP = [
    { pattern: /^review$/i,                                                                             action: 'review',        hasArg: false },
    { pattern: /^(?:accept|apply|keep\s+(?:new|corrected)|option\s+(?:two|2)|yes)$/i,                  action: 'accept',        hasArg: false },
    { pattern: /^(?:decline|discard|reject|keep\s+(?:previous|old|original)|option\s+(?:one|1)|no)$/i,  action: 'decline',       hasArg: false },
    { pattern: /^undo$/i,                                                                               action: 'undo',          hasArg: false },
    { pattern: /^redo$/i,                                                                               action: 'redo',          hasArg: false },
    { pattern: /^read$/i,                                                                               action: 'read',          hasArg: false },
    { pattern: /^make\s+that\s+a\s+separate\s+note$/i,                                                  action: 'separate_note', hasArg: false },
    { pattern: /^edit(?:\s*:\s*|\s+)(.+)/is,                                                            action: 'ai_instruction',hasArg: true  },
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
    if (!body) {
      return { action: 'empty_prompt', arg: '', commandText: segment };
    }

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

    // Any unrecognized phrase following the catchword is automatically an AI instruction!
    return {
      action: 'ai_instruction',
      arg: body,
      commandText: segment,
    };
  }

  return { parse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPCommandParser;
}
