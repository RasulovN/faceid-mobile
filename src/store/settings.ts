import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setLocale as setI18nLocale, type Locale } from '@/i18n';

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
 * `setLocale` chaqirilganда i18n global `currentLocale` bilan sinxronlanadi.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      locale: 'uz',
      setThemeMode: (themeMode) => set({ themeMode }),
      setLocale: (locale) => {
        setI18nLocale(locale);
        set({ locale });
      },
    }),
    {
      name: 'faceid-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ themeMode: s.themeMode, locale: s.locale }),
      // Diskdan tiklangach i18n global'ini saqlangan til bilan sinxronlash.
      onRehydrateStorage: () => (state) => {
        if (state) setI18nLocale(state.locale);
      },
    },
  ),
);
