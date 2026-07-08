/**
 * VisionCamera native moduli mavjudligini XAVFSIZ tekshirish.
 *
 * Eski dev-client'da (react-native-vision-camera native kodisiz qurilgan)
 * modul chaqiruvi istisno otadi — u holda check ekrani eski expo-camera
 * oqimiga (fallback) tushadi. Shu sabab vision-camera'ga bog'liq har qanday
 * import FAQAT runtime `require` bilan, shu tekshiruvdan o'tgach qilinadi.
 */
export function isVisionCameraAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vc = require('react-native-vision-camera') as {
      Camera?: { getAvailableCameraDevices?: () => unknown[] };
    };
    const devices = vc.Camera?.getAvailableCameraDevices?.();
    return Array.isArray(devices) && devices.length > 0;
  } catch {
    return false;
  }
}
