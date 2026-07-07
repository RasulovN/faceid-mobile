import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BranchMap } from '@/components/BranchMap';
import { Button } from '@/components/Button';
import { Card, InfoRow } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { useMyAttendance } from '@/hooks/queries';
import { useLiveLocation } from '@/hooks/useLiveLocation';
import { useT, type TFunction } from '@/i18n';
import { fmtDate, fmtTime, isoDate, minutesToHM } from '@/lib/format';
import { formatDistance, haversineMeters } from '@/lib/geo';
import { useAuthStore } from '@/store/auth';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import type { AttendanceType, WorkDay } from '@/types/api';

function greetingByHour(t: TFunction): string {
  const h = new Date().getHours();
  if (h < 12) return t('greetingMorning');
  if (h < 18) return t('greetingDay');
  return t('greetingEvening');
}

/** Bugungi workday'dan keyingi harakat turini aniqlaydi (oxirgi event tipi bo'yicha). */
function deriveNextType(day: WorkDay | undefined): AttendanceType {
  if (!day) return 'CHECK_IN';
  if (day.events && day.events.length > 0) {
    const last = [...day.events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )[day.events.length - 1];
    return last.type === 'CHECK_IN' ? 'CHECK_OUT' : 'CHECK_IN';
  }
  if (day.checkInAt && !day.checkOutAt) return 'CHECK_OUT';
  return 'CHECK_IN';
}

export default function TodayScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const employee = useAuthStore((s) => s.employee);
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const isSuspended = company?.status === 'SUSPENDED' || company?.status === 'EXPIRED';

  const today = isoDate(new Date());
  const attendanceQuery = useMyAttendance(today, today);
  const todayWorkDay: WorkDay | undefined = attendanceQuery.data?.[0];

  const { location, permission } = useLiveLocation(!!employee?.branch);

  const branch = employee?.branch ?? null;
  const distance = useMemo(() => {
    if (!location || !branch) return null;
    return haversineMeters(location.latitude, location.longitude, branch.latitude, branch.longitude);
  }, [location, branch]);

  const geofenceRadius = branch?.geofenceRadius ?? 50;
  const inZone = distance !== null && distance <= geofenceRadius;
  const nextType = deriveNextType(todayWorkDay);

  // Bugungi ish grafigi (schedule'dan; bo'lmasa default 09:00–18:00)
  const scheduleText = useMemo(() => {
    const isoWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=Du … 7=Ya
    const day = employee?.schedule?.days.find((d) => d.dayOfWeek === isoWeekday);
    if (employee?.schedule && !day) return null; // grafik bor, lekin bugun yo'q → dam
    if (day) return `${day.startTime} – ${day.endTime}`;
    return '09:00 – 18:00';
  }, [employee]);

  if (!employee) {
    return (
      <View style={[styles.flex, styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="person-remove-outline" size={48} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>{t('notEmployeeTitle')}</Text>
        <Text style={styles.emptyDesc}>{t('notEmployeeDesc')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.bg }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
      refreshControl={
        <RefreshControl
          refreshing={attendanceQuery.isRefetching}
          onRefresh={() => void attendanceQuery.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      {/* Salomlashuv */}
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.greeting}>
            {greetingByHour(t)}, {employee.firstName || user?.username} 👋
          </Text>
          <Text style={styles.date}>{fmtDate(today)}</Text>
        </View>
      </View>

      {/* Obuna to'xtatilgan — davomat cheklangan */}
      {isSuspended ? (
        <View style={styles.suspendedBanner}>
          <Ionicons name="alert-circle" size={24} color={colors.danger} />
          <View style={styles.flex}>
            <Text style={styles.suspendedTitle}>{t('subscriptionSuspendedTitle')}</Text>
            <Text style={styles.suspendedDesc}>{t('subscriptionSuspendedDesc')}</Text>
          </View>
        </View>
      ) : null}

      {/* Bugungi holat */}
      <Card title={t('todayStatus')} style={styles.section}>
        {attendanceQuery.isLoading ? (
          <View style={styles.skeletonGap}>
            <Skeleton height={20} width="60%" />
            <Skeleton height={20} width="45%" />
            <Skeleton height={20} width="52%" />
          </View>
        ) : (
          <>
            <InfoRow
              label={t('scheduleToday')}
              value={scheduleText ?? t('dayOffToday')}
            />
            <InfoRow
              label={t('checkedInAt')}
              value={todayWorkDay?.checkInAt ? fmtTime(todayWorkDay.checkInAt) : '—'}
              valueColor={todayWorkDay?.checkInAt ? colors.successDark : colors.textFaint}
              bold={!!todayWorkDay?.checkInAt}
            />
            <InfoRow
              label={t('checkedOutAt')}
              value={todayWorkDay?.checkOutAt ? fmtTime(todayWorkDay.checkOutAt) : '—'}
              valueColor={todayWorkDay?.checkOutAt ? colors.text : colors.textFaint}
              bold={!!todayWorkDay?.checkOutAt}
            />
            {todayWorkDay && todayWorkDay.workedMinutes > 0 ? (
              <InfoRow
                label={t('workedToday')}
                value={minutesToHM(todayWorkDay.workedMinutes)}
              />
            ) : null}
            {!todayWorkDay?.checkInAt ? (
              <Text style={styles.notArrived}>{t('notArrivedYet')}</Text>
            ) : null}
            {todayWorkDay && todayWorkDay.lateMinutes > 0 ? (
              <View style={styles.lateBadge}>
                <Ionicons name="time-outline" size={14} color={colors.warningDark} />
                <Text style={styles.lateText}>
                  {t('lateBy', { minutes: todayWorkDay.lateMinutes })}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </Card>

      {/* Mock location ogohlantirish */}
      {location?.mocked ? (
        <View style={styles.mockWarning}>
          <Ionicons name="warning-outline" size={18} color={colors.warningDark} />
          <Text style={styles.mockText}>{t('mockLocationWarning')}</Text>
        </View>
      ) : null}

      {/* Geofence holati */}
      {permission === 'denied' ? (
        <Card style={styles.section}>
          <View style={styles.zoneRow}>
            <Ionicons name="location-outline" size={20} color={colors.danger} />
            <View style={styles.flex}>
              <Text style={styles.zoneTitle}>{t('locationDenied')}</Text>
              <Text style={styles.zoneDesc}>{t('locationDeniedDesc')}</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.section}>
          <View style={styles.zoneRow}>
            <Ionicons
              name={inZone ? 'checkmark-circle' : 'navigate-outline'}
              size={20}
              color={inZone ? colors.success : distance !== null ? colors.warning : colors.textFaint}
            />
            <View style={styles.flex}>
              {distance === null ? (
                <Text style={styles.zoneTitle}>{t('locationSearching')}</Text>
              ) : inZone ? (
                <Text style={[styles.zoneTitle, { color: colors.successDark }]}>
                  {t('inZone')}
                </Text>
              ) : (
                <>
                  <Text style={[styles.zoneTitle, { color: colors.warningDark }]}>
                    {t('outOfZone')}
                  </Text>
                  <Text style={styles.zoneDistance}>
                    {t('distanceToBranch', { distance: formatDistance(distance) })}
                  </Text>
                </>
              )}
            </View>
          </View>

          {/* Radius tashqarisida — mini xarita (filial marker + radius doira) */}
          {distance !== null && !inZone && branch ? (
            <View style={styles.mapBox}>
              <BranchMap
                latitude={branch.latitude}
                longitude={branch.longitude}
                radiusMeters={geofenceRadius}
                userLocation={location}
                height={160}
              />
            </View>
          ) : null}
        </Card>
      )}

      {/* Katta harakat tugmasi */}
      <Button
        title={nextType === 'CHECK_IN' ? t('checkInButton') : t('checkOutButton')}
        variant={nextType === 'CHECK_IN' ? 'primary' : 'danger'}
        size="lg"
        disabled={!inZone || isSuspended}
        icon={
          <Ionicons
            name={nextType === 'CHECK_IN' ? 'log-in-outline' : 'log-out-outline'}
            size={24}
            color={colors.white}
          />
        }
        onPress={() => router.push({ pathname: '/check', params: { type: nextType } })}
        style={styles.actionButton}
      />
    </ScrollView>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.bg,
  },
  container: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  greeting: {
    fontSize: 22,
    fontFamily: fonts.extrabold,
    color: colors.text,
  },
  date: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: 16,
  },
  suspendedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.dangerBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 16,
    marginBottom: 16,
  },
  suspendedTitle: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.dangerDark,
  },
  suspendedDesc: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.dangerDark,
    marginTop: 4,
    lineHeight: 19,
  },
  skeletonGap: {
    gap: 12,
  },
  notArrived: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  lateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.warningBg,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  lateText: {
    fontSize: 13,
    fontFamily: fonts.semibold,
    color: colors.warningDark,
  },
  mockWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warningBg,
    borderRadius: radius.control,
    padding: 12,
    marginBottom: 16,
  },
  mockText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.warningDark,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  zoneTitle: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  zoneDesc: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  zoneDistance: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 2,
  },
  mapBox: {
    marginTop: 12,
  },
  actionButton: {
    marginTop: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
});
