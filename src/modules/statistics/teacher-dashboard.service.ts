import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { Payment } from '@/modules/payments/entities/payment.entity';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { UserRole } from '@/common/enums/user-role.enums';
import { StudentStatus } from '@/common/enums/students-status.enums';

const TREND_MONTHS = 6;
const DEBTORS_LIMIT = 100;

/** `amountDue - amountPaid`, manfiy emas. */
const DEBT_SQL = `GREATEST(p."amountDue" - p."amountPaid", 0)`;
/** Qatorning tasdiq kutayotgan cheklari (pul xodimda, hali kassada emas). */
const PENDING_SQL = `(SELECT COALESCE(SUM(r.amount), 0) FROM payment_receipts r
  WHERE r."paymentId" = p.id AND r.status = 'pending')`;

interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

const num = (v: unknown): number => Number(v ?? 0);
/** Kelganlar ulushi (kech qolgan ham keldi), belgilanmagan darslar hisobga kirmaydi. */
const rate = (a: AttendanceCounts): number | null => {
  const total = a.present + a.late + a.absent + a.excused;
  return total ? Math.round(((a.present + a.late) / total) * 1000) / 10 : null;
};

/**
 * O'qituvchi dashboardi: o'z guruhlari bo'yicha bir oylik ko'rsatkichlar.
 *
 * Guruhlar — hozir shu o'qituvchiga biriktirilganlari (tugamagan, yoki
 * tanlangan oyda hali ochiq bo'lgan). Oy o'rtasida o'qituvchi almashgan
 * guruhning o'tgan oylari ham yangi o'qituvchida ko'rinadi — bu ma'lumot
 * uchun, pul (komissiya) baribir `group_teacher_periods` bo'yicha bo'linadi.
 */
@Injectable()
export class TeacherDashboardService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  private q<T = any>(sql: string, params: unknown[]): Promise<T[]> {
    return this.paymentRepo.query(sql, params);
  }

  /**
   * O'qituvchi o'zi uchun so'raydi (`teacherId` e'tiborsiz). Boshqa rol
   * (admin, menejer) `teacherId` bilan istalgan o'qituvchini ko'radi.
   */
  private async resolveTeacher(
    user: { userId: number; role: UserRole; organizationId: number },
    teacherId?: number,
  ) {
    const id = user.role === UserRole.TEACHER ? user.userId : teacherId;
    if (!id) {
      throw new ValidationException({ teacherId: "O'qituvchini tanlang" });
    }
    const [row] = await this.q(
      `SELECT u.id, TRIM(CONCAT(u."firstName", ' ', u."lastName")) AS "fullName"
         FROM users u
        WHERE u.id = $1 AND u."organizationId" = $2 AND u.role = $3`,
      [id, user.organizationId, UserRole.TEACHER],
    );
    if (!row) {
      throw new ValidationException({ teacherId: "O'qituvchi topilmadi" });
    }
    return { id: Number(row.id), fullName: String(row.fullName ?? '') };
  }

  private normalizeMonth(month?: string): string {
    if (!month) return dayjs().format('YYYY-MM');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month YYYY-MM formatida bo‘lishi kerak');
    }
    return month;
  }

  async getDashboard(
    user: { userId: number; role: UserRole; organizationId: number },
    query: { month?: string; teacherId?: number },
  ) {
    const teacher = await this.resolveTeacher(user, query.teacherId);
    const month = this.normalizeMonth(query.month);
    const monthStart = `${month}-01`;
    const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');
    const trendStart = dayjs(monthStart)
      .subtract(TREND_MONTHS - 1, 'month')
      .format('YYYY-MM-DD');

    const groups = await this.q<{ id: number; name: string; status: string }>(
      `SELECT g.id, g.name, g.status
         FROM groups g
         JOIN centers c ON c.id = g."centerId"
        WHERE g."teacherId" = $1 AND c."organizationId" = $2
          AND (g.status <> 'finished' OR g."endDate" >= $3::date)
        ORDER BY g.name`,
      [teacher.id, user.organizationId, monthStart],
    );
    const groupIds = groups.map((g) => Number(g.id));

    const [
      members,
      payments,
      attendance,
      trendPay,
      trendAtt,
      debtors,
      earning,
    ] = await Promise.all([
      // `= ANY('{}')` hech narsa qaytarmaydi — guruhsiz o'qituvchi uchun ham xavfsiz.
      this.membersByGroup(groupIds),
      this.paymentsByGroup(groupIds, monthStart),
      this.attendanceByGroup(groupIds, monthStart, monthEnd),
      this.paymentTrend(groupIds, trendStart, monthStart),
      this.attendanceTrend(groupIds, trendStart, monthEnd),
      this.debtors(groupIds, monthStart),
      this.earning(teacher.id, monthStart),
    ]);

    const emptyPay = {
      paidCount: 0,
      partialCount: 0,
      unpaidCount: 0,
      amountDue: 0,
      amountPaid: 0,
      debt: 0,
      pendingAmount: 0,
    };
    const emptyAtt: AttendanceCounts = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
    };

    const groupRows = groups.map((g) => {
      const pay = payments.get(Number(g.id)) ?? emptyPay;
      const att = attendance.get(Number(g.id)) ?? emptyAtt;
      return {
        id: Number(g.id),
        name: g.name,
        status: g.status,
        studentsCount: members.byGroup.get(Number(g.id)) ?? 0,
        ...pay,
        attendance: { ...att, rate: rate(att) },
      };
    });

    const sum = (key: keyof typeof emptyPay) =>
      groupRows.reduce((acc, g) => acc + g[key], 0);
    const attTotals = groupRows.reduce<AttendanceCounts>(
      (acc, g) => ({
        present: acc.present + g.attendance.present,
        late: acc.late + g.attendance.late,
        absent: acc.absent + g.attendance.absent,
        excused: acc.excused + g.attendance.excused,
      }),
      { ...emptyAtt },
    );

    const attByMonth = new Map(trendAtt.map((r: any) => [r.month, r]));
    const payByMonth = new Map(trendPay.map((r: any) => [r.month, r]));
    const trend = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const m = dayjs(trendStart).add(i, 'month').format('YYYY-MM');
      const p: any = payByMonth.get(m) ?? {};
      const a: any = attByMonth.get(m);
      const counts: AttendanceCounts = {
        present: num(a?.present),
        late: num(a?.late),
        absent: num(a?.absent),
        excused: num(a?.excused),
      };
      return {
        month: m,
        amountDue: num(p.amountDue),
        amountPaid: num(p.amountPaid),
        attendanceRate: rate(counts),
      };
    });

    return {
      teacher,
      month,
      totals: {
        groupsCount: groups.length,
        studentsCount: members.distinct,
        paidCount: sum('paidCount'),
        partialCount: sum('partialCount'),
        unpaidCount: sum('unpaidCount'),
        amountDue: sum('amountDue'),
        amountPaid: sum('amountPaid'),
        debt: sum('debt'),
        pendingAmount: sum('pendingAmount'),
        totalDebt: debtors.reduce(
          (acc: number, d: any) => acc + d.totalDebt,
          0,
        ),
        attendance: { ...attTotals, rate: rate(attTotals) },
      },
      earning,
      groups: groupRows,
      trend,
      debtors,
    };
  }

  /** Guruhdagi hozirgi faol o'quvchilar (junction), har guruh va jami (takrorsiz). */
  private async membersByGroup(groupIds: number[]) {
    const rows = await this.q(
      `SELECT sg."groupsId" AS "groupId", sg."studentsId" AS "studentId"
         FROM students_groups_groups sg
         JOIN students s ON s.id = sg."studentsId"
        WHERE sg."groupsId" = ANY($1) AND s.status = $2`,
      [groupIds, StudentStatus.ACTIVE],
    );
    const byGroup = new Map<number, number>();
    for (const r of rows) {
      const gid = Number(r.groupId);
      byGroup.set(gid, (byGroup.get(gid) ?? 0) + 1);
    }
    return { byGroup, distinct: new Set(rows.map((r) => r.studentId)).size };
  }

  /** Tanlangan oy to'lov qatorlari: holat bo'yicha soni va summalar. */
  private async paymentsByGroup(groupIds: number[], monthStart: string) {
    const rows = await this.q(
      `SELECT p."groupId",
              COUNT(*) FILTER (WHERE p.status = 'paid')::int AS "paidCount",
              COUNT(*) FILTER (WHERE p.status = 'partial')::int AS "partialCount",
              COUNT(*) FILTER (WHERE p.status = 'unpaid')::int AS "unpaidCount",
              COALESCE(SUM(p."amountDue"), 0) AS "amountDue",
              COALESCE(SUM(p."amountPaid"), 0) AS "amountPaid",
              COALESCE(SUM(${DEBT_SQL}), 0) AS "debt",
              COALESCE(SUM(${PENDING_SQL}), 0) AS "pendingAmount"
         FROM payments p
        WHERE p."groupId" = ANY($1) AND p."forMonth" = $2::date
        GROUP BY p."groupId"`,
      [groupIds, monthStart],
    );
    return new Map(
      rows.map((r) => [
        Number(r.groupId),
        {
          paidCount: num(r.paidCount),
          partialCount: num(r.partialCount),
          unpaidCount: num(r.unpaidCount),
          amountDue: num(r.amountDue),
          amountPaid: num(r.amountPaid),
          debt: num(r.debt),
          pendingAmount: num(r.pendingAmount),
        },
      ]),
    );
  }

  private async attendanceByGroup(
    groupIds: number[],
    from: string,
    to: string,
  ) {
    const rows = await this.q(
      `SELECT a."groupId",
              COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'late')::int AS late,
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused
         FROM attendance a
        WHERE a."groupId" = ANY($1) AND a."lessonDate" BETWEEN $2::date AND $3::date
        GROUP BY a."groupId"`,
      [groupIds, from, to],
    );
    return new Map<number, AttendanceCounts>(
      rows.map((r) => [
        Number(r.groupId),
        {
          present: num(r.present),
          late: num(r.late),
          absent: num(r.absent),
          excused: num(r.excused),
        },
      ]),
    );
  }

  private paymentTrend(groupIds: number[], from: string, to: string) {
    return this.q(
      `SELECT TO_CHAR(p."forMonth", 'YYYY-MM') AS month,
              COALESCE(SUM(p."amountDue"), 0) AS "amountDue",
              COALESCE(SUM(p."amountPaid"), 0) AS "amountPaid"
         FROM payments p
        WHERE p."groupId" = ANY($1) AND p."forMonth" BETWEEN $2::date AND $3::date
        GROUP BY 1`,
      [groupIds, from, to],
    );
  }

  private attendanceTrend(groupIds: number[], from: string, to: string) {
    return this.q(
      `SELECT TO_CHAR(a."lessonDate", 'YYYY-MM') AS month,
              COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
              COUNT(*) FILTER (WHERE a.status = 'late')::int AS late,
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              COUNT(*) FILTER (WHERE a.status = 'excused')::int AS excused
         FROM attendance a
        WHERE a."groupId" = ANY($1) AND a."lessonDate" BETWEEN $2::date AND $3::date
        GROUP BY 1`,
      [groupIds, from, to],
    );
  }

  /**
   * Qarzdorlar: shu guruhlardagi tanlangan oygacha (shu oy ham) to'lanmagan
   * qoldiq — o'quvchi + guruh bo'yicha, eng kattasi birinchi. `monthStatus` —
   * tanlangan oy qatorining holati (qator bo'lmasa null).
   */
  private async debtors(groupIds: number[], monthStart: string) {
    const rows = await this.q(
      `SELECT p."studentId", p."groupId", s."firstName", s."lastName", s.phone,
              g.name AS "groupName",
              SUM(${DEBT_SQL}) AS "totalDebt",
              SUM(CASE WHEN p."forMonth" = $2::date THEN ${DEBT_SQL} ELSE 0 END) AS "monthDebt",
              COUNT(*) FILTER (WHERE p."amountDue" > p."amountPaid")::int AS "debtMonths",
              MAX(CASE WHEN p."forMonth" = $2::date THEN p.status::text END) AS "monthStatus",
              SUM(${PENDING_SQL}) AS "pendingAmount"
         FROM payments p
         JOIN students s ON s.id = p."studentId"
         JOIN groups g ON g.id = p."groupId"
        WHERE p."groupId" = ANY($1) AND p."forMonth" <= $2::date
        GROUP BY p."studentId", p."groupId", s."firstName", s."lastName", s.phone, g.name
       HAVING SUM(${DEBT_SQL}) > 0
        ORDER BY "totalDebt" DESC
        LIMIT ${DEBTORS_LIMIT}`,
      [groupIds, monthStart],
    );
    return rows.map((r) => ({
      studentId: Number(r.studentId),
      groupId: Number(r.groupId),
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone ?? null,
      groupName: r.groupName,
      totalDebt: num(r.totalDebt),
      monthDebt: num(r.monthDebt),
      debtMonths: num(r.debtMonths),
      monthStatus: r.monthStatus ?? null,
      pendingAmount: num(r.pendingAmount),
    }));
  }

  /** O'qituvchining shu oydagi hisoblangan daromadi (oylik + foiz); yo'q bo'lsa null. */
  private async earning(teacherId: number, monthStart: string) {
    const [row] = await this.q(
      `SELECT "baseSalarySnapshot", "commissionAmount", "carryOverCommission", "totalEarning"
         FROM teacher_monthly_earnings
        WHERE "teacherId" = $1 AND "forMonth" = $2::date`,
      [teacherId, monthStart],
    );
    if (!row) return null;
    return {
      baseSalary: num(row.baseSalarySnapshot),
      commission: num(row.commissionAmount),
      carryOver: num(row.carryOverCommission),
      total: num(row.totalEarning),
    };
  }
}
