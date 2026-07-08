import { useCallback } from 'react';
import { useSettingsStore } from '@/store/settings';
import { en } from './en';
import { ru } from './ru';
import { uz } from './uz';
import { uzCyrl } from './uz-Cyrl';

/**
 * Minimal i18n qatlam — 4 til.
 *
 * Ikki xil kirish nuqtasi:
 *  - `useT()` — REAKTIV hook (React komponentlar uchun). `useSettingsStore(s => s.locale)`
 *    ga obuna bo'ladi, shuning uchun til o'zgarganda hook'ni ishlatgan har bir komponent
 *    qayta render bo'ladi va matnlar darhol yangilanadi (navigatsiya buzilmaydi).
 *  - `t()` — GLOBAL funksiya (non-komponent kontekstlar: `src/lib/*` xato/format matnlari).
 *    Modul-global `currentLocale` bo'yicha ishlaydi; `setLocale` uni settings store bilan
 *    sinxronlaydi.
 */
const dictionaries = {
  uz,
  'uz-Cyrl': uzCyrl,
  ru,
  en,
} as const;

export type Locale = keyof typeof dictionaries;
export type TranslationKey = keyof typeof uz;
export type TranslateVars = Record<string, string | number>;
export type TFunction = (key: TranslationKey, vars?: TranslateVars) => string;

/** Berilgan locale + kalit bo'yicha matnni oladi va `{placeholder}`larni almashtiradi. */
function translate(locale: Locale, key: TranslationKey, vars?: TranslateVars): string {
  let text: string = dictionaries[locale][key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

let currentLocale: Locale = 'uz';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

// Global `currentLocale` ni settings store bilan sinxron ushlaymiz.
// Subscription ham foydalanuvchi tanlovини (setLocale), ham AsyncStorage'dan
// rehydrate bo'lishni qamrab oladi — settings.ts endi i18n'ni import qilmaydi
// (require cycle yo'q).
currentLocale = useSettingsStore.getState().locale;
useSettingsStore.subscribe((s) => {
  currentLocale = s.locale;
});

/**
 * Global (non-reaktiv) tarjima funksiyasi — FAQAT React komponentidan tashqarida
 * ishlating (masalan `src/lib/errors.ts`, `src/lib/api.ts`, `src/lib/format.ts`).
 * React komponentlarida `useT()` dan foydalaning.
 */
export function t(key: TranslationKey, vars?: TranslateVars): string {
  return translate(currentLocale, key, vars);
}

/**
 * Reaktiv tarjima hook'i. Joriy locale'ga obuna bo'ladi va shu locale'ga bog'langan
 * `t` funksiyani qaytaradi. Locale o'zgarsa — hook'ni ishlatgan komponent re-render
 * bo'lib, barcha `t('key')` chaqiruvlari yangi tilga o'tadi.
 *
 * @example
 *   const t = useT();
 *   <Text>{t('loginTitle')}</Text>
 */
export function useT(): TFunction {
  const locale = useSettingsStore((s) => s.locale);
  return useCallback(
    (key: TranslationKey, vars?: TranslateVars) => translate(locale, key, vars),
    [locale],
  );
}
