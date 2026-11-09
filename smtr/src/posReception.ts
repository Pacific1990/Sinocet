import { ApiError, type PendingTransfer, type Session } from './api';

const POS_API = '/ekolabs/pos/api/v1';
export const posReceptionEnabled = import.meta.env.VITE_SMTR_POS_RECEPTION === 'true';

async function requestPos<T>(path: string, access?: { token: string; organizationId: string }, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(POS_API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(access ? { Authorization: 'Bearer ' + access.token, 'X-Organization-Id': access.organizationId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch {
    throw new ApiError('API EkoLabs POS indisponible.', 0);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(typeof payload?.message === 'string' ? payload.message : 'Requête POS refusée.', response.status);
  }
  if (payload?.success !== true || !Object.hasOwn(payload, 'data')) {
    throw new ApiError('Réponse EkoLabs POS invalide.', 502);
  }
  return payload.data as T;
}

export async function loginPosReception(username: string, password: string): Promise<Session> {
  const organizationId = import.meta.env.VITE_SMTR_POS_ORGANIZATION_ID;
  if (typeof organizationId !== 'string' || !/^[1-9]\d{0,15}$/.test(organizationId)) {
    throw new ApiError('Entreprise POS non configurée pour la recette SMTR.', 503);
  }
  const data = await requestPos<{
    accessToken: string;
    user: { id: number | string; username: string; userType: string; organizationRoles: Record<string, string> };
  }>('/auth/login', undefined, { username, password });
  const user = data?.user;
  if (user?.userType !== 'staff' || user.organizationRoles?.[organizationId] !== 'smtr_agent') {
    throw new ApiError('Compte Agent SMTR non habilité pour cette entreprise.', 403);
  }
  if (typeof data.accessToken !== 'string' || !data.accessToken || !/^[1-9]\d*$/.test(String(user.id)) ||
      typeof user.username !== 'string' || !user.username.trim()) {
    throw new ApiError('Session EkoLabs POS invalide.', 502);
  }
  await pendingPosReceipts(data.accessToken, organizationId);
  return {
    accessToken: data.accessToken,
    posOrganizationId: organizationId,
    user: { id: String(user.id), name: user.username, role: 'agent', twoFactorVerified: false },
  };
}

type PosReceipt = Omit<PendingTransfer, 'items'> & {
  items: Array<{ id: string; imeiMasked: string | null; productName?: string }>;
};

export async function pendingPosReceipts(token: string, organizationId: string): Promise<{transfers: PendingTransfer[]}> {
  const receipts = await requestPos<PosReceipt[]>('/transfers/pending-receipts', { token, organizationId });
  if (!Array.isArray(receipts) || receipts.some(r => !r || typeof r.id !== 'string' || !Array.isArray(r.items) ||
      r.items.some(item => !item || typeof item.id !== 'string'))) {
    throw new ApiError('Liste de réceptions POS invalide.', 502);
  }
  return { transfers: receipts.map(receipt => ({
    ...receipt,
    items: receipt.items.map(item => ({
      ...item, imeiMasked: item.imeiMasked ?? 'IMEI absent', productName: item.productName ?? '',
    })),
  })) };
}

async function changeReceipt(token: string, organizationId: string, id: string, action: 'receive' | 'discrepancy', body: object) {
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new ApiError('Identifiant de transfert invalide.', 422);
  const result = await requestPos<{id: string | number}>('/transfers/' + id + '/' + action, { token, organizationId }, body);
  if (String(result?.id) !== id) throw new ApiError('Confirmation POS invalide.', 502);
  return { transfer: { id } };
}

export function receivePosTransfer(token: string, organizationId: string, id: string, itemIds: string[]) {
  return changeReceipt(token, organizationId, id, 'receive', { item_ids: itemIds });
}

export function reportPosDiscrepancy(token: string, organizationId: string, id: string, itemIds: string[], reason: string) {
  return changeReceipt(token, organizationId, id, 'discrepancy', { present_item_ids: itemIds, reason });
}
