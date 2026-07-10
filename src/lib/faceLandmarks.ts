/**
 * MediaPipe Face Landmarker frame-processor pluginiga JS kirish nuqtasi.
 *
 * DIQQAT: bu modul vision-camera'ni STATIK import qiladi — uni FAQAT
 * isVisionCameraAvailable() true bo'lgandan keyin runtime `require` bilan
 * yuklash kerak (check.tsx shunday qiladi), aks holda eski (vision-camera'siz)
 * buildda ilova yiqilishi mumkin.
 *
 * Plugin lokal `modules/vision-camera-face-landmarks` paketida (Android/iOS
 * native kod, Google MediaPipe Tasks SDK). U yo'q buildda
 * initFrameProcessorPlugin null qaytaradi — chaqiruvchi MLKit rejimiga tushadi.
 */
import { VisionCameraProxy } from 'react-native-vision-camera';
import type { FrameProcessorPlugin } from 'react-native-vision-camera';

/** Normallashgan (0..1) yuz to'rtburchagi — mesh chegarasi */
export interface FaceLandmarksBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Native plugin bitta kadr uchun qaytaradigan natija */
export interface FaceLandmarksResult {
  /** Upright (portret) kadr kengligi, px */
  width?: number;
  /** Upright (portret) kadr balandligi, px */
  height?: number;
  /** Yuz topilmasa undefined */
  face?: FaceLandmarksBox;
  /**
   * Ko'z yumuqlik skori (0 — aniq ochiq, 1 — aniq yumuq) — MediaPipe
   * `eyeBlinkLeft/Right` blendshape'larining o'rtachasi; -1 — ma'lumot yo'q.
   */
  blink?: number;
  /** Tekis massiv [x0,y0,x1,y1,...] — normallashgan mesh nuqtalari (siyraklashtirilgan) */
  landmarks?: number[];
  /** Native tomonda model yuklanmagan (masalan, .task fayl yo'q) */
  unavailable?: boolean;
}

let cachedPlugin: FrameProcessorPlugin | null | undefined;

/**
 * Pluginni bir marta yaratadi (native tomonda FaceLandmarker + model yuklanadi
 * — kioskdagi warmup kabi bir martalik ish). Plugin native buildda yo'q
 * bo'lsa null.
 */
export function getFaceLandmarksPlugin(): FrameProcessorPlugin | null {
  if (cachedPlugin !== undefined) return cachedPlugin;
  try {
    cachedPlugin =
      VisionCameraProxy.initFrameProcessorPlugin('detectFaceLandmarks', {}) ?? null;
  } catch {
    cachedPlugin = null;
  }
  return cachedPlugin;
}

/** MediaPipe rejimi shu buildda mavjudmi (native plugin ro'yxatda bormi) */
export function isFaceLandmarksAvailable(): boolean {
  return getFaceLandmarksPlugin() !== null;
}
