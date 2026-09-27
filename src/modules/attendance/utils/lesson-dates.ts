import { WeekDay } from '@/common/enums/group-schedule.enum';
import { dayjs } from '@/shared/utils/dayjs';

export type ScheduleInput = {
  day: WeekDay;
  startTime: string; // HH:mm or HH:mm:ss (not used for date existence, kept for future)
};

export type LessonDatesWindow =
  | { mode: 'last'; count: number }
  | { mode: 'range'; from: string; to: string };

export type SchedulePeriodInput = {
  fromDate: string | Date; // YYYY-MM-DD, inclusive
  days: ScheduleInput[];
};

export type PauseInput = {
  fromDate: string | Date; // YYYY-MM-DD, inclusive
  toDate: string | Date; // YYYY-MM-DD, inclusive
};

/** Sana to'xtatilgan davrga tushadimi. */
export function buildPausedChecker(
  pauses?: PauseInput[] | null,
): (date: string) => boolean {
  const ranges = (pauses ?? []).map((p) => ({
    from: dayjs(p.fromDate).format('YYYY-MM-DD'),
    to: dayjs(p.toDate).format('YYYY-MM-DD'),
  }));
  if (!ranges.length) return () => false;
  return (date: string) => ranges.some((r) => r.from <= date && date <= r.to);
}

export type ComputeLessonDatesArgs = {
  timezone: string;
  groupStartDate: string; // YYYY-MM-DD
  groupEndDate?: string | null; // YYYY-MM-DD
  schedules: ScheduleInput[];
  /**
   * Jadval tarixi (`group_schedule_periods`). Berilsa, har bir sana o'sha
   * kunda amalda bo'lgan jadval bo'yicha tekshiriladi va `schedules` faqat
   * zaxira bo'lib qoladi. Jadval o'zgargandan keyin ham o'tgan darslar
   * eski kunlarda qoladi.
   */
  schedulePeriods?: SchedulePeriodInput[] | null;
  /**
   * Guruh to'xtatilgan davrlar (`group_pauses`, inclusive). Bu kunlardagi
   * darslar o'tkazilmaydi va natijaga kirmaydi.
   */
  pauses?: PauseInput[] | null;
  /** Bayram kunlari (`holidays`, inclusive) — bu kunlarda dars bo'lmaydi. */
  holidays?: PauseInput[] | null;
  now?: string; // optional "now" ISO string; defaults to runtime now
  window: LessonDatesWindow;
};

const weekDayToDayjsDow: Record<WeekDay, number> = {
  [WeekDay.SUNDAY]: 0,
  [WeekDay.MONDAY]: 1,
  [WeekDay.TUESDAY]: 2,
  [WeekDay.WEDNESDAY]: 3,
  [WeekDay.THURSDAY]: 4,
  [WeekDay.FRIDAY]: 5,
  [WeekDay.SATURDAY]: 6,
};

const toDows = (days: ScheduleInput[]): number[] =>
  Array.from(new Set((days ?? []).map((s) => weekDayToDayjsDow[s.day])));

/**
 * Sana (YYYY-MM-DD) uchun amaldagi dars kunlarini qaytaruvchi funksiya.
 * Davr: `fromDate <= sana` ga mos eng oxirgisi, bo'lmasa eng birinchisi.
 */
function buildDowResolver(
  schedules: ScheduleInput[],
  periods?: SchedulePeriodInput[] | null,
): { hasAny: boolean; dowsFor: (date: string) => number[] } {
  const normalized = (periods ?? [])
    .filter((p) => p && p.fromDate && p.days?.length)
    .map((p) => ({
      from: dayjs(p.fromDate).format('YYYY-MM-DD'),
      dows: toDows(p.days),
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  if (!normalized.length) {
    const dows = toDows(schedules);
    return { hasAny: dows.length > 0, dowsFor: () => dows };
  }

  return {
    hasAny: true,
    dowsFor: (date: string) => {
      let picked = normalized[0];
      for (const p of normalized) {
        if (p.from <= date) picked = p;
        else break;
      }
      return picked.dows;
    },
  };
}

/**
 * Pure function: computes lesson dates from schedule + group boundaries only.
 * Does NOT read attendance DB.
 */
export function computeLessonDates(args: ComputeLessonDatesArgs): string[] {
  const { timezone, schedules, groupStartDate, groupEndDate, window } = args;

  const resolver = buildDowResolver(schedules, args.schedulePeriods);
  if (!resolver.hasAny) return [];
  const isPaused = buildPausedChecker([
    ...(args.pauses ?? []),
    ...(args.holidays ?? []),
  ]);
  const isLessonDay = (d: ReturnType<typeof dayjs>) => {
    const key = d.format('YYYY-MM-DD');
    return resolver.dowsFor(key).includes(d.day()) && !isPaused(key);
  };

  const start = dayjs.tz(groupStartDate, timezone).startOf('day');
  const endBoundary = groupEndDate
    ? dayjs.tz(groupEndDate, timezone).startOf('day')
    : null;

  const now = args.now ? dayjs.tz(args.now, timezone) : dayjs().tz(timezone);
  const today = now.startOf('day');

  if (window.mode === 'range') {
    const from = dayjs.tz(window.from, timezone).startOf('day');
    const to = dayjs.tz(window.to, timezone).startOf('day');

    const rangeStart = from.isAfter(start) ? from : start;
    const rangeEnd = endBoundary
      ? to.isBefore(endBoundary)
        ? to
        : endBoundary
      : to;

    if (rangeEnd.isBefore(rangeStart)) return [];

    const out: string[] = [];
    let cursor = rangeStart;
    while (cursor.isSame(rangeEnd) || cursor.isBefore(rangeEnd)) {
      if (isLessonDay(cursor)) {
        out.push(cursor.format('YYYY-MM-DD'));
      }
      cursor = cursor.add(1, 'day');
    }
    return out;
  }

  // mode === 'last'
  const count = Math.max(0, window.count ?? 0);
  if (!count) return [];

  const latest = endBoundary
    ? today.isBefore(endBoundary)
      ? today
      : endBoundary
    : today;

  if (latest.isBefore(start)) return [];

  const found: string[] = [];
  let cursor = latest;
  while (
    (cursor.isSame(start) || cursor.isAfter(start)) &&
    found.length < count
  ) {
    if (isLessonDay(cursor)) {
      found.push(cursor.format('YYYY-MM-DD'));
    }
    cursor = cursor.subtract(1, 'day');
  }

  return found.reverse();
}
