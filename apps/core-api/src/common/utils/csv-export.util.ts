export function csvEscape(value: string | null | undefined): string {
  if (!value) return '';
  let str = String(value).trim();

  // CSV formula injection mitigation: neutralize cells starting with =, +, -, or @
  if (
    str.startsWith('=') ||
    str.startsWith('+') ||
    str.startsWith('-') ||
    str.startsWith('@')
  ) {
    str = `'${str}`;
  }

  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
