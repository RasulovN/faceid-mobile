import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

interface Props extends TextInputProps {
  label: string;
  error?: string;
  /** parol maydoni — ko'z tugmasi bilan */
  secure?: boolean;
}

export function Input({ label, error, secure = false, ...rest }: Props): React.ReactElement {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [hidden, setHidden] = useState(secure);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          focused && styles.inputFocused,
          !!error && styles.inputError,
        ]}
      >
        <TextInput
          {...rest}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setHidden((v) => !v)}
            hitSlop={8}
            style={styles.eye}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    wrap: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.text,
      marginBottom: 6,
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.control,
    },
    inputFocused: {
      borderColor: colors.primary,
    },
    inputError: {
      borderColor: colors.danger,
    },
    input: {
      flex: 1,
      height: 48,
      paddingHorizontal: 14,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    eye: {
      paddingHorizontal: 12,
    },
    error: {
      marginTop: 4,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.danger,
    },
  });
