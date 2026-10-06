import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

export const GRAYTAG_MULTIPART_BOUNDARY = '----graytag-renewal-product-model-v1';

export function buildMultipartJsonBody(model: unknown): { body: string; contentType: string } {
  const boundary = GRAYTAG_MULTIPART_BOUNDARY;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: [
      `--${boundary}`,
      'Content-Disposition: form-data; name="productModel"; filename="blob"',
      'Content-Type: application/json',
      '',
      JSON.stringify(model),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  };
}

type CurlExec = (file: string, args: string[], options: { maxBuffer: number }) => Promise<{ stdout: string }>;
const defaultCurlExec = promisify(nodeExecFile) as unknown as CurlExec;

export async function curlFetch(
  url: string,
  options: RequestInit = {},
  proxyUrl: string,
  exec: CurlExec = defaultCurlExec,
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  const headerEntries: Array<[string, string]> = options.headers instanceof Headers
    ? Array.from(options.headers.entries())
    : Array.isArray(options.headers)
      ? options.headers.map(([key, value]) => [String(key), String(value)])
      : Object.entries(options.headers || {}).map(([key, value]) => [key, String(value)]);
  const args = [
    '-s', '-S', '-D', '-',
    '-x', proxyUrl,
    '-X', method,
    '--max-time', '15',
    '-w', '\n__STATUS__%{http_code}',
  ];

  for (const [key, value] of headerEntries) args.push('-H', `${key}: ${value}`);

  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body !== 'string') {
      throw new TypeError('unsupported request body for proxy transport');
    }
    args.push('--data-binary', options.body);
  }
  args.push(url);

  let stdout: string;
  try {
    ({ stdout } = await exec('curl', args, { maxBuffer: 10 * 1024 * 1024 }));
  } catch {
    // exec errors include command arguments, including proxy and session secrets.
    throw new Error('GrayTag proxy connection failed');
  }
  const statusMatch = stdout.match(/__STATUS__(\d+)$/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  let body = stdout.replace(/\n?__STATUS__\d+$/, '');
  let headers = new Headers({ 'Content-Type': 'application/json' });
  // curl may emit the proxy CONNECT block before the actual response headers.
  while (/^HTTP\/\S+ \d{3}[^\r\n]*\r?\n/.test(body)) {
    const separator = body.match(/\r?\n\r?\n/);
    if (!separator || separator.index === undefined) break;
    const block = body.slice(0, separator.index);
    headers = new Headers();
    for (const line of block.split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':'); if (colon < 1) continue;
      const name = line.slice(0, colon).toLowerCase();
      if (['content-type', 'retry-after', 'location'].includes(name)) headers.set(name, line.slice(colon + 1).trim());
    }
    body = body.slice(separator.index + separator[0].length);
  }
  return new Response([204, 205, 304].includes(status) ? null : body, { status, headers });
}
