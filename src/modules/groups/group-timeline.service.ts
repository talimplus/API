import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';

export type GroupTimelineEventType =
  | 'group_created'
  | 'group_started'
  | 'group_finished'
  | 'group_end_planned'
  | 'teacher_assigned'
  | 'teacher_changed'
  | 'schedule_set'
  | 'schedule_changed'
  | 'fee_set'
  | 'fee_changed'
  | 'pause'
  | 'lesson_moved'
  | 'student_joined'
  | 'student_left'
  | 'student_transferred_in'
  | 'student_transferred_out';

export interface GroupTimelineEvent {
  /** Hodisa kuchga kirgan kun (YYYY-MM-DD, guruh timezone'ida). */
  date: string;
  type: GroupTimelineEventType;
  /** Tayyor matn (uz) — front xohlasa `data` dan o'zi yasaydi. */
  title: string;
  data: Record<string, any>;
}

type Day = { day: string; startTime: string };

const DAY_LABELS: Record<string, string> = {
  monday: 'Du',
  tuesday: 'Se',
  wednesday: 'Ch',
  thursday: 'Pa',
  friday: 'Ju',
  saturday: 'Sh',
  sunday: 'Ya',
};
const DAY_ORDER = Object.keys(DAY_LABELS);

/**
 * Guruh tarixi (timeline) — mavjud tarix jadvallaridan yig'iladi, alohida
 * "audit" jadvali yo'q:
 * - o'qituvchi — `group_teacher_periods`, jadval — `group_schedule_periods`,
 *   narx — `group_fee_periods`, pauza — `group_pauses`,
 *   ko'chirilgan darslar — `attendance_lesson_overrides`,
 *   o'quvchilar — `student_group_enrollments` (qo'shildi/chiqdi/ko'chirildi);
 * - status o'zgarishlari va xona tarixi saqlanmaydi — faqat boshlanish /
 *   tugash sanalari ko'rsatiladi.
 * Kim o'zgartirgani ham yozilmaydi (pauza va dars ko'chirishdan tashqari).
 */
@Injectable()
export class GroupTimelineService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private d(v: Date | string | null | undefined): string | null {
    return v ? dayjs(v).format('YYYY-MM-DD') : null;
  }

  private money(n: number): string {
    return `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
  }

  private scheduleLabel(days: Day[]): string {
    return [...(days ?? [])]
      .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day))
      .map(
        (x) =>
          `${DAY_LABELS[x.day] ?? x.day} ${String(x.startTime).slice(0, 5)}`,
      )
      .join(', ');
  }

  async getTimeline(
    groupId: number,
    organizationId: number,
    centerId?: number,
  ): Promise<GroupTimelineEvent[]> {
    const q = (sql: string, params: any[] = [groupId]) =>
      this.dataSource.query(sql, params);

    const [group] = await q(
      `SELECT g."id", g."status", g."startDate", g."endDate", g."createdAt",
              g."timezone", g."centerId"
         FROM "groups" g
         JOIN "centers" c ON c."id" = g."centerId"
        WHERE g."id" = $1 AND c."organizationId" = $2`,
      [groupId, organizationId],
    );
    if (!group || (centerId && Number(group.centerId) !== centerId)) {
      throw new NotFoundException('Group not found');
    }
    const tz = group.timezone || 'Asia/Tashkent';
    const events: GroupTimelineEvent[] = [];

    events.push({
      date: dayjs(group.createdAt).tz(tz).format('YYYY-MM-DD'),
      type: 'group_created',
      title: 'Guruh yaratildi',
      data: {},
    });
    const startDate = this.d(group.startDate);
    if (startDate) {
      events.push({
        date: startDate,
        type: 'group_started',
        title: 'Darslar boshlanishi',
        data: {},
      });
    }
    const endDate = this.d(group.endDate);
    if (endDate) {
      const finished = group.status === 'finished';
      events.push({
        date: endDate,
        type: finished ? 'group_finished' : 'group_end_planned',
        title: finished ? 'Guruh yakunlandi' : 'Darslar tugashi (reja)',
        data: {},
      });
    }

    const teachers: {
      fromDate: Date;
      teacherId: number | null;
      fullName: string | null;
    }[] = await q(
      `SELECT tp."fromDate", tp."teacherId",
              NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS "fullName"
         FROM "group_teacher_periods" tp
         LEFT JOIN "users" u ON u."id" = tp."teacherId"
        WHERE tp."groupId" = $1
        ORDER BY tp."fromDate" ASC`,
    );
    teachers.forEach((t, i) => {
      const prev = i > 0 ? teachers[i - 1] : null;
      const name = t.fullName ?? "o'qituvchisiz";
      events.push({
        date: this.d(t.fromDate) as string,
        type: prev ? 'teacher_changed' : 'teacher_assigned',
        title: prev
          ? `O'qituvchi almashdi: ${prev.fullName ?? "o'qituvchisiz"} → ${name}`
          : `O'qituvchi: ${name}`,
        data: {
          teacherId: t.teacherId,
          teacherName: t.fullName,
          previousTeacherId: prev?.teacherId ?? null,
          previousTeacherName: prev?.fullName ?? null,
        },
      });
    });

    const schedules: { fromDate: Date; days: Day[] }[] = await q(
      `SELECT "fromDate", "days" FROM "group_schedule_periods"
        WHERE "groupId" = $1 ORDER BY "fromDate" ASC`,
    );
    schedules.forEach((s, i) => {
      const prev = i > 0 ? schedules[i - 1] : null;
      events.push({
        date: this.d(s.fromDate) as string,
        type: prev ? 'schedule_changed' : 'schedule_set',
        title: prev
          ? `Jadval o'zgardi: ${this.scheduleLabel(prev.days)} → ${this.scheduleLabel(s.days)}`
          : `Jadval: ${this.scheduleLabel(s.days)}`,
        data: { days: s.days, previousDays: prev?.days ?? null },
      });
    });

    const fees: { fromMonth: Date; monthlyFee: string }[] = await q(
      `SELECT "fromMonth", "monthlyFee" FROM "group_fee_periods"
        WHERE "groupId" = $1 ORDER BY "fromMonth" ASC`,
    );
    fees.forEach((f, i) => {
      const prev = i > 0 ? fees[i - 1] : null;
      const fee = Number(f.monthlyFee ?? 0);
      const prevFee = prev ? Number(prev.monthlyFee ?? 0) : null;
      events.push({
        date: dayjs(f.fromMonth).format('YYYY-MM-01'),
        type: prev ? 'fee_changed' : 'fee_set',
        title:
          prevFee !== null
            ? `Oylik narx o'zgardi: ${this.money(prevFee)} → ${this.money(fee)}`
            : `Oylik narx: ${this.money(fee)}`,
        data: { monthlyFee: fee, previousMonthlyFee: prevFee },
      });
    });

    const pauses: {
      fromDate: Date;
      toDate: Date;
      reason: string;
      createdByName: string | null;
    }[] = await q(
      `SELECT p."fromDate", p."toDate", p."reason",
              NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS "createdByName"
         FROM "group_pauses" p
         LEFT JOIN "users" u ON u."id" = p."createdById"
        WHERE p."groupId" = $1`,
    );
    for (const p of pauses) {
      events.push({
        date: this.d(p.fromDate) as string,
        type: 'pause',
        title: `Guruh to'xtatildi (${this.d(p.fromDate)} — ${this.d(p.toDate)}): ${p.reason}`,
        data: {
          fromDate: this.d(p.fromDate),
          toDate: this.d(p.toDate),
          reason: p.reason,
          createdByName: p.createdByName,
        },
      });
    }

    const overrides: {
      fromDate: Date;
      toDate: Date;
      reason: string | null;
      createdByName: string | null;
    }[] = await q(
      `SELECT o."fromDate", o."toDate", o."reason",
              NULLIF(TRIM(CONCAT(u."firstName", ' ', u."lastName")), '') AS "createdByName"
         FROM "attendance_lesson_overrides" o
         LEFT JOIN "users" u ON u."id" = o."createdById"
        WHERE o."groupId" = $1`,
    );
    for (const o of overrides) {
      events.push({
        date: this.d(o.fromDate) as string,
        type: 'lesson_moved',
        title: `Dars ko'chirildi: ${this.d(o.fromDate)} → ${this.d(o.toDate)}`,
        data: {
          fromDate: this.d(o.fromDate),
          toDate: this.d(o.toDate),
          reason: o.reason,
          createdByName: o.createdByName,
        },
      });
    }

    const enrollments: {
      studentId: number;
      fullName: string | null;
      joinedAt: Date;
      leftAt: Date | null;
      leftReason: string | null;
      transferredFromGroupId: number | null;
      transferredFromGroupName: string | null;
      transferredToGroupId: number | null;
      transferredToGroupName: string | null;
    }[] = await q(
      `SELECT e."studentId", e."joinedAt", e."leftAt", e."leftReason",
              NULLIF(TRIM(CONCAT(s."firstName", ' ', s."lastName")), '') AS "fullName",
              e."transferredFromGroupId", gf."name" AS "transferredFromGroupName",
              e."transferredToGroupId", gt."name" AS "transferredToGroupName"
         FROM "student_group_enrollments" e
         LEFT JOIN "students" s ON s."id" = e."studentId"
         LEFT JOIN "groups" gf ON gf."id" = e."transferredFromGroupId"
         LEFT JOIN "groups" gt ON gt."id" = e."transferredToGroupId"
        WHERE e."groupId" = $1`,
    );
    for (const e of enrollments) {
      const name = e.fullName ?? `#${e.studentId}`;
      const student = {
        studentId: Number(e.studentId),
        studentName: e.fullName,
      };
      events.push(
        e.transferredFromGroupId
          ? {
              date: this.d(e.joinedAt) as string,
              type: 'student_transferred_in',
              title: `${name} ko'chib keldi (${e.transferredFromGroupName ?? `#${e.transferredFromGroupId}`} guruhidan)`,
              data: {
                ...student,
                groupId: e.transferredFromGroupId,
                groupName: e.transferredFromGroupName,
              },
            }
          : {
              date: this.d(e.joinedAt) as string,
              type: 'student_joined',
              title: `${name} guruhga qo'shildi`,
              data: student,
            },
      );
      if (!e.leftAt) continue;
      events.push(
        e.transferredToGroupId
          ? {
              date: this.d(e.leftAt) as string,
              type: 'student_transferred_out',
              title: `${name} ko'chirildi (${e.transferredToGroupName ?? `#${e.transferredToGroupId}`} guruhiga)`,
              data: {
                ...student,
                groupId: e.transferredToGroupId,
                groupName: e.transferredToGroupName,
              },
            }
          : {
              date: this.d(e.leftAt) as string,
              type: 'student_left',
              title: `${name} guruhdan chiqdi`,
              data: { ...student, reason: e.leftReason },
            },
      );
    }

    // Yangisi tepada; bir kunda — guruh hodisalari o'quvchilardan oldin.
    const rank = (t: GroupTimelineEventType) =>
      t.startsWith('student_') ? 1 : 0;
    return events.sort(
      (a, b) => b.date.localeCompare(a.date) || rank(a.type) - rank(b.type),
    );
  }
}
