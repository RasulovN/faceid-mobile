/**
 * MpFaceCamera — Google MediaPipe Face Landmarker bilan real-vaqt Face ID
 * kamerasi (kioskdagi faceDetect.ts bilan bir xil model va semantika):
 *
 *  - native frame-processor plugin ('detectFaceLandmarks', lokal
 *    modules/vision-camera-face-landmarks paketi) har kadrda 478 nuqtali
 *    mesh + `eyeBlinkLeft/Right` blendshape skorlarini beradi;
 *  - blink skori ko'z holatini MAXSUS O'QITILGAN modeldan oladi — statik
 *    rasm/ekran qancha qimirlatilsa ham "yumuq" bo'lib ketmaydi (MLKit
 *    eyeOpenProbability'dan ko'ra barqarorroq, kioskda isbotlangan);
 *  - suratga olish FAQAT FaceGate jonlilik dalilini (tabiiy ko'z yumish)
 *    kuzatgandagina — blink paytida 3 kadr OVOZSIZ olinadi (birinchisi ko'z
 *    yumuq payt — serverdagi EAR tekshiruviga fotografik dalil);
 *  - mesh nuqtalari va yuz ramkasi UI-thread'da chiziladi (LiveFaceCamera
 *    bilan bir xil pool texnikasi — React re-render YO'Q).
 *
 * DIQQAT: bu fayl check.tsx'dan faqat runtime `require` bilan yuklanadi
 * (isVisionCameraAvailable() va isFaceLandmarksAvailable() true bo'lganda) —
 * eski buildlarda native modul yo'qligi ilovani yiqitmasligi uchun.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Camera,
  runAtTargetFps,
  useCameraDevice,
  useCameraFormat,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import {
  getFaceLandmarksPlugin,
  type FaceLandmarksResult,
} from '@/lib/faceLandmarks';
import { FaceGate, type GateStatus, type GateTrigger } from '@/lib/faceGate';
import type { LiveFaceCameraProps } from '@/components/LiveFaceCamera';

/** Front kamera ro'yxatda paydo bo'lishini shuncha kutamiz (ms). */
const DEVICE_WAIT_MS = 1500;

/** 2 kadr = minimal to'liq burst: 1-kadr blink paytida (yopiq ko'z — EAR
 * dalili), 2-kadr ~300ms keyin (ochiq ko'z). Server burst chegarasi kadr
 * soniga moslashadi (min_valid_frames = min(3, len)) — izchillik, passiv
 * anti-spoof va blink-challenge qatlamlari TO'LIQ saqlanadi, lekin capture,
 * yuklash va server ishi ~33% kamayadi (kiosk tezligiga yaqin). */
const BURST_SIZE = 2;
const BURST_GAP_MS = 300;
/** Snapshot JPEG sifati — server 112px kropda ishlaydi; snapshot ekran
 * o'lchamida (~1080p) chiqadi, 60 sifat yuklamani ~2x kichraytiradi
 * (yangi buildda submitFrames baribir 640px ga resize qiladi). */
const SNAPSHOT_QUALITY = 60;
/** MediaPipe tahlil chastotasi — kioskga yaqin silliq kuzatuv; sekin
 * qurilmada inference o'zi chastotani tabiiy cheklaydi (kadr tushib qoladi). */
const TARGET_FPS = 30;
/** Native'dan har nechanchi mesh nuqtasi olinadi. 2 = har ikkinchi nuqta
 * (239 ta) — TEZLIK uchun: har nuqta alohida Animated.View bo'lib, UI-thread'da
 * har kadrda qayta hisoblanadi (kiosk esa bitta canvas'da chizadi). Mobil
 * qurilma kiosk'dan zaifroq — nuqtani 2x kamaytirish bridge yuki, EMA va
 * overlay hisobini yarmiga tushiradi; zichlik ko'zга deyarli bir xil.
 * Kuchli qurilmada 1 ga tushirsa 478 ta (kioskdek) to'liq mesh bo'ladi. */
const LANDMARK_STEP = 2;
/** Overlay nuqtalari pool o'lchami — LANDMARK_STEP=2'da native yuboradigan
 * nuqtalar soni (478 mesh / 2). LANDMARK_STEP'ni o'zgartirsa mos ravishda
 * ceil(478 / LANDMARK_STEP) qilib yangilang. */
const MAX_MESH_DOTS = 239;
/** Nuqta EMA silliqlash: yangi o'lchov ulushi (LiveFaceCamera bilan bir xil) */
const MESH_ALPHA = 0.6;
/** Ramka kuzatuv animatsiyasi davomiyligi chegaralari (ms) */
const BOX_MIN_DUR = 60;
const BOX_MAX_DUR = 240;
/** Ramka mesh chegarasidan biroz TOR (kioskdagi -5.5% pad kabi) — detektor
 * bbox'i yuzdan kengroq ko'rinmasin */
const BOX_PAD_RATIO = -0.055;
/** Native shuncha marta ketma-ket 'unavailable' desa — MLKit rejimiga tushamiz */
const UNAVAILABLE_LIMIT = 8;

/**
 * Blendshape blink chegaralari — kiosk LivenessGate (close 0.5 / open 0.28)
 * bilan mos: FaceGate eyeOpen = 1 - blink bilan ishlaydi, ya'ni
 * "aniq ochiq" blink ≤ 0.28, "yumuq" blink ≥ 0.55.
 */
const MEDIAPIPE_GATE_CONFIG = {
  eyeOpenHigh: 0.72,
  eyeOpenLow: 0.45,
} as const;

/** Ramka rangi holatga qarab (LiveFaceCamera bilan bir xil palitra) */
const BOX_COLORS: Record<'searching' | 'adjust' | 'ready' | 'captured' | 'spoof', string> = {
  searching: 'rgba(255,255,255,0.9)',
  adjust: '#F59E0B', // amber — yaqinlashing/markazlang
  ready: '#6366F1', // indigo — barqaror, jonlilik kutilmoqda
  captured: '#10B981', // emerald — kadrlar olindi
  spoof: '#F43F5E', // rose — insoniylik aniqlanmadi (rasm/ekran gumoni)
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mesh nuqtalari UI-thread holati: tekis massiv [x0,y0,x1,y1,...] + soni. */
interface MeshState {
  pts: number[];
  n: number;
}

const EMPTY_MESH: MeshState = { pts: [], n: 0 };

/** Pool indekslari — render'da map uchun bir marta yaratiladi. */
const DOT_POOL: number[] = Array.from({ length: MAX_MESH_DOTS }, (_, i) => i);

/**
 * Bitta mesh nuqtasi — pozitsiyani to'g'ridan-to'g'ri shared value'dan
 * UI-thread'da oladi (LiveFaceCamera'dagi MeshDot bilan bir xil).
 */
const MeshDot = React.memo(function MeshDot({
  mesh,
  index,
}: {
  mesh: SharedValue<MeshState>;
  index: number;
}): React.ReactElement {
  const style = useAnimatedStyle(() => {
    const m = mesh.value;
    if (index >= m.n) {
      return { opacity: 0, transform: [{ translateX: -100 }, { translateY: -100 }] };
    }
    return {
      opacity: 1,
      transform: [
        { translateX: m.pts[index * 2] },
        { translateY: m.pts[index * 2 + 1] },
      ],
    };
  });
  return <Animated.View style={[styles.meshDot, style]} />;
});

export type MpFaceCameraProps = LiveFaceCameraProps;

export function MpFaceCamera({
  paused,
  onStatus,
  onBurst,
  onUnavailable,
}: MpFaceCameraProps): React.ReactElement | null {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const device = useCameraDevice('front');
  // Tahlil oqimi 720p yetarli (MediaPipe ichkarida 192px'da ishlaydi);
  // snapshot ham shu oqimdan olinadi — server 112px kropiga mo'l-ko'l.
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1280, height: 720 } },
  ]);
  const plugin = useMemo(() => getFaceLandmarksPlugin(), []);

  // Front kamera hech topilmasa — chaqiruvchi keyingi rejimga o'tsin
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  useEffect(() => {
    if (device) return;
    const timer = setTimeout(() => {
      onUnavailableRef.current?.();
    }, DEVICE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [device]);

  const cameraRef = useRef<Camera>(null);
  const gateRef = useRef(new FaceGate(MEDIAPIPE_GATE_CONFIG));
  const capturingRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastStatusRef = useRef<GateStatus | null>(null);
  const lastDetectAtRef = useRef(0);
  const unavailableStreakRef = useRef(0);
  const droppedRef = useRef(false);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onBurstRef = useRef(onBurst);
  onBurstRef.current = onBurst;

  // MUHIM: koordinata masshtabi konteynerning ANIQ o'lchamidan hisoblanadi
  // (Android navigatsiya paneli tufayli window o'lchami farq qilishi mumkin)
  const viewSizeRef = useRef({ width: windowWidth, height: windowHeight });

  // EMA silliqlash uchun oxirgi nuqta pozitsiyalari (JS tomonda saqlanadi)
  const meshPrevRef = useRef<number[]>([]);
  const mesh = useSharedValue<MeshState>(EMPTY_MESH);

  // --- Yuz ramkasi (kvadrat) animatsiyasi ---
  const boxX = useSharedValue(windowWidth / 2 - 110);
  const boxY = useSharedValue(windowHeight / 2 - 140);
  const boxW = useSharedValue(220);
  const boxH = useSharedValue(220);
  const boxOpacity = useSharedValue(0);
  const boxColor = useSharedValue<string>(BOX_COLORS.searching);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boxX.value }, { translateY: boxY.value }],
    width: boxW.value,
    height: boxH.value,
    opacity: boxOpacity.value,
    borderColor: boxColor.value,
  }));

  // Pauza tugagach (server javobidan keyin) darvoza qayta qurollanadi
  useEffect(() => {
    if (!paused) {
      gateRef.current.reset();
      capturingRef.current = false;
    }
  }, [paused]);

  const captureBurst = useCallback(async (trigger: GateTrigger) => {
    const camera = cameraRef.current;
    if (!camera || capturingRef.current) return;
    capturingRef.current = true;
    boxColor.value = BOX_COLORS.captured;
    try {
      const uris: string[] = [];
      for (let i = 0; i < BURST_SIZE; i += 1) {
        // Birinchi kadr DARHOL — blink triggeri ko'z yumuq paytda otiladi.
        let path: string;
        try {
          const snap = await camera.takeSnapshot({ quality: SNAPSHOT_QUALITY });
          path = snap.path;
        } catch {
          // Ba'zi qurilmalarda snapshot ishlamasligi mumkin — photo fallback
          const photo = await camera.takePhoto({
            flash: 'off',
            enableShutterSound: false,
          });
          path = photo.path;
        }
        uris.push(path.startsWith('file://') ? path : `file://${path}`);
        if (i < BURST_SIZE - 1) await delay(BURST_GAP_MS);
      }
      onBurstRef.current(uris, trigger);
    } catch {
      // Suratga olish xatosi — darvoza qayta qurollanadi, keyingi blinkda urinadi
      gateRef.current.reset();
      capturingRef.current = false;
    }
  }, [boxColor]);

  /**
   * Native natijani qabul qiladi (JS thread). Normallashgan koordinatalar
   * cover-fit qonuni bilan konteyner koordinatalariga o'tkaziladi va front
   * kamera previewi ko'zgu aksida bo'lgani uchun X o'qi teskarilanadi.
   */
  const handleResult = useCallback(
    (result: FaceLandmarksResult) => {
      if (droppedRef.current) return;

      // Native tomonda model yuklanmagan — bir necha kadrdan keyin fallback
      if (result.unavailable) {
        unavailableStreakRef.current += 1;
        if (unavailableStreakRef.current >= UNAVAILABLE_LIMIT) {
          droppedRef.current = true;
          onUnavailableRef.current?.();
        }
        return;
      }
      unavailableStreakRef.current = 0;

      const now = Date.now();
      const sinceLast = now - lastDetectAtRef.current;
      lastDetectAtRef.current = now;

      const { width: vw, height: vh } = viewSizeRef.current;
      const fw = result.width ?? 0;
      const fh = result.height ?? 0;
      const face = result.face;

      if (face && fw > 0 && fh > 0) {
        // Cover-fit: kadr konteynerni to'ldirguncha kattalashtiriladi
        const s = Math.max(vw / fw, vh / fh);
        const dx = (vw - fw * s) / 2;
        const dy = (vh - fh * s) / 2;
        const mapX = (nx: number) => vw - (nx * fw * s + dx); // ko'zgu aksi
        const mapY = (ny: number) => ny * fh * s + dy;

        const rawW = face.width * fw * s;
        const rawH = face.height * fh * s;
        const rawX = mapX(face.x + face.width); // ko'zguda o'ng chekka chapga aylanadi
        const rawY = mapY(face.y);

        // Ramka — chiziqli easing, davomiylik real kadr oralig'iga teng
        const pad = rawW * BOX_PAD_RATIO;
        const cfg = {
          duration: Math.min(BOX_MAX_DUR, Math.max(BOX_MIN_DUR, sinceLast)),
          easing: Easing.linear,
        };
        boxX.value = withTiming(rawX - pad, cfg);
        boxY.value = withTiming(rawY - pad, cfg);
        boxW.value = withTiming(rawW + pad * 2, cfg);
        boxH.value = withTiming(rawH + pad * 2, cfg);
        boxOpacity.value = withTiming(1, { duration: 150 });

        // Mesh nuqtalari — absolyut koordinatada, yengil EMA silliqlash bilan
        const lm = result.landmarks;
        if (lm && lm.length >= 2) {
          const n = Math.min(lm.length / 2, MAX_MESH_DOTS);
          const prev = meshPrevRef.current;
          const reuse = prev.length === n * 2;
          const next = new Array<number>(n * 2);
          for (let i = 0; i < n; i += 1) {
            const x = mapX(lm[i * 2]);
            const y = mapY(lm[i * 2 + 1]);
            next[i * 2] = reuse ? prev[i * 2] + (x - prev[i * 2]) * MESH_ALPHA : x;
            next[i * 2 + 1] = reuse ? prev[i * 2 + 1] + (y - prev[i * 2 + 1]) * MESH_ALPHA : y;
          }
          meshPrevRef.current = next;
          mesh.value = { pts: next, n };
        } else if (mesh.value.n !== 0) {
          meshPrevRef.current = [];
          mesh.value = EMPTY_MESH;
        }

        if (pausedRef.current || capturingRef.current) return;

        const blink = result.blink ?? -1;
        const gateResult = gateRef.current.push({
          present: true,
          multiple: false, // numFaces=1 — kioskdagi kabi eng katta yuz kuzatiladi
          centerX: (rawX + rawW / 2) / vw,
          centerY: (rawY + rawH / 2) / vh,
          widthRatio: rawW / vw,
          yaw: 0, // blendshape har doim bor — turn-fallback kerak emas
          eyeOpen: blink >= 0 ? 1 - blink : -1,
          timestamp: now,
        });

        // Ramka rangi holatga mos
        if (gateResult.status === 'hold' || gateResult.status === 'hold_long') {
          boxColor.value = BOX_COLORS.ready;
        } else if (gateResult.status === 'triggered') {
          boxColor.value = BOX_COLORS.captured;
        } else if (gateResult.status === 'spoof_suspected') {
          boxColor.value = BOX_COLORS.spoof;
        } else {
          boxColor.value = BOX_COLORS.adjust;
        }

        if (gateResult.status !== lastStatusRef.current) {
          lastStatusRef.current = gateResult.status;
          onStatusRef.current(gateResult.status);
        }

        if (gateResult.status === 'triggered') {
          void captureBurst(gateResult.trigger);
        }
      } else {
        boxOpacity.value = withTiming(0, { duration: 250 });
        if (mesh.value.n !== 0) {
          meshPrevRef.current = [];
          mesh.value = EMPTY_MESH;
        }
        if (pausedRef.current || capturingRef.current) return;
        const gateResult = gateRef.current.push({
          present: false,
          multiple: false,
          centerX: 0,
          centerY: 0,
          widthRatio: 0,
          yaw: 0,
          eyeOpen: -1,
          timestamp: now,
        });
        boxColor.value = BOX_COLORS.searching;
        if (gateResult.status !== lastStatusRef.current) {
          lastStatusRef.current = gateResult.status;
          onStatusRef.current(gateResult.status);
        }
      }
    },
    [boxX, boxY, boxW, boxH, boxOpacity, boxColor, mesh, captureBurst],
  );

  // Worklet'dan JS thread'ga sakrash uchun ko'prik
  const handleResultOnJS = useMemo(
    () => Worklets.createRunOnJS(handleResult),
    [handleResult],
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      if (plugin == null) return;
      runAtTargetFps(TARGET_FPS, () => {
        'worklet';
        const result = plugin.call(frame, { landmarkStep: LANDMARK_STEP });
        if (result != null) {
          void handleResultOnJS(result as unknown as FaceLandmarksResult);
        }
      });
    },
    [plugin, handleResultOnJS],
  );

  if (!device) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          viewSizeRef.current = { width, height };
        }
      }}
    >
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive
        photo
        photoQualityBalance="speed"
        // MUHIM: MediaPipe iOS'da faqat BGRA sample-buffer qabul qiladi
        // ('yuv' bilan "unsupported pixel format" bo'ladi); Android'da ham
        // RGBA kadr bitmap'ga arzonroq aylanadi.
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
      />
      {/* Yuz ramkasi — yuzga silliq ergashadi */}
      <Animated.View pointerEvents="none" style={[styles.faceBox, boxStyle]} />
      {/* Mesh nuqtalari pool'i — pozitsiyalar UI-thread'da yangilanadi */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {DOT_POOL.map((i) => (
          <MeshDot key={i} mesh={mesh} index={i} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  faceBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 3,
    borderRadius: 18,
  },
  meshDot: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Kiosk canvas nuqtalari bilan bir xil ko'rinish: 478 ta MAYDA oq nuqta
    // zich to'r bo'lib ko'rinadi (katta nuqtalar bu zichlikda qorishib ketadi)
    width: 2.5,
    height: 2.5,
    marginLeft: -1.25,
    marginTop: -1.25,
    borderRadius: 1.25,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
});
