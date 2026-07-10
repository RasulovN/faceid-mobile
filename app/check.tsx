import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { SuccessCheck } from '@/components/SuccessCheck';
import { getCurrentLocation, type LiveLocation } from '@/hooks/useLiveLocation';
import { useT } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { shrinkFrames } from '@/lib/frameShrink';
import { announce } from '@/lib/voice';
import { checkErrorMessage } from '@/lib/errors';
import { fmtTime } from '@/lib/format';
import { formatDistance, haversineMeters } from '@/lib/geo';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import type { AttendanceType, MobileCheckResponse } from '@/types/api';
import type { LiveFaceCameraProps } from '@/components/LiveFaceCamera';
import { WsFaceCamera } from '@/components/WsFaceCamera';
import type { GateStatus } from '@/lib/faceGate';
import { isVisionCameraAvailable } from '@/lib/visionCamera';

// VisionCamera native moduli BOR buildda — real-vaqt yuz kuzatuvi (on-device
// ML Kit yuz kvadrati + blink jonlilik darvozasi). Eski dev-client'da null
// bo'lib qoladi va ekran expo-camera fallback oqimida ishlaydi. Statik import
// EMAS: native modul yo'q buildda ilova yiqilmasligi uchun runtime require.
let LiveFaceCamera: React.ComponentType<LiveFaceCameraProps> | null = null;
try {
  if (isVisionCameraAvailable()) {
    LiveFaceCamera = (
      require('@/components/LiveFaceCamera') as typeof import('@/components/LiveFaceCamera')
    ).LiveFaceCamera;
  }
} catch {
  LiveFaceCamera = null;
}

// MediaPipe Face Landmarker plugini BOR buildda — kioskdagi kabi blendshape
// (eyeBlinkLeft/Right) blink darvozasi: LIVE (MLKit) dan ham ishonchliroq,
// shuning uchun eng yuqori ustuvor rejim. Plugin yo'q eski buildda null bo'lib
// qoladi va ekran MLKit LIVE oqimiga tushadi. Statik import EMAS: native modul
// yo'q buildda ilova yiqilmasligi uchun runtime require.
let MpFaceCamera: React.ComponentType<LiveFaceCameraProps> | null = null;
try {
  if (isVisionCameraAvailable()) {
    const faceLandmarks =
      require('@/lib/faceLandmarks') as typeof import('@/lib/faceLandmarks');
    if (faceLandmarks.isFaceLandmarksAvailable()) {
      MpFaceCamera = (
        require('@/components/MpFaceCamera') as typeof import('@/components/MpFaceCamera')
      ).MpFaceCamera;
    }
  }
} catch {
  MpFaceCamera = null;
}

/** Yuqori bosqich holati (geofence/kamera/natija). */
type Phase = 'locating' | 'far' | 'camera' | 'success' | 'error';

/** Kamera ichidagi real-time verify siklining holati. */
type ScanState = 'starting' | 'scanning' | 'verifying' | 'retry' | 'success';

/** Real-time sikl mutable holati (ref ichida — re-render qo'zg'atmaydi). */
interface LoopState {
  active: boolean;
  cancelled: boolean;
  inFlight: boolean;
  attempts: number;
  netFails: number;
  /** Ketma-ket FACE_NOT_RECOGNIZED soni — boshqa odam yuzини aniqlash uchun. */
  notRecognizedStreak: number;
  /** Ketma-ket LIVENESS_FAILED soni — rasm/ekran (spoof) urinishini aniqlash uchun. */
  livenessStreak: number;
  /** Oxirgi urinishning xato kodi (timeout xabarини tanlash uchun). */
  lastCode: string;
  startedAt: number;
}

// --- Sikl parametrlari ---
// Har bir urinish endi BURST: bir necha kadr ketma-ket olinib bitta so'rovda
// yuboriladi — server jonlilikni (passiv anti-spoof + bosh burilishi) shu
// ketma-ketlik bo'yicha tekshiradi. Shu sabab urinish soni kam, vaqt ko'proq.
// Legacy'da darvoza yo'q — kadrda yuz bo'lmasligi mumkin; 4 kadr yuboriladi,
// server 3 tasida yuz topsa yetadi (bitta yaroqsiz kadr kechiriladi).
const BURST_FRAMES = 4;
const BURST_FRAME_GAP_MS = 550; // kadrlar orasidagi pauza (bosh burilishga ulgursin)
const MAX_ATTEMPTS = 6;
const MAX_DURATION_MS = 60_000;
const SCAN_INTERVAL_MS = 1000; // urinishlar orasidagi asosiy interval
const RETRY_HINT_MS = 900; // amber "retry" hint ko'rsatilish muddati
const NETWORK_FAIL_LIMIT = 3; // ketma-ket tarmoq xatosi → terminal
const TIP_AFTER_ATTEMPTS = 3; // shundan keyin yorug'lik maslahati
const NOT_RECOGNIZED_STREAK_LIMIT = 3; // ketma-ket "boshqa odam" → terminal
const LIVENESS_STREAK_LIMIT = 3; // ketma-ket spoof gumoni → terminal

/** Kadrlar orasidagi kutish. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function CheckScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: AttendanceType = params.type === 'CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN';

  const employee = useAuthStore((s) => s.employee);
  const branch = employee?.branch ?? null;
  const locale = useSettingsStore((s) => s.locale);

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [phase, setPhase] = useState<Phase>('locating');
  const [scanState, setScanState] = useState<ScanState>('starting');
  const [cameraReady, setCameraReady] = useState(false);
  const [farDistance, setFarDistance] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successTime, setSuccessTime] = useState<string>('');
  // Rejimlar: mp (MediaPipe blendshape) > live (on-device ML Kit) > ws
  // (server-driven real-time) > legacy. mpFailed/liveFailed — modul bor-u,
  // lekin runtime'da ishlamadi (front kamera yo'q / model yuklanmagan).
  const [mpFailed, setMpFailed] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  const mpMode = MpFaceCamera !== null && !mpFailed;
  const liveMode = mpMode || (LiveFaceCamera !== null && !liveFailed);
  const [wsFailed, setWsFailed] = useState(false);
  const legacyMode = !liveMode && wsFailed;

  // Diagnostika: qaysi rejim ishlayotganini Metro konsolida ko'rsatamiz.
  // MEDIAPIPE ko'rinmasa — build eski (native plugin yo'q), yangi
  // dev-client/EAS build kerak (README: "Yuz tekshiruvi rejimlari").
  useEffect(() => {
    if (!__DEV__) return;
    const mode = mpMode
      ? 'MEDIAPIPE (478 mesh, blendshape blink)'
      : LiveFaceCamera !== null && !liveFailed
        ? 'LIVE (MLKit, 133 kontur)'
        : !wsFailed
          ? 'WS (server-driven)'
          : 'LEGACY (HTTP burst)';
    console.log(`[check] yuz tekshiruvi rejimi: ${mode}`);
  }, [mpMode, liveFailed, wsFailed]);
  const [gateStatus, setGateStatus] = useState<string>(liveMode ? 'no_face' : 'connecting');
  const [liveBusy, setLiveBusy] = useState(false);

  // --- Sikl uchun ref'lar (stale closure'siz, re-render'siz o'qish) ---
  const phaseRef = useRef<Phase>('locating');
  const locationRef = useRef<LiveLocation | null>(null);
  const loopRef = useRef<LoopState>({
    active: false,
    cancelled: false,
    inFlight: false,
    attempts: 0,
    netFails: 0,
    notRecognizedStreak: 0,
    livenessStreak: 0,
    lastCode: '',
    startedAt: 0,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<() => void>(() => undefined);
  const lastHintRef = useRef<string>('');

  // t va type'ni ref orqali eng so'nggi qiymatда ushlaymiz (sikl qayta yaratilmasin)
  const tRef = useRef(t);
  tRef.current = t;
  const typeRef = useRef(type);
  typeRef.current = type;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (hintTimerRef.current) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  /** Siklni to'liq to'xtatadi (terminal/success/unmount). */
  const stopLoop = useCallback(() => {
    loopRef.current.cancelled = true;
    loopRef.current.active = false;
    clearTimers();
  }, [clearTimers]);

  /**
   * Transient xatodan keyin: amber "retry" hint ko'rsatib, ~800ms so'ng
   * "scanning"ga qaytadi va ~1500ms da keyingi urinishni rejalashtiradi.
   * Rekursiv scheduler — setInterval EMAS, so'rovlar bir-birini bosmaydi.
   */
  const scheduleRetry = useCallback(() => {
    if (loopRef.current.cancelled) return;
    setScanState('retry');
    hintTimerRef.current = setTimeout(() => {
      if (loopRef.current.cancelled) return;
      setScanState('scanning');
    }, RETRY_HINT_MS);
    timerRef.current = setTimeout(() => {
      tickRef.current();
    }, SCAN_INTERVAL_MS);
  }, []);

  /**
   * Urinish/vaqt limitlarini tekshiradi; oshgan bo'lsa terminal holatga
   * o'tkazib true qaytaradi (legacy tick ham, live burst ham ishlatadi).
   */
  const enforceLimits = useCallback((): boolean => {
    const loop = loopRef.current;
    const tt = tRef.current;
    if (loop.attempts < MAX_ATTEMPTS && Date.now() - loop.startedAt < MAX_DURATION_MS) {
      return false;
    }
    stopLoop();
    // Oxirgi sabab aniq bo'lsa mos xabar + ovoz beramiz.
    if (loop.lastCode === 'FACE_NOT_RECOGNIZED') {
      setErrorMessage(tt('faceNotYours'));
      announce('notRecognized', tt('voiceNotRecognized'), localeRef.current);
    } else if (loop.lastCode === 'LIVENESS_FAILED') {
      setErrorMessage(tt('errLivenessSpoof'));
      announce('livenessFailed', tt('voiceLivenessFailed'), localeRef.current);
    } else {
      setErrorMessage(lastHintRef.current || tt('verifyTimeout'));
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setPhaseBoth('error');
    return true;
  }, [stopLoop, setPhaseBoth]);

  /**
   * Muvaffaqiyatli tekshiruv: streak'lar reset, sikl to'xtaydi, success
   * bosqichi (HTTP burst ham, WS oqimi ham shu yerga keladi).
   */
  const handleCheckSuccess = useCallback(
    async (timestampIso?: string) => {
      const loop = loopRef.current;
      const tt = tRef.current;
      loop.netFails = 0;
      loop.notRecognizedStreak = 0;
      loop.livenessStreak = 0;
      loop.lastCode = '';
      stopLoop();
      setScanState('success');
      setSuccessTime(fmtTime(timestampIso ?? new Date().toISOString()));
      await queryClient.invalidateQueries({ queryKey: ['attendance'] });
      announce(
        typeRef.current === 'CHECK_IN' ? 'checkIn' : 'checkOut',
        typeRef.current === 'CHECK_IN' ? tt('voiceCheckIn') : tt('voiceCheckOut'),
        localeRef.current,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhaseBoth('success');
    },
    [stopLoop, setPhaseBoth, queryClient],
  );

  /**
   * Urinish xatosini tasniflaydi (HTTP burst va WS oqimi uchun UMUMIY):
   * terminal kodlar → error/far bosqich; transient → hint + davom.
   */
  const handleCheckError = useCallback(
    (err: unknown) => {
      const loop = loopRef.current;
      const tt = tRef.current;
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';

      // TERMINAL: geofence'dan chiqib ketgan → "far" bosqichi
      if (code === 'OUT_OF_GEOFENCE') {
        stopLoop();
        const details = err instanceof ApiError ? (err.details as { distance?: number } | null) : null;
        if (details?.distance != null) setFarDistance(details.distance);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPhaseBoth('far');
        return;
      }

      // TERMINAL: kompaniya obunasi to'xtatilgan (backend 402) → cheksiz retry EMAS
      if (code === 'SUBSCRIPTION_EXPIRED') {
        stopLoop();
        setErrorMessage(checkErrorMessage(err));
        announce('subscriptionExpired', tt('voiceSubscriptionExpired'), localeRef.current);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhaseBoth('error');
        return;
      }

      // TERMINAL: xavfsizlik/konfiguratsiya/debounce → error bosqichi
      if (
        code === 'MOCK_LOCATION' ||
        code === 'FACE_NOT_FOUND' ||
        code === 'DEBOUNCE' ||
        code === 'UNAUTHORIZED'
      ) {
        stopLoop();
        setErrorMessage(checkErrorMessage(err));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhaseBoth('error');
        return;
      }

      // NETWORK: transient, lekin ketma-ket NETWORK_FAIL_LIMIT marta → terminal.
      // Tarmoq xatosi yuz mosligini bildirmaydi → not-recognized streak'ni reset.
      if (code === 'NETWORK_ERROR') {
        loop.netFails += 1;
        loop.notRecognizedStreak = 0;
        loop.livenessStreak = 0;
        loop.lastCode = code;
        if (loop.netFails >= NETWORK_FAIL_LIMIT) {
          stopLoop();
          setErrorMessage(tt('errNetwork'));
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPhaseBoth('error');
          return;
        }
        lastHintRef.current = tt('errNetwork');
        scheduleRetry();
        return;
      }

      // YUZ MOS EMAS: kadrда yuz bor, lekin login qilgan xodimга MOS EMAS.
      // Ketma-ket NOT_RECOGNIZED_STREAK_LIMIT marta → boshqa odam → terminal.
      if (code === 'FACE_NOT_RECOGNIZED') {
        loop.netFails = 0;
        loop.livenessStreak = 0;
        loop.notRecognizedStreak += 1;
        loop.lastCode = code;
        if (loop.notRecognizedStreak >= NOT_RECOGNIZED_STREAK_LIMIT) {
          stopLoop();
          setErrorMessage(tt('faceNotYours'));
          announce('notRecognized', tt('voiceNotRecognized'), localeRef.current);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPhaseBoth('error');
          return;
        }
        lastHintRef.current = tt('errFaceNotRecognized');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleRetry();
        return;
      }

      // JONLILIK O'TMADI: rasm/ekran (spoof) gumoni. Ketma-ket
      // LIVENESS_STREAK_LIMIT marta → terminal (server bu urinishlarni
      // xavfsizlik hodisasi sifatida audit-log qiladi).
      if (code === 'LIVENESS_FAILED') {
        loop.netFails = 0;
        loop.notRecognizedStreak = 0;
        loop.livenessStreak += 1;
        loop.lastCode = code;
        if (loop.livenessStreak >= LIVENESS_STREAK_LIMIT) {
          stopLoop();
          setErrorMessage(tt('errLivenessSpoof'));
          announce('livenessFailed', tt('voiceLivenessFailed'), localeRef.current);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPhaseBoth('error');
          return;
        }
        lastHintRef.current = tt('errLivenessSpoof');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleRetry();
        return;
      }

      // TRANSIENT: FACE_NOT_DETECTED (kadrda yuz yo'q — hech narsa yuborilgani
      // bilan "boshqa odam" EMAS) / CHALLENGE_FAILED (bosh burilmadi) /
      // FACE_LOW_QUALITY / boshqa — barcha streak'lar reset, sikl davom etadi.
      loop.netFails = 0;
      loop.notRecognizedStreak = 0;
      loop.livenessStreak = 0;
      loop.lastCode = code;
      lastHintRef.current = code === 'UNKNOWN' ? tt('scanRetry') : checkErrorMessage(err);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      scheduleRetry();
    },
    [stopLoop, scheduleRetry, setPhaseBoth],
  );

  /**
   * Olingan kadrlarni serverga yuborib natijani tasniflaydi — legacy
   * (expo-camera burst) va live (on-device darvoza) rejimlar uchun UMUMIY.
   * Chaqirilishidan OLDIN loop.inFlight=true bo'lishi shart; o'zi reset qiladi.
   */
  const submitFrames = useCallback(
    async (frameUris: string[]) => {
      const loop = loopRef.current;
      const loc = locationRef.current;
      if (loop.cancelled || !loc) {
        loop.inFlight = false;
        return;
      }
      try {
        setScanState('verifying');
        // TEZLIK: kadrlar yuklashdan oldin 640px ga kichraytiriladi (~10x kam
        // trafik) — "tekshirilmoqda" kutishining asosiy qismi yuklash edi.
        // Eski buildda (modul yo'q) kadr o'zgarishsiz ketadi.
        const uploadUris = await shrinkFrames(frameUris);
        const form = new FormData();
        uploadUris.forEach((uri, i) => {
          form.append('frames', {
            uri,
            name: `frame${i}.jpg`,
            type: 'image/jpeg',
          } as unknown as Blob);
        });
        form.append('latitude', String(loc.latitude));
        form.append('longitude', String(loc.longitude));
        form.append('accuracy', String(loc.accuracy ?? 0));
        form.append('isMockLocation', String(loc.mocked));
        form.append('type', typeRef.current);

        const res = await api<MobileCheckResponse>('/attendance/mobile/check', {
          method: 'POST',
          formData: form,
          // Sekin uplink'da katta yuklama 12s default'dan oshishi mumkin —
          // uzilib QAYTA yuklashdan (2x sekin) ko'ra kutgan tezroq.
          timeoutMs: 30_000,
        });
        if (loop.cancelled) return;
        await handleCheckSuccess(res.event?.timestamp);
      } catch (err) {
        if (loopRef.current.cancelled) return;
        handleCheckError(err);
      } finally {
        loopRef.current.inFlight = false;
      }
    },
    [handleCheckSuccess, handleCheckError],
  );

  /**
   * LEGACY (expo-camera) urinish: 4 kadr burst oladi → submitFrames.
   * Faqat VisionCamera'siz eski buildda ishlaydi; foydalanuvchi bosh burishi
   * server 'turn' challenge'iga dalil bo'ladi.
   */
  const runTick = useCallback(async () => {
    const loop = loopRef.current;
    const tt = tRef.current;
    if (loop.cancelled || phaseRef.current !== 'camera') return;
    if (loop.inFlight) return;
    if (enforceLimits()) return;

    const camera = cameraRef.current;
    if (!camera || !locationRef.current) {
      scheduleRetry();
      return;
    }

    loop.inFlight = true;
    loop.attempts += 1;
    setScanState('scanning');
    const frameUris: string[] = [];
    try {
      for (let i = 0; i < BURST_FRAMES; i += 1) {
        if (loop.cancelled) {
          loop.inFlight = false;
          return;
        }
        const photo = await camera.takePictureAsync({
          // Legacy'da rasm TO'LIQ sensor o'lchamida chiqadi — past sifat +
          // submitFrames'dagi 640px resize yuklamani kichik tutadi.
          quality: 0.35,
          skipProcessing: true,
          shutterSound: false,
        });
        if (!photo) throw new ApiError('CAPTURE_FAILED', tt('errGeneric'), 0);
        frameUris.push(photo.uri);
        if (i < BURST_FRAMES - 1) await delay(BURST_FRAME_GAP_MS);
      }
    } catch {
      loop.inFlight = false;
      lastHintRef.current = tt('scanRetry');
      scheduleRetry();
      return;
    }
    await submitFrames(frameUris);
  }, [enforceLimits, scheduleRetry, submitFrames]);

  /**
   * LIVE rejim: FaceGate jonlilik dalili (blink/burilish) bilan olingan
   * kadrlar. Darvoza allaqachon "haqiqiy odam" ekanini tasdiqlagan — server
   * endi passiv anti-spoof + identity'ni tekshiradi.
   */
  const handleLiveBurst = useCallback(
    (uris: string[]) => {
      const loop = loopRef.current;
      if (loop.cancelled || loop.inFlight || phaseRef.current !== 'camera') return;
      if (enforceLimits()) return;
      loop.inFlight = true;
      loop.attempts += 1;
      setLiveBusy(true);
      void submitFrames(uris).finally(() => setLiveBusy(false));
    },
    [enforceLimits, submitFrames],
  );

  // 'spoof_suspected' (rasm/ekran gumoni) — bir sessiyada BIR MARTA ovoz +
  // haptic bilan e'lon qilinadi; darvoza ochiq qoladi (haqiqiy odam blink
  // qilsa davom etadi), lekin foydalanuvchi sababni darhol eshitadi.
  const spoofAnnouncedRef = useRef(false);
  const noteSpoof = useCallback((status: string) => {
    if (status !== 'spoof_suspected' || spoofAnnouncedRef.current) return;
    spoofAnnouncedRef.current = true;
    announce('livenessFailed', tRef.current('voiceLivenessFailed'), localeRef.current);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);

  const handleGateStatus = useCallback(
    (status: GateStatus) => {
      setGateStatus(status);
      noteSpoof(status);
    },
    [noteSpoof],
  );

  // --- WS (server-driven real-time) rejim handlerlari ---

  const handleWsStatus = useCallback(
    (state: string) => {
      setGateStatus(state === 'verifying' ? 'triggered' : state);
      noteSpoof(state);
      if (state === 'verifying') {
        setScanState('verifying');
      } else {
        setScanState((s) => (s === 'verifying' ? 'scanning' : s));
      }
    },
    [noteSpoof],
  );

  const handleWsSuccess = useCallback(
    (timestampIso?: string) => {
      if (loopRef.current.cancelled) return;
      void handleCheckSuccess(timestampIso);
    },
    [handleCheckSuccess],
  );

  const handleWsFailure = useCallback(
    (err: ApiError, terminal: boolean) => {
      if (loopRef.current.cancelled) return;
      if (terminal) {
        stopLoop();
        setErrorMessage(checkErrorMessage(err));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setPhaseBoth('error');
        return;
      }
      loopRef.current.attempts += 1;
      if (enforceLimits()) return;
      handleCheckError(err);
    },
    [stopLoop, setPhaseBoth, enforceLimits, handleCheckError],
  );

  const handleWsFatalStart = useCallback(
    (err: ApiError) => {
      if (loopRef.current.cancelled) return;
      const knownTerminal = [
        'OUT_OF_GEOFENCE',
        'SUBSCRIPTION_EXPIRED',
        'MOCK_LOCATION',
        'FACE_NOT_FOUND',
        'DEBOUNCE',
        'UNAUTHORIZED',
      ];
      if (knownTerminal.includes(err.code)) {
        // handleCheckError bu kodlarni to'g'ri terminal bosqichga o'tkazadi
        handleCheckError(err);
        return;
      }
      stopLoop();
      setErrorMessage(checkErrorMessage(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPhaseBoth('error');
    },
    [handleCheckError, stopLoop, setPhaseBoth],
  );

  const handleWsUnavailable = useCallback(() => {
    // WS ulanmadi/uzildi — eski HTTP burst rejimiga tushamiz (bosh burish
    // challenge bilan); legacy CameraView mount bo'lib siklni qayta boshlaydi.
    stopLoop();
    setWsFailed(true);
  }, [stopLoop]);

  useEffect(() => {
    tickRef.current = () => {
      // Live rejimda darvoza (blink), WS rejimda server sessiyasi boshqaradi —
      // timer tick faqat legacy oqim uchun.
      if (!legacyMode) return;
      void runTick();
    };
  }, [runTick, legacyMode]);

  /** Kamera tayyor bo'lgach avtomatik siklni boshlaydi (idempotent). */
  const startLoop = useCallback(() => {
    const loop = loopRef.current;
    if (loop.active || !locationRef.current) return;
    loop.active = true;
    loop.cancelled = false;
    loop.inFlight = false;
    loop.attempts = 0;
    loop.netFails = 0;
    loop.notRecognizedStreak = 0;
    loop.livenessStreak = 0;
    loop.lastCode = '';
    loop.startedAt = Date.now();
    lastHintRef.current = '';
    spoofAnnouncedRef.current = false;
    setScanState('scanning');
    // Live/WS rejimlarda birinchi urinishni darvoza/server boshlaydi
    if (legacyMode) tickRef.current();
  }, [legacyMode]);

  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
    startLoop();
  }, [startLoop]);

  // Live/WS rejimlarda legacy CameraView yo'q (onCameraReady kelmaydi) —
  // kamera bosqichiga o'tishning o'zida siklni qurollantiramiz.
  useEffect(() => {
    if (!legacyMode && phase === 'camera' && cameraPermission?.granted) {
      startLoop();
    }
  }, [legacyMode, phase, cameraPermission, startLoop]);

  /** Qo'lda olish (fallback) — in-flight lock bilan avto-sikl bilan aralashmaydi. */
  const manualCapture = useCallback(() => {
    if (loopRef.current.inFlight || loopRef.current.cancelled) return;
    clearTimers();
    tickRef.current();
  }, [clearTimers]);

  // 1-bosqich: joylashuvni qayta tekshirish (Haversine + geofence radius)
  const verifyLocation = useCallback(async () => {
    stopLoop();
    setCameraReady(false);
    setScanState('starting');
    setPhaseBoth('locating');
    try {
      const loc = await getCurrentLocation();
      locationRef.current = loc;
      if (!branch) {
        setErrorMessage(t('errGeneric'));
        setPhaseBoth('error');
        return;
      }
      const dist = haversineMeters(loc.latitude, loc.longitude, branch.latitude, branch.longitude);
      if (dist > (branch.geofenceRadius ?? 50)) {
        setFarDistance(dist);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setPhaseBoth('far');
        return;
      }
      setPhaseBoth('camera');
    } catch {
      setErrorMessage(t('errGeneric'));
      setPhaseBoth('error');
    }
  }, [branch, t, stopLoop, setPhaseBoth]);

  useEffect(() => {
    void verifyLocation();
  }, [verifyLocation]);

  // Unmount'да siklni to'xtatib, barcha timerlarni tozalaymiz (memory leak yo'q)
  useEffect(() => () => stopLoop(), [stopLoop]);

  // Kamera bosqichiga o'tganda ruxsatni avtomatik so'raymiz
  useEffect(() => {
    if (
      phase === 'camera' &&
      cameraPermission &&
      !cameraPermission.granted &&
      cameraPermission.canAskAgain
    ) {
      void requestCameraPermission();
    }
  }, [phase, cameraPermission, requestCameraPermission]);

  // --- Verify pulse animatsiyasi (oval glow) ---
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (scanState === 'verifying') {
      pulse.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [scanState, pulse]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.55,
    transform: [{ scale: 1 + pulse.value * 0.05 }],
  }));

  const ovalColor =
    scanState === 'verifying'
      ? colors.primary
      : scanState === 'retry'
        ? colors.warning
        : scanState === 'success'
          ? colors.success
          : colors.white;

  // Live/WS rejimlarda 'scanning' paytida darvoza holatiga mos YO'NALTIRUVCHI
  // matn (yuzni joylashtirish/yaqinlashish/qarab turish); legacy rejimda esa
  // bosh burish ko'rsatmasi (server 'turn' challenge'i uchun).
  const gateText =
    gateStatus === 'connecting'
      ? t('faceConnecting')
      : gateStatus === 'no_face'
        ? t('faceSearching')
        : gateStatus === 'too_small'
          ? t('faceCloser')
          : gateStatus === 'off_center'
            ? t('faceCenter')
            : gateStatus === 'multiple'
              ? t('faceMultiple')
              : gateStatus === 'too_dark'
                ? t('faceTooDark')
                : gateStatus === 'spoof_suspected'
                  ? t('errLivenessSpoof')
                  : gateStatus === 'hold_long'
                    ? t('faceBlinkHint')
                    : gateStatus === 'triggered'
                      ? t('scanVerifying')
                      : t('faceHold');

  const statusText =
    scanState === 'starting'
      ? t('scanStarting')
      : scanState === 'verifying'
        ? t('scanVerifying')
        : scanState === 'retry'
          ? lastHintRef.current || t('scanRetry')
          : legacyMode
            ? t('scanChallenge')
            : gateText;

  const showTip = loopRef.current.attempts >= TIP_AFTER_ATTEMPTS && scanState !== 'success';

  const title = type === 'CHECK_IN' ? t('checkTitleIn') : t('checkTitleOut');

  // --- Muvaffaqiyat: fullscreen yashil check animatsiya ---
  if (phase === 'success') {
    return (
      <SuccessCheck
        title={
          type === 'CHECK_IN'
            ? t('checkInDone', { time: successTime })
            : t('checkOutDone', { time: successTime })
        }
        onClose={() => router.back()}
      />
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeBtn}>
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.closeBtn} />
      </View>

      {/* Joylashuv tekshirilmoqda */}
      {phase === 'locating' ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.white} />
          <Text style={styles.centerText}>{t('locating')}</Text>
        </View>
      ) : null}

      {/* Radius tashqarisida */}
      {phase === 'far' ? (
        <View style={styles.centerBox}>
          <Ionicons name="navigate-outline" size={56} color={colors.warning} />
          <Text style={styles.centerTitle}>{t('outOfZone')}</Text>
          {farDistance !== null ? (
            <Text style={styles.centerText}>
              {t('distanceToBranch', { distance: formatDistance(farDistance) })}
            </Text>
          ) : null}
          <View style={styles.centerActions}>
            <Button title={t('retry')} variant="secondary" onPress={() => void verifyLocation()} />
            <Button title={t('close')} variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}

      {/* Xato */}
      {phase === 'error' ? (
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={56} color={colors.danger} />
          <Text style={styles.centerTitle}>{t('checkFailedTitle')}</Text>
          <Text style={styles.centerText}>{errorMessage}</Text>
          <View style={styles.centerActions}>
            <Button title={t('retry')} onPress={() => void verifyLocation()} />
            <Button title={t('close')} variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}

      {/* Kamera + real-time verify sikli */}
      {phase === 'camera' ? (
        cameraPermission?.granted ? (
          <View style={styles.flex}>
            {MpFaceCamera && !mpFailed ? (
              // MEDIAPIPE: kioskdagi kabi 478-nuqtali mesh + blendshape blink
              // darvozasi — ko'z holati maxsus o'qitilgan modeldan o'lchanadi.
              <MpFaceCamera
                paused={liveBusy}
                onStatus={handleGateStatus}
                onBurst={handleLiveBurst}
                onUnavailable={() => setMpFailed(true)}
              />
            ) : LiveFaceCamera && !liveFailed ? (
              // LIVE: on-device ML Kit — yuz kvadrat bilan kuzatiladi, faqat
              // jonlilik dalili (blink) bilan suratga olinadi.
              <LiveFaceCamera
                paused={liveBusy}
                onStatus={handleGateStatus}
                onBurst={handleLiveBurst}
                onUnavailable={() => setLiveFailed(true)}
              />
            ) : !wsFailed && locationRef.current ? (
              // WS: kadrlar real-time serverga oqadi — yuz kvadrati va jonlilik
              // darvozasi server tomonda; native modul kerak emas.
              <WsFaceCamera
                location={locationRef.current}
                type={type}
                onStatus={handleWsStatus}
                onFatalStart={handleWsFatalStart}
                onFailure={handleWsFailure}
                onSuccess={handleWsSuccess}
                onUnavailable={handleWsUnavailable}
              />
            ) : (
              // LEGACY: oddiy burst + bosh burish challenge (WS ham imkonsiz)
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="front"
                onCameraReady={handleCameraReady}
              />
            )}

            {/* Qorong'i chetlar */}
            <View pointerEvents="none" style={styles.maskTop} />
            <View pointerEvents="none" style={styles.maskBottom} />

            {/* Oval ramka + glow — faqat legacy rejimda (live/ws'da yuz kvadrati bor) */}
            {legacyMode ? (
              <View pointerEvents="none" style={styles.ovalWrap}>
                <Animated.View
                  style={[styles.ovalGlow, { borderColor: colors.primary }, glowStyle]}
                />
                <View style={[styles.oval, { borderColor: ovalColor }]} />
              </View>
            ) : null}

            {/* Jonli status matni */}
            <Animated.View entering={FadeIn.delay(150)} style={styles.statusWrap}>
              <View style={styles.statusPill}>
                {scanState === 'verifying' ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : null}
                <Text style={styles.statusText}>{statusText}</Text>
              </View>
              {showTip ? <Text style={styles.tipText}>{t('scanTipLight')}</Text> : null}
            </Animated.View>

            {/* Qo'lda olish — faqat legacy rejimda (live/ws avto ishlaydi) */}
            {legacyMode ? (
              <View style={[styles.captureWrap, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.captureHint}>{t('manualCapture')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={manualCapture}
                  disabled={scanState === 'verifying'}
                  style={({ pressed }) => [
                    styles.captureBtn,
                    scanState === 'verifying' && styles.captureDisabled,
                    pressed && styles.capturePressed,
                  ]}
                >
                  <View style={styles.captureInner} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.centerBox}>
            <Ionicons name="camera-outline" size={56} color={colors.white} />
            <Text style={styles.centerTitle}>{t('cameraPermissionTitle')}</Text>
            <Text style={styles.centerText}>{t('cameraPermissionDesc')}</Text>
            <View style={styles.centerActions}>
              <Button
                title={t('allowCamera')}
                onPress={() => void requestCameraPermission()}
              />
              <Button title={t('close')} variant="ghost" onPress={() => router.back()} />
            </View>
          </View>
        )
      ) : null}
    </View>
  );
}

const OVAL_WIDTH = 260;
const OVAL_HEIGHT = 340;

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 5,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.white,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  centerTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.white,
    textAlign: 'center',
  },
  centerText: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    lineHeight: 21,
  },
  centerActions: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 20,
  },
  maskTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '18%',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  maskBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '22%',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  ovalWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: OVAL_WIDTH,
    height: OVAL_HEIGHT,
    borderRadius: OVAL_WIDTH / 2,
    borderWidth: 3,
    marginTop: -30,
  },
  ovalGlow: {
    position: 'absolute',
    width: OVAL_WIDTH + 20,
    height: OVAL_HEIGHT + 20,
    borderRadius: (OVAL_WIDTH + 20) / 2,
    borderWidth: 6,
    marginTop: -30,
  },
  statusWrap: {
    position: 'absolute',
    top: '12%',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '92%',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.full,
  },
  statusText: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    color: colors.white,
    textAlign: 'center',
    flexShrink: 1,
  },
  tipText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  captureWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
  },
  captureHint: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.75)',
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureDisabled: {
    opacity: 0.4,
  },
  capturePressed: {
    opacity: 0.7,
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.white,
  },
});
