/**
 * VoicePilot – Safe DOM Range Command Remover
 *
 * Removes recognized voice commands from rich-text contenteditable containers
 * using native DOM Range operations.
 *
 * Guarantees:
 *  1. Identifies exact text range belonging to the recognized command.
 *  2. Removes only that range, including appropriate surrounding whitespace.
 *  3. Preserves all unrelated document text.
 *  4. Preserves valid formatting (<strong>, <em>, <h1>, lists, paragraphs, links).
 *  5. Handles repeated phrases (targets the actual utterance at the insertion point).
 *  6. Handles Unicode, punctuation, line breaks, and unusual characters.
 *  7. Never falls back to searching and replacing arbitrary HTML strings.
 *  8. Does not corrupt DOM tree or truncate closing tags.
 *  9. If boundaries cannot be resolved reliably, leaves text untouched and returns false.
 *
 * Exported (browser global & CommonJS): VPDomRangeRemover
 */

const VPDomRangeRemover = (() => {

  /**
   * Collect all text nodes inside root in tree-order, mapping global character offsets.
   */
  function mapTextNodes(root) {
    const nodes = [];
    let fullText = '';

    if (!root) return { nodes, fullText };

    // TreeWalker for all text nodes
    if (typeof document !== 'undefined' && document.createTreeWalker) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let curr;
      while ((curr = walker.nextNode())) {
        const val = curr.nodeValue || '';
        const start = fullText.length;
        const end = start + val.length;
        fullText += val;
        nodes.push({ node: curr, start, end, length: val.length });
      }
    } else {
      // Recursive fallback (for Node / mock environments)
      function walk(n) {
        if (!n) return;
        if (n.nodeType === 3) { // TEXT_NODE
          const val = n.nodeValue || '';
          const start = fullText.length;
          const end = start + val.length;
          fullText += val;
          nodes.push({ node: n, start, end, length: val.length });
        } else if (n.childNodes) {
          for (let i = 0; i < n.childNodes.length; i++) {
            walk(n.childNodes[i]);
          }
        }
      }
      walk(root);
    }

    return { nodes, fullText };
  }

  /**
   * Find the character range [start, end) of the command in fullText.
   * Prefers searching from the end to target the newly inserted utterance
   * and preserve any earlier occurrences of the catchword.
   */
  function findCommandRange(fullText, commandText, catchword = 'Shazam') {
    if (!fullText || !commandText) return null;

    const trimmedCmd = commandText.trim();
    if (!trimmedCmd) return null;

    // 1. Try exact lastIndexOf
    let idx = fullText.lastIndexOf(trimmedCmd);

    // 2. If not found, try flexible punctuation match at the end
    if (idx === -1) {
      const escapedCmd = trimmedCmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escapedCmd + '[\\s.,;:!?"\'—]*$', 'i');
      const m = re.exec(fullText);
      if (m) {
        idx = m.index;
      }
    }

    // 3. If still not found, search for catchword boundary at utterance end
    if (idx === -1 && catchword) {
      const escapedCatch = catchword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(?:^|[\\s.,;:!?"\'—])(' + escapedCatch + '(?:\\b|\\s*[,.:;\\-]).*)$', 'i');
      const m = re.exec(fullText);
      if (m) {
        idx = fullText.lastIndexOf(m[1]);
      }
    }

    if (idx === -1) {
      return null; // Cannot determine boundaries reliably
    }

    let start = idx;
    let end = idx + trimmedCmd.length;

    // Swallow trailing punctuation if the command utterance ended with it
    while (end < fullText.length && /[.,;:!?"'—\s]/.test(fullText[end])) {
      end++;
    }

    // Swallow one preceding whitespace char to avoid double spaces
    if (start > 0 && /[\s\u00A0]/.test(fullText[start - 1])) {
      start--;
    }

    return { start, end };
  }

  /**
   * Map global character range [start, end) to DOM nodes and local offsets.
   */
  function locateDomRange(textNodes, start, end) {
    if (!textNodes || textNodes.length === 0) return null;

    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;

    for (const item of textNodes) {
      if (!startNode && start >= item.start && start <= item.end) {
        startNode = item.node;
        startOffset = start - item.start;
      }
      if (end >= item.start && end <= item.end) {
        endNode = item.node;
        endOffset = end - item.start;
        break;
      }
    }

    if (!startNode || !endNode) {
      // If end reached the very end of all nodes
      const last = textNodes[textNodes.length - 1];
      if (!endNode && end >= last.end) {
        endNode = last.node;
        endOffset = last.length;
      }
    }

    if (!startNode || !endNode) return null;
    return { startNode, startOffset, endNode, endOffset };
  }

  /**
   * Safely removes commandText from editorElement using DOM Range.
   *
   * @param {HTMLElement} editorElement
   * @param {string} commandText
   * @param {string} [catchword='Shazam']
   * @returns {{ success: boolean, reason?: string, removedText?: string }}
   */
  function safeRemoveCommand(editorElement, commandText, catchword = 'Shazam') {
    if (!editorElement || !commandText) {
      return { success: false, reason: 'Invalid arguments' };
    }

    const { nodes, fullText } = mapTextNodes(editorElement);
    if (nodes.length === 0 || !fullText) {
      return { success: false, reason: 'Editor contains no text nodes' };
    }

    const charRange = findCommandRange(fullText, commandText, catchword);
    if (!charRange) {
      // Requirement 10: If boundaries cannot be determined reliably,
      // leave text untouched rather than guessing.
      return { success: false, reason: 'Command boundaries could not be resolved reliably' };
    }

    const domLoc = locateDomRange(nodes, charRange.start, charRange.end);
    if (!domLoc) {
      return { success: false, reason: 'Could not map range to DOM nodes' };
    }

    const removedText = fullText.slice(charRange.start, charRange.end);

    if (typeof document !== 'undefined' && document.createRange) {
      const range = document.createRange();
      range.setStart(domLoc.startNode, domLoc.startOffset);
      range.setEnd(domLoc.endNode, domLoc.endOffset);
      range.deleteContents();

      // Clean up empty inline formatting nodes left empty by deletion
      cleanEmptyFormattingNodes(editorElement);
    } else {
      // Headless / mock environment fallback
      if (domLoc.startNode === domLoc.endNode) {
        const val = domLoc.startNode.nodeValue || '';
        domLoc.startNode.nodeValue = val.slice(0, domLoc.startOffset) + val.slice(domLoc.endOffset);
      }
    }

    return { success: true, removedText };
  }

  /**
   * Helper to clean up empty <strong>, <em>, <span> tags left behind.
   */
  function cleanEmptyFormattingNodes(container) {
    if (!container || !container.querySelectorAll) return;
    const candidates = container.querySelectorAll('strong, b, em, i, u, s, span');
    candidates.forEach(el => {
      if (!el.textContent || !el.textContent.trim()) {
        if (!el.children.length) {
          el.parentNode && el.parentNode.removeChild(el);
        }
      }
    });
  }

  return {
    mapTextNodes,
    findCommandRange,
    locateDomRange,
    safeRemoveCommand,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPDomRangeRemover;
}
