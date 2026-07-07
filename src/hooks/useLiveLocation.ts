import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface LiveLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Android: soxta joylashuv (mock) flagi */
  mocked: boolean;
}

export type LocationPermission = 'pending' | 'granted' | 'denied';

/** `Location.LocationObject` → bizning `LiveLocation` shakli. */
function toLiveLocation(loc: Location.LocationObject): LiveLocation {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    mocked: loc.mocked ?? false,
  };
}

/** Fallback poll intervali (ms) — telefon qimirlamasa ham holat yangilanib tursin. */
const POLL_INTERVAL_MS = 4000;

/**
 * Old fonda joylashuvni JONLI (realtime) kuzatadi.
 *
 * Uch qatlamli yangilash strategiyasi (holat refresh'siz avtomatik yangilanadi):
 *  1. `enabled` bo'lganda DARHOL bir marta `getCurrentPositionAsync` — boshlang'ich
 *     qiymat kutilmasdan ko'rsatiladi.
 *  2. `watchPositionAsync` (distanceInterval: 1) — harakatda tezkor yangilanish.
 *  3. `setInterval` fallback (~4s) — telefon qimirlamaganda ham (ayniqsa iOS
 *     distanceFilter tufayli watch event kelmasa) holat qayta o'qiladi.
 *
 * GPS vaqtincha xato bersa — oldingi qiymat saqlanadi (xato yutiladi).
 */
export function useLiveLocation(enabled: boolean): {
  location: LiveLocation | null;
  permission: LocationPermission;
} {
  const [location, setLocation] = useState<LiveLocation | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('pending');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const apply = (loc: Location.LocationObject): void => {
      if (cancelled) return;
      setLocation(toLiveLocation(loc));
    };

    const readOnce = async (): Promise<void> => {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        apply(loc);
      } catch {
        // GPS vaqtincha xato — oldingi qiymatni saqlaymiz
      }
    };

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermission('denied');
        return;
      }
      setPermission('granted');

      // 1) Darhol boshlang'ich o'qish
      await readOnce();
      if (cancelled) return;

      // 2) Harakatda tezkor yangilanish
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 1,
        },
        apply,
      );

      // 3) Fallback: telefon qimirlamasa ham davriy yangilash
      intervalId = setInterval(() => {
        void readOnce();
      }, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled]);

  return { location, permission };
}

/** Bir martalik aniq joylashuv (check oqimi boshida qayta tekshirish uchun). */
export async function getCurrentLocation(): Promise<LiveLocation> {
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return toLiveLocation(loc);
}
