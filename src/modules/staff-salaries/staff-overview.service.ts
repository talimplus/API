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
import { ALL_PERMISSIONS } from '@/common/permissions/permission.catalog';
import { User } from '@/modules/users/entities/user.entity';
import {
  PaymentReceipt,
  PaymentReceiptStatus,
} from '@/modules/payments/entities/payment-receipt.entity';
import { StaffAttendanceService } from '@/modules/staff-attendance/staff-attendance.service';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';

const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Oyma-oy grafik uchun nechta oy ko'rsatiladi */
const MONTHS_IN_SERIES = 12;

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

    const [attendanceSummary, lateRecords, receipts, months, deductions] =
      await Promise.all([
        this.attendanceService.getUserSummary(userId, from, to),
        this.attendanceService.listUserRecords(userId, from, to),
        this.loadUnsettledReceipts(userId),
        this.buildMonthSeries(userId, month),
        this.deductionsService.listForUser(userId, reqUser),
      ]);

    const pending = receipts.filter(
      (r) => r.status === PaymentReceiptStatus.PENDING,
    );
    const rejected = receipts.filter(
      (r) => r.status === PaymentReceiptStatus.REJECTED,
    );

    const monthDeductions = deductions.filter(
      (d) => d.sourceForMonth === month,
    );
    const deductionOutstanding =
      await this.deductionsService.getOutstanding(userId);

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
      },
      months,
      lateRecords: lateRecords.filter((r) => (r.lateMinutes ?? 0) > 0),
      attendanceRecords: lateRecords,
      unsettledReceipts: receipts.map((r) => this.receiptView(r)),
      deductions,
      salary: salary ? await this.salaryView(salary) : null,
    };
  }

  // ─────────────────────────────────────────────────────────────

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
    const baseSalary = Number(salary.baseSalary ?? 0);
    const deductionAmount = Number(salary.deductionAmount ?? 0);
    const paidAmount = Number(salary.paidAmount ?? 0);
    const netSalary = round2(Math.max(0, baseSalary - deductionAmount));

    return {
      id: salary.id,
      forMonth: dayjs(salary.forMonth).format('YYYY-MM-DD'),
      baseSalary,
      deductionAmount,
      netSalary,
      paidAmount,
      remaining: round2(Math.max(0, netSalary - paidAmount)),
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
