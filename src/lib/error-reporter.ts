import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { API_URL } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Mobil xatolarni backend'ga yuboruvchi reporter — superadmin paneldagi
 * "Mobil loglar" sahifasiga tushadi (POST /public/mobile-logs, authsiz).
 *
 * - Fatal JS xatolar: ErrorUtils global handler o'rab olinadi (default handler
 *   baribir chaqiriladi — dev'da redbox, prod'da crash o'z holicha qoladi).
 * - Ushlangan xatolar: ErrorBoundary reportError() ni chaqiradi.
 * - Internet yo'q bo'lsa navbatga (AsyncStorage) yoziladi va keyingi ishga
 *   tushirishda flushPendingErrorLogs() yuboradi.
 * - Reporter hech qachon o'zi xato otmasligi kerak — hamma joyda catch.
 */

const PENDING_KEY = 'faceid-pending-error-logs';
const MAX_PENDING = 20;
const SEND_TIMEOUT_MS = 8_000;
/** Bir xil xabar shu oraliqda qayta yuborilmaydi (xato tsiklida spam bo'lmasin) */
const DEDUP_WINDOW_MS = 30_000;

interface ErrorPayload {
  message: string;
  stack?: string;
  isFatal: boolean;
  platform: string;
  osVersion?: string;
  deviceModel?: string;
  appVersion?: string;
  route?: string;
  username?: string;
  userId?: string;
  extra?: Record<string, unknown>;
  occurredAt: string;
}

const recentMessages = new Map<string, number>();

function isDuplicate(message: string): boolean {
  const now = Date.now();
  const last = recentMessages.get(message);
  recentMessages.set(message, now);
  if (recentMessages.size > 50) recentMessages.clear();
  return last !== undefined && now - last < DEDUP_WINDOW_MS;
}

function buildPayload(
  error: unknown,
  opts: { isFatal: boolean; route?: string; extra?: Record<string, unknown> },
): ErrorPayload {
  const err = error instanceof Error ? error : new Error(String(error));
  const user = useAuthStore.getState().user as { id?: string; username?: string } | null;
  return {
    message: (err.message || 'Nomsiz xato').slice(0, 4000),
    stack: err.stack ? err.stack.slice(0, 16000) : undefined,
    isFatal: opts.isFatal,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    osVersion: String(Platform.Version ?? '').slice(0, 40) || undefined,
    deviceModel: Device.modelName?.slice(0, 120) ?? undefined,
    appVersion: Constants.expoConfig?.version?.slice(0, 40) ?? undefined,
    route: opts.route?.slice(0, 255),
    username: user?.username?.slice(0, 120),
    userId: user?.id,
    extra: opts.extra,
    occurredAt: new Date().toISOString(),
  };
}

async function send(payload: ErrorPayload): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_URL}/public/mobile-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function queuePending(payload: ErrorPayload): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as ErrorPayload[]) : [];
    list.push(payload);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // navbatga yozib bo'lmasa — yo'qotamiz (reporter hech narsani buzmasin)
  }
}

/** Xatoni yuboradi; tarmoq bo'lmasa keyingi start uchun navbatga qo'yadi */
export function reportError(
  error: unknown,
  opts: { isFatal?: boolean; route?: string; extra?: Record<string, unknown> } = {},
): void {
  try {
    const payload = buildPayload(error, { isFatal: opts.isFatal ?? true, ...opts });
    if (isDuplicate(payload.message)) return;
    void send(payload).then((ok) => {
      if (!ok) void queuePending(payload);
    });
  } catch {
    // reporter xatosi yutiladi
  }
}

/** Oldingi sessiyada yuborilmay qolgan xatolarni jo'natadi (app startida chaqiriladi) */
export async function flushPendingErrorLogs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as ErrorPayload[];
    if (!Array.isArray(list) || list.length === 0) {
      await AsyncStorage.removeItem(PENDING_KEY);
      return;
    }
    const failed: ErrorPayload[] = [];
    for (const payload of list.slice(-MAX_PENDING)) {
      const ok = await send(payload);
      if (!ok) failed.push(payload);
    }
    if (failed.length > 0) {
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(failed));
    } else {
      await AsyncStorage.removeItem(PENDING_KEY);
    }
  } catch {
    // flush xatosi yutiladi
  }
}

let installed = false;

/** Global fatal xato handler'ini o'rnatadi — bir marta, app kirishida */
export function initErrorReporting(): void {
  if (installed) return;
  installed = true;
  try {
    // ErrorUtils — React Native global (type'larda to'liq emas)
    const errorUtils = (globalThis as Record<string, any>).ErrorUtils as
      | {
          getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
          setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void;
        }
      | undefined;
    if (!errorUtils) return;

    const defaultHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, { isFatal: isFatal ?? true });
      // Default xatti-harakat saqlanadi (dev redbox / prod crash dialog)
      defaultHandler(error, isFatal);
    });
  } catch {
    // reporter o'rnatilmasa ham app ishlayveradi
  }
}
