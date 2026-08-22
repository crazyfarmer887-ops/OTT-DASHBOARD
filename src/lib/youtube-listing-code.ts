export function youtubeListingCodeFromManagerEmail(managerEmail: string): string {
  const localPart = managerEmail.split('@', 1)[0]?.trim().toLowerCase() || '';
  if (localPart.length <= 6) return localPart;
  return `${localPart.slice(0, 3)}${localPart.slice(-3)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SEPARATORS = new Set([',', '.', ';', ':', '!', '?', '/', '\\', '|', '-', '_', '—', '·']);
const CLOSING_WRAPPER = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['（', '）']]);

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/u.test(value);
}

function spliceCode(name: string, start: number, end: number): string {
  let innerLeft = start;
  while (isWhitespace(name[innerLeft - 1])) innerLeft -= 1;
  let innerRight = end;
  while (isWhitespace(name[innerRight])) innerRight += 1;

  const opening = name[innerLeft - 1];
  const closing = name[innerRight];
  let removeStart = start;
  let removeEnd = end;
  let replacement = '';

  if (opening && CLOSING_WRAPPER.has(opening) && CLOSING_WRAPPER.get(opening) === closing) {
    removeStart = innerLeft - 1;
    removeEnd = innerRight + 1;
  } else {
    const leftSeparator = name[start - 1];
    const rightSeparator = name[end];
    if (SEPARATORS.has(leftSeparator) && leftSeparator === rightSeparator) {
      removeStart = start - 1;
      removeEnd = end + 1;
      replacement = leftSeparator;
    } else {
      if (SEPARATORS.has(leftSeparator)) removeStart = start - 1;
      if (SEPARATORS.has(rightSeparator)) removeEnd = end + 1;
    }
  }

  while (isWhitespace(name[removeStart - 1])) removeStart -= 1;
  while (isWhitespace(name[removeEnd])) removeEnd += 1;

  const before = name.slice(0, removeStart);
  const after = name.slice(removeEnd);
  if (!replacement && before && after) replacement = ' ';
  return `${before}${replacement}${after}`;
}

export function removeYouTubeListingCode(name: string, listingCode: string): string {
  const normalizedCode = listingCode.trim().toLowerCase();
  if (!normalizedCode) return name;

  const escapedCode = escapeRegExp(normalizedCode);
  const standaloneCode = new RegExp(`(?<![\\p{L}\\p{N}])${escapedCode}(?![\\p{L}\\p{N}])`, 'iu');
  if (!standaloneCode.test(name)) return name;

  let result = name;
  let match = standaloneCode.exec(result);
  while (match) {
    result = spliceCode(result, match.index, match.index + match[0].length);
    match = standaloneCode.exec(result);
  }
  return result;
}

export function appendYouTubeListingCode(name: string, listingCode: string): string {
  const normalizedCode = listingCode.trim().toLowerCase();
  const titleWithoutCurrentCode = removeYouTubeListingCode(name, normalizedCode);
  if (!normalizedCode) return titleWithoutCurrentCode;
  return titleWithoutCurrentCode ? `${titleWithoutCurrentCode} ${normalizedCode}` : normalizedCode;
}
