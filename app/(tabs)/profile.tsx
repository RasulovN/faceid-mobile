import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BranchMap } from '@/components/BranchMap';
import { Card, InfoRow } from '@/components/Card';
import { useT, type Locale, type TranslationKey } from '@/i18n';
import { fmtDate } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { type ThemeMode, useSettingsStore } from '@/store/settings';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Tema rejimi → tarjima kaliti va ikonka. */
const THEME_OPTIONS: { mode: ThemeMode; key: TranslationKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: 'system', key: 'themeSystem', icon: 'phone-portrait-outline' },
  { mode: 'light', key: 'themeLight', icon: 'sunny-outline' },
  { mode: 'dark', key: 'themeDark', icon: 'moon-outline' },
];

/** Til → o'z yozuvidagi native nomi (barcha lug'atlarda bir xil). */
const LANG_OPTIONS: { locale: Locale; key: TranslationKey }[] = [
  { locale: 'uz', key: 'langUz' },
  { locale: 'uz-Cyrl', key: 'langUzCyrl' },
  { locale: 'ru', key: 'langRu' },
  { locale: 'en', key: 'langEn' },
];

const THEME_ICON: Record<ThemeMode, keyof typeof Ionicons.glyphMap> = {
  system: 'phone-portrait-outline',
  light: 'sunny-outline',
  dark: 'moon-outline',
};

const THEME_KEY: Record<ThemeMode, TranslationKey> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const LANG_KEY: Record<Locale, TranslationKey> = {
  uz: 'langUz',
  'uz-Cyrl': 'langUzCyrl',
  ru: 'langRu',
  en: 'langEn',
};

// ---------------------------------------------------------------------------
// Sozlama qatori (row)
// ---------------------------------------------------------------------------

interface SettingRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  danger?: boolean;
  showChevron?: boolean;
  onPress: () => void;
}

function SettingRow({
  icon,
  label,
  value,
  danger,
  showChevron = true,
  onPress,
}: SettingRowProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const accent = danger ? colors.danger : colors.primary;
  const tint = danger ? colors.dangerBg : colors.primaryLight;

  const handlePress = (): void => {
    void Haptics.selectionAsync();
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={19} color={accent} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Pastdan chiquvchi modal (bottom-sheet)
// ---------------------------------------------------------------------------

interface OptionSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function OptionSheet({ visible, title, onClose, children }: OptionSheetProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <AnimatedPressable
          entering={FadeIn.duration(160)}
          style={styles.backdrop}
          onPress={onClose}
        />
        <Animated.View
          entering={SlideInDown.springify().damping(18).stiffness(160).mass(0.6)}
          style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SheetOptionProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}

function SheetOption({ icon, label, active, onPress }: SheetOptionProps): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetOption,
        active && styles.sheetOptionActive,
        pressed && styles.rowPressed,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={22}
          color={active ? colors.primary : colors.textMuted}
          style={styles.sheetOptionIcon}
        />
      ) : null}
      <Text style={[styles.sheetOptionLabel, active && styles.sheetOptionLabelActive]}>
        {label}
      </Text>
      {active ? (
        <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
      ) : (
        <View style={styles.sheetRadio} />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Guruh sarlavhasi
// ---------------------------------------------------------------------------

function GroupLabel({ label }: { label: string }): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.groupLabel}>{label}</Text>;
}

// ---------------------------------------------------------------------------
// Ekran
// ---------------------------------------------------------------------------

export default function ProfileScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();

  const user = useAuthStore((s) => s.user);
  const employee = useAuthStore((s) => s.employee);
  const signOut = useAuthStore((s) => s.signOut);

  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);

  const [themeSheet, setThemeSheet] = useState(false);
  const [langSheet, setLangSheet] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const branch = employee?.branch ?? null;
  const displayName = employee?.fullName ?? user?.username ?? '';
  const photoUrl = avatarError ? null : (employee?.photoUrls?.[0] ?? user?.avatarUrl ?? null);
  const subtitle = employee
    ? `${employee.position}${employee.department ? ` • ${employee.department}` : ''}`
    : (user?.email ?? '');

  const confirmLogout = (): void => {
    Alert.alert(t('logoutConfirmTitle'), t('logoutConfirmDesc'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const selectTheme = (mode: ThemeMode): void => {
    void Haptics.selectionAsync();
    setThemeMode(mode);
    setThemeSheet(false);
  };

  const selectLocale = (next: Locale): void => {
    void Haptics.selectionAsync();
    setLocale(next);
    setLangSheet(false);
  };

  return (
    <>
      <ScrollView
        style={[styles.flex, { backgroundColor: colors.bg }]}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
      >
        <Text style={styles.screenTitle}>{t('profileTitle')}</Text>

        {/* Profil header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.avatarImage}
                resizeMode="cover"
                onError={() => setAvatarError(true)}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text style={styles.avatarText}>{initials(displayName) || '•'}</Text>
            )}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
          {branch ? (
            <View style={styles.branchChip}>
              <Ionicons name="business-outline" size={13} color={colors.primary} />
              <Text style={styles.branchChipText} numberOfLines={1}>
                {branch.name}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Shaxsiy ma'lumot */}
        <Card style={styles.card}>
          <InfoRow label={t('usernameLabel')} value={user?.username ?? '—'} />
          <InfoRow label={t('emailLabel')} value={user?.email ?? '—'} />
          <InfoRow label={t('phoneLabel')} value={user?.phone ?? '—'} />
          {employee?.tabNumber ? (
            <InfoRow label={t('tabNumberLabel')} value={employee.tabNumber} />
          ) : null}
          {employee ? (
            <InfoRow label={t('hiredAtLabel')} value={fmtDate(employee.hiredAt)} />
          ) : null}
        </Card>

        {/* Filial xaritada */}
        {branch ? (
          <Card title={t('branchLabel')} style={styles.card}>
            <Text style={styles.branchName}>{branch.name}</Text>
            {branch.address ? <Text style={styles.branchAddress}>{branch.address}</Text> : null}
            <View style={styles.mapBox}>
              <BranchMap
                latitude={branch.latitude}
                longitude={branch.longitude}
                radiusMeters={branch.geofenceRadius}
                height={170}
              />
            </View>
          </Card>
        ) : null}

        {/* Sozlamalar guruhi — tema/til modal orqali */}
        <GroupLabel label={t('settingsGroupTitle')} />
        <Card style={styles.groupCard}>
          <SettingRow
            icon={THEME_ICON[themeMode]}
            label={t('appThemeLabel')}
            value={t(THEME_KEY[themeMode])}
            onPress={() => setThemeSheet(true)}
          />
          <View style={styles.rowDivider} />
          <SettingRow
            icon="language-outline"
            label={t('language')}
            value={t(LANG_KEY[locale])}
            onPress={() => setLangSheet(true)}
          />
        </Card>

        {/* Hisob guruhi */}
        <GroupLabel label={t('accountGroupTitle')} />
        <Card style={styles.groupCard}>
          <SettingRow
            icon="key-outline"
            label={t('changePassword')}
            onPress={() => router.push('/change-password')}
          />
        </Card>

        {/* Chiqish */}
        <Card style={styles.groupCard}>
          <SettingRow
            icon="log-out-outline"
            label={t('logout')}
            danger
            showChevron={false}
            onPress={confirmLogout}
          />
        </Card>

        <Text style={styles.version}>
          {t('versionLabel')} {Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>

      {/* Tema tanlash modali */}
      <OptionSheet visible={themeSheet} title={t('theme')} onClose={() => setThemeSheet(false)}>
        {THEME_OPTIONS.map((opt) => (
          <SheetOption
            key={opt.mode}
            icon={opt.icon}
            label={t(opt.key)}
            active={themeMode === opt.mode}
            onPress={() => selectTheme(opt.mode)}
          />
        ))}
      </OptionSheet>

      {/* Til tanlash modali */}
      <OptionSheet visible={langSheet} title={t('language')} onClose={() => setLangSheet(false)}>
        {LANG_OPTIONS.map((opt) => (
          <SheetOption
            key={opt.locale}
            label={t(opt.key)}
            active={locale === opt.locale}
            onPress={() => selectLocale(opt.locale)}
          />
        ))}
      </OptionSheet>
    </>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    container: {
      paddingHorizontal: 16,
      paddingBottom: 40,
      backgroundColor: colors.bg,
    },
    screenTitle: {
      fontSize: 24,
      fontFamily: fonts.extrabold,
      color: colors.text,
      marginBottom: 16,
    },
    // Header
    header: {
      alignItems: 'center',
      paddingVertical: 20,
      marginBottom: 20,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
      overflow: 'hidden',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarText: {
      fontSize: 32,
      fontFamily: fonts.extrabold,
      color: colors.primary,
    },
    name: {
      fontSize: 22,
      fontFamily: fonts.extrabold,
      color: colors.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginTop: 4,
      textAlign: 'center',
    },
    branchChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      maxWidth: '90%',
    },
    branchChipText: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: colors.primary,
      flexShrink: 1,
    },
    // Kartalar
    card: {
      marginBottom: 16,
    },
    groupCard: {
      marginBottom: 16,
      paddingVertical: 4,
    },
    groupLabel: {
      fontSize: 12,
      fontFamily: fonts.bold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      marginLeft: 4,
    },
    branchName: {
      fontSize: 16,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    branchAddress: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginTop: 2,
    },
    mapBox: {
      marginTop: 12,
    },
    // Sozlama qatori
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
    },
    rowPressed: {
      opacity: 0.6,
    },
    rowIcon: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.semibold,
      color: colors.text,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      maxWidth: 140,
    },
    rowDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 50,
    },
    version: {
      textAlign: 'center',
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textFaint,
      marginTop: 8,
    },
    // Modal / bottom-sheet
    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 16,
      paddingTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 12,
    },
    sheetTitle: {
      fontSize: 17,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 12,
      marginLeft: 4,
    },
    sheetOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: 'transparent',
      marginBottom: 8,
    },
    sheetOptionActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primaryBorder,
    },
    sheetOptionIcon: {
      marginRight: 12,
    },
    sheetOptionLabel: {
      flex: 1,
      fontSize: 16,
      fontFamily: fonts.semibold,
      color: colors.text,
    },
    sheetOptionLabelActive: {
      color: colors.primary,
    },
    sheetRadio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: colors.border,
    },
  });
