/**
 * FaceGate — on-device jonlilik darvozasi (sof mantiq, RN importsiz).
 *
 * ML Kit'dan kelayotgan kadr-ma-kadr kuzatuvlar (yuz bor/yo'q, o'lcham, markaz,
 * yaw, ko'z ochiqligi) shu holat mashinasidan o'tadi. Suratga olish FAQAT:
 *   1) bitta yuz kadrda yetarli katta va markazda BARQAROR turganda, VA
 *   2) JONLILIK dalili kuzatilganda: tabiiy ko'z yumib-ochish (blink —
 *      eyeOpen yuqori→past tushishi). Statik rasm/ekran blink qila olmaydi.
 *
 * Bosh burilishi ('turn') FAQAT ko'z ma'lumoti umuman kelmaydigan qurilmalarda
 * fallback sifatida qoladi: tekis rasmni chapga-o'ngga burish ML Kit yaw'ini
 * o'zgartira olardi — ko'z ma'lumoti bor joyda turn o'chirilgan, rasm shu
 * yo'l bilan darvozadan o'tmaydi.
 *
 * Yuz barqaror turib UZOQ VAQT blink kuzatilmasa (jonsiz yuz — qog'oz rasm,
 * telefon ekrani) darvoza 'spoof_suspected' holatini qaytaradi — UI
 * "insoniylik aniqlanmadi" deb ko'rsatadi. Haqiqiy odam baribir blink qiladi
 * va darvoza o'sha zahoti ochiladi.
 *
 * Trigger 'blink' ko'z YUMILGAN paytda otiladi — kamera darhol suratga olsa,
 * yopiq-ko'z kadri serverdagi EAR blink tekshiruviga dalil bo'ladi.
 */

export interface FaceSample {
  /** Kadrda kamida bitta yuz bormi */
  present: boolean;
  /** Bir nechta yuz (faqat bitta bo'lishi kerak) */
  multiple: boolean;
  /** Yuz markazi, ekran o'lchamiga nisbatan 0..1 */
  centerX: number;
  centerY: number;
  /** Yuz kengligi / ekran kengligi (0..1) */
  widthRatio: number;
  /** Bosh burilishi, gradus */
  yaw: number;
  /** Ikki ko'z ochiqlik ehtimoli o'rtachasi 0..1; ma'lumot yo'q bo'lsa -1 */
  eyeOpen: number;
  /** Monotonik vaqt, ms */
  timestamp: number;
}

export type GateStatus =
  | 'no_face'
  | 'multiple'
  | 'too_small'
  | 'off_center'
  | 'hold' // barqaror — jonlilik dalili (blink) kutilmoqda
  | 'hold_long' // uzoq kutildi — foydalanuvchiga "ko'z yumib oching" maslahati
  | 'spoof_suspected' // juda uzoq blink yo'q — rasm/ekran gumoni
  | 'triggered'; // dalil kuzatildi — suratga olish vaqti

export type GateTrigger = 'blink' | 'turn' | null;

export interface GateResult {
  status: GateStatus;
  trigger: GateTrigger;
}

export interface GateConfig {
  /** Yuz kengligi ekran kengligining kamida shu ulushi bo'lsin */
  minWidthRatio: number;
  /** Markazdan ruxsat etilgan og'ish (ekran ulushida) */
  centerToleranceX: number;
  centerToleranceY: number;
  /** Trigger yoqilishidan oldin yuz shuncha ms barqaror turishi kerak */
  stableMs: number;
  /** Blink: ochiq/yopiq ko'z chegaralari */
  eyeOpenHigh: number;
  eyeOpenLow: number;
  /** Turn-fallback: barqaror oynada yaw diapazoni (gradus) */
  yawRangeDeg: number;
  /** Turn-fallback: kamida shuncha yaw namunasi yig'ilgan bo'lsin */
  turnMinSamples: number;
  /** Turn-fallback: namunalar kamida shuncha ms oraliqni qamrasin */
  turnMinSpanMs: number;
  /** Yaw/ko'z tarixi oynasi, ms */
  windowMs: number;
  /** Shuncha ms blink kuzatilmasa 'hold_long' (maslahat ko'rsatiladi) */
  longHoldMs: number;
  /** Shuncha ms blink kuzatilmasa 'spoof_suspected' (rasm/ekran gumoni) */
  spoofAfterMs: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  minWidthRatio: 0.28,
  centerToleranceX: 0.22,
  centerToleranceY: 0.25,
  stableMs: 600,
  eyeOpenHigh: 0.6,
  eyeOpenLow: 0.35,
  yawRangeDeg: 14,
  turnMinSamples: 5,
  turnMinSpanMs: 500,
  windowMs: 3500,
  longHoldMs: 4500,
  spoofAfterMs: 8000,
};

interface HistoryEntry {
  timestamp: number;
  yaw: number;
  eyeOpen: number;
}

export class FaceGate {
  private readonly config: GateConfig;
  private history: HistoryEntry[] = [];
  private stableSince: number | null = null;
  private locked = false;

  constructor(config: Partial<GateConfig> = {}) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
  }

  /** Burst yakunlangach (yoki xatodan keyin) darvozani qayta qurollantirish. */
  reset(): void {
    this.history = [];
    this.stableSince = null;
    this.locked = false;
  }

  /** Trigger otilganmi (reset qilinmaguncha qayta otilmaydi). */
  get isLocked(): boolean {
    return this.locked;
  }

  push(sample: FaceSample): GateResult {
    if (this.locked) return { status: 'triggered', trigger: null };

    const cfg = this.config;

    if (!sample.present) {
      this.resetStability();
      return { status: 'no_face', trigger: null };
    }
    if (sample.multiple) {
      this.resetStability();
      return { status: 'multiple', trigger: null };
    }
    if (sample.widthRatio < cfg.minWidthRatio) {
      this.resetStability();
      return { status: 'too_small', trigger: null };
    }
    if (
      Math.abs(sample.centerX - 0.5) > cfg.centerToleranceX ||
      Math.abs(sample.centerY - 0.5) > cfg.centerToleranceY
    ) {
      this.resetStability();
      return { status: 'off_center', trigger: null };
    }

    // Yuz joyida — tarixga yozamiz va eski yozuvlarni o'chiramiz
    if (this.stableSince === null) this.stableSince = sample.timestamp;
    this.history.push({
      timestamp: sample.timestamp,
      yaw: sample.yaw,
      eyeOpen: sample.eyeOpen,
    });
    const cutoff = sample.timestamp - cfg.windowMs;
    while (this.history.length > 0 && this.history[0].timestamp < cutoff) {
      this.history.shift();
    }

    const stableFor = sample.timestamp - this.stableSince;
    if (stableFor < cfg.stableMs) {
      return { status: 'hold', trigger: null };
    }

    // --- Jonlilik dalillari ---

    // 1) BLINK (asosiy trigger): oynada avval OCHIQ ko'z bo'lgan, hozirgi
    //    kadr YOPIQ. Trigger yopiq paytda otiladi — darhol suratga olinsa
    //    serverga yopiq-ko'z kadri (EAR dalili) tushadi. Statik rasm/ekran
    //    buni qila olmaydi.
    if (sample.eyeOpen >= 0 && sample.eyeOpen <= cfg.eyeOpenLow) {
      const sawOpen = this.history.some(
        (h) => h.eyeOpen >= cfg.eyeOpenHigh && h.timestamp < sample.timestamp,
      );
      if (sawOpen) {
        this.locked = true;
        return { status: 'triggered', trigger: 'blink' };
      }
    }

    // 2) TURN (faqat fallback): ko'z ochiqlik ma'lumoti UMUMAN kelmaydigan
    //    qurilmalarda bosh burilishi qabul qilinadi. Ko'z ma'lumoti bor joyda
    //    turn O'CHIRILGAN — tekis rasmni burish yaw'ni o'zgartirib darvozadan
    //    o'tib ketmasin. Qat'iy talablar: yetarli namuna + vaqt oralig'i.
    const hasEyeData = this.history.some((h) => h.eyeOpen >= 0);
    if (!hasEyeData) {
      const yawEntries = this.history.filter((h) => Number.isFinite(h.yaw));
      if (yawEntries.length >= cfg.turnMinSamples) {
        const yaws = yawEntries.map((h) => h.yaw);
        const spanMs =
          yawEntries[yawEntries.length - 1].timestamp - yawEntries[0].timestamp;
        if (
          spanMs >= cfg.turnMinSpanMs &&
          Math.max(...yaws) - Math.min(...yaws) >= cfg.yawRangeDeg
        ) {
          this.locked = true;
          return { status: 'triggered', trigger: 'turn' };
        }
      }
    }

    // Ko'z ma'lumoti BOR, lekin juda uzoq blink kuzatilmadi — jonsiz yuz
    // (qog'oz rasm / telefon ekrani) gumoni. Haqiqiy odam blink qilishi
    // bilan yuqoridagi trigger baribir ochiladi.
    if (hasEyeData && stableFor >= cfg.spoofAfterMs) {
      return { status: 'spoof_suspected', trigger: null };
    }

    return {
      status: stableFor >= cfg.longHoldMs ? 'hold_long' : 'hold',
      trigger: null,
    };
  }

  private resetStability(): void {
    this.stableSince = null;
    this.history = [];
  }
}
