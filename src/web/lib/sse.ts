export interface SseFrame {
  event: string;
  id?: string;
  data: string;
}

export interface ParsedSseBuffer {
  frames: SseFrame[];
  remainder: string;
}

function parseFrame(block: string): SseFrame | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value || 'message';
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'data') data.push(value);
  }

  if (data.length === 0) return null;
  return { event, ...(id === undefined ? {} : { id }), data: data.join('\n') };
}

export function parseSseBuffer(buffer: string): ParsedSseBuffer {
  const frames: SseFrame[] = [];
  const boundary = /\r?\n\r?\n/g;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(buffer)) !== null) {
    const frame = parseFrame(buffer.slice(consumed, match.index));
    if (frame) frames.push(frame);
    consumed = boundary.lastIndex;
  }

  return { frames, remainder: buffer.slice(consumed) };
}
