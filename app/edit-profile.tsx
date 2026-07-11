import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
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
import { useAuthStore } from '@/store/auth';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

const schema = z
  .object({
    username: z.string().trim().min(3, t('errIdentifierShort')),
    email: z
      .string()
      .trim()
      .refine((v) => v === '' || z.string().email().safeParse(v).success, t('errEmail')),
    phone: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\+998\d{9}$/.test(v), t('errPhone')),
  })
  .refine((v) => v.email !== '' || v.phone !== '', {
    message: t('emailOrPhoneRequired'),
    path: ['email'],
  });

type FormValues = z.infer<typeof schema>;

/** Kiritilgan raqamni +998XXXXXXXXX ko'rinishiga keltiradi (bo'sh bo'lsa bo'sh qoladi) */
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('998')) digits = digits.slice(3);
  return `+998${digits.slice(0, 9)}`;
}

export default function EditProfileScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: user?.username ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setLoading(true);
    try {
      // Faqat to'ldirilgan maydonlar yuboriladi — backend bo'shlarini o'zgartirmaydi
      await api('/auth/profile', {
        method: 'PATCH',
        body: {
          username: values.username || undefined,
          email: values.email || undefined,
          phone: values.phone || undefined,
        },
      });
      await refreshMe();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('editProfile'), t('profileUpdated'), [
        { text: t('close'), onPress: () => router.back() },
      ]);
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
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('editProfile')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.subtitle}>{t('editProfileDesc')}</Text>

          <Controller
            control={control}
            name="username"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('usernameLabel')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                autoCapitalize="none"
                autoCorrect={false}
                error={errors.username?.message}
              />
            )}
          />
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
          <Controller
            control={control}
            name="phone"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('phoneLabel')}
                placeholder="+998 90 123 45 67"
                value={value}
                onChangeText={(v: string) => onChange(normalizePhone(v))}
                onBlur={onBlur}
                keyboardType="phone-pad"
                error={errors.phone?.message}
              />
            )}
          />

          {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}

          <Button title={t('save')} onPress={() => void onSubmit()} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginBottom: 16,
    lineHeight: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.danger,
    marginBottom: 12,
  },
});
