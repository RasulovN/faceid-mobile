import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, InfoRow } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { useMyAttendance, useMyPayroll } from '@/hooks/queries';
import { useT, type TFunction } from '@/i18n';
import { fmtMoney, isoMonth, minutesToHM, monthRange, monthTitle } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { type ColorScheme, fonts, radius, useTheme } from '@/theme';
import type { PayrollStatus } from '@/types/api';

function statusBadge(
  status: PayrollStatus,
  colors: ColorScheme,
  t: TFunction,
): { label: string; bg: string; fg: string } {
  switch (status) {
    case 'PAID':
      return { label: t('payrollStatusPaid'), bg: colors.successBg, fg: colors.successDark };
    case 'APPROVED':
      return { label: t('payrollStatusApproved'), bg: colors.primaryLight, fg: colors.primary };
    default:
      return { label: t('payrollStatusDraft'), bg: colors.zinc100, fg: colors.textMuted };
  }
}

export default function PayrollScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = useT();
  const employee = useAuthStore((s) => s.employee);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const monthParam = isoMonth(year, month);
  const payrollQuery = useMyPayroll(monthParam);

  const record = payrollQuery.data?.record ?? null;
  // 403 yoki record topilmasa → davomat asosidagi taxminiy hisob
  const needEstimate = !payrollQuery.isLoading && !record;

  const { from, to } = monthRange(year, month);
  const attendanceQuery = useMyAttendance(from, to);

  const estimate = useMemo(() => {
    if (!employee) return null;
    const days = attendanceQuery.data ?? [];
    const workedMinutes = days.reduce((sum, wd) => sum + (wd.workedMinutes || 0), 0);
    const amount =
      employee.salaryType === 'HOURLY'
        ? Math.round((employee.salaryAmount * workedMinutes) / 60)
        : employee.salaryAmount;
    return { workedMinutes, amount };
  }, [employee, attendanceQuery.data]);

  const changeMonth = (delta: number): void => {
    void Haptics.selectionAsync();
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const loading = payrollQuery.isLoading || (needEstimate && attendanceQuery.isLoading);

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.bg }]}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
    >
      <Text style={styles.screenTitle}>{t('payrollTitle')}</Text>

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

      {loading ? (
        <Card style={styles.section}>
          <View style={styles.skeletonGap}>
            <Skeleton height={22} width="50%" />
            <Skeleton height={18} width="70%" />
            <Skeleton height={18} width="60%" />
            <Skeleton height={30} width="80%" />
          </View>
        </Card>
      ) : record ? (
        <>
          {/* Rasmiy PayrollRecord */}
          <Card style={styles.section}>
            <View style={styles.totalHeader}>
              <View style={styles.flex}>
                <Text style={styles.totalLabel}>{t('totalAmount')}</Text>
                <Text style={styles.totalValue}>{fmtMoney(record.totalAmount)}</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: statusBadge(record.status, colors, t).bg },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: statusBadge(record.status, colors, t).fg }]}
                >
                  {statusBadge(record.status, colors, t).label}
                </Text>
              </View>
            </View>
          </Card>

          <Card title={t('payrollTitle')} style={styles.section}>
            <InfoRow label={t('baseSalary')} value={fmtMoney(record.baseSalary)} />
            <InfoRow label={t('workedTime')} value={minutesToHM(record.workedMinutes)} />
            {record.overtimeAmount > 0 ? (
              <InfoRow
                label={t('overtimeAmount')}
                value={`+ ${fmtMoney(record.overtimeAmount)}`}
                valueColor={colors.successDark}
              />
            ) : null}
            {record.bonusAmount > 0 ? (
              <InfoRow
                label={t('bonusAmount')}
                value={`+ ${fmtMoney(record.bonusAmount)}`}
                valueColor={colors.successDark}
              />
            ) : null}
            {record.penaltyAmount > 0 ? (
              <InfoRow
                label={t('penaltyAmount')}
                value={`− ${fmtMoney(record.penaltyAmount)}`}
                valueColor={colors.dangerDark}
              />
            ) : null}
            <View style={styles.divider} />
            <InfoRow label={t('totalAmount')} value={fmtMoney(record.totalAmount)} bold />
          </Card>
        </>
      ) : (
        <>
          {/* Taxminiy hisob (403 yoki record hali yo'q) */}
          {estimate ? (
            <Card title={t('estimateTitle')} style={styles.section}>
              <InfoRow
                label={t('baseSalary')}
                value={employee ? fmtMoney(employee.salaryAmount) : '—'}
              />
              <InfoRow label={t('workedTime')} value={minutesToHM(estimate.workedMinutes)} />
              <View style={styles.divider} />
              <InfoRow
                label={t('totalAmount')}
                value={`≈ ${fmtMoney(estimate.amount)}`}
                bold
              />
            </Card>
          ) : (
            <Card style={styles.section}>
              <Text style={styles.empty}>{t('noPayrollYet')}</Text>
            </Card>
          )}

          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={18} color={colors.warningDark} />
            <Text style={styles.noteText}>{t('estimateNote')}</Text>
          </View>
        </>
      )}
    </ScrollView>
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
  totalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  totalValue: {
    fontSize: 26,
    fontFamily: fonts.extrabold,
    color: colors.text,
    marginTop: 4,
  },
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.warningBg,
    borderRadius: radius.control,
    padding: 12,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.warningDark,
    lineHeight: 18,
  },
  skeletonGap: {
    gap: 12,
  },
  empty: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
