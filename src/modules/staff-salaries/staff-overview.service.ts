import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { UserRole } from '@/common/enums/user-role.enums';
import { WeekDay } from '@/common/enums/group-schedule.enum';
import { ALL_PERMISSIONS } from '@/common/permissions/permission.catalog';
import { User } from '@/modules/users/entities/user.entity';
import {
  PaymentReceipt,
  PaymentReceiptStatus,
} from '@/modules/payments/entities/payment-receipt.entity';
import { StaffAttendanceService } from '@/modules/staff-attendance/staff-attendance.service';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import {
  OutstandingKind,
  StaffDeductionsService,
} from '@/modules/staff-salaries/staff-deductions.service';
import { StaffBonusesService } from '@/modules/staff-salaries/staff-bonuses.service';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import { salaryMoneyView } from '@/modules/staff-salaries/salary-math';

const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Oyma-oy grafik uchun nechta oy ko'rsatiladi */
const MONTHS_IN_SERIES = 12;

/** Guruh jadvalini hafta tartibida chiqarish uchun */
const WEEK_DAY_ORDER: string[] = Object.values(WeekDay);

/**
 * Xodim sahifasi uchun yig'ma ma'lumot: davomat, topshirilmagan pullar,
 * jarimalar va oylik holati.
 *
 * Nega "topshirilmagan pul" shu yerda: rollar dinamik, ya'ni to'lovni kim
 * qabul qilgani rol nomiga bog'liq emas. `payment_receipts.receivedById`
 * to'lovni qabul qilgan xodimni ko'rsatadi; admin uni tasdiqlamaguncha
 * (`status = pending`) pul o'sha xodimning bo'ynida turadi.
 */
@Injectable()
export class StaffOverviewService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PaymentReceipt)
    private readonly receiptRepo: Repository<PaymentReceipt>,
    @InjectRepository(StaffSalary)
    private readonly salaryRepo: Repository<StaffSalary>,
    private readonly attendanceService: StaffAttendanceService,
    private readonly deductionsService: StaffDeductionsService,
    private readonly bonusesService: StaffBonusesService,
  ) {}

  /**
   * @param targetUserId `null` bo'lsa — so'rov yuborgan xodimning o'zi
   */
  async getOverview(
    reqUser: any,
    targetUserId: number | null,
    forMonth?: string,
  ) {
    const userId = targetUserId ?? reqUser.userId;
    this.assertCanView(reqUser, userId);

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['organization', 'center', 'userRole'],
    });
    if (!user) throw new NotFoundException('Xodim topilmadi');
    if ((user as any).organization?.id !== reqUser.organizationId) {
      throw new ForbiddenException(
        'Bu xodim sizning tashkilotingizga tegishli emas',
      );
    }

    const month = this.normalizeMonth(forMonth);
    const from = dayjs(month).startOf('month').format('YYYY-MM-DD');
    const to = dayjs(month).endOf('month').format('YYYY-MM-DD');

    const [
      attendanceSummary,
      lateRecords,
      receipts,
      months,
      allDeductions,
      groups,
      bonuses,
    ] = await Promise.all([
      this.attendanceService.getUserSummary(userId, from, to),
      this.attendanceService.listUserRecords(userId, from, to),
      this.loadUnsettledReceipts(userId),
      this.buildMonthSeries(userId, month),
      this.deductionsService.listForUser(userId, reqUser),
      user.role === UserRole.TEACHER
        ? this.loadTeacherGroups(
            userId,
            reqUser.organizationId,
            Boolean(user.dismissedAt),
          )
        : Promise.resolve([]),
      this.bonusesService.listForUser(userId, reqUser),
    ]);

    // Avans jarima emas (oldindan berilgan pul) — ro'yxatlar alohida.
    const deductions = allDeductions.filter(
      (d) => d.type !== StaffDeductionType.ADVANCE,
    );
    const advances = allDeductions.filter(
      (d) => d.type === StaffDeductionType.ADVANCE,
    );

    const pending = receipts.filter(
      (r) => r.status === PaymentReceiptStatus.PENDING,
    );
    const rejected = receipts.filter(
      (r) => r.status === PaymentReceiptStatus.REJECTED,
    );

    const monthDeductions = deductions.filter(
      (d) => d.sourceForMonth === month,
    );
    const [deductionOutstanding, advanceOutstanding] = await Promise.all([
      this.deductionsService.getOutstanding(userId),
      this.deductionsService.getOutstanding(userId, OutstandingKind.ADVANCE),
    ]);
    const sumFor = (list: { amount: number }[]) =>
      round2(list.reduce((acc, x) => acc + x.amount, 0));

    const salary = await this.salaryRepo.findOne({
      where: { userId, forMonth: month as any },
    });
    if (salary) await this.deductionsService.applyOutstanding(salary);

    return {
      user: this.userView(user),
      forMonth: month,
      summary: {
        ...attendanceSummary,
        unsettledCount: pending.length,
        unsettledAmount: round2(
          pending.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
        ),
        rejectedCount: rejected.length,
        rejectedAmount: round2(
          rejected.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
        ),
        deductionThisMonth: round2(
          monthDeductions.reduce((sum, d) => sum + d.amount, 0),
        ),
        deductionOutstanding,
        advanceThisMonth: sumFor(
          advances.filter((a) => a.sourceForMonth === month),
        ),
        advanceOutstanding,
        bonusThisMonth: sumFor(bonuses.filter((b) => b.forMonth === month)),
      },
      months,
      lateRecords: lateRecords.filter((r) => (r.lateMinutes ?? 0) > 0),
      attendanceRecords: lateRecords,
      unsettledReceipts: receipts.map((r) => this.receiptView(r)),
      deductions,
      advances,
      bonuses,
      salary: salary ? await this.salaryView(salary) : null,
      groups,
    };
  }

  // ─────────────────────────────────────────────────────────────

  /**
   * O'qituvchi hozir dars o'tadigan guruhlar (`finished` emas): fan, xona,
   * jadval, o'quvchilar soni. Boshqa xodimlarda bo'sh ro'yxat.
   * Ishdan bo'shatilgan o'qituvchida (`history`) — u dars o'tgan BARCHA
   * guruhlar (tugaganlari ham, o'qituvchi tarixidan ham): sahifa uning
   * arxividir, guruh sahifasidan o'quvchilar va davomat ochiladi.
   * Xom SQL — staff-salaries moduli groups moduliga bog'lanmasin.
   */
  private async loadTeacherGroups(
    teacherId: number,
    organizationId: number,
    history = false,
  ) {
    const rows: any[] = await this.userRepo.manager.query(
      `SELECT g.id, g.name, g.status,
              TO_CHAR(g."startDate", 'YYYY-MM-DD') AS "startDate",
              TO_CHAR(g."endDate", 'YYYY-MM-DD') AS "endDate",
              s.name AS "subjectName", r.name AS "roomName",
              (SELECT COUNT(*)::int FROM "students_groups_groups" sg
                WHERE sg."groupsId" = g.id) AS "studentsCount",
              COALESCE((SELECT json_agg(json_build_object(
                         'day', gs.day,
                         'startTime', TO_CHAR(gs."startTime", 'HH24:MI')))
                  FROM group_schedule gs WHERE gs."groupId" = g.id), '[]') AS schedules
         FROM groups g
         JOIN centers c ON c.id = g."centerId"
         LEFT JOIN subjects s ON s.id = g."subjectId"
         LEFT JOIN rooms r ON r.id = g."roomId"
        WHERE c."organizationId" = $2
          AND ${
            history
              ? `(g."teacherId" = $1 OR EXISTS (SELECT 1 FROM group_teacher_periods tp
                   WHERE tp."groupId" = g.id AND tp."teacherId" = $1))`
              : `g."teacherId" = $1 AND g.status <> 'finished'`
          }
        ORDER BY (g.status = 'started') DESC, g."endDate" DESC NULLS FIRST, g.name`,
      [teacherId, organizationId],
    );

    return rows.map((g) => ({
      id: Number(g.id),
      name: g.name,
      status: g.status,
      subject: g.subjectName ?? null,
      room: g.roomName ?? null,
      studentsCount: Number(g.studentsCount ?? 0),
      startDate: g.startDate ?? null,
      endDate: g.endDate ?? null,
      schedules: (g.schedules as { day: string; startTime: string }[]).sort(
        (a, b) =>
          WEEK_DAY_ORDER.indexOf(a.day) - WEEK_DAY_ORDER.indexOf(b.day) ||
          a.startTime.localeCompare(b.startTime),
      ),
    }));
  }

  /**
   * Xodim qabul qilgan, lekin admin tasdiqlamagan cheklar.
   *
   * `pending` — pul xodimda turibdi; `rejected` — admin rad etgan, ya'ni
   * kelishmovchilik bor. Ikkalasi ham xodimning javobgarligida.
   * Davr bo'yicha cheklanmaydi: qarz qachon paydo bo'lganidan qat'i nazar
   * yopilmaguncha ko'rinib turishi kerak.
   */
  private async loadUnsettledReceipts(userId: number) {
    return this.receiptRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.payment', 'payment')
      .leftJoinAndSelect('payment.student', 'student')
      .leftJoinAndSelect('payment.group', 'group')
      .where('r."receivedById" = :userId', { userId })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [PaymentReceiptStatus.PENDING, PaymentReceiptStatus.REJECTED],
      })
      .orderBy('r.createdAt', 'DESC')
      .getMany();
  }

  /** Oxirgi 12 oy bo'yicha davomat yig'indisi */
  private async buildMonthSeries(userId: number, month: string) {
    const result = [];
    for (let i = MONTHS_IN_SERIES - 1; i >= 0; i--) {
      const cursor = dayjs(month).subtract(i, 'month');
      const from = cursor.startOf('month').format('YYYY-MM-DD');
      const to = cursor.endOf('month').format('YYYY-MM-DD');
      const summary = await this.attendanceService.getUserSummary(
        userId,
        from,
        to,
      );
      // Umuman darsi ham, yozuvi ham bo'lmagan oyni ko'rsatishdan ma'no yo'q
      if (!summary.expectedDays && !summary.attendedDays) continue;
      result.push({ month: cursor.format('YYYY-MM-01'), ...summary });
    }
    return result;
  }

  private async salaryView(salary: StaffSalary) {
    return {
      id: salary.id,
      forMonth: dayjs(salary.forMonth).format('YYYY-MM-DD'),
      ...salaryMoneyView(salary),
      status: salary.status,
      appliedDeductions: await this.deductionsService.listForSalary(salary.id),
    };
  }

  private receiptView(receipt: PaymentReceipt) {
    const payment: any = (receipt as any).payment;
    return {
      id: receipt.id,
      amount: Number(receipt.amount ?? 0),
      status: receipt.status,
      paymentMethod: receipt.paymentMethod ?? null,
      checkNo: receipt.checkNo ?? null,
      transactionNo: receipt.transactionNo ?? null,
      receivedAt: receipt.receivedAt ?? receipt.createdAt,
      comment: receipt.comment ?? null,
      student: payment?.student
        ? {
            id: payment.student.id,
            firstName: payment.student.firstName,
            lastName: payment.student.lastName,
          }
        : null,
      group: payment?.group
        ? { id: payment.group.id, name: payment.group.name }
        : null,
      forMonth: payment?.forMonth
        ? dayjs(payment.forMonth).format('YYYY-MM-DD')
        : null,
    };
  }

  private userView(user: User) {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      login: user.login,
      role: user.role,
      roleName: (user as any).userRole?.name ?? null,
      centerId: (user as any).center?.id ?? null,
      centerName: (user as any).center?.name ?? null,
      salary: Number(user.salary ?? 0),
      commissionPercentage: Number(user.commissionPercentage ?? 0),
      createdAt: user.createdAt,
      isActive: user.isActive !== false,
      dismissedAt: user.dismissedAt ?? null,
      dismissalReason: user.dismissalReason ?? null,
    };
  }

  /**
   * Boshqa xodimning sahifasini ko'rish uchun `staffPerformance.view` kerak.
   * O'zinikini har kim ko'radi (`staffAttendance.viewOwn` guard'da tekshirilgan).
   */
  private assertCanView(reqUser: any, targetUserId: number) {
    if (targetUserId === reqUser.userId) return;

    const permissions: string[] = reqUser.permissions ?? [];
    const allowed =
      permissions.includes(ALL_PERMISSIONS) ||
      permissions.includes('staffPerformance.view') ||
      reqUser.role === UserRole.ADMIN ||
      reqUser.role === UserRole.SUPER_ADMIN;

    if (!allowed) {
      throw new ForbiddenException(
        'Boshqa xodimning sahifasini ko‘rishga ruxsatingiz yo‘q',
      );
    }
  }

  private normalizeMonth(forMonth?: string): string {
    const ym = forMonth?.trim() || dayjs().format('YYYY-MM');
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new BadRequestException(
        'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak',
      );
    }
    return `${ym}-01`;
  }
}
