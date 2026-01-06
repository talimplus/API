import { WeekDay } from '@/common/enums/group-schedule.enum';
import { dayjs } from '@/shared/utils/dayjs';

export type ScheduleInput = {
  day: WeekDay;
  startTime: string; // HH:mm or HH:mm:ss (not used for date existence, kept for future)
};

export type LessonDatesWindow =
  | { mode: 'last'; count: number }
  | { mode: 'range'; from: string; to: string };

export type ComputeLessonDatesArgs = {
  timezone: string;
  groupStartDate: string; // YYYY-MM-DD
  groupEndDate?: string | null; // YYYY-MM-DD
  schedules: ScheduleInput[];
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

/**
 * Pure function: computes lesson dates from schedule + group boundaries only.
 * Does NOT read attendance DB.
 */
export function computeLessonDates(args: ComputeLessonDatesArgs): string[] {
  const { timezone, schedules, groupStartDate, groupEndDate, window } = args;

  const scheduleDows = Array.from(
    new Set(schedules.map((s) => weekDayToDayjsDow[s.day])),
  );
  if (!scheduleDows.length) return [];

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
      ? (to.isBefore(endBoundary) ? to : endBoundary)
      : to;

    if (rangeEnd.isBefore(rangeStart)) return [];

    const out: string[] = [];
    let cursor = rangeStart;
    while (cursor.isSame(rangeEnd) || cursor.isBefore(rangeEnd)) {
      if (scheduleDows.includes(cursor.day())) {
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
    ? (today.isBefore(endBoundary) ? today : endBoundary)
    : today;

  if (latest.isBefore(start)) return [];

  const found: string[] = [];
  let cursor = latest;
  while ((cursor.isSame(start) || cursor.isAfter(start)) && found.length < count) {
    if (scheduleDows.includes(cursor.day())) {
      found.push(cursor.format('YYYY-MM-DD'));
    }
    cursor = cursor.subtract(1, 'day');
  }

  return found.reverse();
}


