import { isRole, type Role } from './permissions';

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
  twoFactorVerified: boolean;
}
export interface Session {
  accessToken: string;
  user: AuthenticatedUser;
}
export interface SummaryMetric {
  id: string;
  label: string;
  value: string;
  hint?: string;
}
export interface ListRecord {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: string;
}
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_URL = (import.meta.env.VITE_SMTR_API_BASE_URL || '/smtr/api/v1').replace(/\/+$/, '');

async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiError('API indisponible. Vérifiez la connexion et la configuration du serveur.', 0);
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'message' in body
      ? String(body.message) : 'Le serveur a refusé cette opération.';
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const raw = await request<unknown>('/auth/login', null, {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  if (!raw || typeof raw !== 'object') throw new ApiError('Réponse d’authentification invalide.', 502);
  const data = raw as Record<string, unknown>;
  const user = data.user as Record<string, unknown> | undefined;
  if (typeof data.accessToken !== 'string' || !data.accessToken ||
      !user || !isRole(user.role) || typeof user.id !== 'string' ||
      typeof user.name !== 'string') {
    throw new ApiError('Contrat d’authentification non reconnu.', 502);
  }
  if (user.role === 'director' && user.twoFactorVerified !== true) {
    throw new ApiError('Authentification à deux facteurs requise pour la Direction.', 403);
  }
  return {
    accessToken: data.accessToken,
    user: {
      id: user.id, name: user.name, role: user.role,
      twoFactorVerified: user.twoFactorVerified === true,
    },
  };
}

export async function fetchMetrics(token: string, signal?: AbortSignal): Promise<SummaryMetric[]> {
  const result = await request<{metrics: SummaryMetric[]}>('/dashboard/summary', token, {signal});
  if (!result || !Array.isArray(result.metrics)) throw new ApiError('Format du tableau de bord non reconnu.', 502);
  return result.metrics;
}

export async function fetchList(path: string, token: string, signal?: AbortSignal): Promise<ListRecord[]> {
  const result = await request<{items: ListRecord[]}>(path, token, {signal});
  if (!result || !Array.isArray(result.items)) throw new ApiError('Format de liste non reconnu.', 502);
  return result.items;
}
