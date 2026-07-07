import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { fonts, radius, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

interface Props {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** default true — bosilganda light haptic */
  haptic?: boolean;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  haptic = true,
}: Props): React.ReactElement {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const isDisabled = disabled || loading;

  const bg: Record<ButtonVariant, string> = {
    primary: colors.primary,
    secondary: colors.white,
    success: colors.success,
    danger: colors.danger,
    ghost: 'transparent',
  };
  const fg: Record<ButtonVariant, string> = {
    primary: colors.white,
    // `secondary` foni DOIM oq (colors.white). Shuning uchun matn ham DOIM to'q
    // bo'lishi shart — aks holda dark rejimda yorug' `colors.text` oq fonda ko'rinmay
    // qoladi (muvaffaqiyat/ogohlantirish ekranlaridagi tugma "yo'qolib" ketardi).
    secondary: '#18181B',
    success: colors.white,
    danger: colors.white,
    ghost: colors.primary,
  };

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 18, stiffness: 300 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18, stiffness: 300 });
      }}
      onPress={() => {
        if (haptic) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress();
      }}
      style={[
        styles.base,
        size === 'lg' && styles.lg,
        { backgroundColor: bg[variant] },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        isDisabled && styles.disabled,
        animatedStyle,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              styles.title,
              size === 'lg' && styles.titleLg,
              { color: fg[variant] },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: radius.control,
  },
  lg: {
    height: 60,
    borderRadius: radius.card,
  },
  disabled: {
    opacity: 0.45,
  },
  title: {
    fontSize: 16,
    fontFamily: fonts.semibold,
  },
  titleLg: {
    fontSize: 18,
    fontFamily: fonts.bold,
  },
});
