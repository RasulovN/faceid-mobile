import { t } from '@/i18n';

export const MONTHS_UZ = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const;

/** Dushanbadan boshlanadi */
export const WEEKDAYS_SHORT_UZ = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** ISO timestamp → "09:41" */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "2026-07-06" yoki ISO → "06.07.2026" */
export function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Date → lokal "YYYY-MM-DD" */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Date → "2026-07" (payroll month param) */
export function isoMonth(year: number, monthIdx0: number): string {
  return `${year}-${pad2(monthIdx0 + 1)}`;
}

/** "Iyul 2026" */
export function monthTitle(year: number, monthIdx0: number): string {
  return `${MONTHS_UZ[monthIdx0]} ${year}`;
}

/** Oy boshi/oxiri — attendance so'rovi uchun */
export function monthRange(year: number, monthIdx0: number): { from: string; to: string } {
  return {
    from: isoDate(new Date(year, monthIdx0, 1)),
    to: isoDate(new Date(year, monthIdx0 + 1, 0)),
  };
}

/** 452 → "7 soat 32 daq" */
export function minutesToHM(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} ${t('minuteShort')}`;
  if (rest === 0) return `${h} ${t('hourShort')}`;
  return `${h} ${t('hourShort')} ${rest} ${t('minuteShort')}`;
}

/** tiyin → "1 250 000 so'm" */
export function fmtMoney(tiyin: number): string {
  const soum = Math.round(tiyin / 100);
  const formatted = String(soum).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${t('soum')}`;
}

/** Kalendar matritsasi: haftalar (dushanba birinchi), bo'sh katak = null */
export function monthMatrix(year: number, monthIdx0: number): (number | null)[][] {
  const first = new Date(year, monthIdx0, 1);
  const daysInMonth = new Date(year, monthIdx0 + 1, 0).getDate();
  const startIdx = (first.getDay() + 6) % 7; // Yak=0 → Du=0 ga surish
  const cells: (number | null)[] = new Array<number | null>(startIdx).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
