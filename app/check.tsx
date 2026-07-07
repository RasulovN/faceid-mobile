import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
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
import { type Locale, useT } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { checkErrorMessage } from '@/lib/errors';
import { fmtTime } from '@/lib/format';
import { formatDistance, haversineMeters } from '@/lib/geo';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import type { AttendanceType, MobileCheckResponse } from '@/types/api';

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
  /** Oxirgi urinishning xato kodi (timeout xabarини tanlash uchun). */
  lastCode: string;
  startedAt: number;
}

// --- Sikl parametrlari ---
const MAX_ATTEMPTS = 15;
const MAX_DURATION_MS = 30_000;
const SCAN_INTERVAL_MS = 1500; // urinishlar orasidagi asosiy interval
const RETRY_HINT_MS = 800; // amber "retry" hint ko'rsatilish muddati
const NETWORK_FAIL_LIMIT = 3; // ketma-ket tarmoq xatosi → terminal
const TIP_AFTER_ATTEMPTS = 5; // shundan keyin yorug'lik maslahati
const NOT_RECOGNIZED_STREAK_LIMIT = 5; // ketma-ket "boshqa odam" → terminal

/** Locale'ni TTS til kodiga moslaydi (uz-Cyrl uchun 'uz' fallback). */
function speechLang(locale: Locale): string {
  switch (locale) {
    case 'ru':
      return 'ru';
    case 'en':
      return 'en';
    default:
      return 'uz';
  }
}

/**
 * Ovozli e'lon — faqat terminal (bir martalik) holatlarda chaqiriladi.
 * Qurilma TTS'ni qo'llab-quvvatlamasa jimgina o'tadi (try/catch).
 */
function announce(text: string, locale: Locale): void {
  try {
    Speech.stop();
    Speech.speak(text, { language: speechLang(locale) });
  } catch {
    /* ovoz mavjud emas — jim */
  }
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
   * Bitta urinish: kadr oladi → multipart yuboradi → natijani tasniflaydi.
   * In-flight lock (loop.inFlight) tufayli bir vaqtда faqat bitta so'rov ketadi.
   */
  const runTick = useCallback(async () => {
    const loop = loopRef.current;
    const tt = tRef.current;
    if (loop.cancelled || phaseRef.current !== 'camera') return;
    if (loop.inFlight) return;

    // Limit: urinishlar soni yoki umumiy vaqt oshsa → terminal timeout
    if (loop.attempts >= MAX_ATTEMPTS || Date.now() - loop.startedAt >= MAX_DURATION_MS) {
      stopLoop();
      // Oxirgi sabab "yuz mos emas" bo'lsa aniq xabar + ovoz beramiz.
      if (loop.lastCode === 'FACE_NOT_RECOGNIZED') {
        setErrorMessage(tt('faceNotYours'));
        announce(tt('voiceNotRecognized'), localeRef.current);
      } else {
        setErrorMessage(lastHintRef.current || tt('verifyTimeout'));
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPhaseBoth('error');
      return;
    }

    const camera = cameraRef.current;
    const loc = locationRef.current;
    if (!camera || !loc) {
      scheduleRetry();
      return;
    }

    loop.inFlight = true;
    loop.attempts += 1;
    setScanState('scanning');
    try {
      const photo = await camera.takePictureAsync({ quality: 0.5, skipProcessing: true });
      if (loop.cancelled) return;
      if (!photo) throw new ApiError('CAPTURE_FAILED', tt('errGeneric'), 0);

      setScanState('verifying');
      const form = new FormData();
      form.append('selfie', {
        uri: photo.uri,
        name: 'selfie.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
      form.append('latitude', String(loc.latitude));
      form.append('longitude', String(loc.longitude));
      form.append('accuracy', String(loc.accuracy ?? 0));
      form.append('isMockLocation', String(loc.mocked));
      form.append('type', typeRef.current);

      const res = await api<MobileCheckResponse>('/attendance/mobile/check', {
        method: 'POST',
        formData: form,
      });
      if (loop.cancelled) return;

      // --- Muvaffaqiyat: siklni darhol to'xtatamiz ---
      loop.netFails = 0;
      loop.notRecognizedStreak = 0;
      loop.lastCode = '';
      stopLoop();
      setScanState('success');
      setSuccessTime(fmtTime(res.event?.timestamp ?? new Date().toISOString()));
      await queryClient.invalidateQueries({ queryKey: ['attendance'] });
      announce(
        typeRef.current === 'CHECK_IN' ? tt('voiceCheckIn') : tt('voiceCheckOut'),
        localeRef.current,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhaseBoth('success');
    } catch (err) {
      if (loopRef.current.cancelled) return;
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
        announce(tt('voiceSubscriptionExpired'), localeRef.current);
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
        loop.notRecognizedStreak += 1;
        loop.lastCode = code;
        if (loop.notRecognizedStreak >= NOT_RECOGNIZED_STREAK_LIMIT) {
          stopLoop();
          setErrorMessage(tt('faceNotYours'));
          announce(tt('voiceNotRecognized'), localeRef.current);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPhaseBoth('error');
          return;
        }
        lastHintRef.current = tt('errFaceNotRecognized');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        scheduleRetry();
        return;
      }

      // TRANSIENT: LIVENESS_FAILED / FACE_LOW_QUALITY / boshqa — bular yuz mosligini
      // bildirmaydi → streak reset. Siklда davom etamiz, qisqa hint ko'rsatib.
      loop.netFails = 0;
      loop.notRecognizedStreak = 0;
      loop.lastCode = code;
      lastHintRef.current = code === 'UNKNOWN' ? tt('scanRetry') : checkErrorMessage(err);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      scheduleRetry();
    } finally {
      loopRef.current.inFlight = false;
    }
  }, [stopLoop, scheduleRetry, setPhaseBoth, queryClient]);

  useEffect(() => {
    tickRef.current = () => {
      void runTick();
    };
  }, [runTick]);

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
    loop.lastCode = '';
    loop.startedAt = Date.now();
    lastHintRef.current = '';
    setScanState('scanning');
    tickRef.current();
  }, []);

  const handleCameraReady = useCallback(() => {
    setCameraReady(true);
    startLoop();
  }, [startLoop]);

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

  const statusText =
    scanState === 'starting'
      ? t('scanStarting')
      : scanState === 'verifying'
        ? t('scanVerifying')
        : scanState === 'retry'
          ? lastHintRef.current || t('scanRetry')
          : t('scanLooking');

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
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="front"
              onCameraReady={handleCameraReady}
            />

            {/* Qorong'i chetlar */}
            <View pointerEvents="none" style={styles.maskTop} />
            <View pointerEvents="none" style={styles.maskBottom} />

            {/* Oval ramka + verify glow */}
            <View pointerEvents="none" style={styles.ovalWrap}>
              <Animated.View style={[styles.ovalGlow, { borderColor: colors.primary }, glowStyle]} />
              <View style={[styles.oval, { borderColor: ovalColor }]} />
            </View>

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

            {/* Qo'lda olish (ixtiyoriy fallback) */}
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
