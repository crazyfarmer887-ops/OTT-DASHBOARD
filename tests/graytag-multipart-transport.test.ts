import { describe, expect, test, vi } from 'vitest';
import { buildMultipartJsonBody, curlFetch } from '../src/api/http-transport';

const model = {
  name: '넷플릭스 30일',
  sellingGuide: '이용 안내',
  endDate: '20260827T0000',
  priceType: 'Extended',
  tempProductCategory: 'Netflix',
  dealUsid: 'deal-1',
  dealEndDate: '20260728T0000',
  price: 12000,
};

describe('Graytag multipart JSON transport', () => {
  test('deterministically encodes the exact productModel part and closing boundary', () => {
    const encoded = buildMultipartJsonBody(model);
    expect(encoded.contentType).toBe('multipart/form-data; boundary=----graytag-renewal-product-model-v1');
    expect(encoded.body).toBe(
      '------graytag-renewal-product-model-v1\r\n' +
      'Content-Disposition: form-data; name="productModel"; filename="blob"\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(model) + '\r\n' +
      '------graytag-renewal-product-model-v1--\r\n',
    );
  });

  test('proxy curl receives the nonempty exact body through --data-binary', async () => {
    const encoded = buildMultipartJsonBody(model);
    const exec = vi.fn(async (_file: string, args: string[]) => {
      const bodyIndex = args.indexOf('--data-binary');
      expect(bodyIndex).toBeGreaterThan(-1);
      expect(args[bodyIndex + 1]).toBe(encoded.body);
      expect(args).toContain(`Content-Type: ${encoded.contentType}`);
      return { stdout: '{"succeeded":true}\n__STATUS__200' };
    });
    const response = await curlFetch('https://graytag.example/register', {
      method: 'POST', headers: { 'Content-Type': encoded.contentType }, body: encoded.body,
    }, 'http://proxy.example:8080', exec as any);
    expect(response.status).toBe(200);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('rejects unsupported non-null bodies before invoking curl', async () => {
    const exec = vi.fn();
    await expect(curlFetch('https://graytag.example/register', {
      method: 'POST', body: new FormData(),
    }, 'http://proxy.example:8080', exec as any)).rejects.toThrow(/unsupported request body/i);
    expect(exec).not.toHaveBeenCalled();
  });
});
