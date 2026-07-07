import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { type ColorScheme, fonts, radius, shadow, useTheme } from '@/theme';

interface Props {
  children: React.ReactNode;
  title?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, title, style }: Props): React.ReactElement {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

interface RowProps {
  label: string;
  value: string;
  valueColor?: string;
  bold?: boolean;
}

/** "Label ......... Value" qatori */
export function InfoRow({ label, value, valueColor, bold }: RowProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          valueColor ? { color: valueColor } : null,
          bold ? styles.rowValueBold : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      ...shadow.sm,
    },
    title: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
    },
    rowLabel: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      flexShrink: 1,
      marginRight: 12,
    },
    rowValue: {
      fontSize: 15,
      color: colors.text,
      fontFamily: fonts.medium,
      flexShrink: 1,
      textAlign: 'right',
    },
    rowValueBold: {
      fontFamily: fonts.bold,
      fontSize: 16,
    },
  });
