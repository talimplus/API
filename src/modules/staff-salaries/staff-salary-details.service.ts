import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { UserRole } from '@/common/enums/user-role.enums';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { UserPayService } from '@/modules/users/user-pay.service';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import {
  isSalaryFrozen,
  round2,
  salaryMoneyView,
} from '@/modules/staff-salaries/salary-math';
import {
  OutstandingKind,
  StaffDeductionsService,
} from '@/modules/staff-salaries/staff-deductions.service';

/** Oylar orasidagi ustama o'tkazmasi — sababi (o'quvchi, guruh, to'lov) bilan. */
export interface SalaryTransfer {
  id: number;
  amount: number;
  /** O'tkazma qaysi oy ishidan (o'quvchi to'lagan oy). */
  fromMonth: string;
  /** Qaysi oy oyligiga qo'shilgan; null — hali qo'shilmagan (keyingi oyga). */
  toMonth: string | null;
  student: { id: number; name: string } | null;
  group: { id: number; name: string } | null;
  /** O'quvchi pulni bergan kun (chek), bo'lmasa tasdiqlangan kun. */
  paidAt: string | null;
  confirmedAt: string | null;
}

const ym = (d: unknown) => (d ? dayjs(d as any).format('YYYY-MM-01') : null);
const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);
const fullName = (r: any, prefix: string) =>
  r[`${prefix}Id`]
    ? {
        id: Number(r[`${prefix}Id`]),
        name: String(r[`${prefix}Name`] ?? '').trim(),
      }
    : null;

/**
 * Ish haqi sahifasidagi "batafsil hisob" (chek ko'rinishi) va ro'yxatdagi
 * o'tkazma izohlari. Faqat o'qiydi — hech narsa yozmaydi.
 */
@Injectable()
export class StaffSalaryDetailsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly earnings: TeacherEarningsService,
    private readonly userPay: UserPayService,
    private readonly deductions: StaffDeductionsService,
  ) {}

  /** O'qituvchilarning shu oyga tegishli o'tkazmalari (chiqqan va kelgan). */
  async transfersFor(
    teacherIds: number[],
    month: string, // YYYY-MM-01
  ): Promise<Map<number, { out: SalaryTransfer[]; in: SalaryTransfer[] }>> {
    const map = new Map<
      number,
      { out: SalaryTransfer[]; in: SalaryTransfer[] }
    >();
    if (!teacherIds.length) return map;
    const rows = await this.dataSource.query(
      `SELECT c."id", c."teacherId", c."amount", c."sourceForMonth", c."appliedForMonth",
              st."id" AS "studentId", CONCAT(st."firstName", ' ', st."lastName") AS "studentName",
              g."id" AS "groupId", g."name" AS "groupName",
              r."paidAt", r."createdAt" AS "receivedAt", r."confirmedAt"
         FROM "teacher_commission_carryovers" c
         LEFT JOIN "students" st ON st."id" = c."studentId"
         LEFT JOIN "groups" g ON g."id" = c."groupId"
         LEFT JOIN "payment_receipts" r ON r."id" = c."receiptId"
        WHERE c."teacherId" = ANY($1)
          AND (c."sourceForMonth" = $2 OR c."appliedForMonth" = $2)
        ORDER BY c."id"`,
      [teacherIds, month],
    );
    for (const r of rows) {
      const t: SalaryTransfer = {
        id: Number(r.id),
        amount: Number(r.amount),
        fromMonth: ym(r.sourceForMonth)!,
        toMonth: ym(r.appliedForMonth),
        student: fullName(r, 'student'),
        group: fullName(r, 'group'),
        paidAt: iso(r.paidAt ?? r.receivedAt),
        confirmedAt: iso(r.confirmedAt),
      };
      const entry = map.get(Number(r.teacherId)) ?? { out: [], in: [] };
      if (t.fromMonth === month) entry.out.push(t);
      if (t.toMonth === month) entry.in.push(t);
      map.set(Number(r.teacherId), entry);
    }
    return map;
  }

  /** `userId` + `YYYY-MM` bo'yicha (front manzili shunday). */
  async detailsByMonth(organizationId: number, userId: number, ym: string) {
    if (!/^\d{4}-\d{2}$/.test(ym ?? '')) {
      throw new BadRequestException(
        'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak',
      );
    }
    const [row] = await this.dataSource.query(
      `SELECT s."id" FROM "staff_salaries" s JOIN "users" u ON u."id" = s."userId"
        WHERE s."userId" = $1 AND s."forMonth" = $2 AND u."organizationId" = $3`,
      [userId, `${ym}-01`, organizationId],
    );
    if (!row) throw new NotFoundException('Oylik topilmadi');
    return this.details(organizationId, Number(row.id));
  }

  /** Bitta oylikning qadam-baqadam hisobi. */
  async details(organizationId: number, salaryId: number) {
    const [s] = await this.dataSource.query(
      `SELECT s.*, u."firstName", u."lastName", u."role", ur."name" AS "roleName",
              u."salary", u."commissionPercentage"
         FROM "staff_salaries" s
         JOIN "users" u ON u."id" = s."userId"
         LEFT JOIN "roles" ur ON ur."id" = u."userRoleId"
        WHERE s."id" = $1 AND u."organizationId" = $2`,
      [salaryId, organizationId],
    );
    if (!s) throw new NotFoundException('Oylik topilmadi');
    const month = ym(s.forMonth)!;
    const userId = Number(s.userId);
    const isTeacher = s.role === UserRole.TEACHER;

    // 1) Ustama — guruhlar bo'yicha
    let commission: {
      percent: number;
      groups: {
        groupId: number;
        groupName: string;
        paid: number;
        share: number;
      }[];
      total: number;
    } | null = null;
    let fixedSalary = Number(s.baseSalary ?? 0);
    if (isTeacher) {
      const [earning] = await this.dataSource.query(
        `SELECT * FROM "teacher_monthly_earnings" WHERE "teacherId" = $1 AND "forMonth" = $2`,
        [userId, month],
      );
      const pay = await this.userPay.getForMonth(
        {
          id: userId,
          salary: s.salary ?? null,
          commissionPercentage: s.commissionPercentage ?? null,
        },
        month,
      );
      const percent = Number(pay.commissionPercentage ?? 0);
      const byGroup = await this.earnings.commissionBaseByGroup(userId, month);
      const names: { id: number; name: string }[] = byGroup.size
        ? await this.dataSource.query(
            `SELECT "id", "name" FROM "groups" WHERE "id" = ANY($1)`,
            [Array.from(byGroup.keys())],
          )
        : [];
      const nameOf = new Map(names.map((g) => [Number(g.id), g.name]));
      const groups = Array.from(byGroup.entries()).map(([groupId, paid]) => ({
        groupId,
        groupName: nameOf.get(groupId) ?? `#${groupId}`,
        paid: round2(paid),
        share: round2((paid * percent) / 100),
      }));
      fixedSalary = Number(earning?.baseSalarySnapshot ?? 0);
      commission = {
        percent,
        groups,
        total: round2(groups.reduce((sum, g) => sum + g.share, 0)),
      };
    }

    // 2) O'tkazmalar
    const transfers = (await this.transfersFor([userId], month)).get(
      userId,
    ) ?? { out: [], in: [] };

    // 3) Mukofot va jarimalar
    const bonuses = await this.dataSource.query(
      `SELECT b."id", b."amount", b."reason", b."createdAt",
              CONCAT(cu."firstName", ' ', cu."lastName") AS "createdBy"
         FROM "staff_bonuses" b LEFT JOIN "users" cu ON cu."id" = b."createdById"
        WHERE b."userId" = $1 AND b."forMonth" = $2 ORDER BY b."id"`,
      [userId, month],
    );
    const apps: any[] = await this.dataSource.query(
      `SELECT a."deductionId", a."amount", s2."forMonth"
         FROM "staff_salary_deductions" a
         JOIN "staff_salaries" s2 ON s2."id" = a."staffSalaryId"
        WHERE s2."userId" = $1`,
      [userId],
    );
    const deductions: any[] = await this.dataSource.query(
      `SELECT d."id", d."type", d."amount", d."appliedAmount", d."reason",
              d."sourceForMonth", d."createdAt",
              CONCAT(cu."firstName", ' ', cu."lastName") AS "createdBy"
         FROM "staff_deductions" d LEFT JOIN "users" cu ON cu."id" = d."createdById"
        WHERE d."userId" = $1 ORDER BY d."sourceForMonth", d."id"`,
      [userId],
    );
    const allocationsOf = (deductionId: number) =>
      apps
        .filter((a) => Number(a.deductionId) === deductionId)
        .map((a) => ({ month: ym(a.forMonth)!, amount: Number(a.amount) }))
        .sort((a, b) => a.month.localeCompare(b.month));
    const view = (d: any) => {
      const allocations = allocationsOf(Number(d.id));
      return {
        id: Number(d.id),
        type: d.type,
        amount: Number(d.amount),
        reason: d.reason,
        forMonth: ym(d.sourceForMonth),
        createdAt: iso(d.createdAt),
        createdBy: String(d.createdBy ?? '').trim() || null,
        thisMonth: round2(
          allocations
            .filter((a) => a.month === month)
            .reduce((sum, a) => sum + a.amount, 0),
        ),
        allocations,
        notWithheld: round2(Number(d.amount) - Number(d.appliedAmount)),
      };
    };
    const relevant = deductions
      .map(view)
      .filter((d) => d.thisMonth > 0 || d.forMonth === month);
    const advances = relevant.filter(
      (d) => d.type === StaffDeductionType.ADVANCE,
    );
    const fines = relevant.filter((d) => d.type !== StaffDeductionType.ADVANCE);

    // 5) Berilgan pullar
    const payments = await this.dataSource.query(
      `SELECT p."id", p."amount", p."comment", p."paidAt",
              CONCAT(pu."firstName", ' ', pu."lastName") AS "paidBy"
         FROM "staff_salary_payments" p LEFT JOIN "users" pu ON pu."id" = p."paidById"
        WHERE p."staffSalaryId" = $1 ORDER BY p."paidAt"`,
      [salaryId],
    );

    const money = salaryMoneyView(s);
    return {
      id: Number(s.id),
      userId,
      forMonth: month,
      status: s.status,
      user: {
        id: userId,
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        roleName: s.roleName ?? null,
      },
      /** Oy hali tugamagan — ustama o'sib boradi. */
      monthOpen: month >= dayjs().startOf('month').format('YYYY-MM-01'),
      /** Pul berib yopilgan o'tgan oy: kech kelgan pul keyingi oyga o'tadi. */
      closed: isSalaryFrozen({ ...s, forMonth: month }),
      fixedSalary,
      commission,
      transfers,
      bonuses: bonuses.map((b: any) => ({
        id: Number(b.id),
        amount: Number(b.amount),
        reason: b.reason,
        createdAt: iso(b.createdAt),
        createdBy: String(b.createdBy ?? '').trim() || null,
      })),
      fines,
      advances,
      payments: payments.map((p: any) => ({
        id: Number(p.id),
        amount: Number(p.amount),
        comment: p.comment ?? null,
        paidAt: iso(p.paidAt),
        paidBy: String(p.paidBy ?? '').trim() || null,
      })),
      advanceDebt: await this.deductions.getOutstanding(
        userId,
        OutstandingKind.ADVANCE,
      ),
      totals: {
        /** Hisoblangan oylik: maosh + ustama ± o'tkazmalar + mukofot. */
        calculated: round2(money.baseSalary + money.bonusAmount),
        advance: money.advanceAmount,
        fines: money.fineAmount,
        paid: money.paidAmount,
        remaining: money.remaining,
      },
    };
  }
}
