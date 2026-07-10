/**
 * Yuborishdan oldin kadrlarni KICHRAYTIRISH — verify tezligining asosiy kaliti.
 *
 * Muammo: vision-camera `takeSnapshot` Android'da preview bitmap'ini oladi —
 * o'lchami EKRAN o'lchamiga teng (~1080×2340). 3 kadrlik burst ~1-2MB bo'lib,
 * mobil uplink'da yuklash bir necha soniya olardi ("shaxsingiz tekshirilmoqda"
 * uzoq kutish). Server esa 112px ArcFace kropida ishlaydi — 640px yetarli
 * (kiosk ham 640px yuboradi, WS oqimi ham).
 *
 * Yechim: expo-image-manipulator bilan kadr 640px kenglikka resize + JPEG 0.7
 * — kadr ~60-120KB bo'ladi (~10x kichik). Modul NATIV — eski (rebuild
 * qilinmagan) buildda bo'lmaydi: himoyalangan require null qaytaradi va kadr
 * o'zgarishsiz yuboriladi (hech narsa buzilmaydi).
 */

type ManipulatorModule = typeof import('expo-image-manipulator');

let manipulator: ManipulatorModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  manipulator = require('expo-image-manipulator') as ManipulatorModule;
  if (typeof manipulator.manipulateAsync !== 'function') manipulator = null;
} catch {
  manipulator = null;
}

/** Yuboriladigan kadr kengligi — server det/krop uchun mo'l-ko'l (kiosk bilan bir xil) */
const FRAME_MAX_WIDTH = 640;
/** Resize'dan keyingi JPEG siqish darajasi */
const FRAME_COMPRESS = 0.7;

/**
 * Bitta kadrni kichraytiradi. Modul yo'q yoki xato bo'lsa asl URI qaytadi —
 * verify oqimi hech qachon shu bosqichda yiqilmaydi.
 */
export async function shrinkFrame(uri: string): Promise<string> {
  if (!manipulator) return uri;
  try {
    const result = await manipulator.manipulateAsync(
      uri,
      [{ resize: { width: FRAME_MAX_WIDTH } }],
      { compress: FRAME_COMPRESS, format: manipulator.SaveFormat.JPEG },
    );
    return result.uri || uri;
  } catch {
    return uri;
  }
}

/** Burst kadrlarini PARALLEL kichraytiradi (har biri ~100-200ms, jami ~1 kadr vaqti). */
export function shrinkFrames(uris: string[]): Promise<string[]> {
  return Promise.all(uris.map(shrinkFrame));
}

/** Diagnostika uchun: shu buildda resize ishlaydimi. */
export function isFrameShrinkAvailable(): boolean {
  return manipulator !== null;
}
