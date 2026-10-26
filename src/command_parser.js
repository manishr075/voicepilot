/**
 * VoicePilot Command Parser
 * Parses Wispr Flow dictated segments for catchword triggers and commands.
 * 
 * Rules:
 * - Local commands (NEVER call AI): undo, redo, read, stop, copy, clear, review, accept, decline, format (bold, italic, heading, list), separate note, remove last
 * - Tolerant to dictation punctuation (trailing periods, commas, colons, spaces)
 * - Supports catchword at start OR following dictated speech (e.g. "We need this. Shazam, bold")
 * - Disambiguates imperative commands from ordinary speech containing the catchword
 *   (e.g. "Shazam is a music application." is NOT a command).
 */
const VPCommandParser = (() => {
  const LOCAL_COMMANDS = [
    // 1. Review (full polish proposal)
    { pattern: /^(?:review|polish|ai\s+review|check|proofread)$/i,                                             action: 'review',        hasArg: false },
    // 2. Accept / Apply / Keep (Option 2)
    { pattern: /^(?:accept(?:\s+(?:this|that|it|proposal|changes?|edit))?|apply(?:\s+(?:this|that|it|proposal|changes?|edit))?|keep(?:\s+(?:this|that|it|new|corrected|changes?))?|choose\s+(?:corrected|new|option\s+(?:two|2))|option\s+(?:two|2)|yes|confirm|looks\s+good)$/i, action: 'accept', hasArg: false },
    // 3. Decline / Discard / Reject (Option 1)
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
    { pattern: /^(?:clear|clear\s+(?:draft|all|text|document)|delete\s+all)$/i,                               action: 'clear',         hasArg: false },
    // 10. Separate Note
    { pattern: /^(?:make\s+that\s+a\s+separate\s+note|separate\s+note|move\s+to\s+notes?|save\s+to\s+notes?)$/i, action: 'separate_note', hasArg: false },
    // 11. Remove last insertion
    { pattern: /^(?:remove\s+last(?:\s+insertion)?|remove\s+that|delete\s+last(?:\s+insertion)?|scratch\s+that)$/i, action: 'remove_last', hasArg: false },
    // 12. Keep that segment
    { pattern: /^(?:keep\s+that|keep\s+segment)$/i,                                                            action: 'keep_that',     hasArg: false },
    // 13. Rich Text Formatting Commands (Local, instant)
    { pattern: /^(?:bold|make\s+(?:this|that)\s+bold|bold\s+(?:this|that))$/i,                                action: 'format_bold',   hasArg: false },
    { pattern: /^(?:italic|italicize(?:\s+(?:this|that))?|make\s+(?:this|that)\s+italic)$/i,                  action: 'format_italic', hasArg: false },
    { pattern: /^(?:heading|make\s+(?:this|that)\s+a?\s*heading|h1|h2)$/i,                                     action: 'format_heading',hasArg: false },
    { pattern: /^(?:bullet\s+point|bullet\s+list|make\s+(?:this|that)\s+a?\s*list|list)$/i,                    action: 'format_list',   hasArg: false },
    // 14. Pause and Resume
    { pattern: /^(?:pause|pause\s+listening)$/i,                                                               action: 'pause',         hasArg: false },
    { pattern: /^(?:resume|resume\s+listening)$/i,                                                              action: 'resume',        hasArg: false },
  ];

  // Explicit edit keywords (e.g. "Shazam, edit: make it concise")
  const EXPLICIT_EDIT_RE = /^(?:edit|revise|change|rewrite|polish)(?:\s*:\s*|\s+)(.+)/is;

  // Natural imperative edit directives (e.g. "put a comma next to hello", "make it more formal")
  const IMPERATIVE_ACTION_RE = /^(?:put\b|add\b|remove\b|delete\b|replace\b|insert\b|capitalize\b|format\b|make\s+it\b|make\s+this\b|fix\b|correct\b|shorten\b|expand\b|translate\b)(.+)/is;

  // Declarative words that indicate ordinary speech rather than an instruction
  const DECLARATIVE_LEAD_RE = /^(?:is\b|was\b|are\b|were\b|has\b|had\b|have\b|appears?\b|can\b|could\b|will\b|would\b|shall\b|should\b|says?\b|said\b|told\b|sounds?\b|means?\b|stands?\s+for\b|yesterday\b|today\b|tomorrow\b|tracks?\b|songs?\b|app\b|application\b)/i;

  function buildCatchwordRegex(catchword) {
    if (!catchword || !catchword.trim()) return null;
    const escaped = catchword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match catchword preceded by start-of-line OR boundary/punctuation
    // Followed by optional punctuation and space
    return new RegExp('(?:^|[\\s.,;:!?"\'—])(' + escaped + '(?:\\b|\\s*[,.:;\\-—])\\s*([\\s\\S]*))$', 'i');
  }

  function parse(segment, catchword = 'Shazam') {
    if (!segment || typeof segment !== 'string' || !segment.trim()) return null;
    const catchRe = buildCatchwordRegex(catchword);
    if (!catchRe) return null;

    const m = catchRe.exec(segment.trim());
    if (!m) return null;

    const fullCommand = m[1];
    const rawBody = (m[2] || '').trim();

    // Standalone catchword (e.g. "Shazam" without command body)
    if (!rawBody) {
      return { action: 'empty_prompt', arg: '', commandText: fullCommand };
    }

    // Strip surrounding punctuation common in dictation (e.g. "undo.", "read.", "copy.", "accept,")
    const cleanBody = rawBody.replace(/^[.,;:!?"'—\s]+|[.,;:!?"'—\s]+$/g, '').trim();
    if (!cleanBody) {
      return { action: 'empty_prompt', arg: '', commandText: fullCommand };
    }

    // 1. Check local deterministic commands
    for (const { pattern, action, hasArg } of LOCAL_COMMANDS) {
      const match = pattern.exec(cleanBody) || pattern.exec(rawBody);
      if (match) {
        return {
          action,
          arg: hasArg ? (match[1] || '').trim() : null,
          commandText: fullCommand,
        };
      }
    }

    // 2. Check explicit edit directives (e.g. "edit: make it concise")
    const explicitMatch = EXPLICIT_EDIT_RE.exec(cleanBody);
    if (explicitMatch) {
      return {
        action: 'ai_instruction',
        arg: (explicitMatch[1] || '').trim(),
        commandText: fullCommand,
      };
    }

    // 3. Check for ordinary speech false positives:
    // If the body starts with declarative verbs ("is a music app", "appears in this article"), it is ordinary speech!
    if (DECLARATIVE_LEAD_RE.test(cleanBody)) {
      return null; // Ordinary speech: keep as text!
    }

    // 4. Check for natural imperative edit directives (e.g. "put a comma next to hello")
    if (IMPERATIVE_ACTION_RE.test(cleanBody)) {
      return {
        action: 'ai_instruction',
        arg: cleanBody,
        commandText: fullCommand,
      };
    }

    // If the catchword is followed by words but not matching any command pattern or imperative directive,
    // treat as ordinary speech to prevent accidental triggering (e.g. "I heard Shazam yesterday")
    return null;
  }

  return { parse };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPCommandParser;
}
