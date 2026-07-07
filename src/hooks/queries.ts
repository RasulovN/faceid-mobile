import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { AttendanceEvent, PayrollRecord, WorkDay, WorkDayStatus } from '@/types/api';

/** API kontrakt shakli: GET /employees/:id/attendance → [{ date, workDay, events }] */
interface AttendanceDayDto {
  date: string;
  workDay: {
    status: WorkDayStatus;
    scheduledMinutes: number;
    workedMinutes: number;
    lateMinutes: number;
    earlyLeaveMinutes: number;
    overtimeMinutes: number;
  } | null;
  events: AttendanceEvent[];
}

function toWorkDay(dto: AttendanceDayDto): WorkDay {
  const checkIn = dto.events.find((e) => e.type === 'CHECK_IN');
  const checkOut = [...dto.events].reverse().find((e) => e.type === 'CHECK_OUT');
  return {
    date: dto.date,
    status: dto.workDay?.status ?? (dto.events.length > 0 ? 'INCOMPLETE' : 'WEEKEND'),
    scheduledMinutes: dto.workDay?.scheduledMinutes ?? 0,
    workedMinutes: dto.workDay?.workedMinutes ?? 0,
    lateMinutes: dto.workDay?.lateMinutes ?? 0,
    earlyLeaveMinutes: dto.workDay?.earlyLeaveMinutes ?? 0,
    overtimeMinutes: dto.workDay?.overtimeMinutes ?? 0,
    checkInAt: checkIn?.timestamp ?? null,
    checkOutAt: checkOut?.timestamp ?? null,
    events: dto.events,
  };
}

/** GET /employees/:id/attendance?from&to — kunlik davomat (kontrakt DTO → WorkDay) */
export function useMyAttendance(from: string, to: string) {
  const employeeId = useAuthStore((s) => s.employee?.id);
  return useQuery({
    queryKey: ['attendance', employeeId, from, to],
    enabled: !!employeeId,
    queryFn: async () => {
      const days = await api<AttendanceDayDto[]>(`/employees/${employeeId}/attendance`, {
        query: { from, to },
      });
      return days.map(toWorkDay);
    },
  });
}

export interface PayrollQueryResult {
  /** null → EMPLOYEE roliga ruxsat berilmagan (403) — taxminiy hisob rejimi */
  record: PayrollRecord | null;
  forbidden: boolean;
}

/**
 * GET /payroll?month= — o'z recordini so'raydi.
 * 403 bo'lsa graceful: forbidden=true qaytaradi (ekran taxminiy hisob ko'rsatadi).
 */
export function useMyPayroll(month: string) {
  const employeeId = useAuthStore((s) => s.employee?.id);
  return useQuery<PayrollQueryResult>({
    queryKey: ['payroll', employeeId, month],
    enabled: !!employeeId,
    queryFn: async () => {
      try {
        const records = await api<PayrollRecord[]>('/payroll', { query: { month } });
        const mine =
          records.find((r) => r.employee?.id === employeeId) ??
          (records.length === 1 ? records[0] : null);
        return { record: mine ?? null, forbidden: false };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.code === 'FORBIDDEN')) {
          return { record: null, forbidden: true };
        }
        throw err;
      }
    },
  });
}
