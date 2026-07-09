import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * FaceID Davomat brend belgisi — skan qavslari + avatar glifi.
 *
 * Glif SOF View'lar bilan chizilgan (react-native-svg o'rnatilmagan — native modul
 * qo'shish dev-client rebuild talab qiladi). Geometriya assets/brand/logo.svg dagi
 * master bilan bir xil (birlik kvadratning ulushlari). Haqiqiy logoga o'tish
 * yo'riqnomasi: assets/brand/README.md.
 */
export function BrandLogo({
  size = 72,
  variant = 'tile',
  color,
  tileColor = '#4F46E5',
  style,
}: {
  /** Kvadrat konteyner tomoni, px */
  size?: number;
  /** tile — indigo plitka + oq glif (ikonka uslubi); plain — shaffof fonda glif */
  variant?: 'tile' | 'plain';
  /** Glif rangi (default: tile'da oq, plain'da indigo) */
  color?: string;
  tileColor?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const fg = color ?? (variant === 'tile' ? '#FFFFFF' : '#4F46E5');
  // Master SVG dagi ulushlar (viewBox 1024): inset .175, qalinlik .056, uzunlik .17
  const i = size * 0.175;
  const t = size * 0.056;
  const l = size * 0.17;
  const r = size * 0.025;

  const bars: ViewStyle[] = [
    { left: i, top: i, width: l, height: t },
    { left: i, top: i, width: t, height: l },
    { right: i, top: i, width: l, height: t },
    { right: i, top: i, width: t, height: l },
    { left: i, bottom: i, width: l, height: t },
    { left: i, bottom: i, width: t, height: l },
    { right: i, bottom: i, width: l, height: t },
    { right: i, bottom: i, width: t, height: l },
  ];

  return (
    <View
      style={[
        { width: size, height: size },
        variant === 'tile' && { backgroundColor: tileColor, borderRadius: size * 0.28 },
        style,
      ]}
    >
      {bars.map((bar, idx) => (
        <View
          key={idx}
          style={[styles.abs, bar, { backgroundColor: fg, borderRadius: r }]}
        />
      ))}
      {/* bosh */}
      <View
        style={[
          styles.abs,
          {
            left: size * 0.398,
            top: size * 0.333,
            width: size * 0.204,
            height: size * 0.204,
            borderRadius: size * 0.102,
            backgroundColor: fg,
          },
        ]}
      />
      {/* yelka */}
      <View
        style={[
          styles.abs,
          {
            left: size * 0.345,
            top: size * 0.58,
            width: size * 0.31,
            height: size * 0.144,
            borderRadius: size * 0.072,
            backgroundColor: fg,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
