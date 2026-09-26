const MAX_GAP_MS = 30 * 60_000;
const MAX_SPAN_MS = 2 * 60 * 60_000;
const MAX_MESSAGES = 6;

/** A buyer's consecutive messages form one thought until a seller/system message or a long pause. */
export function buyerTurnEndingAt<T extends { buyer: boolean; time: number }>(
  ordered: readonly T[], endIndex: number,
): T[] {
  const last = ordered[endIndex];
  if (!last?.buyer || !Number.isFinite(last.time)) return [];
  let first = endIndex;
  while (first > 0 && endIndex - first + 1 < MAX_MESSAGES) {
    const previous = ordered[first - 1];
    const current = ordered[first];
    if (!previous.buyer || !Number.isFinite(previous.time)
      || current.time - previous.time > MAX_GAP_MS
      || last.time - previous.time > MAX_SPAN_MS) break;
    first -= 1;
  }
  return ordered.slice(first, endIndex + 1);
}
