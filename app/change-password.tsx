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
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

const schema = z
  .object({
    currentPassword: z.string().min(1, t('errRequired')),
    newPassword: z.string().min(6, t('errPasswordShort')),
    confirmPassword: z.string().min(1, t('errRequired')),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: t('errPasswordMatch'),
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export default function ChangePasswordScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setLoading(true);
    try {
      await api('/auth/change-password', {
        method: 'PATCH',
        body: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        },
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('changePassword'), t('passwordChanged'), [
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
          <Text style={styles.headerTitle}>{t('changePassword')}</Text>
        </View>

        <View style={styles.card}>
          <Controller
            control={control}
            name="currentPassword"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('currentPasswordLabel')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secure
                autoCapitalize="none"
                error={errors.currentPassword?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="newPassword"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('newPasswordLabel')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secure
                autoCapitalize="none"
                error={errors.newPassword?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { value, onChange, onBlur } }) => (
              <Input
                label={t('confirmPasswordLabel')}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                secure
                autoCapitalize="none"
                error={errors.confirmPassword?.message}
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
  errorText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.danger,
    marginBottom: 12,
  },
});
