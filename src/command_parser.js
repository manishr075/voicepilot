/**
 * VoicePilot Command Parser
 * Parses Wispr Flow dictated segments for catchword triggers and commands.
 * 
 * Rules:
 * - Local commands (NEVER call AI): undo, redo, read, stop, copy, clear, review, accept, decline, separate note
 * - Tolerant to dictation punctuation (trailing periods, commas, spaces)
 * - ANY OTHER PHRASE following the catchword is treated as an AI instruction using Gemini 3.5 Flash-Lite.
 */
const VPCommandParser = (() => {
  const COMMAND_MAP = [
    // 1. Review (full polish)
    { pattern: /^(?:review|polish|ai\s+review|check|proofread)$/i,                                             action: 'review',        hasArg: false },
    // 2. Accept (Option 2 / Corrected)
    { pattern: /^(?:accept(?:\s+(?:this|that|it|proposal|changes?|edit))?|apply(?:\s+(?:this|that|it|proposal|changes?|edit))?|keep\s+(?:new|corrected|changes?)|choose\s+(?:corrected|new|option\s+(?:two|2))|option\s+(?:two|2)|yes|confirm|looks\s+good)$/i, action: 'accept', hasArg: false },
    // 3. Decline (Option 1 / Previous)
    { pattern: /^(?:decline(?:\s+(?:this|that|it|proposal|changes?|edit))?|discard(?:\s+(?:this|that|it|proposal|changes?|edit))?|reject(?:\s+(?:this|that|it|proposal|changes?|edit))?|keep\s+(?:previous|old|original)|choose\s+(?:previous|old|original|option\s+(?:one|1))|option\s+(?:one|1)|no|cancel)$/i, action: 'decline', hasArg: false },
    // 4. Undo
    { pattern: /^(?:undo|undo\s+that|revert|revert\s+that|go\s+back)$/i,                                       action: 'undo',          hasArg: false },
    // 5. Redo
    { pattern: /^(?:redo|redo\s+that)$/i,                                                                      action: 'redo',          hasArg: false },
    // 6. Read
    { pattern: /^(?:read|read\s+aloud|read\s+draft|read\s+text|speak)$/i,                                      action: 'read',          hasArg: false },
    // 7. Stop / Silence Playback
    { pattern: /^(?:stop|silence|be\s+quiet|shut\s+up|stop\s+reading|pause\s+reading)$/i,                       action: 'stop',          hasArg: false },
    // 8. Copy to Clipboard
    { pattern: /^(?:copy|copy\s+all|copy\s+draft|copy\s+to\s+clipboard|clipboard)$/i,                         action: 'copy',          hasArg: false },
    // 9. Clear Draft
    { pattern: /^(?:clear|clear\s+(?:draft|all|text|document)|delete\s+all)$/i,                             action: 'clear',         hasArg: false },
    // 10. Separate Note
    { pattern: /^(?:make\s+that\s+a\s+separate\s+note|separate\s+note|move\s+to\s+notes?)$/i,                 action: 'separate_note', hasArg: false },
    // 11. Explicit "edit" instruction
    { pattern: /^edit(?:\s*:\s*|\s+)(.+)/is,                                                                   action: 'ai_instruction',hasArg: true  },
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

    const rawBody = m[1].trim();
    if (!rawBody) {
      return { action: 'empty_prompt', arg: '', commandText: segment };
    }

    // Strip surrounding punctuation common in dictation (e.g. "undo.", "read.", "copy.", "accept,")
    const cleanBody = rawBody.replace(/^[.,;:!?"'—\s]+|[.,;:!?"'—\s]+$/g, '').trim();

    // Check clean body first for local commands
    for (const { pattern, action, hasArg } of COMMAND_MAP) {
      const match = pattern.exec(cleanBody) || pattern.exec(rawBody);
      if (match) {
        return {
          action,
          arg: hasArg ? (match[1] || '').trim() : null,
          commandText: segment,
        };
      }
    }

    // If not matching any local command, the phrase is an AI instruction!
    return {
      action: 'ai_instruction',
      arg: cleanBody || rawBody,
      commandText: segment,
    };
  }

  return { parse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPCommandParser;
}
