import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
// FAQAT type import — runtime'da o'chiriladi, i18n bilan require cycle hosil qilmaydi.
// i18n global `currentLocale` sinxronlash i18n/index.ts'dagi store subscription'da.
import type { Locale } from '@/i18n';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  /** Foydalanuvchi tanlagan tema rejimi. Effektiv rang uchun `useTheme()` ga qarang. */
  themeMode: ThemeMode;
  locale: Locale;
  setThemeMode: (mode: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
}

/**
 * Sozlamalar store'i — AsyncStorage'da saqlanadi (rehydrate on start).
 * i18n global `currentLocale` bilan sinxronlash i18n/index.ts'dagi subscription
 * orqali bo'ladi (setLocale ham, rehydrate ham set() chaqirib subscriber'larni uyg'otadi).
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      locale: 'uz',
      setThemeMode: (themeMode) => set({ themeMode }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'faceid-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ themeMode: s.themeMode, locale: s.locale }),
    },
  ),
);
