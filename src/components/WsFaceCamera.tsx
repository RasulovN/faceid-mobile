/**
 * WsFaceCamera — WebSocket orqali REAL-TIME yuz tekshiruvi (native modulsiz!).
 *
 * Oqim: expo-camera kadrlarni (~1.5 kadr/s, past sifat) socket.io orqali
 * backend'ga yuboradi → face-service /analyze har kadrda yuzni topadi →
 * server yuz KVADRATINI (normalized bbox) va darvoza holatini qaytaradi →
 * komponent kvadratni ekranga chizadi (cover-fit + old kamera oyna aksi).
 *
 * Server jonlilik darvozasi (blink yoki bosh burilishi) dalil ko'rgandagina
 * to'liq verifikatsiyani boshlaydi — kamera oldida odam bo'lmasa yoki statik
 * rasm turgan bo'lsa identifikatsiya/DB tekshiruvi UMUMAN ishlamaydi.
 * Natija `face:result` eventida keladi.
 */
import { CameraView } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { Socket } from 'socket.io-client';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createFaceSocket } from '@/lib/faceSocket';
import type { LiveLocation } from '@/hooks/useLiveLocation';
import type { AttendanceType } from '@/types/api';

export interface WsFaceCameraProps {
  location: LiveLocation;
  type: AttendanceType;
  /** Darvoza holati: connecting | no_face | too_small | off_center | multiple | hold | hold_long | verifying */
  onStatus: (state: string) => void;
  /** Sessiya boshlanishi rad etildi (geofence/obuna/debounce/...) */
  onFatalStart: (err: ApiError) => void;
  /** Verifikatsiya urinishi muvaffaqiyatsiz (terminal=true — sessiya yopildi) */
  onFailure: (err: ApiError, terminal: boolean) => void;
  onSuccess: (eventTimestamp?: string) => void;
  /** WS ulanib bo'lmadi / uzildi — chaqiruvchi legacy rejimga o'tadi */
  onUnavailable: () => void;
}

interface FrameAck {
  state?: string;
  box?: { x: number; y: number; width: number; height: number } | null;
  landmarks?: number[][] | null;
  roll?: number | null;
  frameWidth?: number;
  frameHeight?: number;
  liveness?: { progress?: number; passiveOk?: boolean };
  processingMs?: number;
}

interface HudState {
  connected: boolean;
  fps: number;
  latencyMs: number;
  progress: number;
}

interface ResultPayload {
  ok?: boolean;
  code?: string;
  message?: string;
  details?: unknown;
  terminal?: boolean;
  event?: { timestamp?: string };
}

const FRAME_QUALITY = 0.35;
/** Yuz ko'rinib turganda kadrlar orasidagi qisqa nafas (tez kuzatuv). */
const LOOP_BREATH_MS = 30;
/** Yuz KO'RINMAYOTGANDA sekin rejim — kamera bekorga band bo'lmasin. */
const IDLE_BREATH_MS = 1200;
/** Shuncha ketma-ket "yuz yo'q" kadrdan keyin sekin rejimga o'tiladi. */
const IDLE_AFTER_NO_FACE = 4;
const NET_FAIL_LIMIT = 3;
/** Oqim surati uchun uzun tomon chegaralari (piksel) — KICHIK = TEZ. */
const MIN_PICTURE_LONG_SIDE = 320;
const MAX_PICTURE_LONG_SIDE = 1024;

/**
 * Mavjud surat o'lchamlaridan oqim uchun ENG MOSINI tanlaydi:
 * 1) aspekt nisbati EKRANGA eng yaqin bo'lsin — surat va preview bir xil
 *    ko'rish maydonini (FOV) qamrasin, aks holda overlay (kvadrat/nuqtalar)
 *    vertikal siljiydi (masalan 4:3 surat vs 16:9 preview);
 * 2) shu aspektlar ichida ENG KICHIGI (tez capture + kichik payload).
 */
function pickStreamPictureSize(
  sizes: string[],
  screenRatio: number, // min(w,h)/max(w,h), masalan ~0.46
): string | undefined {
  let best: { size: string; aspectDiff: number; longSide: number } | null = null;
  for (const size of sizes) {
    const [a, b] = size.split('x').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    const longSide = Math.max(a, b);
    if (longSide < MIN_PICTURE_LONG_SIDE || longSide > MAX_PICTURE_LONG_SIDE) continue;
    const ratio = Math.min(a, b) / Math.max(a, b);
    const aspectDiff = Math.abs(ratio - screenRatio);
    if (
      !best ||
      aspectDiff < best.aspectDiff - 0.02 ||
      (Math.abs(aspectDiff - best.aspectDiff) <= 0.02 && longSide < best.longSide)
    ) {
      best = { size, aspectDiff, longSide };
    }
  }
  return best?.size;
}

const BOX_COLORS = {
  searching: 'rgba(255,255,255,0.9)',
  adjust: '#F59E0B',
  ready: '#6366F1',
  verifying: '#10B981',
} as const;

/** Bitta capture uchun maksimal kutish — undan oshsa kadr tashlanadi. */
const CAPTURE_TIMEOUT_MS = 4000;
/** Shuncha ketma-ket capture muvaffaqiyatsizligi → kamera qayta MOUNT qilinadi. */
const CAPTURE_FAIL_REMOUNT = 3;
/** 'verifying' holati shu vaqtdan uzoq davom etsa sessiya qayta ochiladi. */
const VERIFY_WATCHDOG_MS = 25_000;
/** WS ulanish urinishlari (birinchisi + qayta urinishlar). */
const CONNECT_ATTEMPTS = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// expo-file-system bo'lsa oqim suratlarining vaqtinchalik fayllarini o'chirib
// boramiz (disk to'lib qolmasin); native modul bo'lmasa jimgina o'tamiz.
let FileSystemMod: { deleteAsync?: (uri: string, o?: { idempotent?: boolean }) => Promise<void> } | null =
  null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  FileSystemMod = require('expo-file-system/legacy') as typeof FileSystemMod;
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FileSystemMod = require('expo-file-system') as typeof FileSystemMod;
  } catch {
    FileSystemMod = null;
  }
}

function cleanupPhotoFile(uri: string | undefined): void {
  if (!uri || !FileSystemMod?.deleteAsync) return;
  FileSystemMod.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export function WsFaceCamera({
  location,
  type,
  onStatus,
  onFatalStart,
  onFailure,
  onSuccess,
  onUnavailable,
}: WsFaceCameraProps): React.ReactElement {
  const window = useWindowDimensions();
  // MUHIM: overlay koordinatalari uchun konteynerning REAL o'lchami kerak —
  // Android'da useWindowDimensions navigatsiya paneli tufayli farq qilishi
  // mumkin edi (nuqtalar/kvadrat vertikal siljib ketardi). onLayout aniq beradi.
  const [layout, setLayout] = useState({ width: window.width, height: window.height });
  const screenW = layout.width;
  const screenH = layout.height;

  const cameraRef = useRef<CameraView>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  // Kamera "qotib qolsa" (capture javob bermasa) key bump bilan qayta mount
  const [cameraKey, setCameraKey] = useState(0);
  // Ilova fonga o'tganda oqim pauza qilinadi (capture xatolari yog'masin)
  const appActiveRef = useRef(true);
  // Yuz mesh nuqtalari — KVADRAT ICHIDA foiz koordinatalarda: shunda ular
  // silliqlangan kvadrat bilan BIRGA harakatlanadi/masshtablanadi/aylanadi.
  const [dots, setDots] = useState<{ leftPct: number; topPct: number }[]>([]);
  const [hud, setHud] = useState<HudState>({
    connected: false,
    fps: 0,
    latencyMs: 0,
    progress: 0,
  });
  const frameTimesRef = useRef<number[]>([]);
  // Bashoratli kuzatuv uchun oxirgi server kvadrati (ekran koordinatalarida)
  const lastBoxRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    t: number;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const stoppedRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const verifyingRef = useRef(false);
  const doneRef = useRef(false); // terminal holat — boshqa callback otilmasin
  const unavailableFiredRef = useRef(false);

  // Callback'larni ref'da ushlaymiz — stream sikli qayta yaratilmaydi
  const cbRef = useRef({ onStatus, onFatalStart, onFailure, onSuccess, onUnavailable });
  cbRef.current = { onStatus, onFatalStart, onFailure, onSuccess, onUnavailable };
  const locRef = useRef(location);
  locRef.current = location;
  const typeRef = useRef(type);
  typeRef.current = type;

  // --- Yuz ramkasi animatsiyasi (harakatga ergashadi) ---
  // DIQQAT: konteyner AYLANTIRILMAYDI — landmarklar kadrda allaqachon bosh
  // og'ishi bilan keladi; qo'shimcha rotatsiya nuqtalarni yuzdan siljitib
  // "tartibsiz" ko'rinishga olib kelardi. Bbox ham aslida o'qlarга parallel.
  const boxX = useSharedValue(screenW / 2 - 110);
  const boxY = useSharedValue(screenH / 2 - 140);
  const boxW = useSharedValue(220);
  const boxH = useSharedValue(260);
  const boxOpacity = useSharedValue(0);
  const boxColor = useSharedValue<string>(BOX_COLORS.searching);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boxX.value }, { translateY: boxY.value }],
    width: boxW.value,
    height: boxH.value,
    opacity: boxOpacity.value,
  }));

  // 4 burchak qavsining rangi (holatga qarab) — bitta animated style
  const cornerColorStyle = useAnimatedStyle(() => ({
    borderColor: boxColor.value,
  }));

  /**
   * Server javobi → ekran: bbox (cover-fit + old kamera oyna aksi), 106 ta
   * mesh nuqtasi, roll rotatsiyasi va HUD ko'rsatkichlari.
   */
  const applyAck = useCallback(
    (ack: FrameAck, latencyMs: number) => {
      const { box, frameWidth, frameHeight } = ack;

      // HUD: FPS (oxirgi 4s dagi kadrlar), latency, jonlilik progressi
      const now = Date.now();
      const times = frameTimesRef.current;
      times.push(now);
      while (times.length > 0 && times[0] < now - 4000) times.shift();
      setHud({
        connected: true,
        fps: Math.round((times.length / 4) * 10) / 10,
        latencyMs: Math.round(latencyMs),
        progress: ack.liveness?.progress ?? 0,
      });

      if (!box || !frameWidth || !frameHeight) {
        boxOpacity.value = withTiming(0, { duration: 250 });
        lastBoxRef.current = null; // yangi paydo bo'lishda bashorat sakramasin
        setDots([]);
        return;
      }
      const scale = Math.max(screenW / frameWidth, screenH / frameHeight);
      const offX = (frameWidth * scale - screenW) / 2;
      const offY = (frameHeight * scale - screenH) / 2;
      const w = box.width * frameWidth * scale;
      const h = box.height * frameHeight * scale;
      let x = box.x * frameWidth * scale - offX;
      const y = box.y * frameHeight * scale - offY;
      // Old kamera preview oynadagidek aks etadi, surat esa aks etmaydi —
      // kvadratni gorizontal aylantiramiz.
      x = screenW - x - w;

      // BASHORATLI KUZATUV (dead-reckoning): server yangilanishi ~300-500ms'da
      // bir keladi — kvadrat oxirgi siljish tezligini davom ettirib KEYINGI
      // pozitsiyaga qarab yuradi, natijada yuz ORQASIDAN emas, yuz BILAN
      // harakatlanadi. Katta sakrashlar clamp bilan cheklanadi (shovqin
      // kuchaymasligi uchun), eski (>800ms) ma'lumotda bashorat o'chadi.
      const prev = lastBoxRef.current;
      lastBoxRef.current = { x, y, w, h, t: now };

      let tx = x;
      let ty = y;
      let tw = w;
      let th = h;
      let dur = 260;
      if (prev) {
        const dt = now - prev.t;
        if (dt > 0 && dt < 800) {
          dur = Math.min(400, Math.max(100, dt));
          const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
          const maxShift = w * 0.4;
          // 1.4x kuchaytirilgan bashorat — harakatga "yetib olish" tezroq
          tx = x + clamp((x - prev.x) * 1.4, maxShift);
          ty = y + clamp((y - prev.y) * 1.4, maxShift);
          tw = w + clamp((w - prev.w) * 1.2, w * 0.2);
          th = h + clamp((h - prev.h) * 1.2, h * 0.2);
        }
      }

      // Chiziqli easing — uzluksiz kuzatuvda tekis, "pulsatsiz" harakat.
      const cfg = { duration: dur, easing: Easing.linear };
      boxX.value = withTiming(tx, cfg);
      boxY.value = withTiming(ty, cfg);
      boxW.value = withTiming(tw, cfg);
      boxH.value = withTiming(th, cfg);
      boxOpacity.value = withTiming(1, { duration: 150 });

      // 106 mesh nuqtasi — bbox'ga NISBATAN foizda (kvadrat konteyner ichida
      // render qilinadi, shuning uchun kvadrat qayoqqa silliq yurса nuqtalar
      // ham birga yuradi; gorizontal oyna aksi shu yerda qo'llanadi).
      if (ack.landmarks && ack.landmarks.length > 0 && box.width > 0 && box.height > 0) {
        setDots(
          ack.landmarks.map(([nx, ny]) => ({
            leftPct: (1 - (nx - box.x) / box.width) * 100,
            topPct: ((ny - box.y) / box.height) * 100,
          })),
        );
      } else {
        setDots([]);
      }

      const state = ack.state ?? 'no_face';
      boxColor.value =
        state === 'hold' || state === 'hold_long'
          ? BOX_COLORS.ready
          : state === 'verifying'
            ? BOX_COLORS.verifying
            : BOX_COLORS.adjust;
    },
    [screenW, screenH, boxX, boxY, boxW, boxH, boxOpacity, boxColor],
  );

  const fireUnavailable = useCallback(() => {
    if (unavailableFiredRef.current || doneRef.current) return;
    unavailableFiredRef.current = true;
    cbRef.current.onUnavailable();
  }, []);

  // Fon/oldinga o'tishlar: fonда oqim to'xtaydi, qaytganda kamera YANGIDAN
  // mount qilinadi (Android'da fon'dan keyin qora/qotgan preview'ning davosi).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      const wasActive = appActiveRef.current;
      appActiveRef.current = active;
      if (active && !wasActive && !stoppedRef.current && !doneRef.current) {
        cameraReadyRef.current = false;
        setCameraKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    let netFails = 0;

    /** Sessiya boshlash — muvaffaqiyatda stream sikli ishga tushadi. */
    const startSession = async (socket: Socket): Promise<boolean> => {
      const loc = locRef.current;
      try {
        const ack = (await socket.timeout(8000).emitWithAck('face:start', {
          type: typeRef.current,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy ?? 0,
          isMockLocation: loc.mocked,
        })) as { ok?: boolean; code?: string; message?: string; details?: unknown };
        if (ack?.ok) return true;
        doneRef.current = true;
        cbRef.current.onFatalStart(
          new ApiError(ack?.code ?? 'UNKNOWN', ack?.message ?? t('errGeneric'), 0, ack?.details),
        );
        return false;
      } catch {
        fireUnavailable();
        return false;
      }
    };

    /**
     * Bitta kadr olish (ovozsiz, TEZ) — TIMEOUT himoyasi bilan: native capture
     * osilib qolsa kadr tashlanadi, oqim hech qachon qotmaydi.
     */
    const captureFrame = async (): Promise<{ base64?: string; uri?: string } | undefined> => {
      const camera = cameraRef.current;
      if (!camera || stoppedRef.current || !appActiveRef.current) return undefined;
      try {
        const photo = await Promise.race([
          camera.takePictureAsync({
            quality: FRAME_QUALITY,
            base64: true,
            shutterSound: false,
            // Orientatsiya qayta ishlovini O'TKAZIB YUBORAMIZ (~150-250ms
            // tejaladi); server sessiya boshida rotatsiyani kalibrlab oladi.
            skipProcessing: true,
          }),
          delay(CAPTURE_TIMEOUT_MS).then(() => undefined),
        ]);
        if (!photo?.base64) return undefined;
        return { base64: photo.base64, uri: photo.uri };
      } catch {
        return undefined;
      }
    };

    const streamLoop = async (socket: Socket): Promise<void> => {
      // Ketma-ket "yuz yo'q" kadrlar soni — adaptiv kadensiya uchun
      let noFaceStreak = 0;
      // Ketma-ket capture muvaffaqiyatsizliklari — kamera avto-tiklash uchun
      let captureFails = 0;
      // Verifying holati boshlanган vaqt — natija yo'qolsa watchdog qutqaradi
      let verifyingSince = 0;
      // QUVUR (pipeline): server javobini kutish paytida KEYINGI kadr olinadi —
      // samarali tezlik yig'indi emas, eng sekin bosqichga teng bo'ladi.
      let nextCapture: Promise<{ base64?: string; uri?: string } | undefined> | null = null;
      /** Ishlatilmay qoladigan quvur kadrining faylini ham tozalaymiz. */
      const discardNext = (): void => {
        nextCapture?.then((c) => cleanupPhotoFile(c?.uri)).catch(() => undefined);
        nextCapture = null;
      };

      while (!stoppedRef.current && !doneRef.current && socket.connected) {
        if (!appActiveRef.current) {
          // Ilova fonda — oqim pauza (qaytganda kamera remount bo'ladi)
          discardNext();
          await delay(400);
          continue;
        }
        if (verifyingRef.current) {
          discardNext();
          if (verifyingSince === 0) verifyingSince = Date.now();
          // WATCHDOG: server natijasi yo'qolgan (crash/paket yo'qolishi) —
          // sessiyani qayta ochib oqimni davom ettiramiz, ilova QOTMAYDI.
          if (Date.now() - verifyingSince > VERIFY_WATCHDOG_MS) {
            verifyingRef.current = false;
            verifyingSince = 0;
            try {
              socket.emit('face:stop');
            } catch {
              /* yopilgan socket */
            }
            const ok = await startSession(socket);
            if (!ok) break;
          }
          await delay(250);
          continue;
        }
        verifyingSince = 0;
        if (!cameraReadyRef.current) {
          discardNext();
          await delay(250);
          continue;
        }

        const captured = await (nextCapture ?? captureFrame());
        nextCapture = null;
        if (stoppedRef.current || doneRef.current) break;
        if (!captured?.base64) {
          // Kamera javob bermayapti — bir necha urinishdan keyin qayta MOUNT
          captureFails += 1;
          if (captureFails >= CAPTURE_FAIL_REMOUNT) {
            captureFails = 0;
            cameraReadyRef.current = false;
            setCameraKey((k) => k + 1);
          }
          await delay(300);
          continue;
        }
        captureFails = 0;
        const base64 = captured.base64;

        const sentAt = Date.now();
        const ackPromise = socket
          .timeout(8000)
          .emitWithAck('face:frame', { image: base64 }) as Promise<FrameAck>;
        // Vaqtinchalik surat fayli endi kerak emas — diskni toza tutamiz
        cleanupPhotoFile(captured.uri);
        // Parallel: javob kelguncha keyingi kadr tayyorlanadi
        if (!verifyingRef.current) nextCapture = captureFrame();

        let ack: FrameAck;
        try {
          ack = await ackPromise;
          netFails = 0;
        } catch {
          netFails += 1;
          if (netFails >= NET_FAIL_LIMIT) {
            netFails = 0;
            cbRef.current.onFailure(new ApiError('NETWORK_ERROR', t('errNetwork'), 0), false);
          }
          await delay(400);
          continue;
        }

        if (stoppedRef.current || doneRef.current) break;

        if (ack?.state === 'no_session') {
          // Backend qayta ishga tushgan bo'lishi mumkin — sessiyani qayta ochamiz
          const ok = await startSession(socket);
          if (!ok) break;
          continue;
        }
        // Server band edi (quvurdagi ortiqcha kadr) — UI holatiga tegmaymiz
        if (ack?.state === 'skipped') continue;

        applyAck(ack, Date.now() - sentAt);
        if (ack?.state === 'verifying') {
          verifyingRef.current = true;
        }
        cbRef.current.onStatus(ack?.state ?? 'no_face');

        // ADAPTIV KADENSIYA: yuz ko'rinmasa kamera sekin rejimga o'tadi —
        // "tinimsiz suratga olish" bo'lmaydi; yuz paydo bo'lishi bilan tezlashadi.
        noFaceStreak = ack?.state === 'no_face' ? noFaceStreak + 1 : 0;
        if (noFaceStreak >= IDLE_AFTER_NO_FACE) {
          discardNext(); // eskirgan quvur kadri kerak emas
          await delay(IDLE_BREATH_MS);
        } else {
          await delay(LOOP_BREATH_MS);
        }
      }
    };

    const boot = async (): Promise<void> => {
      cbRef.current.onStatus('connecting');
      let socket: Socket;
      try {
        socket = await createFaceSocket();
      } catch {
        fireUnavailable();
        return;
      }
      socketRef.current = socket;

      socket.on('face:result', (payload: ResultPayload) => {
        if (stoppedRef.current || doneRef.current) return;
        if (payload?.ok) {
          doneRef.current = true;
          cbRef.current.onSuccess(payload.event?.timestamp);
          return;
        }
        const err = new ApiError(
          payload?.code ?? 'UNKNOWN',
          payload?.message ?? t('errGeneric'),
          0,
          payload?.details,
        );
        if (payload?.terminal) {
          doneRef.current = true;
          cbRef.current.onFailure(err, true);
          return;
        }
        // Sessiya davom etadi — server darvozani qayta qurollantirgan
        verifyingRef.current = false;
        cbRef.current.onFailure(err, false);
      });

      // Bir martalik tarmoq uzilishi darhol taslim qilmasin — qayta urinish
      let connectTries = 0;
      socket.on('connect_error', () => {
        connectTries += 1;
        if (connectTries < CONNECT_ATTEMPTS && !stoppedRef.current && !doneRef.current) {
          setTimeout(() => {
            if (!stoppedRef.current && !doneRef.current) socket.connect();
          }, 900);
          return;
        }
        fireUnavailable();
      });
      socket.on('disconnect', () => {
        setHud((h) => ({ ...h, connected: false }));
        if (!stoppedRef.current && !doneRef.current) fireUnavailable();
      });

      // Guard: reconnect'da 'connect' qayta otilsa ikkinchi parallel sikl ochilmasin
      let loopRunning = false;
      socket.on('connect', () => {
        void (async () => {
          if (loopRunning) return;
          loopRunning = true;
          try {
            const ok = await startSession(socket);
            if (ok) await streamLoop(socket);
          } finally {
            loopRunning = false;
          }
        })();
      });
    };

    void boot();

    return () => {
      stoppedRef.current = true;
      const socket = socketRef.current;
      if (socket) {
        try {
          socket.emit('face:stop');
        } catch {
          /* yopilayotgan socket — e'tiborsiz */
        }
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setLayout({ width, height });
      }}
    >
      <CameraView
        key={cameraKey}
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
        animateShutter={false}
        pictureSize={pictureSize}
        onCameraReady={() => {
          cameraReadyRef.current = true;
          // Oqim uchun EKRAN ASPEKTIGA MOS kichik surat o'lchamini tanlaymiz —
          // surat va preview FOV'i mos bo'lsa overlay aniq o'tiradi.
          void (async () => {
            try {
              const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
              const { width, height } = layoutRef.current;
              const ratio = Math.min(width, height) / Math.max(width, height);
              const chosen = sizes ? pickStreamPictureSize(sizes, ratio) : undefined;
              if (chosen) setPictureSize(chosen);
            } catch {
              /* ba'zi qurilmalarda mavjud emas — default o'lcham qoladi */
            }
          })();
        }}
      />
      {/* Yuz ramkasi: FAQAT 4 burchak qavsi (professional skaner uslubi,
          yon chiziqlarsiz) + ICHIDAGI mesh nuqtalari — foiz koordinatalarda,
          ramka silliq harakatlanganda nuqtalar birga yuradi */}
      <Animated.View pointerEvents="none" style={[styles.faceBox, boxStyle]}>
        <Animated.View style={[styles.corner, styles.cornerTL, cornerColorStyle]} />
        <Animated.View style={[styles.corner, styles.cornerTR, cornerColorStyle]} />
        <Animated.View style={[styles.corner, styles.cornerBL, cornerColorStyle]} />
        <Animated.View style={[styles.corner, styles.cornerBR, cornerColorStyle]} />
        {dots.map((d, i) => (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            style={[styles.meshDot, { left: `${d.leftPct}%`, top: `${d.topPct}%` }]}
          />
        ))}
      </Animated.View>

      {/* HUD: ulanish / FPS / latency / jonlilik progressi */}
      <View pointerEvents="none" style={styles.hud}>
        <View style={[styles.hudDot, { backgroundColor: hud.connected ? '#10B981' : '#F43F5E' }]} />
        <Text style={styles.hudText}>
          {hud.fps.toFixed(1)} fps · {hud.latencyMs} ms · {Math.round(hud.progress * 100)}%
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  faceBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Jag'/kontur nuqtalari bbox chetidan biroz chiqishi mumkin
    overflow: 'visible',
  },
  // 4 burchak qavsi — har biri ikki tomonlama border (yon chiziqlar YO'Q)
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
  },
  cornerTL: {
    top: -3,
    left: -3,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  cornerTR: {
    top: -3,
    right: -3,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  cornerBL: {
    bottom: -3,
    left: -3,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  cornerBR: {
    bottom: -3,
    right: -3,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  meshDot: {
    position: 'absolute',
    width: 3,
    height: 3,
    marginLeft: -1.5,
    marginTop: -1.5,
    borderRadius: 1.5,
    backgroundColor: 'rgba(165,180,252,0.95)', // indigo-300 — aniq ko'rinadi
  },
  hud: {
    position: 'absolute',
    left: 12,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  hudDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  hudText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
