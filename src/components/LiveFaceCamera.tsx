/**
 * LiveFaceCamera — haqiqiy Face ID uslubidagi kamera:
 *
 *  - ML Kit (vision-camera frame processor) yuzni real-vaqtda kuzatadi;
 *  - topilgan yuz ekranda KVADRAT ramka bilan belgilanadi (yuzga ergashadi);
 *  - suratga olish FAQAT FaceGate jonlilik dalilini (tabiiy ko'z yumib-ochish
 *    yoki bosh burilishi) kuzatgandagina bo'ladi — statik rasm/relyef hech
 *    qachon suratga olinmaydi;
 *  - blink paytida 3 kadr OVOZSIZ olinadi (birinchisi ko'z yumuq payt —
 *    serverdagi EAR blink tekshiruviga fotografik dalil).
 *
 * DIQQAT: bu fayl check.tsx'dan faqat runtime `require` bilan yuklanadi
 * (isVisionCameraAvailable() true bo'lganda) — eski dev-client'da native
 * modul yo'qligi ilovani yiqitmasligi uchun.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
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
}

const BURST_SIZE = 3;
const BURST_GAP_MS = 380;
/** Ramka rangi holatga qarab */
const BOX_COLORS: Record<'searching' | 'adjust' | 'ready' | 'captured', string> = {
  searching: 'rgba(255,255,255,0.9)',
  adjust: '#F59E0B', // amber — yaqinlashing/markazlang
  ready: '#6366F1', // indigo — barqaror, jonlilik kutilmoqda
  captured: '#10B981', // emerald — kadrlar olindi
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function LiveFaceCamera({
  paused,
  onStatus,
  onBurst,
}: LiveFaceCameraProps): React.ReactElement | null {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const device: CameraDevice | undefined = useCameraDevice('front');

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
        // Birinchi kadr DARHOL — blink triggeri ko'z yumuq paytda otiladi
        const photo = await camera.takePhoto({
          flash: 'off',
          enableShutterSound: false,
        });
        uris.push(photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`);
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
      // Eng katta yuz — asosiy (orqadagi kichik yuzlar e'tiborsiz)
      const primary = faces.reduce<Face | null>((best, f) => {
        const area = f.bounds.width * f.bounds.height;
        const bestArea = best ? best.bounds.width * best.bounds.height : 0;
        return area > bestArea ? f : best;
      }, null);

      // Ramkani yangilash (yuzga yumshoq ergashadi)
      if (primary) {
        const pad = primary.bounds.width * 0.08;
        boxX.value = withTiming(primary.bounds.x - pad, { duration: 120 });
        boxY.value = withTiming(primary.bounds.y - pad, { duration: 120 });
        boxW.value = withTiming(primary.bounds.width + pad * 2, { duration: 120 });
        boxH.value = withTiming(primary.bounds.height + pad * 2, { duration: 120 });
        boxOpacity.value = withTiming(1, { duration: 150 });
      } else {
        boxOpacity.value = withTiming(0, { duration: 250 });
      }

      if (pausedRef.current || capturingRef.current) return;

      const eyeL = primary?.leftEyeOpenProbability ?? -1;
      const eyeR = primary?.rightEyeOpenProbability ?? -1;
      const result = gateRef.current.push({
        present: primary != null,
        multiple: faces.length > 1,
        centerX: primary ? (primary.bounds.x + primary.bounds.width / 2) / windowWidth : 0,
        centerY: primary ? (primary.bounds.y + primary.bounds.height / 2) / windowHeight : 0,
        widthRatio: primary ? primary.bounds.width / windowWidth : 0,
        yaw: primary?.yawAngle ?? 0,
        eyeOpen: eyeL >= 0 && eyeR >= 0 ? (eyeL + eyeR) / 2 : -1,
        timestamp: Date.now(),
      });

      // Ramka rangi holatga mos
      if (result.status === 'hold' || result.status === 'hold_long') {
        boxColor.value = BOX_COLORS.ready;
      } else if (result.status === 'triggered') {
        boxColor.value = BOX_COLORS.captured;
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
    [windowWidth, windowHeight, boxX, boxY, boxW, boxH, boxOpacity, boxColor, captureBurst],
  );

  const faceDetectionOptions = useMemo(
    () => ({
      performanceMode: 'fast' as const,
      classificationMode: 'all' as const, // ko'z ochiqlik ehtimoli (blink) uchun
      landmarkMode: 'none' as const,
      contourMode: 'none' as const,
      trackingEnabled: false,
      minFaceSize: 0.15,
      cameraFacing: 'front' as const,
      // Natijalar ekran koordinatalarida keladi (ramka chizish uchun)
      autoMode: true,
      windowWidth,
      windowHeight,
    }),
    [windowWidth, windowHeight],
  );

  if (!device) return null;

  return (
    <>
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
      <Animated.View pointerEvents="none" style={[styles.faceBox, boxStyle]} />
    </>
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
});
