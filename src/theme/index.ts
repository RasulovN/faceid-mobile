/**
 * DESIGN_SYSTEM.md token'lari — indigo accent + zinc neytrallar.
 * Ikki palitra: `lightColors` va `darkColors` (bir xil kalitlar, `ColorScheme` tipi).
 * Reaktiv tema uchun komponentlarda `useTheme()` hook'idan foydalaning.
 */
import { useColorScheme } from 'react-native';
import { useSettingsStore } from '@/store/settings';

/** Har ikkala palitra uchun umumiy shakl. */
export interface ColorScheme {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  primaryBorder: string;

  bg: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  zinc100: string;
  zinc300: string;
  zinc700: string;

  success: string;
  successDark: string;
  successBg: string;
  warning: string;
  warningDark: string;
  warningBg: string;
  danger: string;
  dangerDark: string;
  dangerBg: string;

  white: string;
  black: string;
}

/** Yorug' (light) palitra — asl DESIGN_SYSTEM qiymatlari. */
export const lightColors: ColorScheme = {
  primary: '#4F46E5', // indigo-600
  primaryDark: '#4338CA', // indigo-700
  primaryLight: '#EEF2FF', // indigo-50
  primaryBorder: '#C7D2FE', // indigo-200

  bg: '#FAFAFA', // zinc-50
  card: '#FFFFFF',
  border: '#E4E4E7', // zinc-200
  text: '#18181B', // zinc-900
  textMuted: '#71717A', // zinc-500
  textFaint: '#A1A1AA', // zinc-400
  zinc100: '#F4F4F5',
  zinc300: '#D4D4D8',
  zinc700: '#3F3F46',

  success: '#10B981', // emerald-500
  successDark: '#059669',
  successBg: '#ECFDF5',
  warning: '#F59E0B', // amber-500
  warningDark: '#B45309',
  warningBg: '#FFFBEB',
  danger: '#F43F5E', // rose-500
  dangerDark: '#BE123C',
  dangerBg: '#FFF1F2',

  white: '#FFFFFF',
  black: '#000000',
};

/**
 * Qorong'i (dark) palitra — zinc-950 asosli.
 * `*Dark` variantlari (successDark/warningDark/dangerDark) qorong'i fonda MATN
 * sifatida ishlatilgani uchun ataylab YORQINROQ (och) rangga o'giriladi.
 */
export const darkColors: ColorScheme = {
  primary: '#6366F1', // indigo-500 (yorqinroq)
  primaryDark: '#818CF8', // indigo-400 (tanlangan holat chegarasi)
  primaryLight: '#1E1B4B', // indigo-950 (to'q fon)
  primaryBorder: '#3730A3', // indigo-800

  bg: '#09090B', // zinc-950
  card: '#18181B', // zinc-900
  border: '#27272A', // zinc-800
  text: '#FAFAFA', // zinc-50
  textMuted: '#A1A1AA', // zinc-400
  textFaint: '#71717A', // zinc-500
  zinc100: '#27272A', // to'q "subtle" sirt (light'dagi zinc-100 o'rniga)
  zinc300: '#3F3F46',
  zinc700: '#D4D4D8',

  success: '#34D399', // emerald-400
  successDark: '#6EE7B7', // emerald-300 (to'q fonda matn)
  successBg: '#052E23', // to'q emerald
  warning: '#FBBF24', // amber-400
  warningDark: '#FCD34D', // amber-300 (to'q fonda matn)
  warningBg: '#3B2705', // to'q amber
  danger: '#FB7185', // rose-400
  dangerDark: '#FDA4AF', // rose-300 (to'q fonda matn)
  dangerBg: '#4C0519', // rose-950

  white: '#FFFFFF',
  black: '#000000',
};

/**
 * Non-React (modul-global) joylar uchun fallback — DOIM light.
 * React komponent/ekranlar `useTheme()` dan foydalanishi kerak.
 */
export const colors: ColorScheme = lightColors;

/**
 * Manrope font oilalari — RN'da custom shriftda `fontWeight` ISHLAMAYDI,
 * har og'irlik ALOHIDA oila. Matn stillarida `fontFamily: fonts.*` ishlating.
 * Fontlar `app/_layout.tsx` da `useFonts` orqali global yuklanadi.
 */
export const fonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  extrabold: 'Manrope_800ExtraBold',
} as const;

export const radius = {
  card: 16,
  control: 12,
  full: 999,
} as const;

/** 8px baza grid */
export const spacing = (n: number): number => n * 8;

export const shadow = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

export type EffectiveScheme = 'light' | 'dark';

export interface ThemeValue {
  colors: ColorScheme;
  isDark: boolean;
  /** Foydalanuvchi tanlagan rejim ('system' | 'light' | 'dark'). */
  mode: 'system' | 'light' | 'dark';
}

/**
 * Effektiv temani hisoblaydi: settings `themeMode` + OS `useColorScheme()`.
 * Zustand subscription tufayli rejim yoki OS temasi o'zgarsa hook'dan
 * foydalangan komponentlar avtomatik re-render bo'ladi.
 */
export function useTheme(): ThemeValue {
  const mode = useSettingsStore((s) => s.themeMode);
  const system = useColorScheme();
  const effective: EffectiveScheme = mode === 'system' ? (system ?? 'light') : mode;
  const isDark = effective === 'dark';
  return { colors: isDark ? darkColors : lightColors, isDark, mode };
}
