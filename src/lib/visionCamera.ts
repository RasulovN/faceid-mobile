/**
 * VisionCamera native moduli mavjudligini XAVFSIZ tekshirish.
 *
 * Eski dev-client'da (react-native-vision-camera native kodisiz qurilgan)
 * modul chaqiruvi istisno otadi — u holda check ekrani eski expo-camera
 * oqimiga (fallback) tushadi. Shu sabab vision-camera'ga bog'liq har qanday
 * import FAQAT runtime `require` bilan, shu tekshiruvdan o'tgach qilinadi.
 *
 * MUHIM: bu yerda qurilmalar RO'YXATI TEKSHIRILMAYDI. Ba'zi qurilmalarda
 * modul yuklanish paytida (ruxsat berilmasidan oldin) ro'yxat bo'sh keladi
 * va LIVE rejim noto'g'ri o'chib qolar edi. Endi faqat native modulning
 * o'zi javob berishi tekshiriladi; front kamera yo'qligi esa runtime'da
 * LiveFaceCamera ichida aniqlanib, onUnavailable orqali WS rejimga
 * yumshoq o'tiladi.
 */
export function isVisionCameraAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vc = require('react-native-vision-camera') as {
      Camera?: { getAvailableCameraDevices?: () => unknown[] };
    };
    if (typeof vc.Camera?.getAvailableCameraDevices !== 'function') return false;
    // Chaqiruvning o'zi istisno otmasligi = native modul buildda bor.
    // Bo'sh ro'yxat ham "modul bor" degani (ro'yxat keyinroq to'ladi).
    const devices = vc.Camera.getAvailableCameraDevices();
    return Array.isArray(devices);
  } catch {
    return false;
  }
}
