/** API_CONTRACT.md ga mos tiplar (mobil ilovaga kerakli qismi). */

export type Role =
  | 'SUPERADMIN'
  | 'COMPANY_OWNER'
  | 'COMPANY_ADMIN'
  | 'BRANCH_MANAGER'
  | 'HR'
  | 'EMPLOYEE';

export interface User {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: Role;
  companyId: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  lastLoginAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  /** metr, default 50 */
  geofenceRadius: number;
  isMain: boolean;
  isActive: boolean;
}

export interface ScheduleDay {
  /** 1 = dushanba … 7 = yakshanba */
  dayOfWeek: number;
  startTime: string; // "09:00"
  endTime: string; // "18:00"
  breakMinutes: number;
}

export interface WorkSchedule {
  id: string;
  name: string;
  type: 'FIXED' | 'SHIFT' | 'FLEXIBLE';
  days: ScheduleDay[];
  gracePeriodMinutes: number;
}

export type EmployeeStatus = 'ACTIVE' | 'VACATION' | 'FIRED';
export type SalaryType = 'FIXED' | 'HOURLY';

export interface Employee {
  id: string;
  userId: string;
  branchId: string;
  branch?: Branch | null;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  fullName: string;
  birthDate?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
  position: string;
  department?: string | null;
  tabNumber?: string | null;
  hiredAt: string;
  firedAt?: string | null;
  status: EmployeeStatus;
  salaryType: SalaryType;
  /** tiyin */
  salaryAmount: number;
  photoUrls: string[];
  embeddingsCount: number;
  notes?: string | null;
  schedule?: WorkSchedule | null;
}

export interface Company {
  id: string;
  name: string;
  slug?: string;
  logoUrl?: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  timezone?: string;
}

export interface MeResponse {
  user: User;
  employee?: Employee | null;
  company?: Company | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export type AttendanceType = 'CHECK_IN' | 'CHECK_OUT';

export interface AttendanceEvent {
  id: string;
  type: AttendanceType;
  timestamp: string;
  source?: string;
  isManual?: boolean;
  confidence?: number | null;
}

export type WorkDayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT'
  | 'WEEKEND'
  | 'HOLIDAY'
  | 'VACATION'
  | 'SICK'
  | 'INCOMPLETE';

/** GET /employees/:id/attendance?from&to — kunlik WorkDay ro'yxati */
export interface WorkDay {
  date: string; // "2026-07-06"
  status: WorkDayStatus;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  events?: AttendanceEvent[];
}

export interface MobileCheckResponse {
  ok: boolean;
  event: AttendanceEvent;
}

export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export interface PayrollRecord {
  id: string;
  employee?: { id: string; fullName: string } | null;
  periodMonth: string; // "2026-06"
  /** hammasi tiyin */
  baseSalary: number;
  workedMinutes: number;
  overtimeAmount: number;
  penaltyAmount: number;
  bonusAmount: number;
  totalAmount: number;
  status: PayrollStatus;
  generatedAt?: string;
}
