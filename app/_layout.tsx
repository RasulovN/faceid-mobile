import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { flushPendingErrorLogs, initErrorReporting } from '@/lib/error-reporter';
import { useAuthStore } from '@/store/auth';
import { useSettingsStore } from '@/store/settings';
import { useTheme } from '@/theme';

// Fatal JS xatolar superadmin panelga yuborilsin (imkon qadar erta o'rnatiladi).
initErrorReporting();

// Fontlar yuklanmaguncha splash ekranini ushlab turamiz.
void SplashScreen.preventAutoHideAsync();

// PUSH-NOTIFICATION SKELETON: backend'da push-token endpoint tayyor bo'lganda oching.
// import { registerForPushNotificationsAsync, sendPushTokenToBackend } from '@/lib/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  const status = useAuthStore((s) => s.status);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void useAuthStore.getState().bootstrap();
    // Oldingi sessiyada yuborilmay qolgan xato loglarini jo'natamiz
    void flushPendingErrorLogs();
  }, []);

  // PUSH-NOTIFICATION SKELETON: login'dan keyin push tokenni ro'yxatdan o'tkazish.
  // useEffect(() => {
  //   if (status === 'authed') {
  //     registerForPushNotificationsAsync().then((token) => {
  //       if (token) void sendPushTokenToBackend(token);
  //     });
  //   }
  // }, [status]);

  useEffect(() => {
    if (status === 'loading') return;
    const inAuthScreens = segments[0] === 'login' || segments[0] === 'forgot-password';
    if (status === 'guest' && !inAuthScreens) {
      console.log('[boot] guest -> /login ga yo\'naltirilmoqda');
      router.replace('/login');
    } else if (status === 'authed' && inAuthScreens) {
      console.log('[boot] authed -> / (asosiy) ga yo\'naltirilmoqda');
      router.replace('/');
    }
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Tema + til bilan reaktiv ildiz.
 * `useSettingsStore(s => s.locale)` ni kuzatib til o'zgarganда butun daraxt
 * qayta render bo'ladi (barcha `t()` chaqiruvlari yangilanadi).
 * `useTheme()` orqali StatusBar/fon ranglari temaga moslashadi.
 */
function ThemedRoot(): React.ReactElement {
  const { colors, isDark } = useTheme();
  // Reaktivlik: til o'zgarsa root (va butun Stack) qayta render bo'lsin.
  useSettingsStore((s) => s.locale);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="change-password" />
          <Stack.Screen
            name="check"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
        </Stack>
      </AuthGate>
    </>
  );
}

/** Fontlar qandaydir sabab bilan osilib qolsa ham splash abadiy qotib qolmasin. */
const SPLASH_TIMEOUT_MS = 4000;

export default function RootLayout(): React.ReactElement | null {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const [timedOut, setTimedOut] = useState(false);

  // Xavfsizlik taymeri: fontlar yuklanmasa ham belgilangan vaqtdan keyin davom etamiz.
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), SPLASH_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, []);

  const ready = fontsLoaded || !!fontError || timedOut;

  // Ilova chizishga tayyor bo'lishi bilanoq splash'ni yopamiz.
  // onLayout'ga bog'lanmaymiz — u ba'zi holatlarda ishlamay, splash qotib qolardi.
  useEffect(() => {
    if (!ready) return;
    console.log(
      '[boot] splash yopilmoqda (fontsLoaded=%s, fontError=%s, timedOut=%s)',
      fontsLoaded,
      !!fontError,
      timedOut,
    );
    // Splash allaqachon yopilgan bo'lsa hideAsync xatosini e'tiborsiz qoldiramiz.
    SplashScreen.hideAsync().catch(() => undefined);
  }, [ready, fontsLoaded, fontError, timedOut]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <ThemedRoot />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
