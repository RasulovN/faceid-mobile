import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

/**
 * FaceID Davomat brend belgisi — PNG orqali (RN uchun eng optimal: bitta
 * GPU-tayyor <Image>, @1x/@2x/@3x zichlik variantlari avtomatik tanlanadi).
 * Haqiqiy logoga almashtirish: assets/brand/ dagi PNG'larni xuddi shu nomlar
 * bilan yangilash kifoya (assets/brand/README.md).
 */

const TILE = require('../../assets/brand/logo-tile.png');
const GLYPH = require('../../assets/brand/logo-glyph.png');

export function BrandLogo({
  size = 72,
  variant = 'tile',
  color = '#4F46E5',
  style,
}: {
  /** Kvadrat tomoni, px */
  size?: number;
  /** tile — indigo plitka + oq glif (ikonka uslubi); plain — shaffof fonda glif */
  variant?: 'tile' | 'plain';
  /** plain variantda glif rangi (oq glif tintColor bilan bo'yaladi) */
  color?: string;
  style?: StyleProp<ImageStyle>;
}): React.ReactElement {
  return (
    <Image
      source={variant === 'tile' ? TILE : GLYPH}
      style={[
        { width: size, height: size },
        variant === 'plain' && { tintColor: color },
        style,
      ]}
      accessibilityRole="image"
      accessible={false}
    />
  );
}
