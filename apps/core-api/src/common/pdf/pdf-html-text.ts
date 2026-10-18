const BLOCK_TAGS = ['style', 'script'] as const;

function indexOfIgnoreCase(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** Removes one element type and its contents without regex-based HTML filtering. */
function removeBlockElements(html: string, tagName: string): string {
  const openNeedle = `<${tagName}`;
  const closeNeedle = `</${tagName}`;
  let result = html;
  let searchFrom = 0;

  for (;;) {
    const start = indexOfIgnoreCase(result, openNeedle, searchFrom);
    if (start === -1) {
      return result;
    }
    const closeStart = indexOfIgnoreCase(result, closeNeedle, start);
    if (closeStart === -1) {
      return result.slice(0, start);
    }
    const closeEnd = result.indexOf('>', closeStart);
    const removeEnd =
      closeEnd === -1 ? closeStart + closeNeedle.length : closeEnd + 1;
    result = result.slice(0, start) + result.slice(removeEnd);
    searchFrom = start;
  }
}

function stripHtmlTags(html: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) {
      result += html.slice(cursor);
      break;
    }
    result += html.slice(cursor, tagStart);
    const tagEnd = html.indexOf('>', tagStart + 1);
    if (tagEnd === -1) {
      break;
    }
    result += ' ';
    cursor = tagEnd + 1;
  }

  return result;
}

/** Strips tags and collapses whitespace for golden text comparisons. */
export function extractVisibleTextFromHtml(html: string): string {
  let text = html;
  for (const tag of BLOCK_TAGS) {
    text = removeBlockElements(text, tag);
  }
  text = stripHtmlTags(text);
  text = text.replaceAll('&nbsp;', ' ');
  return text.replace(/\s+/g, ' ').trim();
}
