/**
 * LiveFaceCamera — haqiqiy Face ID uslubidagi kamera:
 *
 *  - ML Kit (vision-camera frame processor) yuzni real-vaqtda kuzatadi;
 *  - 133 ta yuz kontur nuqtasi ABSOLYUT ekran koordinatalarida, Reanimated
 *    shared value orqali UI-thread'da chiziladi — React re-render YO'Q,
 *    kuzatuv ~30fps'da silliq va aniq (TF facemesh demo darajasida);
 *  - suratga olish FAQAT FaceGate jonlilik dalilini (tabiiy ko'z yumib-ochish)
 *    kuzatgandagina bo'ladi — statik rasm/ekran hech qachon suratga olinmaydi;
 *  - rasm/ekran ko'rsatilsa (uzoq vaqt blink yo'q) darvoza 'spoof_suspected'
 *    qaytaradi — UI "insoniylik aniqlanmadi" ko'rsatadi;
 *  - blink paytida 3 kadr OVOZSIZ olinadi (birinchisi ko'z yumuq payt —
 *    serverdagi EAR blink tekshiruviga fotografik dalil).
 *
 * DIQQAT: bu fayl check.tsx'dan faqat runtime `require` bilan yuklanadi
 * (isVisionCameraAvailable() true bo'lganda) — eski dev-client'da native
 * modul yo'qligi ilovani yiqitmasligi uchun.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { CameraDevice, Camera as VisionCameraType } from 'react-native-vision-camera';
import { useCameraDevice } from 'react-native-vision-camera';
import type { Face } from 'react-native-vision-camera-face-detector';
import { Camera as FaceDetectionCamera } from 'react-native-vision-camera-face-detector';
import { FaceGate, type GateStatus, type GateTrigger } from '@/lib/faceGate';

export interface LiveFaceCameraProps {
  /** true — darvoza to'xtaydi (server tekshirayotgan payt) */
  paused: boolean;
  /** Darvoza holati o'zgarganda (status pill matni uchun) */
  onStatus: (status: GateStatus) => void;
  /** Jonlilik dalili bilan olingan 3 kadr (file:// URI'lar) */
  onBurst: (uris: string[], trigger: GateTrigger) => void;
  /** Front kamera qurilmasi topilmasa (WS rejimga yumshoq o'tish uchun) */
  onUnavailable?: () => void;
}

/** Front kamera ro'yxatda paydo bo'lishini shuncha kutamiz (ms). */
const DEVICE_WAIT_MS = 1500;

const BURST_SIZE = 3;
const BURST_GAP_MS = 220;
/** Snapshot JPEG sifati — server 112px kropda ishlaydi; snapshot ekran
 * o'lchamida (~1080p) chiqadi, 60 sifat yuklamani ~2x kichraytiradi
 * (yangi buildda submitFrames baribir 640px ga resize qiladi). */
const SNAPSHOT_QUALITY = 60;
/** ML Kit natijalarini qabul qilish chastotasi (~30fps — silliq kuzatuv) */
const DETECT_THROTTLE_MS = 33;
/** ML Kit kontur nuqtalari soni: FACE(36) + qoshlar(20) + ko'zlar(32) +
 * lablar(38) + burun(5) + yonoqlar(2) = 133. Har guruh ichida qo'shni
 * nuqtalar orasiga oraliq nuqta qo'shilib zichlik ~2x oshiriladi (kiosk
 * mesh ko'rinishiga yaqin) — pool shu kengaytirilgan o'lchamda. */
const MAX_MESH_DOTS = 260;
/** Ramka ML Kit bbox'idan biroz TOR (kioskdagi kabi yuz kattaligiga mos —
 * detektor to'rtburchagi yuzdan kengroq ko'rinmasin) */
const BOX_PAD_RATIO = -0.04;
/** Nuqta EMA silliqlash: yangi o'lchov ulushi. ML Kit kontur jitter'ini
 * yo'qotadi, qo'shadigan kechikishi ~1 kadr (sezilmaydi). */
const MESH_ALPHA = 0.6;
/** Ramka kuzatuv animatsiyasi davomiyligi chegaralari (ms) */
const BOX_MIN_DUR = 60;
const BOX_MAX_DUR = 240;

/** Ramka rangi holatga qarab */
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
 * Bitta kontur nuqtasi — pozitsiyani to'g'ridan-to'g'ri shared value'dan
 * UI-thread'da oladi. mesh.value almashganda transformlar React'siz yangilanadi
 * — 133 nuqta 30fps'da ham JS oqimini umuman band qilmaydi.
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

export function LiveFaceCamera({
  paused,
  onStatus,
  onBurst,
  onUnavailable,
}: LiveFaceCameraProps): React.ReactElement | null {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const device: CameraDevice | undefined = useCameraDevice('front');

  // MUHIM: ML Kit autoMode koordinatalari shu o'lchamlarga masshtablanadi.
  // useWindowDimensions EMAS — Android'da navigatsiya paneli tufayli real
  // konteyner o'lchami farq qilib, ramka ham, nuqtalar ham vertikal siljib
  // "yuzdan pastda suzardi". onLayout konteynerning ANIQ o'lchamini beradi.
  const [viewSize, setViewSize] = useState({ width: windowWidth, height: windowHeight });

  // Front kamera hech topilmasa — LIVE rejim imkonsiz, chaqiruvchi WS'ga
  // o'tsin. Ro'yxat kechikib to'lishi mumkin, shuning uchun biroz kutamiz.
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  useEffect(() => {
    if (device) return;
    const timer = setTimeout(() => {
      onUnavailableRef.current?.();
    }, DEVICE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [device]);

  const cameraRef = useRef<VisionCameraType>(null);
  const gateRef = useRef(new FaceGate());
  const capturingRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const lastStatusRef = useRef<GateStatus | null>(null);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onBurstRef = useRef(onBurst);
  onBurstRef.current = onBurst;
  const lastDetectAtRef = useRef(0);
  // EMA silliqlash uchun oxirgi nuqta pozitsiyalari (JS tomonda saqlanadi)
  const meshPrevRef = useRef<number[]>([]);
  // Kontur nuqtalari — ABSOLYUT ekran koordinatalarida (kvadratga bog'lanmagan:
  // avvalgi "foiz-in-box" usulida nuqtalar orqada qolayotgan animatsiyalangan
  // ramkaga nisbatan chizilib, harakatda doim yuzdan siljigan bo'lardi).
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
        // takeSnapshot preview oqimidan oladi: to'liq o'lchamli takePhoto'dan
        // ~5-10x tezroq va fayl ~10x kichik (yuklash + server dekodlash tez).
        let path: string;
        try {
          const snap = await camera.takeSnapshot({ quality: SNAPSHOT_QUALITY });
          path = snap.path;
        } catch {
          // Ba'zi qurilmalarda snapshot ishlamasligi mumkin — to'liq photo fallback
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
      // takePhoto xatosi — darvozani qayta qurollantiramiz, keyingi blinkda urinadi
      gateRef.current.reset();
      capturingRef.current = false;
    }
  }, [boxColor]);

  const handleDetectedFaces = useCallback(
    (faces: Face[]) => {
      // ~30fps yetarli (blink fazasi ~100-150ms bemalol ilinadi); undan tez
      // kelgan natijalar JS oqimini bo'g'masligi uchun tashlanadi.
      const now = Date.now();
      const sinceLast = now - lastDetectAtRef.current;
      if (sinceLast < DETECT_THROTTLE_MS) return;
      lastDetectAtRef.current = now;

      // Eng katta yuz — asosiy (orqadagi kichik yuzlar e'tiborsiz)
      const primary = faces.reduce<Face | null>((best, f) => {
        const area = f.bounds.width * f.bounds.height;
        const bestArea = best ? best.bounds.width * best.bounds.height : 0;
        return area > bestArea ? f : best;
      }, null);

      if (primary) {
        // Ramka — chiziqli easing, davomiylik real kadr oralig'iga teng:
        // kvadrat yuz ORQASIDAN sudralmaydi, notekis pulsatsiya ham bo'lmaydi.
        const pad = primary.bounds.width * BOX_PAD_RATIO;
        const bx = primary.bounds.x - pad;
        const by = primary.bounds.y - pad;
        const bw = primary.bounds.width + pad * 2;
        const bh = primary.bounds.height + pad * 2;
        const cfg = {
          duration: Math.min(BOX_MAX_DUR, Math.max(BOX_MIN_DUR, sinceLast)),
          easing: Easing.linear,
        };
        boxX.value = withTiming(bx, cfg);
        boxY.value = withTiming(by, cfg);
        boxW.value = withTiming(bw, cfg);
        boxH.value = withTiming(bh, cfg);
        boxOpacity.value = withTiming(1, { duration: 150 });

        // Kontur nuqtalari — absolyut koordinatada, engil EMA silliqlash bilan
        // to'g'ridan-to'g'ri UI-thread'ga (setState yo'q). Har kontur guruhida
        // qo'shni nuqtalar orasiga oraliq nuqta qo'shiladi (sof vizual
        // interpolyatsiya): 133 → ~250 nuqta, kiosk mesh'iga yaqin zichlik.
        const contours = primary.contours;
        if (contours) {
          const groups = Object.values(contours).filter(Array.isArray) as {
            x: number;
            y: number;
          }[][];
          const pts: { x: number; y: number }[] = [];
          for (const group of groups) {
            for (let gi = 0; gi < group.length; gi += 1) {
              const p = group[gi];
              pts.push(p);
              const q = group[gi + 1];
              if (q) pts.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
            }
          }
          const n = Math.min(pts.length, MAX_MESH_DOTS);
          const prev = meshPrevRef.current;
          const reuse = prev.length === n * 2;
          const next = new Array<number>(n * 2);
          for (let i = 0; i < n; i += 1) {
            const x = pts[i].x;
            const y = pts[i].y;
            next[i * 2] = reuse ? prev[i * 2] + (x - prev[i * 2]) * MESH_ALPHA : x;
            next[i * 2 + 1] = reuse ? prev[i * 2 + 1] + (y - prev[i * 2 + 1]) * MESH_ALPHA : y;
          }
          meshPrevRef.current = next;
          mesh.value = { pts: next, n };
        } else if (mesh.value.n !== 0) {
          meshPrevRef.current = [];
          mesh.value = EMPTY_MESH;
        }
      } else {
        boxOpacity.value = withTiming(0, { duration: 250 });
        if (mesh.value.n !== 0) {
          meshPrevRef.current = [];
          mesh.value = EMPTY_MESH;
        }
      }

      if (pausedRef.current || capturingRef.current) return;

      const eyeL = primary?.leftEyeOpenProbability ?? -1;
      const eyeR = primary?.rightEyeOpenProbability ?? -1;
      const result = gateRef.current.push({
        present: primary != null,
        multiple: faces.length > 1,
        centerX: primary ? (primary.bounds.x + primary.bounds.width / 2) / viewSize.width : 0,
        centerY: primary ? (primary.bounds.y + primary.bounds.height / 2) / viewSize.height : 0,
        widthRatio: primary ? primary.bounds.width / viewSize.width : 0,
        yaw: primary?.yawAngle ?? 0,
        eyeOpen: eyeL >= 0 && eyeR >= 0 ? (eyeL + eyeR) / 2 : -1,
        timestamp: Date.now(),
      });

      // Ramka rangi holatga mos
      if (result.status === 'hold' || result.status === 'hold_long') {
        boxColor.value = BOX_COLORS.ready;
      } else if (result.status === 'triggered') {
        boxColor.value = BOX_COLORS.captured;
      } else if (result.status === 'spoof_suspected') {
        boxColor.value = BOX_COLORS.spoof;
      } else if (result.status === 'no_face') {
        boxColor.value = BOX_COLORS.searching;
      } else {
        boxColor.value = BOX_COLORS.adjust;
      }

      if (result.status !== lastStatusRef.current) {
        lastStatusRef.current = result.status;
        onStatusRef.current(result.status);
      }

      if (result.status === 'triggered') {
        void captureBurst(result.trigger);
      }
    },
    [viewSize.width, viewSize.height, boxX, boxY, boxW, boxH, boxOpacity, boxColor, mesh, captureBurst],
  );

  const faceDetectionOptions = useMemo(
    () => ({
      performanceMode: 'fast' as const,
      classificationMode: 'all' as const, // ko'z ochiqlik ehtimoli (blink) uchun
      landmarkMode: 'none' as const,
      // Yuz kontur nuqtalari (133 ta) — overlay'da chiziladi. ML Kit ularni
      // faqat eng katta yuz uchun hisoblaydi, 'fast' rejimda narxi past.
      contourMode: 'all' as const,
      trackingEnabled: false,
      minFaceSize: 0.15,
      cameraFacing: 'front' as const,
      // Natijalar konteyner koordinatalarida keladi (autoMode native masshtab)
      autoMode: true,
      windowWidth: viewSize.width,
      windowHeight: viewSize.height,
    }),
    [viewSize.width, viewSize.height],
  );

  if (!device) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) {
          setViewSize((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height },
          );
        }
      }}
    >
      <FaceDetectionCamera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        photo
        photoQualityBalance="speed"
        faceDetectionOptions={faceDetectionOptions}
        faceDetectionCallback={handleDetectedFaces}
      />
      {/* Yuz ramkasi — yuzga silliq ergashadi */}
      <Animated.View pointerEvents="none" style={[styles.faceBox, boxStyle]} />
      {/* Kontur nuqtalari pool'i — pozitsiyalar UI-thread'da yangilanadi */}
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
    // Kiosk canvas nuqtalari ko'rinishi: mayda oq nuqtalar zich to'r bo'ladi
    width: 2.5,
    height: 2.5,
    marginLeft: -1.25,
    marginTop: -1.25,
    borderRadius: 1.25,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
});
