import * as SecureStore from 'expo-secure-store';
import { t } from '@/i18n';
import type { RefreshResponse } from '@/types/api';

const ACCESS_KEY = 'faceid_access_token';
const REFRESH_KEY = 'faceid_refresh_token';

/**
 * EXPO_PUBLIC_API_URL faqat domen bo'lsa (masalan http://192.168.1.42:3000) https://backend.timepro.uz
 * oxiriga /api/v1 avtomatik qo'shiladi; to'liq berilsa o'zgarishsiz qoladi.
 */
function normalizeApiUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, '');
  return /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`;
}

const rawApiUrl = process.env.EXPO_PUBLIC_API_URL;
if (!rawApiUrl) {
  // .env'da EXPO_PUBLIC_API_URL belgilanmagan — jim noto'g'ri URL bilan
  // ishlashdan ko'ra aniq xabar bilan darhol yiqilamiz.
  throw new Error('EXPO_PUBLIC_API_URL .env faylida belgilanmagan');
}

export const API_URL: string = normalizeApiUrl(
  rawApiUrl,
  // process.env.EXPO_PUBLIC_API_URL ?? 'https://backend.timepro.uz',
);

// Diagnostika: Metro terminalда bundle'ga qaysi manzil inline bo'lganini ko'rsatadi.
// Eski IP chiqsa — .env yangilangach `npx expo start -c` qilinmagan (cache eski).
console.log('[boot] API_URL =', API_URL);

/** Har bir so'rov uchun maksimal kutish (ms) — o'lik IP'da abadiy osilib qolmaslik uchun. */
const FETCH_TIMEOUT_MS = 12_000;

/** fetch + timeout: javob kelmasa AbortController orqali bekor qilinadi. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Envelope & xatolar
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
  meta?: Meta;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details ?? null;
  }
}

// ---------------------------------------------------------------------------
// Token saqlash (expo-secure-store)
// ---------------------------------------------------------------------------

export const tokenStorage = {
  async getAccess(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },
  async getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async set(accessToken: string, refreshToken: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

/** 401 refresh ham muvaffaqiyatsiz bo'lsa chaqiriladi (auth store logout qiladi). */
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void): void {
  onUnauthorized = cb;
}

// ---------------------------------------------------------------------------
// Refresh oqimi (bir vaqtda faqat bitta refresh — shared promise)
// ---------------------------------------------------------------------------

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const refreshToken = await tokenStorage.getRefresh();
        if (!refreshToken) return false;
        const res = await fetchWithTimeout(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const json = (await res.json()) as Envelope<RefreshResponse>;
        if (!res.ok || !json.success || !json.data) return false;
        await tokenStorage.set(json.data.accessToken, json.data.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Umumiy so'rov
// ---------------------------------------------------------------------------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body (formData bilan birga bermang) */
  body?: unknown;
  /** multipart body */
  formData?: FormData;
  /** Bearer token qo'shish (default: true) */
  auth?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
}

interface ApiResult<T> {
  data: T;
  meta?: Meta;
}

async function rawRequest<T>(
  path: string,
  opts: RequestOptions,
  isRetry: boolean,
): Promise<ApiResult<T>> {
  const { method = 'GET', body, formData, auth = true, query } = opts;

  let url = `${API_URL}${path}`;
  if (query) {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (params.length > 0) url += `?${params.join('&')}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) {
    const token = await tokenStorage.getAccess();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', t('errNetwork'), 0);
  }

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError('PARSE_ERROR', t('errGeneric'), res.status);
  }

  // 401 → bir marta refresh qilib qayta urinamiz
  if (res.status === 401 && auth && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return rawRequest<T>(path, opts, true);
    await tokenStorage.clear();
    onUnauthorized?.();
    throw new ApiError('UNAUTHORIZED', t('errUnauthorized'), 401);
  }

  if (!json.success || json.error) {
    const err = json.error;
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? t('errGeneric'),
      res.status,
      err?.details,
    );
  }

  return { data: json.data as T, meta: json.meta };
}

/** Envelope'ni ochib faqat data qaytaradi. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { data } = await rawRequest<T>(path, opts, false);
  return data;
}

/** Pagination meta kerak bo'lsa. */
export async function apiWithMeta<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResult<T>> {
  return rawRequest<T>(path, opts, false);
}
