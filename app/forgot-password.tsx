import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Pressable,
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
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/errors';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

const schema = z.object({
  email: z.string().trim().email(t('errEmail')),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setServerError(null);
    setLoading(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', auth: false, body: { email } });
      setSentTo(email);
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
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        {sentTo ? (
          <View style={styles.card}>
            <View style={styles.successIcon}>
              <Ionicons name="mail-open-outline" size={32} color={colors.success} />
            </View>
            <Text style={styles.title}>{t('forgotSentTitle')}</Text>
            <Text style={styles.subtitle}>{t('forgotSentDesc', { email: sentTo })}</Text>
            <Button title={t('backToLogin')} onPress={() => router.back()} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.title}>{t('forgotTitle')}</Text>
            <Text style={styles.subtitle}>{t('forgotSubtitle')}</Text>

            <Controller
              control={control}
              name="email"
              render={({ field: { value, onChange, onBlur } }) => (
                <Input
                  label={t('emailLabel')}
                  placeholder={t('emailPlaceholder')}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={errors.email?.message}
                />
              )}
            />

            {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}

            <Button title={t('sendLink')} onPress={() => void onSubmit()} loading={loading} />
          </View>
        )}
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
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.danger,
    marginBottom: 12,
  },
});
