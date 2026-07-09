import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '@/i18n';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * react-native-yamap-plus — NATIVE modul (Yandex MapKit), Expo Go'da ISHLAMAYDI.
 * (Eski react-native-yamap RN 0.81/Kotlin 2.1 bilan kompilyatsiya bo'lmay qolgani
 * uchun faol fork'ka o'tildi — v6 New Architecture'ni qo'llaydi.)
 * Shu sabab:
 *   - lazy require + try/catch (modul yo'q bo'lsa import qulatmaydi),
 *   - render ErrorBoundary ichida (native view topilmasa fallback),
 *   - fallback karta: "Xarita dev-client talab qiladi".
 * API kaliti runtime'da YamapInstance.init() orqali beriladi
 * (EXPO_PUBLIC_YANDEX_MAPS_API_KEY).
 */

interface YamapPoint {
  lat: number;
  lon: number;
}

interface YamapModule {
  /** Yamap komponenti (default eksport) */
  default: React.ComponentType<Record<string, unknown>>;
  Marker: React.ComponentType<Record<string, unknown>>;
  Circle: React.ComponentType<Record<string, unknown>>;
  YamapInstance: { init: (apiKey: string) => Promise<void> };
}

let cached: YamapModule | null | undefined;
let initialized = false;

function loadYamap(): YamapModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-yamap-plus') as YamapModule;
    const apiKey = process.env.EXPO_PUBLIC_YANDEX_MAPS_API_KEY;
    if (!initialized && apiKey) {
      // init xatosi (masalan eski dev-client'da native modul yo'q) fallback'ga olib boradi
      void mod.YamapInstance.init(apiKey).catch(() => undefined);
      initialized = true;
    }
    cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

interface Props {
  latitude: number;
  longitude: number;
  /** geofence radiusi (metr) — berilsa doira chiziladi */
  radiusMeters?: number;
  /** foydalanuvchi joylashuvi — berilsa alohida marker */
  userLocation?: { latitude: number; longitude: number } | null;
  height?: number;
}

function MapFallback({ height }: { height: number }): React.ReactElement {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  return (
    <View style={[styles.fallback, { height }]}>
      <Ionicons name="map-outline" size={32} color={colors.textFaint} />
      <Text style={styles.fallbackTitle}>{t('mapUnavailable')}</Text>
      <Text style={styles.fallbackDesc}>{t('mapUnavailableDesc')}</Text>
    </View>
  );
}

export function BranchMap({
  latitude,
  longitude,
  radiusMeters,
  userLocation,
  height = 180,
}: Props): React.ReactElement {
  const { colors, isDark } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const yamap = useMemo(loadYamap, []);

  if (!yamap) return <MapFallback height={height} />;

  const YaMap = yamap.default;
  const { Marker, Circle } = yamap;
  const center: YamapPoint = { lat: latitude, lon: longitude };

  return (
    <ErrorBoundary fallback={<MapFallback height={height} />}>
      <View style={[styles.mapWrap, { height }]}>
        <YaMap
          style={{ flex: 1 }}
          initialRegion={{ ...center, zoom: 16 }}
          nightMode={isDark}
          showUserPosition={false}
          logoPadding={{ horizontal: 8, vertical: 8 }}
        >
          {radiusMeters ? (
            <Circle
              center={center}
              radius={radiusMeters}
              fillColor="rgba(79, 70, 229, 0.12)"
              strokeColor={colors.primary}
              strokeWidth={2}
            />
          ) : null}
          <Marker point={center} scale={1} />
          {userLocation ? (
            <Marker point={{ lat: userLocation.latitude, lon: userLocation.longitude }} />
          ) : null}
        </YaMap>
      </View>
    </ErrorBoundary>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    mapWrap: {
      borderRadius: radius.card,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    fallback: {
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.zinc100,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      gap: 6,
    },
    fallbackTitle: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: colors.textMuted,
    },
    fallbackDesc: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textFaint,
      textAlign: 'center',
    },
  });
