import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';
import { RolesService } from '@/modules/roles/roles.service';

export interface GroupMember {
  studentId: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  studentStatus: string;
  /** Birinchi qo'shilgan kun (YYYY-MM-DD). */
  joinedAt: string;
  /** Oxirgi chiqqan kun (exclusive); null — hali a'zo. */
  leftAt: string | null;
  leftReason: string | null;
  transferredToGroupId: number | null;
  transferredToGroupName: string | null;
  /** Hozir shu guruhda (junction). */
  isCurrent: boolean;
  /**
   * Shu guruh bo'yicha o'quvchidan hali OLINISHI kerak summa (tasdiq
   * kutayotgan chek ayirilgan); `payments.view` siz — null.
   */
  debt: number | null;
  /** Reception olgan, admin tasdiqlamagan pul (shu guruh); `payments.view` siz — null. */
  pending: number | null;
}

/**
 * Guruhda biror marta o'qigan barcha o'quvchilar — ko'chirilgan, to'xtagan
 * va guruh tugaganda qolganlar ham. Junction (`students_groups_groups`)
 * faqat hozirgi a'zolarni beradi; tarix `student_group_enrollments` da.
 */
/** Bitta to'lov qatorining tasdiqlash kutayotgan cheklari (`p` — payments). */
const PENDING_PER_ROW = `(SELECT COALESCE(SUM(r.amount), 0) FROM payment_receipts r
  WHERE r."paymentId" = p.id AND r.status = 'pending')`;

@Injectable()
export class GroupMembersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rolesService: RolesService,
  ) {}

  async list(user: CurrentUser, groupId: number): Promise<GroupMember[]> {
    const [group] = await this.dataSource.query(
      `SELECT g.id FROM groups g JOIN centers c ON c.id = g."centerId"
        WHERE g.id = $1 AND c."organizationId" = $2
          AND ($3::int IS NULL OR c.id = $3)`,
      [
        groupId,
        user.organizationId,
        user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN
          ? null
          : (user.centerId ?? null),
      ],
    );
    if (!group) throw new NotFoundException('Group not found');

    const canPayments = await this.rolesService.userHasPermission(user, [
      'payments.view',
    ]);

    const rows: any[] = await this.dataSource.query(
      `SELECT s.id AS "studentId", s."firstName", s."lastName", s.phone,
              s.status AS "studentStatus",
              MIN(e."joinedAt") AS "joinedAt",
              CASE WHEN BOOL_OR(e."leftAt" IS NULL) THEN NULL ELSE MAX(e."leftAt") END AS "leftAt",
              (ARRAY_AGG(e."leftReason" ORDER BY e."joinedAt" DESC))[1] AS "leftReason",
              (ARRAY_AGG(e."transferredToGroupId" ORDER BY e."joinedAt" DESC))[1] AS "transferredToGroupId",
              EXISTS (SELECT 1 FROM students_groups_groups sg
                       WHERE sg."studentsId" = s.id AND sg."groupsId" = $1) AS "isCurrent",
              (SELECT COALESCE(SUM(GREATEST(0, p."amountDue" - p."amountPaid" - ${PENDING_PER_ROW})), 0)
                 FROM payments p
                WHERE p."studentId" = s.id AND p."groupId" = $1) AS "debt",
              (SELECT COALESCE(SUM(${PENDING_PER_ROW}), 0)
                 FROM payments p
                WHERE p."studentId" = s.id AND p."groupId" = $1) AS "pending"
         FROM student_group_enrollments e
         JOIN students s ON s.id = e."studentId"
        WHERE e."groupId" = $1
        GROUP BY s.id`,
      [groupId],
    );
    // Eski ma'lumot: junction'da bor, lekin a'zolik oynasi yo'q o'quvchilar
    // ham hozirgi a'zo (yakunlash oynasi va hisob bir xil ro'yxatni ko'rsin).
    const legacy: any[] = await this.dataSource.query(
      `SELECT s.id AS "studentId", s."firstName", s."lastName", s.phone,
              s.status AS "studentStatus", g."startDate" AS "joinedAt",
              NULL AS "leftAt", NULL AS "leftReason", NULL AS "transferredToGroupId",
              TRUE AS "isCurrent",
              (SELECT COALESCE(SUM(GREATEST(0, p."amountDue" - p."amountPaid" - ${PENDING_PER_ROW})), 0)
                 FROM payments p
                WHERE p."studentId" = s.id AND p."groupId" = $1) AS "debt",
              (SELECT COALESCE(SUM(${PENDING_PER_ROW}), 0)
                 FROM payments p
                WHERE p."studentId" = s.id AND p."groupId" = $1) AS "pending"
         FROM students_groups_groups sg
         JOIN students s ON s.id = sg."studentsId"
         JOIN groups g ON g.id = sg."groupsId"
        WHERE sg."groupsId" = $1
          AND NOT EXISTS (SELECT 1 FROM student_group_enrollments e
                           WHERE e."groupId" = $1 AND e."studentId" = s.id)`,
      [groupId],
    );
    rows.push(...legacy);

    const targetIds = rows
      .map((r) => r.transferredToGroupId)
      .filter((id): id is number => id != null);
    const names = new Map<number, string>();
    if (targetIds.length) {
      const targets: any[] = await this.dataSource.query(
        `SELECT id, name FROM groups WHERE id = ANY($1::int[])`,
        [targetIds],
      );
      for (const t of targets) names.set(Number(t.id), t.name);
    }

    return rows
      .map((r) => ({
        studentId: Number(r.studentId),
        firstName: r.firstName,
        lastName: r.lastName,
        phone: r.phone ?? null,
        studentStatus: r.studentStatus,
        joinedAt: dayjs(r.joinedAt).format('YYYY-MM-DD'),
        leftAt: r.leftAt ? dayjs(r.leftAt).format('YYYY-MM-DD') : null,
        leftReason: r.leftReason ?? null,
        transferredToGroupId:
          r.transferredToGroupId != null
            ? Number(r.transferredToGroupId)
            : null,
        transferredToGroupName:
          r.transferredToGroupId != null
            ? (names.get(Number(r.transferredToGroupId)) ?? null)
            : null,
        isCurrent: r.isCurrent === true,
        debt: canPayments ? Number(r.debt ?? 0) : null,
        pending: canPayments ? Number(r.pending ?? 0) : null,
      }))
      .sort(
        (a, b) =>
          Number(b.isCurrent) - Number(a.isCurrent) ||
          a.lastName.localeCompare(b.lastName),
      );
  }
}
