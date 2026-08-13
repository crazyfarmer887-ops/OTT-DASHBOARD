import { describe, expect, test, vi } from 'vitest';
import { resolveCreatedSimpleLoginAliasId } from '../src/lib/simplelogin-alias-id';

describe('SimpleLogin created alias eventual-consistency resolution', () => {
  test('polls immediately and returns when the id appears on the third exact-email lookup', async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ email: 'created@example.com' })
      .mockResolvedValueOnce({ id: 321, email: 'CREATED@example.com' });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(resolveCreatedSimpleLoginAliasId({
      createdEmail: ' Created@Example.com ',
      lookup,
      sleep,
    })).resolves.toEqual({ id: 321, email: 'created@example.com' });
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenNthCalledWith(1, 'created@example.com');
    expect(lookup).toHaveBeenNthCalledWith(2, 'created@example.com');
    expect(lookup).toHaveBeenNthCalledWith(3, 'created@example.com');
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  test('stops after the bounded retry policy and reports the exact created email without secrets', async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const error = await resolveCreatedSimpleLoginAliasId({
      createdEmail: ' Exact.Alias@Example.com ',
      lookup,
      sleep,
    }).catch((caught) => caught as Error);

    expect(lookup).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(sleep.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBe(15500);
    expect(error.message).toContain('별칭은 생성됐지만');
    expect(error.message).toContain('exact.alias@example.com');
    expect(error.message).toContain('잠시 후 다시 시도');
    expect(error.message).not.toContain('test-api-key');
  });

  test.each([
    [0, 0],
    ['alias-id-0', 'alias-id-0'],
  ])('accepts a present numeric/string id (%s)', async (id, expected) => {
    await expect(resolveCreatedSimpleLoginAliasId({
      createdEmail: 'id@example.com',
      lookup: async () => ({ id, email: 'id@example.com' }),
      sleep: async () => undefined,
    })).resolves.toEqual({ id: expected, email: 'id@example.com' });
  });

  test('ignores a lookup result for a different normalized email', async () => {
    let calls = 0;
    await expect(resolveCreatedSimpleLoginAliasId({
      createdEmail: 'right@example.com',
      retryDelaysMs: [],
      lookup: async () => {
        calls += 1;
        return { id: 7, email: 'wrong@example.com' };
      },
      sleep: async () => undefined,
    })).rejects.toThrow('right@example.com');
    expect(calls).toBe(1);
  });
});
