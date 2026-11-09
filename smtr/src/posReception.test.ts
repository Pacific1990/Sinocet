import { afterEach, expect, test, vi } from 'vitest';
import { loginPosReception, pendingPosReceipts, receivePosTransfer, reportPosDiscrepancy } from './posReception';

const answer = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status === 200, data, message: 'Réception refusée' }), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('uses native POS credentials and confirms the selected company before opening the workspace', async () => {
  vi.stubEnv('VITE_SMTR_POS_ORGANIZATION_ID', '7');
  const fetch = vi.fn()
    .mockResolvedValueOnce(answer({
      accessToken: 'qa-token',
      user: { id: 19, username: 'Agent', userType: 'staff', organizationRoles: { 7: 'smtr_agent', 8: 'owner' } },
    }))
    .mockResolvedValueOnce(answer([]));
  vi.stubGlobal('fetch', fetch);

  expect(await loginPosReception('agent@example.test', 'qa-password')).toMatchObject({
    accessToken: 'qa-token', posOrganizationId: '7', user: { id: '19', role: 'agent' },
  });
  expect(fetch.mock.calls[0][0]).toBe('/ekolabs/pos/api/v1/auth/login');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: 'agent@example.test', password: 'qa-password' });
  expect(fetch.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer qa-token', 'X-Organization-Id': '7' });
});

test('rejects POS accounts without the SMTR Agent role in the selected company', async () => {
  vi.stubEnv('VITE_SMTR_POS_ORGANIZATION_ID', '7');
  const fetch = vi.fn().mockResolvedValue(answer({
    accessToken: 'qa-token',
    user: { id: 19, username: 'Agent', userType: 'staff', organizationRoles: { 7: 'manager', 8: 'smtr_agent' } },
  }));
  vi.stubGlobal('fetch', fetch);
  await expect(loginPosReception('agent@example.test', 'qa-password')).rejects.toMatchObject({ status: 403 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('maps POS receipt payloads and sends only the confirmed IDs and discrepancy reason', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(answer([{ id: '4', source: 'Central', sentAt: '2026-11-09', items: [{ id: '15', imeiMasked: '•••12345' }] }]))
    .mockResolvedValueOnce(answer({ id: 4 }))
    .mockResolvedValueOnce(answer({ id: 5 }));
  vi.stubGlobal('fetch', fetch);
  const { transfers } = await pendingPosReceipts('qa-token', '7');
  expect(transfers[0].items[0]).toMatchObject({ id: '15', imeiMasked: '•••12345' });
  await expect(receivePosTransfer('qa-token', '7', '4', ['15'])).resolves.toEqual({ transfer: { id: '4' } });
  await expect(reportPosDiscrepancy('qa-token', '7', '5', [], 'Appareil absent')).resolves.toEqual({ transfer: { id: '5' } });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ item_ids: ['15'] });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ present_item_ids: [], reason: 'Appareil absent' });
  expect(fetch.mock.calls.every(([url]) => url.startsWith('/ekolabs/pos/api/v1/'))).toBe(true);
});

test('does not treat an expired or rejected POS session as a successful receipt', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null, 401)));
  await expect(receivePosTransfer('qa-token', '7', '4', ['15'])).rejects.toMatchObject({ status: 401 });
});
