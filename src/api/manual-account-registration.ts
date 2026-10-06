import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { generatedAccountKey, manualRegisteredAccount, type GeneratedAccountStore } from '../lib/generated-accounts';

export function registerManualAccountRoutes(app: Hono, store: { read(): GeneratedAccountStore; write(value: GeneratedAccountStore): void }) {
  app.post('/generated-accounts/register', async c => {
    try {
      const account = manualRegisteredAccount(await c.req.json(), randomUUID());
      const accounts = store.read();
      if (Object.values(accounts).some(existing => generatedAccountKey(existing.serviceType, existing.email) === generatedAccountKey(account.serviceType, account.email)))
        return c.json({ ok: false, error: '이미 등록된 계정입니다. 아래 목록에서 확인해주세요.' }, 409);
      // This path only records supplied credentials; it never touches SimpleLogin.
      store.write({ ...accounts, [account.id]: account });
      return c.json({ ok: true, account });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : '계정 등록 실패' }, 400); }
  });
}
