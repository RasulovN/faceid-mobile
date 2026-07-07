import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useT } from '@/i18n';
import { type ColorScheme, fonts, useTheme } from '@/theme';
import { Button } from './Button';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
}

/**
 * Fullscreen yashil muvaffaqiyat ekrani:
 * doira spring bilan kattalashadi, ichida chiziqlardan yasalgan check belgisi
 * ketma-ket chiziladi. Ochilishida success haptic.
 */
export function SuccessCheck({ title, subtitle, onClose }: Props): React.ReactElement {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const circleScale = useSharedValue(0);
  const shortBar = useSharedValue(0);
  const longBar = useSharedValue(0);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    circleScale.value = withSpring(1, { damping: 12, stiffness: 140 });
    shortBar.value = withDelay(250, withTiming(1, { duration: 180 }));
    longBar.value = withDelay(430, withTiming(1, { duration: 220 }));
  }, [circleScale, shortBar, longBar]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));
  // Check belgisi: qisqa chiziq (chapdan pastga) + uzun chiziq (pastdan yuqoriga)
  const shortStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: '45deg' }, { scaleX: shortBar.value }],
    opacity: shortBar.value > 0 ? 1 : 0,
  }));
  const longStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: '-50deg' }, { scaleX: longBar.value }],
    opacity: longBar.value > 0 ? 1 : 0,
  }));

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.circle, circleStyle]}>
        <View style={styles.checkBox}>
          <Animated.View style={[styles.barShort, shortStyle]} />
          <Animated.View style={[styles.barLong, longStyle]} />
        </View>
      </Animated.View>
      <Animated.Text entering={FadeIn.delay(500)} style={styles.title}>
        {title}
      </Animated.Text>
      {subtitle ? (
        <Animated.Text entering={FadeIn.delay(650)} style={styles.subtitle}>
          {subtitle}
        </Animated.Text>
      ) : null}
      <Animated.View entering={FadeIn.delay(800)} style={styles.buttonWrap}>
        <Button title={t('close')} variant="secondary" onPress={onClose} />
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 10,
  },
  circle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  checkBox: {
    width: 72,
    height: 72,
  },
  barShort: {
    position: 'absolute',
    left: 6,
    top: 38,
    width: 26,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white,
    transformOrigin: 'left center',
  },
  barLong: {
    position: 'absolute',
    left: 20,
    top: 50,
    width: 48,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.white,
    transformOrigin: 'left center',
  },
  title: {
    fontSize: 24,
    fontFamily: fonts.extrabold,
    color: colors.white,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  buttonWrap: {
    marginTop: 40,
    alignSelf: 'stretch',
  },
});
