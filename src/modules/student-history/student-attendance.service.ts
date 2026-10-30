import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';

/** O'quvchining bitta guruhdagi davri va davomat yig'indisi. */
export interface StudentAttendanceGroup {
  groupId: number;
  groupName: string;
  groupStatus: string;
  /** Eng birinchi a'zolik boshlanishi (YYYY-MM-DD) yoki null (eski ma'lumot). */
  joinedAt: string | null;
  /** Oxirgi a'zolik tugashi (exclusive); null — hali shu guruhda. */
  leftAt: string | null;
  /** Ko'chirilgan bo'lsa — qaysi guruhga. */
  transferredToGroupName: string | null;
  isCurrent: boolean;
  counts: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    total: number;
  };
}

export interface StudentAttendanceItem {
  id: number;
  lessonDate: string; // YYYY-MM-DD
  groupId: number;
  groupName: string;
  status: string;
  comment: string | null;
  /** Kim belgilagan (o'qituvchi/xodim), bo'lmasa null. */
  submittedBy: string | null;
}

/**
 * O'quvchining BARCHA guruhlardagi davomati — ko'chirilgan va tugagan
 * guruhlar ham. Ota-ona bilan bahs bo'lganda "qachon kelgan, qachon
 * kelmagan" ni bitta joyda ko'rsatish uchun. Xom SQL (modul boshqa domen
 * modullariga bog'lanmaydi — `StudentTimelineService` bilan bir xil uslub).
 */
/** Admin — butun tashkilot; qolganlar — o'z filiali (`null` — cheklov yo'q). */
function branchOf(user: CurrentUser): number | null {
  const isAdmin =
    user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
  return isAdmin ? null : (user.centerId ?? null);
}

@Injectable()
export class StudentAttendanceService {
  constructor(private readonly dataSource: DataSource) {}

  async getForStudent(
    user: CurrentUser,
    studentId: number,
  ): Promise<{
    groups: StudentAttendanceGroup[];
    items: StudentAttendanceItem[];
  }> {
    const [student] = await this.dataSource.query(
      `SELECT s.id FROM students s
         JOIN centers c ON c.id = s."centerId"
        WHERE s.id = $1 AND c."organizationId" = $2
          AND ($3::int IS NULL OR c.id = $3)`,
      // Filialga bog'langan xodim boshqa filial o'quvchisini ko'rmaydi
      // (admin butun tashkilotni ko'radi).
      [studentId, user.organizationId, branchOf(user)],
    );
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    const rows: any[] = await this.dataSource.query(
      `SELECT a.id, a."lessonDate", a."groupId", g.name AS "groupName",
              a.status, a.comment,
              TRIM(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", '')) AS "submittedBy"
         FROM attendance a
         JOIN groups g ON g.id = a."groupId"
         LEFT JOIN users u ON u.id = a."submittedById"
        WHERE a."studentId" = $1
        ORDER BY a."lessonDate" DESC, a.id DESC`,
      [studentId],
    );
    const items: StudentAttendanceItem[] = rows.map((r) => ({
      id: Number(r.id),
      lessonDate: dayjs(r.lessonDate).format('YYYY-MM-DD'),
      groupId: Number(r.groupId),
      groupName: r.groupName,
      status: r.status,
      comment: r.comment ?? null,
      submittedBy: r.submittedBy || null,
    }));

    // Guruhlar: a'zolik oynalaridan (chiqib ketgan guruh ham), hozirgi
    // a'zolik junction'dan, davomati bor-u oynasi yo'q eski guruhlar ham.
    const windows: any[] = await this.dataSource.query(
      `SELECT e."groupId", g.name AS "groupName", g.status AS "groupStatus",
              MIN(e."joinedAt") AS "joinedAt",
              CASE WHEN BOOL_OR(e."leftAt" IS NULL) THEN NULL ELSE MAX(e."leftAt") END AS "leftAt",
              (SELECT tg.name FROM student_group_enrollments t
                 JOIN groups tg ON tg.id = t."transferredToGroupId"
                WHERE t."studentId" = $1 AND t."groupId" = e."groupId"
                ORDER BY t."joinedAt" DESC LIMIT 1) AS "transferredToGroupName"
         FROM student_group_enrollments e
         JOIN groups g ON g.id = e."groupId"
        WHERE e."studentId" = $1
        GROUP BY e."groupId", g.name, g.status`,
      [studentId],
    );
    const current: { groupsId: number }[] = await this.dataSource.query(
      `SELECT "groupsId" FROM students_groups_groups WHERE "studentsId" = $1`,
      [studentId],
    );
    const currentIds = new Set(current.map((c) => Number(c.groupsId)));

    const byGroup = new Map<number, StudentAttendanceGroup>();
    const ensure = (
      id: number,
      name: string,
      status = '',
    ): StudentAttendanceGroup => {
      let g = byGroup.get(id);
      if (!g) {
        g = {
          groupId: id,
          groupName: name,
          groupStatus: status,
          joinedAt: null,
          leftAt: null,
          transferredToGroupName: null,
          isCurrent: currentIds.has(id),
          counts: { present: 0, absent: 0, late: 0, excused: 0, total: 0 },
        };
        byGroup.set(id, g);
      }
      return g;
    };
    for (const w of windows) {
      const g = ensure(Number(w.groupId), w.groupName, w.groupStatus);
      g.joinedAt = w.joinedAt ? dayjs(w.joinedAt).format('YYYY-MM-DD') : null;
      g.leftAt = w.leftAt ? dayjs(w.leftAt).format('YYYY-MM-DD') : null;
      g.transferredToGroupName = w.transferredToGroupName ?? null;
    }
    for (const it of items) {
      const g = ensure(it.groupId, it.groupName);
      if (it.status in g.counts) (g.counts as any)[it.status] += 1;
      g.counts.total += 1;
    }

    // Hozirgi guruhlar avval, keyin eng so'nggi qo'shilgani.
    const groups = [...byGroup.values()].sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''),
    );
    return { groups, items };
  }
}
