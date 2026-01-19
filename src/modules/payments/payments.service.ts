import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Payment,
  PaymentStatus,
} from '@/modules/payments/entities/payment.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { Inject, forwardRef } from '@nestjs/common';
import { StudentDiscountPeriod } from '@/modules/students/entities/student-discount-period.entity';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  PaymentReceipt,
  PaymentReceiptStatus,
} from '@/modules/payments/entities/payment-receipt.entity';
import { UpdatePaymentDto } from '@/modules/payments/dto/update-payment.dto';
import { CalculatePaymentDto } from '@/modules/payments/dto/calculate-payment.dto';
import { User } from '@/modules/users/entities/user.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentReceipt)
    private readonly receiptRepo: Repository<PaymentReceipt>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StudentDiscountPeriod)
    private readonly discountPeriodRepo: Repository<StudentDiscountPeriod>,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
    @Inject(forwardRef(() => TeacherEarningsService))
    private readonly teacherEarningsService: TeacherEarningsService,
  ) {}

  private async computeReceiverCommissionSnapshot(args: {
    receivedById?: number | null;
    amount: number;
  }): Promise<{ percent: number; amount: number }> {
    const receivedById = args.receivedById ?? null;
    if (!receivedById) return { percent: 0, amount: 0 };

    const user = await this.userRepo.findOne({ where: { id: receivedById } });
    if (!user) return { percent: 0, amount: 0 };

    if (![UserRole.MANAGER, UserRole.RECEPTION].includes(user.role)) {
      return { percent: 0, amount: 0 };
    }
    const percent = Math.max(
      0,
      Math.min(100, Number(user.commissionPercentage ?? 0)),
    );
    if (percent <= 0) return { percent: 0, amount: 0 };

    const commissionAmount = this.round2(
      Number(args.amount ?? 0) * (percent / 100),
    );
    return { percent, amount: commissionAmount };
  }
  private async applyConfirmedMoneyToPayment(args: {
    payment: Payment;
    addAmount: number;
    confirmedById?: number;
  }): Promise<Payment> {
    const { payment, addAmount } = args;

    const prevPaid = Number(payment.amountPaid ?? 0);
    const amountDue = Number(payment.amountDue ?? 0);
    const safeAdd = Math.max(0, Number(addAmount ?? 0));
    const nextPaidRaw = this.round2(prevPaid + safeAdd);
    const nextPaid = Math.min(nextPaidRaw, amountDue);

    payment.amountPaid = nextPaid as any;
    if (payment.amountPaid >= amountDue) {
      payment.status = PaymentStatus.PAID;
    } else if (payment.amountPaid > 0) {
      payment.status = PaymentStatus.PARTIAL;
    } else {
      payment.status = PaymentStatus.UNPAID;
    }

    const saved = await this.paymentRepo.save(payment);

    // Referral discount: apply only when this student makes their first CONFIRMED payment (amountPaid 0 -> >0)
    if (prevPaid === 0 && Number(saved.amountPaid ?? 0) > 0) {
      void this.applyReferralDiscountOnFirstPayment(saved.studentId).catch(
        (e) => {
          // eslint-disable-next-line no-console
          console.warn(
            'referral discount apply failed:',
            (e as any)?.message ?? e,
          );
        },
      );
    }

    // Recalculate teacher earnings on any CONFIRMED money received (partial payments included)
    void this.triggerTeacherEarningsRecalcForPayment(saved.id).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('teacher earnings recalc failed:', (e as any)?.message ?? e);
    });

    return saved;
  }

  async submitReceipt(
    paymentId: number,
    amount: number,
    currentUser: CurrentUser,
    comment?: string,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      throw new BadRequestException('To‘lov miqdori noto‘g‘ri');
    }

    // If admin/super_admin submits, auto-confirm (boss took money)
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    const receipt = this.receiptRepo.create({
      paymentId: payment.id,
      amount: this.round2(amt) as any,
      receivedById: currentUser.userId,
      receivedAt: new Date(),
      status: isAdmin
        ? PaymentReceiptStatus.CONFIRMED
        : PaymentReceiptStatus.PENDING,
      confirmedById: isAdmin ? currentUser.userId : null,
      confirmedAt: isAdmin ? new Date() : null,
      comment: comment ?? null,
    });

    // If already confirmed (admin took money), store receiver commission snapshot
    if (isAdmin) {
      const snap = await this.computeReceiverCommissionSnapshot({
        receivedById: currentUser.userId,
        amount: amt,
      });
      receipt.receiverCommissionPercentSnapshot = snap.percent as any;
      receipt.receiverCommissionAmountSnapshot = snap.amount as any;
    }

    const savedReceipt = await this.receiptRepo.save(receipt);

    if (isAdmin) {
      const updated = await this.applyConfirmedMoneyToPayment({
        payment,
        addAmount: amt,
        confirmedById: currentUser.userId,
      });
      return { receipt: savedReceipt, payment: updated, pending: false };
    }

    return { receipt: savedReceipt, pending: true };
  }

  async submitFullReceipt(
    paymentId: number,
    currentUser: CurrentUser,
    comment?: string,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    const remaining = this.round2(
      Number(payment.amountDue ?? 0) - Number(payment.amountPaid ?? 0),
    );
    if (remaining <= 0) {
      throw new BadRequestException('Payment is already fully paid');
    }
    return this.submitReceipt(paymentId, remaining, currentUser, comment);
  }

  async confirmReceipt(receiptId: number, currentUser: CurrentUser) {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;
    if (!isAdmin) {
      throw new BadRequestException('Only admin can confirm receipts');
    }

    const receipt = await this.receiptRepo.findOne({
      where: { id: receiptId },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status === PaymentReceiptStatus.CONFIRMED) {
      const payment = await this.paymentRepo.findOne({
        where: { id: receipt.paymentId },
      });
      return { receipt, payment, alreadyConfirmed: true };
    }
    if (receipt.status === PaymentReceiptStatus.REJECTED) {
      throw new BadRequestException('Receipt is rejected');
    }

    const payment = await this.paymentRepo.findOne({
      where: { id: receipt.paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    const updatedPayment = await this.applyConfirmedMoneyToPayment({
      payment,
      addAmount: Number(receipt.amount ?? 0),
      confirmedById: currentUser.userId,
    });

    receipt.status = PaymentReceiptStatus.CONFIRMED;
    receipt.confirmedById = currentUser.userId;
    receipt.confirmedAt = new Date();

    const snap = await this.computeReceiverCommissionSnapshot({
      receivedById: receipt.receivedById ?? null,
      amount: Number(receipt.amount ?? 0),
    });
    receipt.receiverCommissionPercentSnapshot = snap.percent as any;
    receipt.receiverCommissionAmountSnapshot = snap.amount as any;
    const savedReceipt = await this.receiptRepo.save(receipt);

    return { receipt: savedReceipt, payment: updatedPayment };
  }

  async listPendingReceipts(
    organizationId: number,
    args: { centerId?: number; page?: number; perPage?: number },
  ) {
    const page = Math.max(1, Number(args.page ?? 1));
    const perPage = Math.max(1, Math.min(100, Number(args.perPage ?? 20)));
    const skip = (page - 1) * perPage;

    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.payment', 'p')
      .leftJoinAndSelect('p.student', 'student')
      .leftJoinAndSelect('p.group', 'group')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .orderBy('r.createdAt', 'DESC')
      .skip(skip)
      .take(perPage);

    if (args.centerId) {
      qb.andWhere('center.id = :centerId', { centerId: args.centerId });
    }

    const [data, total] = await qb.getManyAndCount();
    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  private readonly REFERRAL_DISCOUNT_PERCENT = 10;
  // Month length using exclusive end boundary. 1 => [fromMonth, fromMonth+1)
  private readonly REFERRAL_DISCOUNT_MONTHS = 1;

  private discountCache = new Map<
    string,
    { percent: number; breakdown: Array<{ percent: number; reason: string }> }
  >();

  private async applyMonthlyDiscountIncrement(args: {
    studentId: number;
    monthStart: string; // YYYY-MM-01
    incrementPercent: number; // 0..100
    reason: string;
  }) {
    const { studentId, monthStart, incrementPercent, reason } = args;
    const mStart = dayjs(monthStart).startOf('month').format('YYYY-MM-01');
    const mEnd = dayjs(mStart)
      .add(1, 'month')
      .startOf('month')
      .format('YYYY-MM-01'); // exclusive

    // Stacking: we add a separate period record for this month and let calculation sum them.
    // Enforce 100% cap for this month.
    await this.discountPeriodRepo.manager.transaction(async (manager) => {
      const studentRepo = manager.getRepository(Student);
      const paymentRepo = manager.getRepository(Payment);
      const periodRepo = manager.getRepository(StudentDiscountPeriod);

      const student = await studentRepo.findOne({ where: { id: studentId } });
      if (!student) return;

      // Do not allow changing historical paid/partial months
      const paid = await paymentRepo.findOne({
        where: { studentId: studentId as any, forMonth: mStart as any } as any,
      });
      if (paid && Number((paid as any).amountPaid ?? 0) > 0) {
        throw new BadRequestException(
          `Cannot apply discount for ${dayjs(mStart).format('YYYY-MM')}: payment already has money received (paid/partial).`,
        );
      }

      // Sum existing period percents for this month (exclusive end)
      const raw = await periodRepo
        .createQueryBuilder('d')
        .select('COALESCE(SUM(d.percent), 0)', 'sum')
        .where('d.studentId = :studentId', { studentId })
        .andWhere('d.fromMonth <= :mStart', { mStart })
        .andWhere('(d.toMonth IS NULL OR d.toMonth > :mStart)', { mStart })
        .getRawOne<{ sum: string }>();

      const base = Number((student as any).discountPercent ?? 0);
      const existingSum = Number(raw?.sum ?? 0);
      const nextTotal = base + existingSum + Number(incrementPercent);
      if (nextTotal > 100) {
        throw new BadRequestException(
          `Total discountPercent exceeds 100% for studentId=${studentId} month=${mStart} (got ${nextTotal}%)`,
        );
      }

      await periodRepo.save(
        periodRepo.create({
          studentId,
          percent: Number(incrementPercent) as any,
          fromMonth: mStart as any,
          toMonth: mEnd as any,
          reason,
        }),
      );
    });

    // clear cache so new discount is visible immediately
    this.discountCache.delete(`${studentId}:${mStart}`);
  }

  private async applyReferralDiscountOnFirstPayment(studentId: number) {
    const referral = await this.referralRepo.findOne({
      where: { referredStudentId: studentId as any },
    });
    if (!referral) return;
    if ((referral as any).isDiscountApplied) return;

    const referrerStudentId = (referral as any).referrerStudentId;
    if (!referrerStudentId) return;

    // Rule:
    // - If referrer has NOT paid anything for current month yet -> apply discount for current month
    // - If referrer already paid (partial or full) for current month -> apply discount starting next month
    const currentMonth = dayjs().startOf('month').format('YYYY-MM-01');
    const hasPaidThisMonth = await this.paymentRepo
      .createQueryBuilder('p')
      .where('p.studentId = :studentId', { studentId: referrerStudentId })
      .andWhere('p.forMonth = :forMonth', { forMonth: currentMonth })
      .andWhere('p.status IN (:...statuses)', {
        statuses: [PaymentStatus.PAID, PaymentStatus.PARTIAL],
      })
      .andWhere('p.amountPaid > 0')
      .getExists();

    const fromMonth = hasPaidThisMonth
      ? dayjs(currentMonth)
          .add(1, 'month')
          .startOf('month')
          .format('YYYY-MM-01')
      : currentMonth;
    const increment = this.REFERRAL_DISCOUNT_PERCENT;
    await this.applyMonthlyDiscountIncrement({
      studentId: referrerStudentId,
      monthStart: fromMonth,
      incrementPercent: increment,
      reason: `Referral +${increment}% (referred student ${studentId})`,
    });

    referral.isDiscountApplied = true;
    await this.referralRepo.save(referral);

    await this.recalculateOpenPaymentsForStudent(referrerStudentId, {
      maxMonthsBack: 3,
    });
  }

  private async resolveDiscountForMonth(args: {
    student: Student;
    forMonth: string; // YYYY-MM-01
  }): Promise<{
    percent: number;
    breakdown: Array<{ percent: number; reason: string }>;
  }> {
    const { student, forMonth } = args;
    const key = `${student.id}:${forMonth}`;
    const cached = this.discountCache.get(key);
    if (cached !== undefined) return cached;

    const rows = await this.discountPeriodRepo
      .createQueryBuilder('d')
      .where('d.studentId = :studentId', { studentId: student.id })
      .andWhere('d.fromMonth <= :forMonth', { forMonth })
      .andWhere('(d.toMonth IS NULL OR d.toMonth > :forMonth)', { forMonth })
      .orderBy('d.fromMonth', 'DESC')
      .addOrderBy('d.createdAt', 'DESC')
      .getMany();

    const breakdown: Array<{ percent: number; reason: string }> = [];

    // base student.discountPercent (fallback, still supported for referrals/legacy)
    const base = Number(student.discountPercent ?? 0);
    if (base > 0) {
      breakdown.push({
        percent: base,
        reason: student.discountReason
          ? `Base: ${student.discountReason}`
          : 'Base discount',
      });
    }

    for (const r of rows as any[]) {
      const p = Number(r.percent ?? 0);
      if (!p) continue;
      breakdown.push({
        percent: p,
        reason: r.reason ?? 'Discount period',
      });
    }

    const total = breakdown.reduce((sum, b) => sum + b.percent, 0);
    if (total > 100) {
      throw new BadRequestException(
        `Total discountPercent exceeds 100% for studentId=${student.id} month=${forMonth} (got ${total}%)`,
      );
    }

    const result = { percent: Math.max(0, total), breakdown };
    this.discountCache.set(key, result);
    return result;
  }

  private async triggerTeacherEarningsRecalcForPayment(paymentId: number) {
    // We intentionally do not block the payment flow on earnings calculations.
    // If this fails, payroll can still be recalculated via /teacher-earnings/calculate.
    const info = await this.paymentRepo
      .createQueryBuilder('p')
      .select([
        'p.forMonth as "forMonth"',
        't.id as "teacherId"',
        'org.id as "organizationId"',
      ])
      .leftJoin('p.group', 'g')
      .leftJoin('g.teacher', 't')
      .leftJoin('t.organization', 'org')
      .where('p.id = :paymentId', { paymentId })
      .getRawOne<{
        forMonth: string;
        teacherId: number | null;
        organizationId: number | null;
      }>();

    if (!info?.teacherId || !info?.organizationId || !info?.forMonth) return;

    // Month offset: payments.forMonth = earning month, salary is paid in next month
    const payYm = dayjs(info.forMonth).add(1, 'month').format('YYYY-MM');

    // Do not attempt to calculate earnings for future pay months.
    // This can happen when we adjust current-month payments (e.g. student STOPPED refund),
    // because pay month would be next month, which is not allowed by payroll modules.
    const currentYm = dayjs().startOf('month').format('YYYY-MM');
    if (dayjs(`${payYm}-01`).isAfter(dayjs(`${currentYm}-01`))) {
      return;
    }

    await this.teacherEarningsService.calculateTeacherEarningsForMonth(
      info.organizationId,
      info.teacherId,
      payYm,
      { force: true },
    );
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async generateMonthlyPayments() {
    this.logger.log('Cron: Current month payments ensuring...');
    // Cron: ensure current month payments exist (table must never stay empty).
    // We keep this lightweight: ensure only current month for all active students.
    await this.ensurePaymentsForAllActiveStudents({ onlyCurrentMonth: true });
    this.logger.log('Cron: Payment ensure finished');
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private computeDueDates(
    forMonth: string,
    timezone: string,
  ): {
    dueDate: string;
    hardDueDate: string;
  } {
    // IMPORTANT: parse first, then apply timezone (avoids dayjs.tz parsing pitfalls)
    const m = dayjs(forMonth).tz(timezone).startOf('month');
    return {
      dueDate: m.date(10).format('YYYY-MM-DD'),
      hardDueDate: m.date(15).format('YYYY-MM-DD'),
    };
  }

  private computeMonthLessonCounts(args: {
    group: Group;
    forMonth: string; // YYYY-MM-01
    studentActiveStart: string; // YYYY-MM-DD
    studentActiveEndExclusive?: string; // YYYY-MM-DD (optional)
  }): { lessonsPlanned: number; lessonsBillable: number } {
    const { group, forMonth, studentActiveStart, studentActiveEndExclusive } =
      args;
    const timezone = group.timezone || 'Asia/Tashkent';

    // IMPORTANT: parse first, then apply timezone
    const monthStart = dayjs(forMonth).tz(timezone).startOf('month');
    const monthEnd = monthStart.endOf('month');

    /**
     * BUSINESS RULE:
     * - group.monthlyFee represents a full-month price (independent of when the group was created during the month).
     * Therefore:
     * - lessonsPlanned = schedule-matching lesson count for the FULL calendar month (monthStart..monthEnd),
     *   ignoring group.startDate.
     * - lessonsBillable = lessons the student must pay for, based on studentActiveStart (which already accounts for
     *   group.startDate and student.activatedAt/createdAt).
     */

    // Planned lessons for the full month (ignore group boundaries)
    // Use group.startDate and group.endDate for group boundaries, but calculate lessons for full month
    const groupStartDate = group.startDate
      ? dayjs(group.startDate).tz(timezone).format('YYYY-MM-DD')
      : monthStart.format('YYYY-MM-DD');
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).tz(timezone).format('YYYY-MM-DD')
      : null;

    const plannedDates = computeLessonDates({
      timezone,
      groupStartDate,
      groupEndDate,
      schedules: group.schedules ?? [],
      window: {
        mode: 'range',
        from: monthStart.format('YYYY-MM-DD'),
        to: monthEnd.format('YYYY-MM-DD'),
      },
    });

    const lessonsPlanned = plannedDates.length;
    if (!lessonsPlanned) return { lessonsPlanned: 0, lessonsBillable: 0 };

    // Billable lessons: subset of the full month schedule starting from studentActiveStart
    // and optionally ending before studentActiveEndExclusive (used for STOPPED refunds).
    const lessonsBillable = plannedDates.filter((d) => {
      if (d < studentActiveStart) return false;
      if (studentActiveEndExclusive && d >= studentActiveEndExclusive)
        return false;
      return true;
    }).length;

    return { lessonsPlanned, lessonsBillable };
  }

  private computeStudentActiveStartForMonth(args: {
    student: Student;
    group: Group;
    forMonth: string; // YYYY-MM-01
  }): string {
    const { student, group, forMonth } = args;
    const timezone = group.timezone || 'Asia/Tashkent';

    // IMPORTANT: parse first, then apply timezone
    const monthStart = dayjs(forMonth).tz(timezone).startOf('month');

    const activatedOrCreated = student.activatedAt
      ? dayjs(student.activatedAt).tz(timezone)
      : dayjs(student.createdAt).tz(timezone);

    const groupStart = dayjs(group.startDate).tz(timezone);

    let max = monthStart.startOf('day');
    const a = activatedOrCreated.startOf('day');
    const g = groupStart.startOf('day');
    if (a.isAfter(max)) max = a;
    if (g.isAfter(max)) max = g;
    return max.format('YYYY-MM-DD');
  }

  private computeStudentActiveEndExclusiveForMonth(args: {
    student: Student;
    group: Group;
    forMonth: string; // YYYY-MM-01
  }): string | null {
    const { student, group, forMonth } = args;
    if (!student.stoppedAt) return null;

    const timezone = group.timezone || 'Asia/Tashkent';
    const monthStart = dayjs(forMonth).tz(timezone).startOf('month');
    const monthEnd = monthStart.endOf('month');

    const stoppedDay = dayjs(student.stoppedAt).tz(timezone).startOf('day');
    // If stopped outside this month, no end boundary for this month.
    if (stoppedDay.isBefore(monthStart.startOf('day'))) {
      // stopped before month start => nothing billable this month; endExclusive = monthStart
      return monthStart.format('YYYY-MM-DD');
    }
    if (stoppedDay.isAfter(monthEnd.startOf('day'))) {
      return null;
    }
    // Refund from stopped day inclusive => endExclusive = stopped day
    return stoppedDay.format('YYYY-MM-DD');
  }

  async adjustPaymentsForStudentStopped(studentId: number) {
    this.discountCache.clear();
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
      relations: ['groups'],
    });
    if (!student) return;
    if (!student.stoppedAt) return;

    const currentMonth = dayjs().startOf('month').format('YYYY-MM-01');

    const payments = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where('payments.studentId = :studentId', { studentId })
      .andWhere('payments.forMonth = :forMonth', { forMonth: currentMonth })
      .getMany();

    if (!payments.length) return;

    const toSave: Payment[] = [];
    for (const p of payments as any[]) {
      if (!p.group || !p.student) continue;
      if (!p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      const studentActiveStart = this.computeStudentActiveStartForMonth({
        student: p.student,
        group: p.group,
        forMonth,
      });
      const studentActiveEndExclusive =
        this.computeStudentActiveEndExclusiveForMonth({
          student: p.student,
          group: p.group,
          forMonth,
        });

      const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts(
        {
          group: p.group,
          forMonth,
          studentActiveStart,
          studentActiveEndExclusive: studentActiveEndExclusive ?? undefined,
        },
      );

      const { percent: discountPercent } = await this.resolveDiscountForMonth({
        student: p.student,
        forMonth,
      });
      const amountDue = this.computeAmountDue({
        student: p.student,
        group: p.group,
        lessonsPlanned,
        lessonsBillable,
        discountPercent,
      });

      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);

      const prevPaid = Number(p.amountPaid ?? 0);
      const prevRefunded = Number(p.refundedAmount ?? 0);

      let newPaid = prevPaid;
      let newRefunded = prevRefunded;
      let refundedAt: Date | null = p.refundedAt ?? null;

      if (newPaid > amountDue) {
        const refund = this.round2(newPaid - amountDue);
        newRefunded = this.round2(newRefunded + refund);
        newPaid = amountDue;
        refundedAt = new Date();
      }

      let newStatus = p.status;
      if (newPaid === amountDue) newStatus = PaymentStatus.PAID;
      else if (newPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.amountDue = amountDue as any;
      p.amountPaid = newPaid as any;
      p.refundedAmount = newRefunded as any;
      p.refundedAt = refundedAt as any;
      p.status = newStatus;
      p.dueDate = dueDate as any;
      p.hardDueDate = hardDueDate as any;

      toSave.push(p);
    }

    if (toSave.length) {
      await this.paymentRepo.save(toSave as any);
      // Trigger teacher earnings recalculation for affected payments
      for (const p of toSave) {
        // Do not block STOPPED flow on payroll calculations
        void this.triggerTeacherEarningsRecalcForPayment(p.id).catch(() => {});
      }
    }
  }

  private computeAmountDue(args: {
    student: Student;
    group: Group;
    lessonsPlanned: number;
    lessonsBillable: number;
    discountPercent: number;
  }): number {
    const { student, group, lessonsPlanned, lessonsBillable, discountPercent } =
      args;
    // Fee priority:
    // - if student.monthlyFee is set (> 0) -> use it
    // - otherwise fallback to group.monthlyFee
    const studentFee = Number(student.monthlyFee ?? 0);
    const groupFee = Number(group.monthlyFee ?? 0);
    const baseMonthlyFee = studentFee > 0 ? studentFee : groupFee;
    if (!lessonsPlanned) return 0;

    // Apply discount AFTER lesson-based prorating
    const proratedFee = baseMonthlyFee * (lessonsBillable / lessonsPlanned);
    const finalFee = proratedFee * (1 - discountPercent / 100);
    return this.round2(Math.max(0, finalFee));
  }

  /**
   * Recalculate open payments (UNPAID/PARTIAL) when pricing inputs change:
   * - student.monthlyFee / group.monthlyFee
   * - student.discountPercent
   *
   * Bound to a small window for safety (default: last 3 months).
   * PAID payments are never changed.
   */
  private async recalculateOpenPaymentsForOrganization(
    organizationId: number,
    opts?: { maxMonthsBack?: number; centerId?: number },
  ) {
    this.discountCache.clear();
    const maxMonthsBack = Math.max(1, opts?.maxMonthsBack ?? 3);
    const windowStart = dayjs()
      .startOf('month')
      .subtract(maxMonthsBack - 1, 'month')
      .format('YYYY-MM-01');
    const windowEnd = dayjs().startOf('month').format('YYYY-MM-01');

    const payments = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere(opts?.centerId ? 'center.id = :centerId' : '1=1', {
        centerId: opts?.centerId,
      })
      .andWhere('payments.status != :paid', { paid: PaymentStatus.PAID })
      .andWhere('payments.forMonth BETWEEN :windowStart AND :windowEnd', {
        windowStart,
        windowEnd,
      })
      .getMany();

    if (!payments.length) return;

    const toSave: Payment[] = [];
    const toDeleteIds: number[] = [];

    for (const p of payments as any[]) {
      if (!p.group || !p.student) continue;
      if (!p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      const studentActiveStart = this.computeStudentActiveStartForMonth({
        student: p.student,
        group: p.group,
        forMonth,
      });
      const plannedEndExclusive = p.plannedStudyUntilDate
        ? dayjs(p.plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
        : undefined;
      const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts(
        {
          group: p.group,
          forMonth,
          studentActiveStart,
          studentActiveEndExclusive: plannedEndExclusive,
        },
      );

      // Keep the system free of useless zero-bill payments:
      // if nothing is billable and nothing was paid -> delete open payment
      const amountPaid = Number(p.amountPaid ?? 0);
      if (!lessonsPlanned || !lessonsBillable) {
        if (amountPaid === 0) {
          toDeleteIds.push(p.id);
        }
        continue;
      }

      const { percent: discountPercent } = await this.resolveDiscountForMonth({
        student: p.student,
        forMonth,
      });
      const amountDue = this.computeAmountDue({
        student: p.student,
        group: p.group,
        lessonsPlanned,
        lessonsBillable,
        discountPercent,
      });

      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);

      // If discount/fee changed and now due is below already-paid amount,
      // clamp amountPaid to amountDue and mark PAID.
      let newAmountPaid = amountPaid;
      let newStatus = p.status;
      if (newAmountPaid > amountDue) {
        newAmountPaid = amountDue;
      }
      if (newAmountPaid === amountDue) newStatus = PaymentStatus.PAID;
      else if (newAmountPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.amountDue = amountDue as any;
      p.amountPaid = newAmountPaid as any;
      p.status = newStatus;
      p.dueDate = dueDate as any;
      p.hardDueDate = hardDueDate as any;

      toSave.push(p);
    }

    if (toDeleteIds.length) {
      await this.paymentRepo.delete(toDeleteIds);
    }
    if (toSave.length) {
      await this.paymentRepo.save(toSave);
    }
  }

  /**
   * Ensure missing monthly payments exist for all ACTIVE students (and each group they belong to).
   * - Never overwrites existing payments
   * - Never creates duplicates (guarded by unique constraint + existence set)
   */
  async ensurePaymentsForOrganization(
    organizationId: number,
    opts?: { maxMonthsBack?: number; centerId?: number },
  ) {
    // Load active students within org + their groups + schedules (billing is schedule-based)
    const students = await this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.groups', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere(opts?.centerId ? 'center.id = :centerId' : '1=1', {
        centerId: opts?.centerId,
      })
      .andWhere('student.status = :status', { status: StudentStatus.ACTIVE })
      .getMany();

    await this.ensurePaymentsForStudents(students, {
      onlyCurrentMonth: false,
      maxMonthsBack: opts?.maxMonthsBack,
    });
  }

  async ensurePaymentsForStudent(
    studentId: number,
    opts: { onlyCurrentMonth: boolean } = { onlyCurrentMonth: false },
  ) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
      relations: ['groups', 'groups.schedules', 'center'],
    });
    if (!student) return;
    if (student.status !== StudentStatus.ACTIVE) return;
    await this.ensurePaymentsForStudents([student], opts);
  }

  private async ensurePaymentsForAllActiveStudents(opts: {
    onlyCurrentMonth: boolean;
  }) {
    const students = await this.studentRepo.find({
      where: { status: StudentStatus.ACTIVE },
      relations: ['groups', 'groups.schedules', 'center'],
    });
    await this.ensurePaymentsForStudents(students, opts);
  }

  /**
   * Recalculate open payments for a specific student (used when discount periods change).
   * PAID payments are never modified.
   */
  async recalculateOpenPaymentsForStudent(
    studentId: number,
    opts?: { maxMonthsBack?: number },
  ) {
    this.discountCache.clear();

    const maxMonthsBack = Math.max(1, opts?.maxMonthsBack ?? 3);
    const windowStart = dayjs()
      .startOf('month')
      .subtract(maxMonthsBack - 1, 'month')
      .format('YYYY-MM-01');
    const windowEnd = dayjs().startOf('month').format('YYYY-MM-01');

    const payments = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where('payments.studentId = :studentId', { studentId })
      .andWhere('payments.status != :paid', { paid: PaymentStatus.PAID })
      .andWhere('payments.forMonth BETWEEN :windowStart AND :windowEnd', {
        windowStart,
        windowEnd,
      })
      .getMany();

    if (!payments.length) return;

    const toSave: Payment[] = [];
    const toDeleteIds: number[] = [];

    for (const p of payments as any[]) {
      if (!p.group || !p.student) continue;
      if (!p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      const studentActiveStart = this.computeStudentActiveStartForMonth({
        student: p.student,
        group: p.group,
        forMonth,
      });
      const studentActiveEndExclusive =
        this.computeStudentActiveEndExclusiveForMonth({
          student: p.student,
          group: p.group,
          forMonth,
        });

      const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts(
        {
          group: p.group,
          forMonth,
          studentActiveStart,
          studentActiveEndExclusive: studentActiveEndExclusive ?? undefined,
        },
      );

      const amountPaid = Number(p.amountPaid ?? 0);
      if (!lessonsPlanned || !lessonsBillable) {
        if (amountPaid === 0) toDeleteIds.push(p.id);
        continue;
      }

      const { percent: discountPercent } = await this.resolveDiscountForMonth({
        student: p.student,
        forMonth,
      });
      const amountDue = this.computeAmountDue({
        student: p.student,
        group: p.group,
        lessonsPlanned,
        lessonsBillable,
        discountPercent,
      });

      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);

      let newAmountPaid = amountPaid;
      let newStatus = p.status;
      if (newAmountPaid > amountDue) newAmountPaid = amountDue;
      if (newAmountPaid === amountDue) newStatus = PaymentStatus.PAID;
      else if (newAmountPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.amountDue = amountDue as any;
      p.amountPaid = newAmountPaid as any;
      p.status = newStatus;
      p.dueDate = dueDate as any;
      p.hardDueDate = hardDueDate as any;

      toSave.push(p);
    }

    if (toDeleteIds.length) await this.paymentRepo.delete(toDeleteIds);
    if (toSave.length) await this.paymentRepo.save(toSave);
  }

  private async ensurePaymentsForStudents(
    students: Student[],
    opts: { onlyCurrentMonth: boolean; maxMonthsBack?: number },
  ) {
    if (!students.length) return;
    this.discountCache.clear();

    const studentIds = students.map((s) => s.id);
    const groupIds = Array.from(
      new Set(
        students
          .flatMap((s) => s.groups ?? [])
          .map((g) => g?.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );

    if (!groupIds.length) return;

    const existing = await this.paymentRepo
      .createQueryBuilder('payments')
      .select([
        'payments.studentId as "studentId"',
        'payments.groupId as "groupId"',
        'payments.forMonth as "forMonth"',
      ])
      .where('payments.studentId IN (:...studentIds)', { studentIds })
      .andWhere('payments.groupId IN (:...groupIds)', { groupIds })
      .getRawMany<{ studentId: number; groupId: number; forMonth: string }>();

    const existingSet = new Set(
      existing.map((r) => `${r.studentId}:${r.groupId}:${r.forMonth}`),
    );

    const toCreate: Partial<Payment>[] = [];

    for (const student of students) {
      for (const group of student.groups ?? []) {
        if (!group?.id) continue;
        if (!group.schedules?.length) continue; // no schedule => no lesson plan => skip

        const timezone = group.timezone || 'Asia/Tashkent';
        const todayMonth = dayjs().tz(timezone).startOf('month');

        const activatedOrCreated = student.activatedAt
          ? dayjs(student.activatedAt).tz(timezone)
          : dayjs(student.createdAt).tz(timezone);
        const groupStart = dayjs(group.startDate).tz(timezone);

        const startAnchor = activatedOrCreated.isAfter(groupStart)
          ? activatedOrCreated
          : groupStart;
        const startMonth = startAnchor.startOf('month');

        const endMonth = todayMonth;

        let startCursor = startMonth;
        if (
          !opts.onlyCurrentMonth &&
          opts.maxMonthsBack &&
          opts.maxMonthsBack > 0
        ) {
          const limitStart = endMonth
            .subtract(opts.maxMonthsBack - 1, 'month')
            .startOf('month');
          if (startCursor.isBefore(limitStart)) startCursor = limitStart;
        }

        let cursor = opts.onlyCurrentMonth ? endMonth : startCursor;
        while (cursor.isBefore(endMonth) || cursor.isSame(endMonth)) {
          const forMonth = cursor.format('YYYY-MM-01');
          const key = `${student.id}:${group.id}:${forMonth}`;
          if (existingSet.has(key)) {
            cursor = cursor.add(1, 'month');
            continue;
          }

          const studentActiveStart = this.computeStudentActiveStartForMonth({
            student,
            group,
            forMonth,
          });
          const { lessonsPlanned, lessonsBillable } =
            this.computeMonthLessonCounts({
              group,
              forMonth,
              studentActiveStart,
            });

          if (!lessonsPlanned) {
            cursor = cursor.add(1, 'month');
            continue;
          }

          // Prevent useless zero-bill payments (e.g. activeStart after last lesson)
          if (!lessonsBillable) {
            cursor = cursor.add(1, 'month');
            continue;
          }

          const { percent: discountPercent } =
            await this.resolveDiscountForMonth({ student, forMonth });
          const amountDue = this.computeAmountDue({
            student,
            group,
            lessonsPlanned,
            lessonsBillable,
            discountPercent,
          });

          const { dueDate, hardDueDate } = this.computeDueDates(
            forMonth,
            timezone,
          );

          toCreate.push({
            studentId: student.id,
            groupId: group.id,
            student: { id: student.id } as any,
            group: { id: group.id } as any,
            forMonth: forMonth as any,
            amountDue,
            amountPaid: 0,
            status: PaymentStatus.UNPAID,
            dueDate: dueDate as any,
            hardDueDate: hardDueDate as any,
            lessonsPlanned,
            lessonsBillable,
          });
          existingSet.add(key);

          cursor = cursor.add(1, 'month');
        }
      }
    }

    if (!toCreate.length) return;

    // Insert-only. If a race happens, unique constraint will reject duplicates.
    try {
      await this.paymentRepo.save(toCreate as any);
    } catch (e) {
      // Ignore only unique conflicts; surface everything else (like numeric overflow)
      const code = (e as any)?.code ?? (e as any)?.driverError?.code;
      if (code === '23505') {
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('ensurePayments save error:', (e as any)?.message ?? e);
      throw e;
    }
  }

  // To‘liq to‘lovni tasdiqlash
  async markAsPaid(paymentId: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    payment.amountPaid = payment.amountDue;
    payment.status = PaymentStatus.PAID;
    return this.paymentRepo.save(payment);
  }

  // Qisman to‘lov qilish
  async payPartial(paymentId: number, amount: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');
    if (amount <= 0) throw new BadRequestException('To‘lov miqdori noto‘g‘ri');

    const amountDue = Number(payment.amountDue ?? 0);
    const amountPaid = Number(payment.amountPaid ?? 0);
    payment.amountPaid = Math.min(amountPaid + amount, amountDue);

    if (payment.amountPaid === amountDue) {
      payment.status = PaymentStatus.PAID;
    } else {
      payment.status = PaymentStatus.PARTIAL;
    }

    return this.paymentRepo.save(payment);
  }

  async findAll(
    organizationId: number,
    {
      centerId,
      page,
      perPage,
      status,
      forMonth,
      overdueOnly,
      studentId,
      groupId,
      search,
    }: {
      centerId?: number;
      page: number;
      perPage: number;
      status?: PaymentStatus;
      forMonth?: string; // YYYY-MM
      overdueOnly?: boolean;
      studentId?: number;
      groupId?: number;
      search?: string;
    },
    currentUser: CurrentUser,
  ) {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    const effectiveCenterId =
      centerId ?? (!isAdmin ? currentUser.centerId : undefined);

    // Ensure missing monthly payments are present when listing payments
    try {
      await this.ensurePaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
        centerId: effectiveCenterId,
      });
      // Also recalculate open payments in the same bounded window (pricing/discount updates)
      await this.recalculateOpenPaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
        centerId: effectiveCenterId,
      });
    } catch (e) {
      // Helpful error when DB schema is outdated (migrations not applied)
      if (
        e instanceof QueryFailedError &&
        typeof (e as any).message === 'string' &&
        (e as any).message.includes('does not exist')
      ) {
        throw new BadRequestException(
          'Database schema is outdated. Please run migrations: `npm run migration:run`',
        );
      }
      throw e;
    }

    const skip = (page - 1) * perPage;
    const query = this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (effectiveCenterId) {
      query.andWhere('center.id = :centerId', { centerId: effectiveCenterId });
    } else if (!isAdmin) {
      // safety: non-admin must always be scoped to a center
      throw new BadRequestException('centerId is required');
    }

    if (status) {
      query.andWhere('payments.status = :status', { status });
    }

    if (studentId) {
      query.andWhere('payments.studentId = :studentId', { studentId });
    }

    if (groupId) {
      query.andWhere('payments.groupId = :groupId', { groupId });
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query.andWhere(
        new Brackets((qb) => {
          qb.where('student.firstName ILIKE :q', { q })
            .orWhere('student.lastName ILIKE :q', { q })
            .orWhere('student.phone ILIKE :q', { q })
            .orWhere('group.name ILIKE :q', { q });
        }),
      );
    }

    if (forMonth) {
      // normalize YYYY-MM -> YYYY-MM-01
      const m = `${forMonth}-01`;
      query.andWhere('payments.forMonth = :forMonth', { forMonth: m });
    }

    if (overdueOnly) {
      // overdue = today > hardDueDate AND status != paid
      query.andWhere('payments.hardDueDate IS NOT NULL');
      query.andWhere('payments.status != :paid', { paid: PaymentStatus.PAID });
      query.andWhere('payments.hardDueDate < CURRENT_DATE');
    }

    const [data, total] = await query
      .orderBy('payments.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    // Pending receipts aggregation (so UI can show "awaiting approval")
    const paymentIds = data.map((p: any) => Number(p.id)).filter(Boolean);
    const pendingByPaymentId = new Map<
      number,
      { pendingAmount: number; pendingReceiptsCount: number }
    >();
    if (paymentIds.length) {
      const raw = await this.receiptRepo
        .createQueryBuilder('r')
        .select([
          'r.paymentId as "paymentId"',
          'COALESCE(SUM(r.amount), 0) as "pendingAmount"',
          'COUNT(r.id) as "pendingReceiptsCount"',
        ])
        .where('r.paymentId IN (:...paymentIds)', { paymentIds })
        .andWhere('r.status = :status', {
          status: PaymentReceiptStatus.PENDING,
        })
        .groupBy('r.paymentId')
        .getRawMany<{
          paymentId: number;
          pendingAmount: string;
          pendingReceiptsCount: string;
        }>();

      for (const r of raw) {
        pendingByPaymentId.set(Number(r.paymentId), {
          pendingAmount: Number(r.pendingAmount ?? 0),
          pendingReceiptsCount: Number(r.pendingReceiptsCount ?? 0),
        });
      }
    }

    // enrich response with computed fields (overdue, remaining, discount breakdown)
    const enriched = await Promise.all(
      data.map(async (p: any) => {
        const timezone = p.group?.timezone || 'Asia/Tashkent';
        const today = dayjs().tz(timezone).format('YYYY-MM-DD');
        const hardDue = p.hardDueDate
          ? dayjs(p.hardDueDate).format('YYYY-MM-DD')
          : null;
        const isOverdue =
          !!hardDue && today > hardDue && p.status !== PaymentStatus.PAID;

        const amountDue = Number(p.amountDue ?? 0);
        const amountPaid = Number(p.amountPaid ?? 0);
        const remainingAmount = this.round2(amountDue - amountPaid);

        const pending = pendingByPaymentId.get(Number(p.id)) ?? {
          pendingAmount: 0,
          pendingReceiptsCount: 0,
        };

        const paymentForMonth = p.forMonth
          ? dayjs(p.forMonth).startOf('month').format('YYYY-MM-01')
          : null;
        const discount =
          p.student && paymentForMonth
            ? await this.resolveDiscountForMonth({
                student: p.student,
                forMonth: paymentForMonth,
              })
            : { percent: 0, breakdown: [] };

        return {
          ...instanceToPlain(p),
          forMonth: p.forMonth ? dayjs(p.forMonth).format('YYYY-MM-DD') : null,
          createdAt: p.createdAt?.toISOString?.() ?? String(p.createdAt),
          dueDate: p.dueDate ? dayjs(p.dueDate).format('YYYY-MM-DD') : null,
          hardDueDate: p.hardDueDate
            ? dayjs(p.hardDueDate).format('YYYY-MM-DD')
            : null,
          isOverdue,
          remainingAmount,
          refundedAmount: Number((p as any).refundedAmount ?? 0),
          pendingAmount: pending.pendingAmount,
          hasPendingReceipt: pending.pendingReceiptsCount > 0,
          pendingReceiptsCount: pending.pendingReceiptsCount,
          discountPercentApplied: discount.percent,
          discountBreakdown: discount.breakdown,
          lessonsPlanned: p.lessonsPlanned ?? 0,
          lessonsBillable: p.lessonsBillable ?? 0,
        };
      }),
    );

    return {
      data: enriched,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async calculatePayment(id: number, dto: CalculatePaymentDto) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['student', 'group', 'group.schedules'],
    });
    if (!payment) throw new NotFoundException("To'lov topilmadi");

    if (!payment.group || !payment.student) {
      throw new BadRequestException(
        "Payment student yoki group ma'lumotlari topilmadi",
      );
    }

    if (!payment.group.schedules || payment.group.schedules.length === 0) {
      throw new BadRequestException("Group'da schedule ma'lumotlari topilmadi");
    }

    const forMonth = dayjs(payment.forMonth)
      .startOf('month')
      .format('YYYY-MM-01');

    const studentActiveStart = this.computeStudentActiveStartForMonth({
      student: payment.student,
      group: payment.group,
      forMonth,
    });

    // Parse plannedStudyUntilDate (can be ISO string or YYYY-MM-DD)
    const plannedEndDate = dayjs(dto.plannedStudyUntilDate)
      .startOf('day')
      .format('YYYY-MM-DD');
    const plannedEndExclusive = dayjs(plannedEndDate)
      .add(1, 'day')
      .format('YYYY-MM-DD');

    const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts({
      group: payment.group,
      forMonth,
      studentActiveStart,
      studentActiveEndExclusive: plannedEndExclusive,
    });

    if (lessonsPlanned === 0) {
      throw new BadRequestException('Bu oy uchun darslar rejalashtirilmagan');
    }

    const { percent: discountPercent } = await this.resolveDiscountForMonth({
      student: payment.student,
      forMonth,
    });

    const amountDue = this.computeAmountDue({
      student: payment.student,
      group: payment.group,
      lessonsPlanned,
      lessonsBillable,
      discountPercent,
    });

    // Get pending receipts amount
    const pendingRaw = await this.receiptRepo
      .createQueryBuilder('r')
      .select([
        'COALESCE(SUM(r.amount), 0) as "pendingAmount"',
        'COUNT(r.id) as "pendingReceiptsCount"',
      ])
      .where('r.paymentId = :paymentId', { paymentId: id })
      .andWhere('r.status = :status', {
        status: PaymentReceiptStatus.PENDING,
      })
      .getRawOne<{ pendingAmount: string; pendingReceiptsCount: string }>();

    const pendingAmount = Number(pendingRaw?.pendingAmount ?? 0);
    const currentAmountPaid = Number(payment.amountPaid ?? 0);
    const totalPaid = currentAmountPaid + pendingAmount;
    const remainingAmount = this.round2(Math.max(0, amountDue - totalPaid));

    return {
      paymentId: payment.id,
      studentId: payment.studentId,
      studentName: `${payment.student.firstName} ${payment.student.lastName}`,
      forMonth: dayjs(payment.forMonth).format('YYYY-MM-DD'),
      plannedStudyUntilDate: plannedEndDate,
      lessonsPlanned,
      lessonsBillable,
      discountPercent,
      amountDue,
      currentAmountDue: Number(payment.amountDue ?? 0),
      currentAmountPaid,
      pendingAmount,
      totalPaid,
      remainingAmount,
      difference: this.round2(amountDue - Number(payment.amountDue ?? 0)),
    };
  }

  async updatePayment(id: number, dto: UpdatePaymentDto) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['student', 'group'],
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    // If payment is already paid, don't allow changes
    if (payment.status === PaymentStatus.PAID && payment.amountPaid > 0) {
      throw new BadRequestException(
        'To‘lov allaqachon to‘langan, o‘zgartirib bo‘lmaydi',
      );
    }

    // Update plannedStudyUntilDate
    if (dto.plannedStudyUntilDate !== undefined) {
      payment.plannedStudyUntilDate = dto.plannedStudyUntilDate
        ? (dayjs(dto.plannedStudyUntilDate).startOf('day').toDate() as any)
        : null;
    }

    // Recalculate amountDue based on new plannedStudyUntilDate
    const forMonth = dayjs(payment.forMonth)
      .startOf('month')
      .format('YYYY-MM-01');

    const studentActiveStart = this.computeStudentActiveStartForMonth({
      student: payment.student!,
      group: payment.group!,
      forMonth,
    });

    const plannedEndExclusive = payment.plannedStudyUntilDate
      ? dayjs(payment.plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
      : undefined;

    const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts({
      group: payment.group!,
      forMonth,
      studentActiveStart,
      studentActiveEndExclusive: plannedEndExclusive,
    });

    const { percent: discountPercent } = await this.resolveDiscountForMonth({
      student: payment.student!,
      forMonth,
    });

    const amountDue = this.computeAmountDue({
      student: payment.student!,
      group: payment.group!,
      lessonsPlanned,
      lessonsBillable,
      discountPercent,
    });

    // Update payment fields
    payment.lessonsPlanned = lessonsPlanned;
    payment.lessonsBillable = lessonsBillable;
    payment.amountDue = amountDue as any;

    // Adjust amountPaid if it exceeds new amountDue
    const currentPaid = Number(payment.amountPaid ?? 0);
    if (currentPaid > amountDue) {
      payment.amountPaid = amountDue as any;
    }

    // Update status
    if (payment.amountPaid >= amountDue) {
      payment.status = PaymentStatus.PAID;
    } else if (payment.amountPaid > 0) {
      payment.status = PaymentStatus.PARTIAL;
    } else {
      payment.status = PaymentStatus.UNPAID;
    }

    const saved = await this.paymentRepo.save(payment);

    // Trigger teacher earnings recalculation
    void this.triggerTeacherEarningsRecalcForPayment(saved.id).catch(() => {});

    return this.findOne(saved.id);
  }

  async findOne(id: number) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['group', 'student'],
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    const today = dayjs().format('YYYY-MM-DD');
    const hardDue = (payment as any).hardDueDate
      ? dayjs((payment as any).hardDueDate).format('YYYY-MM-DD')
      : null;
    const isOverdue =
      !!hardDue && today > hardDue && payment.status !== PaymentStatus.PAID;

    const amountDue = Number((payment as any).amountDue ?? 0);
    const amountPaid = Number((payment as any).amountPaid ?? 0);
    const remainingAmount = this.round2(amountDue - amountPaid);

    const pendingRaw = await this.receiptRepo
      .createQueryBuilder('r')
      .select([
        'COALESCE(SUM(r.amount), 0) as "pendingAmount"',
        'COUNT(r.id) as "pendingReceiptsCount"',
      ])
      .where('r.paymentId = :paymentId', { paymentId: id })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .getRawOne<{ pendingAmount: string; pendingReceiptsCount: string }>();

    const pendingAmount = Number(pendingRaw?.pendingAmount ?? 0);
    const pendingReceiptsCount = Number(pendingRaw?.pendingReceiptsCount ?? 0);

    const forMonth = (payment as any).forMonth
      ? dayjs((payment as any).forMonth)
          .startOf('month')
          .format('YYYY-MM-01')
      : null;
    const discount =
      (payment as any).student && forMonth
        ? await this.resolveDiscountForMonth({
            student: (payment as any).student,
            forMonth,
          })
        : { percent: 0, breakdown: [] };

    return {
      ...instanceToPlain(payment),
      forMonth: (payment as any).forMonth
        ? dayjs((payment as any).forMonth).format('YYYY-MM-DD')
        : null,
      createdAt:
        (payment as any).createdAt?.toISOString?.() ??
        String((payment as any).createdAt),
      dueDate: (payment as any).dueDate
        ? dayjs((payment as any).dueDate).format('YYYY-MM-DD')
        : null,
      hardDueDate: (payment as any).hardDueDate
        ? dayjs((payment as any).hardDueDate).format('YYYY-MM-DD')
        : null,
      isOverdue,
      remainingAmount,
      refundedAmount: Number((payment as any).refundedAmount ?? 0),
      pendingAmount,
      hasPendingReceipt: pendingReceiptsCount > 0,
      pendingReceiptsCount,
      discountPercentApplied: discount.percent,
      discountBreakdown: discount.breakdown,
      lessonsPlanned: (payment as any).lessonsPlanned ?? 0,
      lessonsBillable: (payment as any).lessonsBillable ?? 0,
      plannedStudyUntilDate: (payment as any).plannedStudyUntilDate
        ? dayjs((payment as any).plannedStudyUntilDate).format('YYYY-MM-DD')
        : null,
    };
  }
}
