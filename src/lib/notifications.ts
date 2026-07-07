/**
 * PUSH-NOTIFICATION SKELETON (spec bo'yicha — hozircha faqat tayyorgarlik).
 *
 * Oqim:
 *   1. registerForPushNotificationsAsync() — ruxsat so'raydi va Expo push token oladi.
 *   2. sendPushTokenToBackend(token) — token backendga yuboriladi.
 *
 * Backend'da hozircha push-token endpoint'i YO'Q (API_CONTRACT.md da yo'q).
 * Endpoint tayyor bo'lganda:
 *   - sendPushTokenToBackend ichidagi kommentni oching,
 *   - app/_layout.tsx dagi chaqiruv kommentini oching.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Expo push token oladi (faqat real qurilmada ishlaydi). */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) return null; // emulator/simulator'da push yo'q

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Davomat',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return tokenResponse.data;
}

/**
 * Tokenni backendga yuborishga TAYYOR funksiya.
 * Backend endpoint qo'shilganda quyidagi kommentni oching:
 */
export async function sendPushTokenToBackend(token: string): Promise<void> {
  // import { api } from './api';
  // await api('/notifications/push-token', {
  //   method: 'POST',
  //   body: { token, platform: Platform.OS },
  // });
  void token; // endpoint tayyor bo'lguncha yuborilmaydi
}
