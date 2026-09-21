import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupStatus } from '@/modules/groups/enums/group-status.enum';
import { Room } from '@/modules/rooms/entities/rooms.entity';
import { GroupSchedule } from './entities/group-schedule.entity';

/** Guruhda davomiylik ko'rsatilmagan bo'lsa (eski yozuv) shu qiymat olinadi. */
export const DEFAULT_LESSON_DURATION_MINUTES = 90;

/** Tekshirilayotgan bitta dars: hafta kuni + boshlanish vaqti. */
export interface ScheduleSlotInput {
  day: WeekDay;
  startTime: string; // 'HH:mm' yoki 'HH:mm:ss'
}

/**
 * Bitta to'qnashuv. `reason` — nima band: xonami yoki o'qituvchimi.
 * Xabarni frontend o'zi yig'adi (tarjima uchun), shuning uchun bu yerda
 * tayyor matn emas, faqat faktlar qaytariladi.
 */
export interface ScheduleConflict {
  reason: 'room' | 'teacher';
  day: WeekDay;
  /** Yangi (tekshirilayotgan) dars vaqti */
  requestedStartTime: string;
  requestedEndTime: string;
  /** Xona/o'qituvchini band qilib turgan guruh */
  groupId: number;
  groupName: string;
  startTime: string;
  endTime: string;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
}

/** Jadval panjarasidagi bitta dars. */
export interface ScheduleBoardLesson {
  groupId: number;
  groupName: string;
  groupStatus: GroupStatus;
  day: WeekDay;
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  durationMinutes: number;
  roomId: number | null;
  roomName: string | null;
  teacherId: number | null;
  teacherName: string | null;
  subjectId: number | null;
  subjectName: string | null;
}

/** 'HH:mm' / 'HH:mm:ss' -> yarim tundan boshlab daqiqa. */
export function timeToMinutes(value: string): number {
  const [h = '0', m = '0'] = String(value ?? '').split(':');
  return Number(h) * 60 + Number(m);
}

/** Daqiqa -> 'HH:mm' (24 soatdan oshsa ham kesilmaydi, sutka ichida qoladi). */
export function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(total)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Dars jadvali: panjara uchun ma'lumot va xona/o'qituvchi bandligi tekshiruvi.
 *
 * Alohida kichik modul sifatida turadi, chunki uni ham `GroupsModule`
 * (guruh yaratish/tahrirlashda bloklash uchun), ham `GroupScheduleModule`
 * (sahifa va "oldindan tekshirish" endpointi uchun) ishlatadi.
 *
 * **Qoida:** ikkita dars bir xil kunda, bir xil xonada (yoki bir xil
 * o'qituvchida) vaqti kesishsa — to'qnashuv. Kesishish yopiq-ochiq oraliq
 * bo'yicha hisoblanadi: `[start, start + davomiylik)`, ya'ni 09:00–10:30 va
 * 10:30–12:00 **to'qnashmaydi**.
 */
@Injectable()
export class ScheduleBoardService {
  constructor(
    @InjectRepository(GroupSchedule)
    private readonly scheduleRepo: Repository<GroupSchedule>,
    @InjectRepository(Room)
    private readonly roomRepo: Repository<Room>,
  ) {}

  private durationOf(group?: Group | null): number {
    const raw = Number(group?.lessonDurationMinutes ?? 0);
    return raw > 0 ? raw : DEFAULT_LESSON_DURATION_MINUTES;
  }

  private fullName(user?: { firstName?: string; lastName?: string } | null) {
    if (!user) return null;
    return [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
  }

  /** Tugamagan guruhlarning jadval qatorlari (guruh + xona + o'qituvchi bilan). */
  private baseQuery(organizationId: number) {
    return this.scheduleRepo
      .createQueryBuilder('schedule')
      .innerJoinAndSelect('schedule.group', 'group')
      .leftJoinAndSelect('group.room', 'room')
      .leftJoinAndSelect('group.teacher', 'teacher')
      .leftJoinAndSelect('group.subject', 'subject')
      .innerJoin('group.center', 'center')
      .innerJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('group.status != :finished', {
        finished: GroupStatus.FINISHED,
      });
  }

  /**
   * Xona yoki o'qituvchi bandligi.
   *
   * `roomId`/`teacherId` bo'sh bo'lsa o'sha tekshiruv o'tkazib yuboriladi
   * (guruhga xona yoki o'qituvchi biriktirilmagan bo'lishi mumkin).
   */
  async findConflicts(args: {
    organizationId: number;
    days: ScheduleSlotInput[];
    durationMinutes?: number | null;
    roomId?: number | null;
    teacherId?: number | null;
    excludeGroupId?: number | null;
  }): Promise<ScheduleConflict[]> {
    const { organizationId, days, roomId, teacherId, excludeGroupId } = args;
    if (!days?.length) return [];
    if (!roomId && !teacherId) return [];

    const duration =
      Number(args.durationMinutes ?? 0) > 0
        ? Number(args.durationMinutes)
        : DEFAULT_LESSON_DURATION_MINUTES;

    const requested = days
      .filter((d) => d?.day && d?.startTime)
      .map((d) => {
        const start = timeToMinutes(d.startTime);
        return { day: d.day, start, end: start + duration };
      });
    if (!requested.length) return [];

    const qb = this.baseQuery(organizationId).andWhere(
      'schedule.day IN (:...days)',
      { days: Array.from(new Set(requested.map((r) => r.day))) },
    );

    if (roomId && teacherId) {
      qb.andWhere('(room.id = :roomId OR teacher.id = :teacherId)', {
        roomId,
        teacherId,
      });
    } else if (roomId) {
      qb.andWhere('room.id = :roomId', { roomId });
    } else {
      qb.andWhere('teacher.id = :teacherId', { teacherId });
    }

    if (excludeGroupId) {
      qb.andWhere('group.id != :excludeGroupId', { excludeGroupId });
    }

    const rows = await qb.getMany();
    const conflicts: ScheduleConflict[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const group = row.group;
      if (!group) continue;

      const existingStart = timeToMinutes(row.startTime);
      const existingEnd = existingStart + this.durationOf(group);

      for (const slot of requested) {
        if (slot.day !== row.day) continue;
        // Yopiq-ochiq oraliq: tugash vaqti keyingi darsning boshlanishi bo'lishi mumkin
        const overlaps = slot.start < existingEnd && existingStart < slot.end;
        if (!overlaps) continue;

        const reason: 'room' | 'teacher' =
          roomId && group.room?.id === roomId ? 'room' : 'teacher';

        const key = `${reason}:${group.id}:${row.day}:${row.startTime}:${slot.start}`;
        if (seen.has(key)) continue;
        seen.add(key);

        conflicts.push({
          reason,
          day: row.day,
          requestedStartTime: minutesToTime(slot.start),
          requestedEndTime: minutesToTime(slot.end),
          groupId: group.id,
          groupName: group.name,
          startTime: minutesToTime(existingStart),
          endTime: minutesToTime(existingEnd),
          roomId: group.room?.id ?? null,
          roomName: group.room?.name ?? null,
          teacherId: group.teacher?.id ?? null,
          teacherName: this.fullName(group.teacher),
        });
      }
    }

    return conflicts.sort(
      (a, b) =>
        a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime),
    );
  }

  /**
   * Dars jadvali sahifasi uchun butun hafta. Front kunni o'zi filtrlaydi —
   * ma'lumot hajmi kichik, har kun almashganda so'rov yuborish shart emas.
   */
  async getBoard(args: { organizationId: number; centerId?: number | null }) {
    const { organizationId, centerId } = args;

    const roomQb = this.roomRepo
      .createQueryBuilder('room')
      .innerJoin('room.center', 'center')
      .innerJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .orderBy('room.name', 'ASC');
    if (centerId) roomQb.andWhere('center.id = :centerId', { centerId });

    const lessonQb = this.baseQuery(organizationId);
    if (centerId) lessonQb.andWhere('center.id = :centerId', { centerId });

    const [rooms, rows] = await Promise.all([
      roomQb.getMany(),
      lessonQb.getMany(),
    ]);

    const lessons: ScheduleBoardLesson[] = rows
      .filter((row) => !!row.group)
      .map((row) => {
        const group = row.group;
        const duration = this.durationOf(group);
        const start = timeToMinutes(row.startTime);
        return {
          groupId: group.id,
          groupName: group.name,
          groupStatus: group.status,
          day: row.day,
          startTime: minutesToTime(start),
          endTime: minutesToTime(start + duration),
          durationMinutes: duration,
          roomId: group.room?.id ?? null,
          roomName: group.room?.name ?? null,
          teacherId: group.teacher?.id ?? null,
          teacherName: this.fullName(group.teacher),
          subjectId: group.subject?.id ?? null,
          subjectName: group.subject?.name ?? null,
        };
      })
      .sort(
        (a, b) =>
          a.startTime.localeCompare(b.startTime) ||
          a.groupName.localeCompare(b.groupName),
      );

    return {
      rooms: rooms.map((r) => ({ id: r.id, name: r.name })),
      lessons,
    };
  }
}
