import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { t, useT } from '@/i18n';
import { apiErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/auth';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

const schema = z.object({
  identifier: z.string().trim().min(3, t('errIdentifierShort')),
  password: z.string().min(1, t('errRequired')),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  // Reaktiv tarjima — modul-global `t` (yuqoridagi zod schema) faqat validatsiya uchun.
  const t = useT();
  const signIn = useAuthStore((s) => s.signIn);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setLoading(true);
    try {
      await signIn(values.identifier, values.password);
      // muvaffaqiyatda AuthGate avtomatik bosh ekranga yo'naltiradi
    } catch (err) {
      setServerError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  });

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoWrap}>
          <View style={styles.logo}>
            <Ionicons name="scan-outline" size={36} color={colors.white} />
          </View>
          <Text style={styles.appName}>{t('appName')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t('loginTitle')}</Text>
          <Text style={styles.subtitle}>{t('loginSubtitle')}</Text>

          <Controller
            control={control}
            name="identifier"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('identifierLabel')}
                placeholder={t('identifierPlaceholder')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                error={errors.identifier?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('passwordLabel')}
                placeholder={t('passwordPlaceholder')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secure
                autoCapitalize="none"
                error={errors.password?.message}
              />
            )}
          />

          {serverError ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{serverError}</Text>
            </View>
          ) : null}

          <Button title={t('loginButton')} onPress={() => void onSubmit()} loading={loading} />

          <Link href="/forgot-password" asChild>
            <Text style={styles.forgot}>{t('forgotPassword')}</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  appName: {
    fontSize: 20,
    fontFamily: fonts.extrabold,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerBg,
    borderRadius: radius.control,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.dangerDark,
  },
  forgot: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.primary,
  },
});
