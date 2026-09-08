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
import { Brackets, DataSource, QueryFailedError, Repository } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';
import { Attendance } from '@/modules/attendance/entities/attendance.entity';
import { AttendanceStatus } from '@/modules/attendance/enums/attendance-status.enum';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { Inject, forwardRef } from '@nestjs/common';
import { StudentDiscountPeriod } from '@/modules/students/entities/student-discount-period.entity';
import { Referral } from '@/modules/referrals/entities/referal.entity';
import { CurrentUser } from '@/common/types/current.user';
import { UserRole } from '@/common/enums/user-role.enums';
import {
  PaymentMethod,
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
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @Inject(forwardRef(() => TeacherEarningsService))
    private readonly teacherEarningsService: TeacherEarningsService,
    private readonly dataSource: DataSource,
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
    const { addAmount } = args;
    const paymentId = args.payment.id;

    const saved = await this.dataSource.transaction(async (manager) => {
      const lockedPayment = await manager
        .getRepository(Payment)
        .createQueryBuilder('p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: paymentId })
        .getOne();

      if (!lockedPayment) throw new NotFoundException('To\'lov topilmadi');

      const prevPaid = Number(lockedPayment.amountPaid ?? 0);
      const amountDue = Number(lockedPayment.amountDue ?? 0);
      const safeAdd = Math.max(0, Number(addAmount ?? 0));
      const nextPaidRaw = this.round2(prevPaid + safeAdd);
      const nextPaid = Math.min(nextPaidRaw, amountDue);

      lockedPayment.amountPaid = nextPaid as any;
      if (lockedPayment.amountPaid >= amountDue) {
        lockedPayment.status = PaymentStatus.PAID;
      } else if (lockedPayment.amountPaid > 0) {
        lockedPayment.status = PaymentStatus.PARTIAL;
      } else {
        lockedPayment.status = PaymentStatus.UNPAID;
      }

      const result = await manager.save(lockedPayment);
      return { result, prevPaid };
    });

    if (saved.prevPaid === 0 && Number(saved.result.amountPaid ?? 0) > 0) {
      void this.applyReferralDiscountOnFirstPayment(saved.result.studentId).catch(
        (e) => {
          console.warn(
            'referral discount apply failed:',
            (e as any)?.message ?? e,
          );
        },
      );
    }

    void this.triggerTeacherEarningsRecalcForPayment(saved.result.id).catch((e) => {
      console.warn('teacher earnings recalc failed:', (e as any)?.message ?? e);
    });

    return saved.result;
  }

  async submitReceipt(
    paymentId: number,
    amount: number,
    currentUser: CurrentUser,
    comment?: string,
    paymentMethod?: PaymentMethod,
    paidAt?: string | Date | null,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
      relations: ['student'],
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      throw new BadRequestException(`To'lov miqdori noto'g'ri`);
    }

    const amountDue = Number(payment.amountDue ?? 0);
    const amountPaid = Number(payment.amountPaid ?? 0);
    const remaining = this.round2(amountDue - amountPaid);

    // Sum pending receipts to prevent over-collection
    const pendingSum = await this.receiptRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.amount), 0)', 'sum')
      .where('r.paymentId = :paymentId', { paymentId })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .getRawOne<{ sum: string }>();
    const pendingTotal = Number(pendingSum?.sum ?? 0);

    const availableToCollect = this.round2(remaining - pendingTotal);
    if (amt > availableToCollect && availableToCollect >= 0) {
      throw new BadRequestException(
        `Maksimal qabul qilish mumkin bo'lgan summa: ${availableToCollect}`,
      );
    }

    // ── Chek/invoice raqamini hosil qilish ───────────────────────────────
    // Bazaviy raqam (invoiceNo) markaz ichida ketma-ket, oyning birinchi
    // to'lovida biriktiriladi. Keyingi qismlarga harf qo'shiladi (A, B, C...).
    const centerId = payment.student?.centerId ?? null;
    const invoiceNo = await this.assignInvoiceNoIfNeeded(payment, centerId);

    // Shu oy uchun rad etilmagan receiptlar soni -> keyingi qism indeksi.
    const priorCount = await this.receiptRepo
      .createQueryBuilder('r')
      .where('r.paymentId = :paymentId', { paymentId })
      .andWhere('r.status != :rejected', {
        rejected: PaymentReceiptStatus.REJECTED,
      })
      .getCount();
    const installmentIndex = priorCount + 1;

    // Bir martalik to'liq to'lovmi? (birinchi va butun qoldiqni yopadi)
    const singleFull =
      installmentIndex === 1 &&
      this.round2(amountPaid + pendingTotal + amt) >= this.round2(amountDue);
    const checkNo = this.buildCheckNo(invoiceNo, installmentIndex, singleFull);

    // Global yagona tranzaktsiya raqami (har to'lov uchun alohida).
    const transactionNo = await this.generateTransactionNo();

    // To'lovdan oldingi/keyingi umumiy qoldiq (qarz) snapshot.
    const balanceBefore = await this.getStudentTotalDebt(payment.studentId);
    const balanceAfter = this.round2(Math.max(0, balanceBefore - amt));

    // If admin/super_admin submits, auto-confirm (boss took money)
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    const receipt = this.receiptRepo.create({
      paymentId: payment.id,
      amount: this.round2(amt) as any,
      invoiceNo: invoiceNo as any,
      installmentIndex,
      checkNo,
      transactionNo,
      balanceBefore: balanceBefore as any,
      balanceAfter: balanceAfter as any,
      paidAt: this.normalizePaidAt(paidAt),
      receivedById: currentUser.userId,
      receivedAt: new Date(),
      status: isAdmin
        ? PaymentReceiptStatus.CONFIRMED
        : PaymentReceiptStatus.PENDING,
      confirmedById: isAdmin ? currentUser.userId : null,
      confirmedAt: isAdmin ? new Date() : null,
      comment: comment ?? null,
      paymentMethod: paymentMethod ?? null,
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
    const check = await this.buildCheckFromReceipt(savedReceipt.id);

    if (isAdmin) {
      const updated = await this.applyConfirmedMoneyToPayment({
        payment,
        addAmount: amt,
        confirmedById: currentUser.userId,
      });
      return { receipt: savedReceipt, payment: updated, pending: false, check };
    }

    return { receipt: savedReceipt, pending: true, check };
  }

  async submitFullReceipt(
    paymentId: number,
    currentUser: CurrentUser,
    comment?: string,
    paymentMethod?: PaymentMethod,
    paidAt?: string | Date | null,
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);
    const remaining = this.round2(
      Number(payment.amountDue ?? 0) - Number(payment.amountPaid ?? 0),
    );
    if (remaining <= 0) {
      throw new BadRequestException('Payment is already fully paid');
    }
    return this.submitReceipt(
      paymentId,
      remaining,
      currentUser,
      comment,
      paymentMethod,
      paidAt,
    );
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
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);

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
    const check = await this.buildCheckFromReceipt(savedReceipt.id);

    return { receipt: savedReceipt, payment: updatedPayment, check };
  }

  async rejectReceipt(receiptId: number, currentUser: CurrentUser, reason?: string) {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;
    if (!isAdmin) {
      throw new BadRequestException('Only admin can reject receipts');
    }

    const receipt = await this.receiptRepo.findOne({
      where: { id: receiptId },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    if (receipt.status === PaymentReceiptStatus.CONFIRMED) {
      throw new BadRequestException('Tasdiqlangan receiptni rad etib bo\'lmaydi');
    }
    if (receipt.status === PaymentReceiptStatus.REJECTED) {
      return { receipt, alreadyRejected: true };
    }

    receipt.status = PaymentReceiptStatus.REJECTED;
    (receipt as any).rejectedReason = reason ?? null;
    const savedReceipt = await this.receiptRepo.save(receipt);

    return { receipt: savedReceipt };
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

  /**
   * Sum of PENDING receipts grouped by paymentId for the given payment ids.
   * Returns a Map<paymentId, pendingAmount>.
   */
  private async getPendingSumByPayment(
    paymentIds: number[],
  ): Promise<Map<number, number>> {
    if (paymentIds.length === 0) return new Map();
    const rows = await this.receiptRepo
      .createQueryBuilder('r')
      .select('r.paymentId', 'paymentId')
      .addSelect('COALESCE(SUM(r.amount), 0)', 'sum')
      .where('r.paymentId IN (:...ids)', { ids: paymentIds })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .groupBy('r.paymentId')
      .getRawMany<{ paymentId: number; sum: string }>();
    return new Map(rows.map((r) => [Number(r.paymentId), Number(r.sum ?? 0)]));
  }

  /**
   * Payment summary for a single student: per-month breakdown + aggregate totals.
   * Used by the student view page (info + monthly payments + total debt).
   */
  async getStudentPaymentSummary(studentId: number, _currentUser: CurrentUser) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
      relations: ['groups', 'groups.schedules', 'subject', 'center'],
    });
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    // Make sure monthly payment rows exist (no-op for non-active students).
    await this.ensurePaymentsForStudent(studentId).catch(() => undefined);

    const payments = await this.paymentRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.group', 'group')
      .where('p.studentId = :studentId', { studentId })
      .orderBy('p.forMonth', 'DESC')
      .getMany();

    const pendingMap = await this.getPendingSumByPayment(
      payments.map((p) => p.id),
    );

    const studentFee = Number(student.monthlyFee ?? 0);

    const months = await Promise.all(
      payments.map(async (p) => {
        const amountDue = Number(p.amountDue ?? 0);
        const amountPaid = Number(p.amountPaid ?? 0);
        const pendingAmount = this.round2(pendingMap.get(p.id) ?? 0);
        const remaining = this.round2(Math.max(0, amountDue - amountPaid));

        // Proratsiyani tushuntirish uchun dars sanoqlari (Payment'da saqlangan).
        const lessonsPlanned = p.lessonsPlanned ?? null;
        const lessonsBillable = p.lessonsBillable ?? null;
        // EXCUSED endi to'lovni kamaytirmaydi (Req1) — faqat ma'lumot uchun.
        const lessonsExcused = Number(p.lessonsExcused ?? 0);
        // To'lovga kiradigan darslar = lessonsBillable (mid-month proratsiya).
        const effectiveBillable = lessonsBillable;

        // fullAmount = proratsiyasiz to'liq oylik (chegirma bilan, manual
        // exclusionsiz). amountDue = fullAmount * (billable/planned) - manualExcluded.
        const groupFee = Number((p as any).group?.monthlyFee ?? 0);
        const baseMonthlyFee = studentFee > 0 ? studentFee : groupFee;
        let fullAmount: number | null = null;
        if (baseMonthlyFee > 0) {
          try {
            const { percent } = await this.resolveDiscountForMonth({
              student,
              forMonth: dayjs(p.forMonth).format('YYYY-MM-01'),
            });
            fullAmount = this.round2(
              baseMonthlyFee * (1 - Number(percent ?? 0) / 100),
            );
          } catch {
            fullAmount = this.round2(baseMonthlyFee);
          }
        }

        // Bitta dars narxi (chiqarib tashlashda kun -> summa hisoblash uchun).
        const perLessonAmount =
          fullAmount != null && lessonsPlanned && lessonsPlanned > 0
            ? this.round2(fullAmount / lessonsPlanned)
            : 0;

        // Proratsiya bo'lganmi: to'lovga kiradigan darslar to'liq oydan kam.
        const isProrated =
          lessonsPlanned != null &&
          effectiveBillable != null &&
          effectiveBillable < lessonsPlanned;

        return {
          paymentId: p.id,
          forMonth: dayjs(p.forMonth).format('YYYY-MM'),
          groupId: p.groupId,
          groupName: p.group?.name ?? null,
          amountDue,
          amountPaid,
          pendingAmount, // tasdiqlash kutayotgan receiptlar summasi
          remaining, // shu oy uchun qolgan qarz
          status: p.status,
          // ↓ proratsiyani tushuntirish uchun
          lessonsPlanned, // guruhda shu oyda jami rejalashtirilgan darslar
          lessonsBillable, // o'quvchiga hisoblangan darslar
          lessonsExcused, // sababli darslar (INFO — to'lovga ta'sir qilmaydi)
          effectiveBillable, // to'lovga kiradigan darslar (== lessonsBillable)
          fullAmount, // proratsiyasiz to'liq oylik (chegirma bilan)
          perLessonAmount, // bitta dars narxi
          isProrated, // proratsiya qilinganmi
          // ↓ qo'lda chiqarib tashlangan (manual exclusion)
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
          manualExcludedLessons: p.manualExcludedLessons ?? null,
          manualExcludedReason: p.manualExcludedReason ?? null,
        };
      }),
    );

    const sum = (pick: (m: (typeof months)[number]) => number) =>
      this.round2(months.reduce((s, m) => s + pick(m), 0));

    const totalDue = sum((m) => m.amountDue);
    const totalPaid = sum((m) => m.amountPaid);
    const totalDebt = sum((m) => m.remaining);
    const totalPending = sum((m) => m.pendingAmount);
    // Hozir yig'ish mumkin bo'lgan summa (qarzdan tasdiqlash kutayotgani ayirilgan).
    const payableNow = this.round2(Math.max(0, totalDebt - totalPending));

    // Distinct schedule days across all of the student's groups (week order).
    const WEEK_ORDER = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    const groups = (student.groups ?? []).map((g: any) => {
      const days = Array.from(
        new Set((g.schedules ?? []).map((s: any) => s.day)),
      ).sort((a: any, b: any) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
      const times = (g.schedules ?? [])
        .slice()
        .sort(
          (a: any, b: any) =>
            WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day),
        )
        .map((s: any) => ({ day: s.day, startTime: s.startTime }));
      return {
        id: g.id,
        name: g.name,
        monthlyFee: Number(g.monthlyFee ?? 0),
        days, // guruh dars kunlari
        schedule: times, // kun + boshlanish vaqti
      };
    });

    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        phone: student.phone,
        secondPhone: student.secondPhone ?? null,
        birthDate: student.birthDate ?? null,
        comment: student.comment ?? null,
        heardAboutUs: student.heardAboutUs ?? null,
        preferredTime: student.preferredTime ?? null,
        preferredDays: student.preferredDays ?? null,
        studyDays: student.studyDays ?? null, // guruhdan yozilgan dars kunlari
        passportSeries: student.passportSeries ?? null,
        passportNumber: student.passportNumber ?? null,
        jshshir: student.jshshir ?? null,
        status: student.status,
        returnLikelihood: student.returnLikelihood ?? null,
        monthlyFee: Number(student.monthlyFee ?? 0),
        discountPercent: Number(student.discountPercent ?? 0),
        discountReason: student.discountReason ?? null,
        activatedAt: student.activatedAt ?? null,
        stoppedAt: student.stoppedAt ?? null,
        createdAt: student.createdAt,
        centerId: student.centerId,
        centerName: (student as any).center?.name ?? null,
        subject: student.subject
          ? { id: student.subject.id, name: (student.subject as any).name }
          : null,
        groups,
      },
      totals: {
        totalDue,
        totalPaid,
        totalDebt,
        totalPending,
        payableNow,
      },
      months,
    };
  }

  /**
   * Pay a student's total debt with a single amount, distributing it across
   * open (unpaid/partial) months oldest-first.
   *
   * Example: 400000/oy dan 2 oy (jami 800000) qarzi bor o'quvchi 600000 to'lasa:
   *  - 1-oy to'liq yopiladi (400000)
   *  - 2-oyga 200000 tushadi (partial), 200000 qarz qoladi.
   *
   * amount berilmasa — jami qarz to'liq to'lanadi (default).
   * Har oy uchun mavjud submitReceipt oqimi ishlatiladi: admin/super_admin
   * bo'lsa avtomatik tasdiqlanadi, reception/manager bo'lsa PENDING receipt
   * yaratiladi (admin keyin tasdiqlaydi).
   */
  async payStudentDebt(
    studentId: number,
    amountInput: number | undefined,
    currentUser: CurrentUser,
    comment?: string,
    paymentMethod?: PaymentMethod,
    paidAt?: string | Date | null,
  ) {
    const student = await this.studentRepo.findOne({
      where: { id: studentId },
    });
    if (!student) throw new NotFoundException(`O'quvchi topilmadi`);

    await this.ensurePaymentsForStudent(studentId).catch(() => undefined);

    const openPayments = await this.paymentRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.group', 'group')
      .where('p.studentId = :studentId', { studentId })
      .andWhere('p.status IN (:...statuses)', {
        statuses: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL],
      })
      .orderBy('p.forMonth', 'ASC') // eng eski oydan boshlab
      .getMany();

    if (openPayments.length === 0) {
      throw new BadRequestException(`O'quvchida qarzdorlik yo'q`);
    }

    const pendingMap = await this.getPendingSumByPayment(
      openPayments.map((p) => p.id),
    );

    // Har oy uchun hozir yig'ish mumkin bo'lgan summa = qoldiq - pending.
    const perMonth = openPayments
      .map((p) => {
        const remaining = this.round2(
          Number(p.amountDue ?? 0) - Number(p.amountPaid ?? 0),
        );
        const pending = pendingMap.get(p.id) ?? 0;
        const available = this.round2(Math.max(0, remaining - pending));
        return { payment: p, available };
      })
      .filter((x) => x.available > 0);

    const totalAvailable = this.round2(
      perMonth.reduce((s, x) => s + x.available, 0),
    );
    if (totalAvailable <= 0) {
      throw new BadRequestException(
        `Yig'ish mumkin bo'lgan qarz yo'q (barcha summalar tasdiqlash kutmoqda)`,
      );
    }

    let amount =
      amountInput != null && amountInput !== undefined
        ? this.round2(Number(amountInput))
        : totalAvailable;

    if (!amount || amount <= 0) {
      throw new BadRequestException(`To'lov miqdori noto'g'ri`);
    }
    if (amount > totalAvailable) {
      throw new BadRequestException(
        `Maksimal to'lash mumkin bo'lgan summa: ${totalAvailable}`,
      );
    }

    let left = amount;
    const allocations: Array<{
      paymentId: number;
      forMonth: string;
      groupId: number | null;
      allocated: number;
      pending: boolean;
      checkNo: string | null;
      transactionNo: string | null;
    }> = [];
    // Har bir oy uchun alohida chek (invoice) hosil bo'ladi.
    const checks: any[] = [];

    for (const item of perMonth) {
      if (left <= 0) break;
      const alloc = this.round2(Math.min(left, item.available));
      if (alloc <= 0) continue;
      const res: any = await this.submitReceipt(
        item.payment.id,
        alloc,
        currentUser,
        comment,
        paymentMethod,
        paidAt,
      );
      allocations.push({
        paymentId: item.payment.id,
        forMonth: dayjs(item.payment.forMonth).format('YYYY-MM'),
        groupId: item.payment.groupId,
        allocated: alloc,
        pending: res?.pending ?? false,
        checkNo: res?.check?.checkNo ?? null,
        transactionNo: res?.check?.transactionNo ?? null,
      });
      if (res?.check) checks.push(res.check);
      left = this.round2(left - alloc);
    }

    const summary = await this.getStudentPaymentSummary(studentId, currentUser);

    return {
      studentId,
      requestedAmount: amount,
      distributedAmount: this.round2(amount - left),
      unallocated: this.round2(left),
      allocations,
      checks,
      summary,
    };
  }

  /**
   * Bir oy (payment) uchun "chiqarib tashlash" (exclusion) natijasini oldindan
   * hisoblaydi — SAQLAMAYDI. excludeLessons (kun) yoki excludeAmount (summa)
   * beriladi; kun berilsa perLessonAmount orqali summaga aylantiriladi.
   */
  async previewExclusion(
    paymentId: number,
    args: { excludeLessons?: number; excludeAmount?: number },
  ) {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
      relations: ['student', 'group', 'group.schedules'],
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);
    if (!payment.student || !payment.group) {
      throw new BadRequestException(
        "To'lov student yoki group ma'lumotlari topilmadi",
      );
    }

    const forMonth = dayjs(payment.forMonth)
      .startOf('month')
      .format('YYYY-MM-01');

    // Bazaviy summa (manual exclusionsiz to'liq hisob).
    const base = await this.computeMonthBilling({
      student: payment.student,
      group: payment.group,
      forMonth,
      manualExcludedAmount: 0,
    });

    const amountPaid = Number(payment.amountPaid ?? 0);
    // Bitta billable dars narxi.
    const perLessonAmount =
      base.lessonsBillable > 0
        ? this.round2(base.amountDue / base.lessonsBillable)
        : 0;

    let excludedLessons: number | null = null;
    let excludedTotal = 0;
    if (args.excludeAmount != null) {
      excludedTotal = this.round2(Math.max(0, Number(args.excludeAmount)));
    } else if (args.excludeLessons != null) {
      excludedLessons = Math.max(0, Math.floor(Number(args.excludeLessons)));
      excludedTotal = this.round2(excludedLessons * perLessonAmount);
    }
    // Bazaviy summadan oshib ketmasin.
    excludedTotal = this.round2(Math.min(excludedTotal, base.amountDue));

    const newAmountDue = this.round2(Math.max(0, base.amountDue - excludedTotal));
    const newRemaining = this.round2(Math.max(0, newAmountDue - amountPaid));

    return {
      paymentId: payment.id,
      forMonth: dayjs(payment.forMonth).format('YYYY-MM'),
      lessonsPlanned: base.lessonsPlanned,
      lessonsBillable: base.lessonsBillable,
      perLessonAmount,
      baseAmountDue: base.amountDue, // manual exclusionsiz to'liq summa
      currentAmountDue: Number(payment.amountDue ?? 0), // hozirgi (avvalgi exclusion bilan)
      amountPaid,
      excludeLessons: excludedLessons,
      excludedAmount: excludedTotal,
      newAmountDue,
      newRemaining,
    };
  }

  /**
   * Chiqarib tashlashni SAQLAYDI: payment.amountDue kamayadi, sabab (comment)
   * yoziladi. excludeLessons yoki excludeAmount + comment (majburiy) kerak.
   * Recalc paytida ham saqlanadi (manualExcludedAmount computeAmountDue'da ayiriladi).
   */
  async applyExclusion(
    paymentId: number,
    args: { excludeLessons?: number; excludeAmount?: number; comment?: string },
    _currentUser: CurrentUser,
  ) {
    const hasExclusion =
      args.excludeAmount != null || args.excludeLessons != null;
    if (!hasExclusion) {
      throw new BadRequestException(
        'excludeLessons (kun) yoki excludeAmount (summa) yuborilishi kerak',
      );
    }
    if (!args.comment || !String(args.comment).trim()) {
      throw new BadRequestException(
        "Chiqarib tashlashda izoh (comment) majburiy",
      );
    }

    const preview = await this.previewExclusion(paymentId, {
      excludeLessons: args.excludeLessons,
      excludeAmount: args.excludeAmount,
    });

    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);

    payment.manualExcludedAmount = preview.excludedAmount as any;
    payment.manualExcludedLessons = preview.excludeLessons ?? null;
    payment.manualExcludedReason = String(args.comment).trim();
    payment.amountDue = preview.newAmountDue as any;

    // Agar allaqachon yangi summadan ko'p to'langan bo'lsa — farqni qaytaramiz.
    const amountDue = preview.newAmountDue;
    let amountPaid = Number(payment.amountPaid ?? 0);
    if (amountPaid > amountDue) {
      const refund = this.round2(amountPaid - amountDue);
      payment.refundedAmount = this.round2(
        Number(payment.refundedAmount ?? 0) + refund,
      ) as any;
      payment.refundedAt = new Date();
      amountPaid = amountDue;
      payment.amountPaid = amountDue as any;
    }

    if (amountPaid >= amountDue) payment.status = PaymentStatus.PAID;
    else if (amountPaid > 0) payment.status = PaymentStatus.PARTIAL;
    else payment.status = PaymentStatus.UNPAID;

    await this.paymentRepo.save(payment);

    return {
      ...preview,
      amountDue: preview.newAmountDue,
      manualExcludedAmount: preview.excludedAmount,
      manualExcludedLessons: preview.excludeLessons,
      manualExcludedReason: payment.manualExcludedReason,
      status: payment.status,
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

  /** "date input" (YYYY-MM-DD yoki ISO) -> Date | null. */
  private normalizePaidAt(input?: string | Date | null): Date | null {
    if (!input) return null;
    const d = dayjs(input);
    if (!d.isValid()) return null;
    return d.startOf('day').toDate();
  }

  /**
   * O'quvchining barcha oylar bo'yicha umumiy qoldig'i (qarzi):
   *   SUM(amountDue - amountPaid) (manfiy bo'lmaydi).
   */
  private async getStudentTotalDebt(studentId: number): Promise<number> {
    const raw = await this.paymentRepo
      .createQueryBuilder('p')
      .select(
        'COALESCE(SUM(GREATEST(p.amountDue - p.amountPaid, 0)), 0)',
        'debt',
      )
      .where('p.studentId = :studentId', { studentId })
      .getRawOne<{ debt: string }>();
    return this.round2(Number(raw?.debt ?? 0));
  }

  /**
   * Payment'ga bazaviy chek raqami (invoiceNo) biriktiradi (agar hali yo'q bo'lsa).
   * Raqam markaz (center) ichida ketma-ket beriladi. Bir vaqtning o'zida ikki
   * to'lov bir xil raqam olmasligi uchun center bo'yicha advisory lock ishlatamiz.
   */
  private async assignInvoiceNoIfNeeded(
    payment: Payment,
    centerId: number | null,
  ): Promise<number> {
    if (payment.invoiceNo != null) return Number(payment.invoiceNo);

    const next = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Payment);
      const locked = await repo
        .createQueryBuilder('p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: payment.id })
        .getOne();
      if (!locked) throw new NotFoundException(`To'lov topilmadi`);
      if (locked.invoiceNo != null) return Number(locked.invoiceNo);

      // Center bo'yicha raqam ketma-ketligini serializatsiya qilish.
      // centerId null bo'lsa 0 kalitidan foydalanamiz (global ketma-ketlik).
      await manager.query('SELECT pg_advisory_xact_lock($1)', [centerId ?? 0]);

      const row = await manager.query(
        `SELECT COALESCE(MAX(p."invoiceNo"), 0) AS max
           FROM payments p
           JOIN students s ON s.id = p."studentId"
          WHERE ($1::int IS NULL AND s."centerId" IS NULL)
             OR s."centerId" = $1`,
        [centerId],
      );
      const nextNo = Number(row?.[0]?.max ?? 0) + 1;
      locked.invoiceNo = nextNo;
      await repo.save(locked);
      return nextNo;
    });

    payment.invoiceNo = next;
    return next;
  }

  /** 1 -> A, 2 -> B, ... 26 -> Z, 27 -> AA (Excel uslubi). */
  private columnLetter(n: number): string {
    let s = '';
    let x = Math.max(1, Math.floor(n));
    while (x > 0) {
      const m = (x - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      x = Math.floor((x - 1) / 26);
    }
    return s;
  }

  /**
   * Chek raqamini quradi:
   *  - bir martalik to'liq to'lov -> "1"
   *  - qisman to'lovlar -> "1-A", "1-A-B", "1-A-B-C" ...
   */
  private buildCheckNo(
    invoiceNo: number,
    installmentIndex: number,
    singleFull: boolean,
  ): string {
    if (installmentIndex <= 1 && singleFull) return String(invoiceNo);
    const letters: string[] = [];
    for (let i = 1; i <= installmentIndex; i++) letters.push(this.columnLetter(i));
    return `${invoiceNo}-${letters.join('-')}`;
  }

  /**
   * Global yagona tranzaktsiya raqamini hosil qiladi:
   *   TRX-YYYYMMDD-NNNNNN
   * Ketma-ket raqam butun tizim bo'yicha yagona Postgres sequence'dan olinadi
   * (nextval — atomar, parallel to'lovlarda ham takrorlanmaydi). Sana qismi —
   * to'lov qabul qilingan kun. Chek qaytib kelganda shu raqam bo'yicha
   * aynan qaysi to'lov ekani aniqlanadi.
   */
  private async generateTransactionNo(when: Date = new Date()): Promise<string> {
    const rows = await this.dataSource.query(
      `SELECT nextval('payment_receipt_transaction_seq') AS seq`,
    );
    const seq = Number(rows?.[0]?.seq ?? 0);
    const datePart = dayjs(when).format('YYYYMMDD');
    const numPart = String(seq).padStart(6, '0');
    return `TRX-${datePart}-${numPart}`;
  }

  private static readonly CHECK_RELATIONS = [
    'payment',
    'payment.student',
    'payment.group',
    'payment.group.teacher',
    'receivedBy',
  ];

  /**
   * Frontendda chek (invoice) chiqarish uchun barcha kerakli maydonlarni
   * yig'ib beradi: chek raqami, ism-familiya, telefon, guruh, o'qituvchi,
   * to'lovdan oldingi/keyingi qoldiq, to'lov usuli, summa, sana-vaqt.
   *
   * MUHIM: balanceBefore/balanceAfter va checkNo — to'lov PAYTIDAGI snapshot
   * qiymatlar (receipt jadvalida saqlangan), bu yerda qayta hisoblanmaydi.
   * Shu sabab chek istalgan vaqtda qayta chop etilganda ham o'zgarmaydi.
   */
  async buildCheckFromReceipt(receiptId: number) {
    const receipt = await this.receiptRepo.findOne({
      where: { id: receiptId },
      relations: PaymentsService.CHECK_RELATIONS,
    });
    if (!receipt) throw new NotFoundException('Receipt topilmadi');
    return this.mapReceiptToCheck(receipt);
  }

  /**
   * Bitta payment (o'quvchining bitta oyi) uchun qilingan BARCHA to'lovlarni
   * (receipt'larni) chek ko'rinishida qaytaradi. Tartib: receivedAt bo'yicha ASC
   * (eng eski to'lovdan boshlab) — chek raqamlari 1, 1-A, 1-A-B ketma-ketligiga
   * mos tushadi. Rad etilgan (rejected) receipt'lar ham status'i bilan qaytadi.
   */
  async getReceiptsForPayment(paymentId: number) {
    const paymentExists = await this.paymentRepo
      .createQueryBuilder('p')
      .where('p.id = :id', { id: paymentId })
      .getExists();
    if (!paymentExists) throw new NotFoundException(`To'lov topilmadi`);

    const receipts = await this.receiptRepo.find({
      where: { paymentId },
      relations: PaymentsService.CHECK_RELATIONS,
      order: { receivedAt: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });

    return { data: receipts.map((r) => this.mapReceiptToCheck(r)) };
  }

  /** Yuklangan (relations bilan) receipt'ni chek obyektiga aylantiradi (N+1 siz). */
  private mapReceiptToCheck(receipt: PaymentReceipt) {
    const payment = (receipt as any).payment;
    const student = payment?.student ?? null;
    const group = payment?.group ?? null;
    const teacher = group?.teacher ?? null;
    const receivedBy = (receipt as any).receivedBy ?? null;

    const fullName = (u: any) =>
      u
        ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null
        : null;

    return {
      receiptId: receipt.id,
      checkNo: receipt.checkNo ?? null,
      transactionNo: receipt.transactionNo ?? null,
      invoiceNo: receipt.invoiceNo ?? null,
      installmentIndex: receipt.installmentIndex ?? null,
      status: receipt.status,
      // O'quvchi
      student: student
        ? {
            id: student.id,
            firstName: student.firstName,
            lastName: student.lastName,
            fullName:
              [student.firstName, student.lastName]
                .filter(Boolean)
                .join(' ')
                .trim() || null,
            phone: student.phone ?? null,
          }
        : null,
      // Guruh + o'qituvchi
      group: group ? { id: group.id, name: group.name ?? null } : null,
      teacher: teacher
        ? { id: teacher.id, fullName: fullName(teacher) }
        : null,
      // Oy
      forMonth: payment?.forMonth
        ? dayjs(payment.forMonth).format('YYYY-MM')
        : null,
      // Summa va qoldiqlar
      amount: Number(receipt.amount ?? 0),
      balanceBefore:
        receipt.balanceBefore != null ? Number(receipt.balanceBefore) : null,
      balanceAfter:
        receipt.balanceAfter != null ? Number(receipt.balanceAfter) : null,
      // To'lov usuli va sana
      paymentMethod: receipt.paymentMethod ?? null,
      paidAt: receipt.paidAt ? dayjs(receipt.paidAt).format('YYYY-MM-DD') : null,
      receivedAt: receipt.receivedAt
        ? dayjs(receipt.receivedAt).toISOString()
        : null,
      createdAt: receipt.createdAt
        ? dayjs(receipt.createdAt).toISOString()
        : null,
      receivedBy: receivedBy
        ? { id: receivedBy.id, fullName: fullName(receivedBy) }
        : null,
      comment: receipt.comment ?? null,
    };
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
  }): {
    lessonsPlanned: number;
    lessonsBillable: number;
    billableDates: string[];
  } {
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
    if (!lessonsPlanned)
      return { lessonsPlanned: 0, lessonsBillable: 0, billableDates: [] };

    // Billable lessons: subset of the full month schedule starting from studentActiveStart
    // and optionally ending before studentActiveEndExclusive (used for STOPPED refunds).
    const billableDates = plannedDates.filter((d) => {
      if (d < studentActiveStart) return false;
      if (studentActiveEndExclusive && d >= studentActiveEndExclusive)
        return false;
      return true;
    });

    return {
      lessonsPlanned,
      lessonsBillable: billableDates.length,
      billableDates,
    };
  }

  /**
   * Count EXCUSED (sababli) attendance rows for a student in a group that fall
   * on the given billable lesson dates. These are deducted from billing.
   * Absent (kelmadi), present and late lessons are NOT counted here.
   */
  private async countExcusedOnDates(
    groupId: number,
    studentId: number,
    dates: string[],
  ): Promise<number> {
    if (!dates.length) return 0;
    return this.attendanceRepo
      .createQueryBuilder('a')
      .where('a.groupId = :groupId', { groupId })
      .andWhere('a.studentId = :studentId', { studentId })
      .andWhere('a.status = :status', { status: AttendanceStatus.EXCUSED })
      .andWhere('a.lessonDate IN (:...dates)', { dates })
      .getCount();
  }

  /**
   * Single source of truth for one payment's monthly billing.
   * Combines schedule-based lesson counts, EXCUSED deductions and discounts.
   */
  private async computeMonthBilling(args: {
    student: Student;
    group: Group;
    forMonth: string; // YYYY-MM-01
    studentActiveEndExclusive?: string;
    manualExcludedAmount?: number;
  }): Promise<{
    studentActiveStart: string;
    lessonsPlanned: number;
    lessonsBillable: number; // schedule-based (mid-month proration only)
    lessonsExcused: number; // INFO only — no longer reduces amountDue (Req1)
    effectiveBillable: number; // billing lessons (== lessonsBillable)
    discountPercent: number;
    amountDue: number;
  }> {
    const {
      student,
      group,
      forMonth,
      studentActiveEndExclusive,
      manualExcludedAmount = 0,
    } = args;

    // O'quvchi shu GURUHGA qachon qo'shilgani (join sanasi). Oy o'rtasida yangi
    // guruhga qo'shilgan bo'lsa, proratsiya shu sanadan boshlanadi.
    const joinedAt = await this.getEnrollmentJoinedAt(student.id, group.id);

    const studentActiveStart = this.computeStudentActiveStartForMonth({
      student,
      group,
      forMonth,
      joinedAt,
    });

    const { lessonsPlanned, lessonsBillable, billableDates } =
      this.computeMonthLessonCounts({
        group,
        forMonth,
        studentActiveStart,
        studentActiveEndExclusive,
      });

    // EXCUSED (sababli) darslar endi to'lovni kamaytirmaydi (Req1) — faqat
    // ma'lumot uchun sanaymiz. Kamaytirish faqat qo'lda (manualExcludedAmount)
    // orqali reception tomonidan qilinadi.
    const lessonsExcused = lessonsPlanned
      ? await this.countExcusedOnDates(group.id, student.id, billableDates)
      : 0;
    const effectiveBillable = lessonsBillable;

    const { percent: discountPercent } = await this.resolveDiscountForMonth({
      student,
      forMonth,
    });

    const amountDue = this.computeAmountDue({
      student,
      group,
      lessonsPlanned,
      lessonsBillable, // excused ayirilmaydi
      discountPercent,
      manualExcludedAmount,
    });

    return {
      studentActiveStart,
      lessonsPlanned,
      lessonsBillable,
      lessonsExcused,
      effectiveBillable,
      discountPercent,
      amountDue,
    };
  }

  private computeStudentActiveStartForMonth(args: {
    student: Student;
    group: Group;
    forMonth: string; // YYYY-MM-01
    joinedAt?: Date | string | null; // o'quvchi shu guruhga qo'shilgan sana
  }): string {
    const { student, group, forMonth, joinedAt } = args;
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

    // Guruhga qo'shilgan sana — yana bir quyi chegara. O'quvchi guruhga
    // qo'shilishidan oldingi darslar uchun to'lov qilmaydi. Sana kuni (start of
    // day) hisobga olinadi: o'sha kungi dars ham to'lovga kiradi.
    if (joinedAt) {
      const j = dayjs(joinedAt).tz(timezone).startOf('day');
      if (j.isValid() && j.isAfter(max)) max = j;
    }

    return max.format('YYYY-MM-DD');
  }

  // (student, group) -> guruhga qo'shilgan sana keshi. Har bir billing
  // operatsiyasi boshida tozalanadi (discountCache bilan birga).
  private joinedAtCache = new Map<string, Date | null>();

  /**
   * O'quvchining berilgan guruhga qo'shilgan sanasini (students_groups_groups.
   * joinedAt) qaytaradi. Yozuv topilmasa null. Natija kesh qilinadi (PK bo'yicha
   * tez qidiruv, N+1 dan qochish uchun).
   */
  private async getEnrollmentJoinedAt(
    studentId: number,
    groupId: number,
  ): Promise<Date | null> {
    const key = `${studentId}:${groupId}`;
    const cached = this.joinedAtCache.get(key);
    if (cached !== undefined) return cached;

    let val: Date | null = null;
    try {
      const rows = await this.dataSource.query(
        `SELECT "joinedAt" FROM "students_groups_groups"
          WHERE "studentsId" = $1 AND "groupsId" = $2 LIMIT 1`,
        [studentId, groupId],
      );
      const raw = rows?.[0]?.joinedAt ?? null;
      val = raw ? new Date(raw) : null;
    } catch {
      // joinedAt ustuni hali yo'q bo'lsa (migratsiya ishlamagan) — eski
      // xatti-harakat (proratsiya activatedAt/groupStart bo'yicha).
      val = null;
    }

    this.joinedAtCache.set(key, val);
    return val;
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
    this.joinedAtCache.clear();
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
      .andWhere('payments.forMonth >= :forMonth', { forMonth: currentMonth })
      .getMany();

    if (!payments.length) return;

    const toSave: Payment[] = [];
    for (const p of payments as any[]) {
      if (!p.group || !p.student) continue;
      if (!p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      const studentActiveEndExclusive =
        this.computeStudentActiveEndExclusiveForMonth({
          student: p.student,
          group: p.group,
          forMonth,
        });

      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive: studentActiveEndExclusive ?? undefined,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
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
      p.lessonsExcused = lessonsExcused;
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

  /**
   * O'quvchi GURUHDAN chiqarilganda (student edit'da guruh olib tashlanganda)
   * o'sha guruhning joriy va kelajak oy to'lovlarini to'g'rilaydi:
   *  - chiqarilgan kungacha (bugun, exclusive) o'tgan darslar bo'yicha prorate;
   *  - agar birorta ham dars o'tmagan bo'lsa (masalan o'sha kuni qo'shib-olib
   *    tashlansa) va pul to'lanmagan bo'lsa — to'lov butunlay o'chiriladi;
   *  - kelajak oylar (bugundan keyin) — billable=0 bo'ladi -> o'chadi;
   *  - agar allaqachon ortiqcha pul to'langan bo'lsa — farq refund qilinadi.
   *
   * MUHIM: bu metod many-to-many biriktirish (students_groups_groups) yozuvi
   * DB'dan o'chirilishidan OLDIN chaqirilishi kerak, aks holda guruhga qo'shilgan
   * sana (joinedAt) yo'qoladi va proratsiya noto'g'ri (qo'shilishdan oldingi
   * darslar ham) hisoblanadi.
   */
  async adjustPaymentsForStudentLeftGroup(studentId: number, groupId: number) {
    this.discountCache.clear();
    this.joinedAtCache.clear();

    const currentMonth = dayjs().startOf('month').format('YYYY-MM-01');

    const payments = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where('payments.studentId = :studentId', { studentId })
      .andWhere('payments.groupId = :groupId', { groupId })
      .andWhere('payments.forMonth >= :forMonth', { forMonth: currentMonth })
      .getMany();

    if (!payments.length) return;

    const toSave: Payment[] = [];
    const toDeleteIds: number[] = [];

    for (const p of payments as any[]) {
      if (!p.group || !p.student || !p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      // Chiqish chegarasi = BUGUN (exclusive): bugundan boshlab darslar to'lovga
      // kirmaydi. Joriy oy uchun bu bugungacha o'tgan darslarni beradi; kelajak
      // oylar uchun (oy boshi > bugun) hech qanday dars qolmaydi -> billable=0.
      const leftExclusive = dayjs().tz(timezone).startOf('day').format('YYYY-MM-DD');

      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive: leftExclusive,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
        });

      const amountPaid = Number(p.amountPaid ?? 0);

      // Hech qanday to'lovga kiradigan dars qolmadi.
      if (!lessonsBillable) {
        if (amountPaid === 0) {
          // Pul to'lanmagan -> to'lovni butunlay o'chiramiz.
          toDeleteIds.push(p.id);
        } else {
          // Pul to'langan -> hammasini refund qilamiz, amountDue = 0.
          p.refundedAmount = this.round2(
            Number(p.refundedAmount ?? 0) + amountPaid,
          ) as any;
          p.refundedAt = new Date() as any;
          p.amountDue = 0 as any;
          p.amountPaid = 0 as any;
          p.lessonsBillable = 0;
          p.lessonsExcused = lessonsExcused;
          p.status = PaymentStatus.PAID; // 0 dan 0 -> to'liq yopilgan
          toSave.push(p);
        }
        continue;
      }

      // Aks holda: o'tgan darslar bo'yicha qayta prorate + kerak bo'lsa refund.
      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);
      let newPaid = amountPaid;
      let newRefunded = Number(p.refundedAmount ?? 0);
      let refundedAt: Date | null = p.refundedAt ?? null;
      if (newPaid > amountDue) {
        const refund = this.round2(newPaid - amountDue);
        newRefunded = this.round2(newRefunded + refund);
        newPaid = amountDue;
        refundedAt = new Date();
      }

      let newStatus = p.status;
      if (newPaid >= amountDue) newStatus = PaymentStatus.PAID;
      else if (newPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.lessonsExcused = lessonsExcused;
      p.amountDue = amountDue as any;
      p.amountPaid = newPaid as any;
      p.refundedAmount = newRefunded as any;
      p.refundedAt = refundedAt as any;
      p.status = newStatus;
      p.dueDate = dueDate as any;
      p.hardDueDate = hardDueDate as any;
      toSave.push(p);
    }

    if (toSave.length) await this.paymentRepo.save(toSave as any);
    if (toDeleteIds.length) await this.paymentRepo.delete(toDeleteIds);

    for (const p of toSave) {
      void this.triggerTeacherEarningsRecalcForPayment(p.id).catch(() => {});
    }
  }

  private computeAmountDue(args: {
    student: Student;
    group: Group;
    lessonsPlanned: number;
    lessonsBillable: number;
    discountPercent: number;
    manualExcludedAmount?: number;
  }): number {
    const {
      student,
      group,
      lessonsPlanned,
      lessonsBillable,
      discountPercent,
      manualExcludedAmount = 0,
    } = args;
    // Fee priority:
    // - if student.monthlyFee is set (> 0) -> use it
    // - otherwise fallback to group.monthlyFee
    const studentFee = Number(student.monthlyFee ?? 0);
    const groupFee = Number(group.monthlyFee ?? 0);
    const baseMonthlyFee = studentFee > 0 ? studentFee : groupFee;
    if (!lessonsPlanned) return 0;

    // Apply discount AFTER lesson-based prorating
    const proratedFee = baseMonthlyFee * (lessonsBillable / lessonsPlanned);
    const discountedFee = proratedFee * (1 - discountPercent / 100);
    // Reception qo'lda chiqarib tashlagan summani oxirida ayiramiz.
    const finalFee = discountedFee - Math.max(0, Number(manualExcludedAmount));
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
    this.joinedAtCache.clear();
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

      const plannedEndExclusive = p.plannedStudyUntilDate
        ? dayjs(p.plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
        : undefined;
      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive: plannedEndExclusive,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
        });

      // Keep the system free of useless zero-bill payments:
      // if nothing is billable and nothing was paid -> delete open payment
      const amountPaid = Number(p.amountPaid ?? 0);
      if (!lessonsPlanned || !lessonsBillable) {
        if (amountPaid === 0) {
          toDeleteIds.push(p.id);
        }
        continue;
      }

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
      p.lessonsExcused = lessonsExcused;
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
    this.joinedAtCache.clear();

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

      const studentActiveEndExclusive =
        this.computeStudentActiveEndExclusiveForMonth({
          student: p.student,
          group: p.group,
          forMonth,
        });

      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive: studentActiveEndExclusive ?? undefined,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
        });

      const amountPaid = Number(p.amountPaid ?? 0);
      if (!lessonsPlanned || !lessonsBillable) {
        if (amountPaid === 0) toDeleteIds.push(p.id);
        continue;
      }

      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);

      let newAmountPaid = amountPaid;
      let newStatus = p.status;
      if (newAmountPaid > amountDue) newAmountPaid = amountDue;
      if (newAmountPaid === amountDue) newStatus = PaymentStatus.PAID;
      else if (newAmountPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.lessonsExcused = lessonsExcused;
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

  /**
   * Recalculate a single payment after an attendance change (present/absent/
   * excused) for one (student, group, month). EXCUSED lessons reduce amountDue;
   * flipping a lesson back to PRESENT restores it. Unlike the "open payments"
   * recalcs, this ALSO adjusts already-PAID payments and issues a refund when
   * the newly-computed amountDue drops below what was already paid.
   */
  async recalcPaymentForAttendanceChange(
    studentId: number,
    groupId: number,
    forMonthInput: string, // any date within the month
  ): Promise<void> {
    this.discountCache.clear();
    this.joinedAtCache.clear();
    const forMonth = dayjs(forMonthInput)
      .startOf('month')
      .format('YYYY-MM-01');

    let payment = await this.paymentRepo.findOne({
      where: {
        studentId,
        groupId: groupId as any,
        forMonth: forMonth as any,
      },
      relations: ['student', 'group', 'group.schedules'],
    });

    // No payment row yet (e.g. attendance submitted before payments ensured):
    // try to create it, then re-load. Only applies to active students.
    if (!payment) {
      await this.ensurePaymentsForStudent(studentId, {
        onlyCurrentMonth: false,
      }).catch(() => {});
      payment = await this.paymentRepo.findOne({
        where: {
          studentId,
          groupId: groupId as any,
          forMonth: forMonth as any,
        },
        relations: ['student', 'group', 'group.schedules'],
      });
    }

    if (!payment || !payment.student || !payment.group) return;
    if (!payment.group.schedules?.length) return;

    const timezone = payment.group.timezone || 'Asia/Tashkent';

    // Prorate boundary: respect plannedStudyUntilDate and STOPPED date, take the
    // earlier of the two so billing stays correct in every case.
    const plannedEndExclusive = payment.plannedStudyUntilDate
      ? dayjs(payment.plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
      : null;
    const stoppedEndExclusive = this.computeStudentActiveEndExclusiveForMonth({
      student: payment.student,
      group: payment.group,
      forMonth,
    });
    const endExclusive =
      [plannedEndExclusive, stoppedEndExclusive]
        .filter((d): d is string => !!d)
        .sort()[0] ?? undefined;

    const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
      await this.computeMonthBilling({
        student: payment.student,
        group: payment.group,
        forMonth,
        studentActiveEndExclusive: endExclusive,
        manualExcludedAmount: Number(payment.manualExcludedAmount ?? 0),
      });

    const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);

    const prevPaid = Number(payment.amountPaid ?? 0);
    const prevRefunded = Number(payment.refundedAmount ?? 0);

    let newPaid = prevPaid;
    let newRefunded = prevRefunded;
    let refundedAt: Date | null = payment.refundedAt ?? null;

    // If already paid more than the new due amount, refund the difference.
    if (newPaid > amountDue) {
      const refund = this.round2(newPaid - amountDue);
      newRefunded = this.round2(newRefunded + refund);
      newPaid = amountDue;
      refundedAt = new Date();
    }

    let newStatus = payment.status;
    if (newPaid >= amountDue) newStatus = PaymentStatus.PAID;
    else if (newPaid > 0) newStatus = PaymentStatus.PARTIAL;
    else newStatus = PaymentStatus.UNPAID;

    payment.lessonsPlanned = lessonsPlanned;
    payment.lessonsBillable = lessonsBillable;
    payment.lessonsExcused = lessonsExcused;
    payment.amountDue = amountDue as any;
    payment.amountPaid = newPaid as any;
    payment.refundedAmount = newRefunded as any;
    payment.refundedAt = refundedAt as any;
    payment.status = newStatus;
    payment.dueDate = dueDate as any;
    payment.hardDueDate = hardDueDate as any;

    await this.paymentRepo.save(payment);

    void this.triggerTeacherEarningsRecalcForPayment(payment.id).catch(() => {});
  }

  private async ensurePaymentsForStudents(
    students: Student[],
    opts: { onlyCurrentMonth: boolean; maxMonthsBack?: number },
  ) {
    if (!students.length) return;
    this.discountCache.clear();
    this.joinedAtCache.clear();

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
        // MUHIM: forMonth `date` ustuni bo'lgani uchun pg drayveri uni JS Date
        // obyekti qilib qaytaradi. Uni to'g'ridan-to'g'ri stringga qo'shsak
        // ("Wed Jul 01 2026 ...") pastdagi tekshiruv kaliti ("2026-07-01")
        // bilan hech qachon mos kelmaydi -> mavjud to'lovlar "yo'q" deb
        // hisoblanadi -> ular qayta yaratishga urinilib, unique constraint
        // (23505) tufayli butun to'plam (jumladan yangi guruh to'lovlari)
        // jimgina tashlab yuboriladi. Shuning uchun DB darajasida (TZ'dan
        // mustaqil) YYYY-MM-01 formatiga keltiramiz.
        `TO_CHAR(payments.forMonth, 'YYYY-MM-01') as "forMonth"`,
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

          const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
            await this.computeMonthBilling({ student, group, forMonth });

          if (!lessonsPlanned) {
            cursor = cursor.add(1, 'month');
            continue;
          }

          // Prevent useless zero-bill payments (e.g. activeStart after last lesson)
          if (!lessonsBillable) {
            cursor = cursor.add(1, 'month');
            continue;
          }

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
            lessonsExcused,
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

  // To'liq to'lovni tasdiqlash
  async markAsPaid(paymentId: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);

    payment.amountPaid = payment.amountDue;
    payment.status = PaymentStatus.PAID;
    return this.paymentRepo.save(payment);
  }

  // Qisman to'lov qilish
  async payPartial(paymentId: number, amount: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);
    if (amount <= 0) throw new BadRequestException(`To'lov miqdori noto'g'ri`);

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

    try {
      await this.ensurePaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
        centerId: effectiveCenterId,
      });
    } catch (e) {
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
          lessonsExcused: p.lessonsExcused ?? 0,
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

    // Parse plannedStudyUntilDate (can be ISO string or YYYY-MM-DD)
    const plannedEndDate = dayjs(dto.plannedStudyUntilDate)
      .startOf('day')
      .format('YYYY-MM-DD');
    const plannedEndExclusive = dayjs(plannedEndDate)
      .add(1, 'day')
      .format('YYYY-MM-DD');

    const {
      lessonsPlanned,
      lessonsBillable,
      lessonsExcused,
      discountPercent,
      amountDue,
    } = await this.computeMonthBilling({
      student: payment.student,
      group: payment.group,
      forMonth,
      studentActiveEndExclusive: plannedEndExclusive,
      manualExcludedAmount: Number(payment.manualExcludedAmount ?? 0),
    });

    if (lessonsPlanned === 0) {
      throw new BadRequestException('Bu oy uchun darslar rejalashtirilmagan');
    }

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
      lessonsExcused,
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
      relations: ['student', 'group', 'group.schedules'],
    });
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);

    // If payment is already paid, don't allow changes
    if (payment.status === PaymentStatus.PAID && payment.amountPaid > 0) {
      throw new BadRequestException(
        `To'lov allaqachon to'langan, o'zgartirib bo'lmaydi`,
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

    const plannedEndExclusive = payment.plannedStudyUntilDate
      ? dayjs(payment.plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
      : undefined;

    const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
      await this.computeMonthBilling({
        student: payment.student!,
        group: payment.group!,
        forMonth,
        studentActiveEndExclusive: plannedEndExclusive,
        manualExcludedAmount: Number(payment.manualExcludedAmount ?? 0),
      });

    // Update payment fields
    payment.lessonsPlanned = lessonsPlanned;
    payment.lessonsBillable = lessonsBillable;
    payment.lessonsExcused = lessonsExcused;
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
    if (!payment) throw new NotFoundException(`To'lov topilmadi`);

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
      lessonsExcused: (payment as any).lessonsExcused ?? 0,
      plannedStudyUntilDate: (payment as any).plannedStudyUntilDate
        ? dayjs((payment as any).plannedStudyUntilDate).format('YYYY-MM-DD')
        : null,
    };
  }
}
