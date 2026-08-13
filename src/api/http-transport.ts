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
    '-s', '-S',
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

  const { stdout } = await exec('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  const statusMatch = stdout.match(/__STATUS__(\d+)$/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  const body = stdout.replace(/\n?__STATUS__\d+$/, '');
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}
