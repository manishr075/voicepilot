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
   * Normalize text before diffing:
   * Normalizes non-breaking spaces so they never appear as literal &nbsp; artifacts.
   */
  function normalizeTextForDiff(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ');
  }

  /**
   * Render in-place diff with safe HTML escaping and soft highlights.
   * Word-level Longest Common Subsequence (LCS) for pinpoint accuracy.
   * No strikethrough styling; additions in soft green, deletions in soft red.
   */
  function renderInPlaceDiff(oldText, newText) {
    const oldStr = normalizeTextForDiff(oldText);
    const newStr = normalizeTextForDiff(newText);

    if (!oldStr && !newStr) return '';
    if (!oldStr) return '<span class="diff-added-highlight">' + escapeHtml(newStr) + '</span>';
    if (!newStr) return '<span class="diff-removed-highlight">' + escapeHtml(oldStr) + '</span>';
    if (oldStr === newStr) return escapeHtml(oldStr);

    // Tokenize into words, whitespace, and punctuation tokens
    const tokenize = s => s.match(/([A-Za-z0-9_'-]+|\s+|[^\s\w])/g) || [];
    const a = tokenize(oldStr);
    const b = tokenize(newStr);
    const m = a.length;
    const n = b.length;

    // For extremely long texts, fall back to fast prefix-suffix diff
    if (m * n > 400000) {
      let prefixLen = 0;
      while (prefixLen < m && prefixLen < n && a[prefixLen] === b[prefixLen]) prefixLen++;
      let suffixLen = 0;
      while (suffixLen < (m - prefixLen) && suffixLen < (n - prefixLen) && a[m - 1 - suffixLen] === b[n - 1 - suffixLen]) suffixLen++;
      const rem = a.slice(prefixLen, m - suffixLen).join('');
      const add = b.slice(prefixLen, n - suffixLen).join('');
      let out = '';
      for (let i = 0; i < prefixLen; i++) out += escapeHtml(a[i]);
      if (rem) out += '<span class="diff-removed-highlight">' + escapeHtml(rem) + '</span>';
      if (add) out += '<span class="diff-added-highlight">' + escapeHtml(add) + '</span>';
      for (let i = m - suffixLen; i < m; i++) out += escapeHtml(a[i]);
      return out;
    }

    // Dynamic Programming LCS Table
    const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (a[i] === b[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack to extract edit operations: 0 = match, -1 = remove, +1 = add
    let i = m, j = n;
    const ops = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.push({ type: 0, text: a[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 1, text: b[j - 1] });
        j--;
      } else {
        ops.push({ type: -1, text: a[i - 1] });
        i--;
      }
    }
    ops.reverse();

    // Group adjacent operations
    let out = '';
    let curType = null;
    let curBuf = '';

    function flush() {
      if (!curBuf) return;
      if (curType === 0) {
        out += escapeHtml(curBuf);
      } else if (curType === -1) {
        out += '<span class="diff-removed-highlight">' + escapeHtml(curBuf) + '</span>';
      } else if (curType === 1) {
        out += '<span class="diff-added-highlight">' + escapeHtml(curBuf) + '</span>';
      }
      curBuf = '';
    }

    for (const op of ops) {
      if (op.type !== curType) {
        flush();
        curType = op.type;
      }
      curBuf += op.text;
    }
    flush();

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
