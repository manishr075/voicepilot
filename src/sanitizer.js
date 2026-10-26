/**
 * VoicePilot – Security & Sanitization Module
 * Provides strict HTML sanitization and HTML-escaping to prevent XSS.
 *
 * Exported (browser global & CommonJS): VPSanitizer
 */

const VPSanitizer = (() => {
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'a', 'span', 'div', 'hr'
  ]);

  const ALLOWED_ATTRS = {
    'a':    new Set(['href', 'title', 'target', 'rel']),
    'span': new Set(['class']),
    'div':  new Set(['class']),
    'p':    new Set(['class']),
  };

  const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|#)/i;

  /**
   * Escape HTML entities in text for safe interpolation inside markup.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Clean a DOM tree recursively according to strict allowlists.
   */
  function cleanDomNode(node) {
    if (!node) return;
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === 1) { // Element node
        const tag = child.tagName.toLowerCase();

        // Strip active/dangerous elements completely
        if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math'].includes(tag)) {
          node.removeChild(child);
          continue;
        }

        // Strip non-allowlisted tags while preserving safe child text
        if (!ALLOWED_TAGS.has(tag)) {
          cleanDomNode(child);
          while (child.firstChild) {
            node.insertBefore(child.firstChild, child);
          }
          node.removeChild(child);
          continue;
        }

        // Sanitize attributes
        const allowedAttrs = ALLOWED_ATTRS[tag] || new Set();
        const attrs = Array.from(child.attributes);
        for (const attr of attrs) {
          const attrName = attr.name.toLowerCase();
          // Remove all inline event handlers (onclick, onerror, onload, etc.)
          if (attrName.startsWith('on') || !allowedAttrs.has(attrName)) {
            child.removeAttribute(attr.name);
          } else if (attrName === 'href') {
            const val = attr.value.trim();
            if (!SAFE_URL_RE.test(val)) {
              child.removeAttribute('href');
            }
          }
        }

        cleanDomNode(child);
      }
    }
  }

  /**
   * Sanitize an HTML string. Works in browser via DOMParser or regex fallback in headless tests.
   */
  function sanitize(dirtyHtml) {
    if (!dirtyHtml || typeof dirtyHtml !== 'string') return '';

    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dirtyHtml, 'text/html');
        cleanDomNode(doc.body);
        return doc.body.innerHTML;
      } catch (e) {
        // Fallback to regex cleaning below
      }
    }

    // Server-side / fallback regex cleaner
    return dirtyHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/\s*on\w+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '')
      .replace(/javascript:[^"'>\s]+/gi, '#');
  }

  /**
   * Render in-place diff with safe HTML escaping and soft highlights.
   * No strikethrough styling; additions in soft green, deletions in soft red.
   */
  function renderInPlaceDiff(oldText, newText) {
    const oldStr = typeof oldText === 'string' ? oldText : '';
    const newStr = typeof newText === 'string' ? newText : '';

    if (!oldStr && !newStr) return '';
    if (!oldStr) return '<span class="diff-added-highlight">' + escapeHtml(newStr) + '</span>';
    if (!newStr) return '<span class="diff-removed-highlight">' + escapeHtml(oldStr) + '</span>';

    const oldWords = oldStr.split(/(\s+)/);
    const newWords = newStr.split(/(\s+)/);

    let prefixLen = 0;
    while (prefixLen < oldWords.length && prefixLen < newWords.length && oldWords[prefixLen] === newWords[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < (oldWords.length - prefixLen) &&
      suffixLen < (newWords.length - prefixLen) &&
      oldWords[oldWords.length - 1 - suffixLen] === newWords[newWords.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    const removed = oldWords.slice(prefixLen, oldWords.length - suffixLen).join('');
    const added   = newWords.slice(prefixLen, newWords.length - suffixLen).join('');

    let out = '';
    for (let i = 0; i < prefixLen; i++) {
      out += escapeHtml(oldWords[i]);
    }
    if (removed) {
      out += '<span class="diff-removed-highlight">' + escapeHtml(removed) + '</span>';
    }
    if (added) {
      out += '<span class="diff-added-highlight">' + escapeHtml(added) + '</span>';
    }
    for (let i = oldWords.length - suffixLen; i < oldWords.length; i++) {
      out += escapeHtml(oldWords[i]);
    }

    return out;
  }

  return {
    escapeHtml,
    sanitize,
    renderInPlaceDiff,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VPSanitizer;
}
