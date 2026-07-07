import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, InfoRow } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { useMyAttendance } from '@/hooks/queries';
import { useT, type TFunction } from '@/i18n';
import {
  fmtDate,
  fmtTime,
  minutesToHM,
  monthMatrix,
  monthRange,
  monthTitle,
  WEEKDAYS_SHORT_UZ,
} from '@/lib/format';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import type { WorkDay, WorkDayStatus } from '@/types/api';

interface DayColors {
  bg: string;
  fg: string;
}

function colorsForStatus(status: WorkDayStatus | undefined, colors: ColorScheme): DayColors {
  switch (status) {
    case 'PRESENT':
      return { bg: colors.successBg, fg: colors.successDark };
    case 'LATE':
    case 'INCOMPLETE':
      return { bg: colors.warningBg, fg: colors.warningDark };
    case 'ABSENT':
      return { bg: colors.dangerBg, fg: colors.dangerDark };
    case 'WEEKEND':
    case 'HOLIDAY':
    case 'VACATION':
      return { bg: colors.zinc100, fg: colors.textFaint };
    default:
      return { bg: 'transparent', fg: colors.text };
  }
}

function statusLabel(status: WorkDayStatus | undefined, t: TFunction): string {
  switch (status) {
    case 'PRESENT':
      return t('statusPresent');
    case 'LATE':
      return t('statusLate');
    case 'ABSENT':
      return t('statusAbsent');
    case 'WEEKEND':
      return t('statusWeekend');
    case 'HOLIDAY':
      return t('statusHoliday');
    case 'VACATION':
      return t('statusVacation');
    case 'INCOMPLETE':
      return t('statusIncomplete');
    default:
      return t('statusUnknown');
  }
}

export default function AttendanceScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { from, to } = monthRange(year, month);
  const query = useMyAttendance(from, to);

  const byDay = useMemo(() => {
    const map = new Map<number, WorkDay>();
    for (const wd of query.data ?? []) {
      const d = new Date(wd.date);
      if (!Number.isNaN(d.getTime())) map.set(d.getDate(), wd);
    }
    return map;
  }, [query.data]);

  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const todayDate = now.getDate();

  // Oy statistikasi
  const stats = useMemo(() => {
    const days = (query.data ?? []).filter((wd) => {
      const d = new Date(wd.date);
      return d.getTime() <= now.getTime();
    });
    const workingDays = days.filter(
      (wd) => wd.status !== 'WEEKEND' && wd.status !== 'HOLIDAY' && wd.status !== 'VACATION',
    );
    const attended = workingDays.filter((wd) => wd.status === 'PRESENT' || wd.status === 'LATE');
    const lateDays = days.filter((wd) => wd.lateMinutes > 0);
    const totalWorked = days.reduce((sum, wd) => sum + (wd.workedMinutes || 0), 0);
    const rate =
      workingDays.length > 0 ? Math.round((attended.length / workingDays.length) * 100) : null;
    return { totalWorked, lateCount: lateDays.length, rate };
  }, [query.data, now]);

  const selected = selectedDay !== null ? byDay.get(selectedDay) : undefined;

  const changeMonth = (delta: number): void => {
    void Haptics.selectionAsync();
    setSelectedDay(null);
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.bg }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
    >
      <Text style={styles.screenTitle}>{t('attendanceTitle')}</Text>

      {/* Oy almashtirgich */}
      <View style={styles.monthSwitcher}>
        <Pressable onPress={() => changeMonth(-1)} hitSlop={10} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.monthTitle}>{monthTitle(year, month)}</Text>
        <Pressable onPress={() => changeMonth(1)} hitSlop={10} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Kalendar */}
      <Card style={styles.section}>
        <View style={styles.weekHeader}>
          {WEEKDAYS_SHORT_UZ.map((d) => (
            <Text key={d} style={styles.weekDay}>
              {d}
            </Text>
          ))}
        </View>

        {query.isLoading ? (
          <View style={styles.skeletonGap}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={40} borderRadius={10} />
            ))}
          </View>
        ) : (
          weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                if (day === null) return <View key={di} style={styles.dayCell} />;
                const wd = byDay.get(day);
                const c = colorsForStatus(wd?.status, colors);
                const isToday = isCurrentMonth && day === todayDate;
                const isSelected = selectedDay === day;
                return (
                  <Pressable
                    key={di}
                    style={styles.dayCell}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSelectedDay(day);
                    }}
                  >
                    <View
                      style={[
                        styles.dayInner,
                        { backgroundColor: c.bg },
                        isToday && styles.dayToday,
                        isSelected && styles.daySelected,
                      ]}
                    >
                      <Text style={[styles.dayText, { color: c.fg }]}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))
        )}

        {/* Legend */}
        <View style={styles.legend}>
          <LegendItem color={colors.successBg} dot={colors.successDark} label={t('legendPresent')} />
          <LegendItem color={colors.warningBg} dot={colors.warningDark} label={t('legendLate')} />
          <LegendItem color={colors.dangerBg} dot={colors.dangerDark} label={t('legendAbsent')} />
          <LegendItem color={colors.zinc100} dot={colors.textFaint} label={t('legendOff')} />
        </View>
      </Card>

      {/* Tanlangan kun detali */}
      {selectedDay !== null ? (
        <Card
          title={fmtDate(`${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`)}
          style={styles.section}
        >
          <InfoRow
            label={t('attendanceTitle')}
            value={statusLabel(selected?.status, t)}
            valueColor={colorsForStatus(selected?.status, colors).fg}
            bold
          />
          <InfoRow
            label={t('checkedInAt')}
            value={selected?.checkInAt ? fmtTime(selected.checkInAt) : '—'}
          />
          <InfoRow
            label={t('checkedOutAt')}
            value={selected?.checkOutAt ? fmtTime(selected.checkOutAt) : '—'}
          />
          <InfoRow
            label={t('dayDetailWorked')}
            value={selected ? minutesToHM(selected.workedMinutes) : '—'}
          />
          {selected && selected.lateMinutes > 0 ? (
            <InfoRow
              label={t('dayDetailLate')}
              value={minutesToHM(selected.lateMinutes)}
              valueColor={colors.warningDark}
            />
          ) : null}
        </Card>
      ) : null}

      {/* Oy statistikasi */}
      <Card title={t('monthStats')} style={styles.section}>
        {query.isLoading ? (
          <View style={styles.skeletonGap}>
            <Skeleton height={18} width="55%" />
            <Skeleton height={18} width="40%" />
            <Skeleton height={18} width="48%" />
          </View>
        ) : (query.data ?? []).length === 0 ? (
          <Text style={styles.empty}>{t('noAttendanceData')}</Text>
        ) : (
          <>
            <InfoRow label={t('totalWorked')} value={minutesToHM(stats.totalWorked)} bold />
            <InfoRow
              label={t('lateCount')}
              value={t('timesCount', { count: stats.lateCount })}
              valueColor={stats.lateCount > 0 ? colors.warningDark : colors.successDark}
            />
            <InfoRow
              label={t('attendanceRate')}
              value={stats.rate !== null ? `${stats.rate}%` : '—'}
              valueColor={
                stats.rate !== null && stats.rate >= 90 ? colors.successDark : colors.text
              }
              bold
            />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function LegendItem({
  color,
  dot,
  label,
}: {
  color: string;
  dot: string;
  label: string;
}): React.ReactElement {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]}>
        <View style={[styles.legendDot, { backgroundColor: dot }]} />
      </View>
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ColorScheme) => StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    backgroundColor: colors.bg,
  },
  screenTitle: {
    fontSize: 24,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginBottom: 12,
  },
  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  section: {
    marginBottom: 16,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.textFaint,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    padding: 2,
  },
  dayInner: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  daySelected: {
    borderWidth: 2,
    borderColor: colors.primaryDark,
  },
  dayText: {
    fontSize: 14,
    fontFamily: fonts.semibold,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 18,
    height: 18,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  skeletonGap: {
    gap: 8,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
