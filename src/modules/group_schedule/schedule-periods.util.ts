import { EntityManager } from 'typeorm';
import { Group } from '@/modules/groups/entities/groups.entity';
import { GroupSchedulePeriod } from '@/modules/group_schedule/entities/group-schedule-period.entity';
import { GroupPause } from '@/modules/groups/entities/group-pause.entity';

/**
 * Guruhning jadval tarixini (`group_schedule_periods`) guruh obyektiga
 * yuklaydi va qaytaradi. Relation allaqachon yuklangan bo'lsa qayta
 * so'ralmaydi — bitta so'rov ichida bir guruh uchun bir marta o'qiladi.
 *
 * O'tgan sanalardagi darslarni hisoblaydigan har bir joy (to'lov
 * proratsiyasi, davomat jurnali, kechikish, syllabus rejasi) shu tarixni
 * `computeLessonDates({ schedulePeriods })` ga berishi kerak.
 */
export async function ensureSchedulePeriods(
  manager: EntityManager,
  group: Group,
): Promise<GroupSchedulePeriod[]> {
  if (!group?.id) return [];
  if (Array.isArray(group.schedulePeriods)) return group.schedulePeriods;
  const periods = await manager.getRepository(GroupSchedulePeriod).find({
    where: { groupId: group.id },
    order: { fromDate: 'ASC' },
  });
  group.schedulePeriods = periods;
  return periods;
}

/**
 * Guruhning to'xtatilgan davrlarini (`group_pauses`) guruh obyektiga yuklaydi.
 * Bu kunlardagi darslar o'tkazilmaydi — `computeLessonDates({ pauses })`.
 */
export async function ensureGroupPauses(
  manager: EntityManager,
  group: Group,
): Promise<GroupPause[]> {
  if (!group?.id) return [];
  if (Array.isArray(group.pauses)) return group.pauses;
  const pauses = await manager.getRepository(GroupPause).find({
    where: { groupId: group.id },
    order: { fromDate: 'ASC' },
  });
  group.pauses = pauses;
  return pauses;
}

/**
 * Guruhga tegishli bayram kunlari (tashkilot bo'yicha + guruh filialiniki)
 * — guruh obyektiga `holidays` bo'lib yuklanadi.
 */
export async function ensureGroupHolidays(
  manager: EntityManager,
  group: Group,
): Promise<{ fromDate: string; toDate: string; name: string }[]> {
  if (!group?.id) return [];
  if (Array.isArray(group.holidays)) return group.holidays;
  const rows = await manager.query(
    `SELECT TO_CHAR(h."fromDate", 'YYYY-MM-DD') AS "fromDate",
            TO_CHAR(h."toDate", 'YYYY-MM-DD') AS "toDate", h."name"
       FROM "holidays" h
       JOIN "groups" g ON g."id" = $1
       JOIN "centers" c ON c."id" = g."centerId"
      WHERE h."organizationId" = c."organizationId"
        AND (h."centerId" IS NULL OR h."centerId" = c."id")
      ORDER BY h."fromDate"`,
    [group.id],
  );
  group.holidays = rows;
  return rows;
}
