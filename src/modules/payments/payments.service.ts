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
import {
  Brackets,
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { Cron } from '@nestjs/schedule';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentStatus } from '@/common/enums/students-status.enums';
import {
  buildPausedChecker,
  computeLessonDates,
} from '@/modules/attendance/utils/lesson-dates';
import {
  ensureGroupHolidays,
  ensureGroupPauses,
  ensureSchedulePeriods,
} from '@/modules/group_schedule/schedule-periods.util';
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
import { GroupFeeService } from '@/modules/groups/group-fee.service';
import {
  StudentBaseDiscountService,
  pickBaseDiscountForMonth,
} from '@/modules/students/student-base-discount.service';
import { EnrollmentsService } from '@/modules/enrollments/enrollments.service';
import { UpdatePaymentDto } from '@/modules/payments/dto/update-payment.dto';
import { CalculatePaymentDto } from '@/modules/payments/dto/calculate-payment.dto';
import { User } from '@/modules/users/entities/user.entity';
import { TelegramNotifierService } from '@/modules/telegram/telegram-notifier.service';
import * as ExcelJS from 'exceljs';

/**
 * GET /payments va GET /payments/export bir xil filterlarni qabul qiladi.
 */
/** "Birinchi N oy tekin" oralig'i: `[from, untilExclusive)`, YYYY-MM-DD. */
export interface FreeWindow {
  from: string;
  untilExclusive: string;
}

export interface PaymentListFilters {
  centerId?: number;
  status?: PaymentStatus;
  forMonth?: string; // YYYY-MM
  overdueOnly?: boolean;
  studentId?: number;
  groupId?: number;
  teacherId?: number;
  search?: string;
  /** Oraliq boshi (YYYY-MM-DD yoki YYYY-MM). Faqat o'zi ham berilishi mumkin. */
  dateFrom?: string;
  /** Oraliq oxiri (YYYY-MM-DD yoki YYYY-MM). Faqat o'zi ham berilishi mumkin. */
  dateTo?: string;
}

const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: "To'langan",
  [PaymentStatus.UNPAID]: "To'lanmagan",
  [PaymentStatus.PARTIAL]: "Qisman to'langan",
};

/** Oy (va guruh) uchun hisoblangan chegirma: foizlar va summalar yig'indisi. */
export interface ResolvedDiscount {
  percent: number;
  /** so'm/oy — faqat to'liq oylarga qo'llanadi */
  amount: number;
  breakdown: Array<{
    percent: number;
    amount: number;
    groupId: number | null;
    reason: string;
  }>;
}

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
    private readonly groupFeeService: GroupFeeService,
    private readonly baseDiscountService: StudentBaseDiscountService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ota-onaga Telegram xabari — "o't va unut" (fire-and-forget).
   * Bot ikkinchi darajali kanal: u ishlamasa ham pul qabul qilish to'xtamaydi,
   * shuning uchun javobni kutmaymiz va xatoni yutamiz.
   */
  private notifyParents(
    receiptId: number,
    kind: 'received' | 'confirmed' | 'rejected',
  ) {
    void this.telegramNotifier
      .notifyReceipt(receiptId, kind)
      .catch(() => undefined);
  }

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
  /**
   * Tasdiqlangan pulni to'lov qatoriga qo'shadi (chaqiruvchining
   * tranzaksiyasi ichida, qator qulflangan holda).
   *
   * Qarzdan ortiq pul YO'QOLMAYDI: chek o'zgarmaydi (kassaga shuncha pul
   * tushgan), ortiqchasi `refundedAmount` ga — o'quvchiga qaytariladigan pul
   * bo'lib yoziladi. Bu holat chek qabul qilingandan keyin qarz kamayganda
   * (chegirma, ko'chirish, guruh erta yopilishi) yuz beradi.
   */
  private async addConfirmedMoneyInTx(
    manager: EntityManager,
    paymentId: number,
    addAmount: number,
  ): Promise<{ result: Payment; prevPaid: number }> {
    const lockedPayment = await manager
      .getRepository(Payment)
      .createQueryBuilder('p')
      .setLock('pessimistic_write')
      .where('p.id = :id', { id: paymentId })
      .getOne();

    if (!lockedPayment) throw new NotFoundException("To'lov topilmadi");

    const prevPaid = Number(lockedPayment.amountPaid ?? 0);
    const amountDue = Number(lockedPayment.amountDue ?? 0);
    const safeAdd = Math.max(0, Number(addAmount ?? 0));
    const nextPaidRaw = this.round2(prevPaid + safeAdd);
    const nextPaid = Math.min(nextPaidRaw, amountDue);
    const excess = this.round2(nextPaidRaw - nextPaid);
    if (excess > 0) {
      this.releaseMoneyFromPayment(lockedPayment, excess, 'refund');
    }

    lockedPayment.amountPaid = nextPaid as any;
    lockedPayment.status = this.statusFor(nextPaid, amountDue);

    const result = await manager.save(lockedPayment);
    return { result, prevPaid };
  }

  /** `amountPaid` / `amountDue` nisbatidan status. */
  private statusFor(paid: number, due: number): PaymentStatus {
    if (paid >= due) return PaymentStatus.PAID;
    if (paid > 0) return PaymentStatus.PARTIAL;
    return PaymentStatus.UNPAID;
  }

  /** Pul qo'shilgandan keyingi fon ishlari (referral, o'qituvchi daromadi). */
  private afterConfirmedMoney(saved: { result: Payment; prevPaid: number }) {
    if (saved.prevPaid === 0 && Number(saved.result.amountPaid ?? 0) > 0) {
      void this.applyReferralDiscountOnFirstPayment(
        saved.result.studentId,
      ).catch((e) => {
        console.warn(
          'referral discount apply failed:',
          (e as any)?.message ?? e,
        );
      });
    }

    void this.triggerTeacherEarningsRecalcForPayment(saved.result.id).catch(
      (e) => {
        console.warn(
          'teacher earnings recalc failed:',
          (e as any)?.message ?? e,
        );
      },
    );
  }

  private async applyConfirmedMoneyToPayment(args: {
    payment: Payment;
    addAmount: number;
    confirmedById?: number;
  }): Promise<Payment> {
    const saved = await this.dataSource.transaction((manager) =>
      this.addConfirmedMoneyInTx(manager, args.payment.id, args.addAmount),
    );
    this.afterConfirmedMoney(saved);
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

    const availableToCollect = Math.max(
      0,
      this.round2(remaining - pendingTotal),
    );
    if (amt > availableToCollect) {
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

    // Ikki xodim bir vaqtda bitta oyga pul qabul qilsa ikkalasi ham yuqoridagi
    // tekshiruvdan o'tib ketmasligi uchun: qatorni qulflab, qoldiqni qayta
    // tekshirib, chekni shu tranzaksiyada yozamiz (admin bo'lsa pul ham shu
    // yerda qo'shiladi).
    const txResult = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(Payment)
        .createQueryBuilder('p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: payment.id })
        .getOne();
      if (!locked) throw new NotFoundException(`To'lov topilmadi`);

      const lockedPending = await manager
        .getRepository(PaymentReceipt)
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.amount), 0)', 'sum')
        .where('r.paymentId = :paymentId', { paymentId })
        .andWhere('r.status = :status', {
          status: PaymentReceiptStatus.PENDING,
        })
        .getRawOne<{ sum: string }>();
      const lockedAvailable = Math.max(
        0,
        this.round2(
          Number(locked.amountDue ?? 0) -
            Number(locked.amountPaid ?? 0) -
            Number(lockedPending?.sum ?? 0),
        ),
      );
      if (amt > lockedAvailable) {
        throw new BadRequestException(
          `Maksimal qabul qilish mumkin bo'lgan summa: ${lockedAvailable}`,
        );
      }

      const savedReceipt = await manager.save(receipt);
      const money = isAdmin
        ? await this.addConfirmedMoneyInTx(manager, payment.id, amt)
        : null;
      return { savedReceipt, money };
    });

    const savedReceipt = txResult.savedReceipt;
    const check = await this.buildCheckFromReceipt(savedReceipt.id);

    if (txResult.money) {
      this.afterConfirmedMoney(txResult.money);
      // Pul qabul qilindi (admin bo'lgani uchun darhol tasdiqlangan ham).
      this.notifyParents(savedReceipt.id, 'received');
      return {
        receipt: savedReceipt,
        payment: txResult.money.result,
        pending: false,
        check,
      };
    }

    this.notifyParents(savedReceipt.id, 'received');
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

    // Tasdiq kutayotgan pul allaqachon o'quvchidan olingan — uni qayta olmaymiz.
    // Aks holda submitReceipt "Maksimal qabul qilish mumkin bo'lgan summa" xatosini
    // qaytaradi va pending receipt bor oyni umuman to'liq to'lab bo'lmaydi.
    const pendingSum = await this.receiptRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.amount), 0)', 'sum')
      .where('r.paymentId = :paymentId', { paymentId })
      .andWhere('r.status = :status', { status: PaymentReceiptStatus.PENDING })
      .getRawOne<{ sum: string }>();
    const payableNow = this.round2(remaining - Number(pendingSum?.sum ?? 0));
    if (payableNow <= 0) {
      throw new BadRequestException(
        "Qolgan summa allaqachon qabul qilingan va admin tasdig'ini kutmoqda",
      );
    }

    return this.submitReceipt(
      paymentId,
      payableNow,
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

    const existing = await this.receiptRepo.findOne({
      where: { id: receiptId },
    });
    if (!existing) throw new NotFoundException('Receipt not found');

    // Komissiya snapshot'i foydalanuvchi jadvalidan o'qiladi — qulfdan oldin.
    const snap = await this.computeReceiverCommissionSnapshot({
      receivedById: existing.receivedById ?? null,
      amount: Number(existing.amount ?? 0),
    });

    // Chek qulflanadi va holati QAYTA tekshiriladi: ikki admin (yoki
    // "barchasini tasdiqlash" + bitta tasdiqlash) bir chekni ikki marta
    // tasdiqlay olmaydi. Pul va chek holati bitta tranzaksiyada yoziladi.
    const tx = await this.dataSource.transaction(async (manager) => {
      const receipt = await manager
        .getRepository(PaymentReceipt)
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id: receiptId })
        .getOne();
      if (!receipt) throw new NotFoundException('Receipt not found');
      if (receipt.status === PaymentReceiptStatus.CONFIRMED) {
        const payment = await manager
          .getRepository(Payment)
          .findOne({ where: { id: receipt.paymentId } });
        return { receipt, payment, money: null };
      }
      if (receipt.status === PaymentReceiptStatus.REJECTED) {
        throw new BadRequestException('Receipt is rejected');
      }

      receipt.status = PaymentReceiptStatus.CONFIRMED;
      receipt.confirmedById = currentUser.userId;
      receipt.confirmedAt = new Date();
      receipt.receiverCommissionPercentSnapshot = snap.percent as any;
      receipt.receiverCommissionAmountSnapshot = snap.amount as any;
      const savedReceipt = await manager.save(receipt);

      const money = await this.addConfirmedMoneyInTx(
        manager,
        receipt.paymentId,
        Number(receipt.amount ?? 0),
      );
      return { receipt: savedReceipt, payment: money.result, money };
    });

    if (!tx.money) {
      return {
        receipt: tx.receipt,
        payment: tx.payment,
        alreadyConfirmed: true,
      };
    }

    this.afterConfirmedMoney(tx.money);
    const check = await this.buildCheckFromReceipt(tx.receipt.id);
    this.notifyParents(tx.receipt.id, 'confirmed');

    return { receipt: tx.receipt, payment: tx.payment, check };
  }

  async rejectReceipt(
    receiptId: number,
    currentUser: CurrentUser,
    reason?: string,
  ) {
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
      throw new BadRequestException(
        "Tasdiqlangan receiptni rad etib bo'lmaydi",
      );
    }
    if (receipt.status === PaymentReceiptStatus.REJECTED) {
      return { receipt, alreadyRejected: true };
    }

    receipt.status = PaymentReceiptStatus.REJECTED;
    (receipt as any).rejectedReason = reason ?? null;
    const savedReceipt = await this.receiptRepo.save(receipt);

    // Ota-onaga "pul qabul qilindi" xabari ketgan bo'lishi mumkin — tuzatib
    // qo'yamiz, aks holda u to'lovni amalga oshgan deb biladi.
    this.notifyParents(savedReceipt.id, 'rejected');

    return { receipt: savedReceipt };
  }

  /**
   * Kun bo'yicha oraliqni [from, toExclusive) ko'rinishiga keltiradi.
   * dateTo ning O'ZI HAM kiradi (shuning uchun oxiri +1 kun).
   * Ikkalasi ham ixtiyoriy — faqat biri berilsa bir tomonlama filter.
   */
  private normalizeDayRange(
    dateFrom?: string,
    dateTo?: string,
  ): { from?: string; toExclusive?: string } {
    const parseDay = (value: string, label: string) => {
      const parsed = dayjs(value.trim());
      if (!parsed.isValid()) {
        throw new BadRequestException(
          `${label} noto'g'ri formatda. YYYY-MM-DD kutilmoqda.`,
        );
      }
      return parsed.startOf('day');
    };

    const fromDay = dateFrom?.trim()
      ? parseDay(dateFrom, 'dateFrom')
      : undefined;
    const toDay = dateTo?.trim() ? parseDay(dateTo, 'dateTo') : undefined;

    if (fromDay && toDay && fromDay.isAfter(toDay)) {
      throw new BadRequestException(
        "dateFrom dateTo dan katta bo'lishi mumkin emas",
      );
    }

    return {
      from: fromDay?.format('YYYY-MM-DD HH:mm:ss'),
      toExclusive: toDay?.add(1, 'day').format('YYYY-MM-DD HH:mm:ss'),
    };
  }

  /**
   * Receiptlar uchun umumiy query — ro'yxat, "barchasini tasdiqlash" va
   * statistika shu yerdan filterlaydi (uchtasi hech qachon farq qilmasligi uchun).
   *
   * @param opts.withRelations true bo'lsa payment/student/group ham SELECT
   *   qilinadi (ro'yxat uchun). Aggregate (COUNT/SUM) query'lar uchun false —
   *   ortiqcha ustunlar GROUP BY bilan to'qnashmasligi uchun.
   */
  private buildReceiptsQuery(
    organizationId: number,
    args: {
      centerId?: number;
      dateFrom?: string;
      dateTo?: string;
      status?: PaymentReceiptStatus;
    },
    opts: { withRelations?: boolean } = {},
  ) {
    const qb = this.receiptRepo.createQueryBuilder('r');

    if (opts.withRelations) {
      qb.leftJoinAndSelect('r.payment', 'p')
        .leftJoinAndSelect('p.student', 'student')
        .leftJoinAndSelect('p.group', 'group');
    } else {
      qb.leftJoin('r.payment', 'p').leftJoin('p.student', 'student');
    }

    qb.leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId });

    if (args.status) {
      qb.andWhere('r.status = :status', { status: args.status });
    }

    if (args.centerId) {
      qb.andWhere('center.id = :centerId', { centerId: args.centerId });
    }

    // Sana bo'yicha filter: pul qachon QABUL QILINGAN (receivedAt).
    // receivedAt bo'sh bo'lsa createdAt ishlatiladi.
    const { from, toExclusive } = this.normalizeDayRange(
      args.dateFrom,
      args.dateTo,
    );

    if (from) {
      qb.andWhere('COALESCE(r.receivedAt, r.createdAt) >= :receivedFrom', {
        receivedFrom: from,
      });
    }

    if (toExclusive) {
      qb.andWhere('COALESCE(r.receivedAt, r.createdAt) < :receivedTo', {
        receivedTo: toExclusive,
      });
    }

    return qb;
  }

  /**
   * Pending receiptlar query'si — ro'yxat ham, "barchasini tasdiqlash" ham
   * shu yerdan filterlaydi.
   */
  private buildPendingReceiptsQuery(
    organizationId: number,
    args: { centerId?: number; dateFrom?: string; dateTo?: string },
  ) {
    return this.buildReceiptsQuery(
      organizationId,
      { ...args, status: PaymentReceiptStatus.PENDING },
      { withRelations: true },
    );
  }

  /**
   * 📊 Receiptlar statistikasi — sahifa tepasidagi bloklar uchun.
   *
   * Bitta so'rovda uchala holat: tasdiqlangan / tasdiq kutilmoqda / rad etilgan.
   * Filterlar GET /payments/pending-receipts bilan AYNAN bir xil (centerId,
   * dateFrom, dateTo) va sana ham bir xil maydon bo'yicha — pul QABUL QILINGAN
   * sana (receivedAt, bo'sh bo'lsa createdAt). Ya'ni: "shu oraliqda qabul
   * qilingan pullarning holati bo'yicha taqsimoti".
   */
  async getReceiptsStats(
    organizationId: number,
    args: { centerId?: number; dateFrom?: string; dateTo?: string },
  ) {
    const rows = await this.buildReceiptsQuery(organizationId, args)
      .select('r.status', 'status')
      .addSelect('COUNT(r.id)', 'count')
      .addSelect('COALESCE(SUM(r.amount), 0)', 'sum')
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string; sum: string }>();

    const empty = () => ({ count: 0, amount: 0 });
    const stats: Record<
      PaymentReceiptStatus,
      { count: number; amount: number }
    > = {
      [PaymentReceiptStatus.CONFIRMED]: empty(),
      [PaymentReceiptStatus.PENDING]: empty(),
      [PaymentReceiptStatus.REJECTED]: empty(),
    };

    for (const row of rows) {
      const key = row.status as PaymentReceiptStatus;
      if (stats[key]) {
        stats[key] = {
          count: Number(row.count ?? 0),
          amount: this.round2(Number(row.sum ?? 0)),
        };
      }
    }

    // Rad etilgan pul kassaga kirmagan, shuning uchun "total" ga QO'SHILMAYDI.
    const totalAmount = this.round2(
      stats[PaymentReceiptStatus.CONFIRMED].amount +
        stats[PaymentReceiptStatus.PENDING].amount,
    );
    const totalCount =
      stats[PaymentReceiptStatus.CONFIRMED].count +
      stats[PaymentReceiptStatus.PENDING].count;

    return {
      confirmed: stats[PaymentReceiptStatus.CONFIRMED],
      pending: stats[PaymentReceiptStatus.PENDING],
      rejected: stats[PaymentReceiptStatus.REJECTED],
      // tasdiqlangan + kutilayotgan (rad etilgansiz)
      total: { count: totalCount, amount: totalAmount },
    };
  }

  async listPendingReceipts(
    organizationId: number,
    args: {
      centerId?: number;
      page?: number;
      perPage?: number;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const page = Math.max(1, Number(args.page ?? 1));
    const perPage = Math.max(1, Math.min(100, Number(args.perPage ?? 20)));
    const skip = (page - 1) * perPage;

    const qb = this.buildPendingReceiptsQuery(organizationId, args);

    // "Barchasini oldim" tugmasi uchun jami summa (joriy sahifa emas, BUTUN filter)
    const totalsRaw = await qb
      .clone()
      .select('COALESCE(SUM(r.amount), 0)', 'sum')
      .getRawOne<{ sum: string }>();

    const [data, total] = await qb
      .orderBy('r.createdAt', 'DESC')
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
        // filterga mos BARCHA pending receiptlar summasi
        totalAmount: Number(totalsRaw?.sum ?? 0),
      },
    };
  }

  /**
   * ✅ Bir nechta (yoki filterga mos barcha) pending receiptni tasdiqlaydi.
   *
   * - `receiptIds` berilsa — faqat o'shalar (frontendda belgilanganlar).
   * - `all: true` berilsa — filterga (centerId/dateFrom/dateTo) mos BARCHASI.
   *
   * Har bir receipt alohida confirmReceipt() orqali o'tadi, ya'ni yakka
   * tasdiqlash bilan bir xil: pul payment'ga qo'shiladi, komissiya snapshot'i
   * olinadi, chek yasaladi. Bittasi xato bersa qolganlari to'xtamaydi —
   * natijada nima bo'lgani ro'yxat bilan qaytadi.
   */
  async confirmReceiptsBulk(
    organizationId: number,
    currentUser: CurrentUser,
    args: {
      receiptIds?: number[];
      all?: boolean;
      centerId?: number;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;
    if (!isAdmin) {
      throw new BadRequestException('Only admin can confirm receipts');
    }

    const hasIds = !!args.receiptIds?.length;
    if (!hasIds && !args.all) {
      throw new BadRequestException(
        'receiptIds bering yoki barchasini tasdiqlash uchun all: true yuboring',
      );
    }

    const effectiveCenterId = isAdmin ? args.centerId : currentUser.centerId;

    // Tanlanganlar ham, "barchasi" ham shu query orqali o'tadi —
    // ya'ni boshqa tashkilot/markazning receipti hech qachon tasdiqlanmaydi.
    const qb = this.buildPendingReceiptsQuery(organizationId, {
      centerId: effectiveCenterId,
      dateFrom: hasIds ? undefined : args.dateFrom,
      dateTo: hasIds ? undefined : args.dateTo,
    });

    if (hasIds) {
      qb.andWhere('r.id IN (:...receiptIds)', {
        receiptIds: [...new Set(args.receiptIds)],
      });
    }

    const targets = await qb
      .orderBy('r.createdAt', 'ASC')
      .select('r.id', 'id')
      .getRawMany<{ id: number }>();

    const targetIds = targets.map((r) => Number(r.id));

    const confirmed: Array<{
      receiptId: number;
      amount: number;
      checkNo?: string | null;
    }> = [];
    const failed: Array<{ receiptId: number; reason: string }> = [];

    for (const receiptId of targetIds) {
      try {
        const result = await this.confirmReceipt(receiptId, currentUser);
        confirmed.push({
          receiptId,
          amount: Number(result.receipt?.amount ?? 0),
          checkNo:
            (result as any).check?.checkNo ?? result.receipt?.checkNo ?? null,
        });
      } catch (e: any) {
        this.logger.error(
          `Bulk confirm failed for receipt ${receiptId}: ${e?.message}`,
        );
        failed.push({ receiptId, reason: e?.message ?? 'Unknown error' });
      }
    }

    // Belgilangan, lekin topilmagan id'lar (allaqachon tasdiqlangan / rad etilgan /
    // boshqa markazniki / umuman yo'q)
    const skipped = hasIds
      ? [...new Set(args.receiptIds)]
          .map(Number)
          .filter((id) => !targetIds.includes(id))
      : [];

    return {
      requested: hasIds
        ? [...new Set(args.receiptIds)].length
        : targetIds.length,
      confirmedCount: confirmed.length,
      confirmedAmount: this.round2(
        confirmed.reduce((acc, c) => acc + c.amount, 0),
      ),
      skippedCount: skipped.length,
      failedCount: failed.length,
      confirmed,
      skipped,
      failed,
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
      relations: [
        'groups',
        'groups.schedules',
        'subject',
        'subjects',
        'center',
      ],
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

    const months = await Promise.all(
      payments.map(async (p) => {
        const amountDue = Number(p.amountDue ?? 0);
        const amountPaid = Number(p.amountPaid ?? 0);
        const pendingAmount = this.round2(pendingMap.get(p.id) ?? 0);
        const remaining = this.round2(Math.max(0, amountDue - amountPaid));
        // O'quvchi topshirgan pul (tasdiqlangan + tasdiq kutayotgan).
        const receivedAmount = this.round2(amountPaid + pendingAmount);
        // Shu oy uchun o'quvchidan hali olinishi kerak bo'lgan summa.
        const payableNow = this.round2(Math.max(0, amountDue - receivedAmount));

        // Proratsiyani tushuntirish uchun dars sanoqlari (Payment'da saqlangan).
        const lessonsPlanned = p.lessonsPlanned ?? null;
        const lessonsBillable = p.lessonsBillable ?? null;
        // EXCUSED endi to'lovni kamaytirmaydi (Req1) — faqat ma'lumot uchun.
        const lessonsExcused = Number(p.lessonsExcused ?? 0);
        // To'lovga kiradigan darslar = lessonsBillable (mid-month proratsiya).
        const effectiveBillable = lessonsBillable;

        // fullAmount = proratsiyasiz to'liq oylik (chegirma bilan, manual
        // exclusionsiz). amountDue = fullAmount * (billable/planned) - manualExcluded.
        // Guruh narxi oyga bog'langan — shu oyda amal qilgan narxni olamiz.
        const groupFee = (p as any).group
          ? await this.resolveGroupFeeForMonth(
              (p as any).group,
              dayjs(p.forMonth).format('YYYY-MM-01'),
            )
          : 0;
        const studentFee = await this.resolvePersonalFeeForMonth(
          student,
          dayjs(p.forMonth).format('YYYY-MM-01'),
        );
        const baseMonthlyFee = studentFee > 0 ? studentFee : groupFee;
        let fullAmount: number | null = null;
        let discountPercent = 0;
        let discountAmount = 0;
        if (baseMonthlyFee > 0) {
          try {
            const { percent, amount } = await this.resolveDiscountForMonth({
              student,
              forMonth: dayjs(p.forMonth).format('YYYY-MM-01'),
              groupId: p.groupId,
            });
            discountPercent = Number(percent ?? 0);
            discountAmount = Number(amount ?? 0);
            fullAmount = this.round2(
              Math.max(
                0,
                baseMonthlyFee * (1 - Number(percent ?? 0) / 100) - amount,
              ),
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
          amountPaid, // admin tasdiqlagan, kassaga tushgan pul
          pendingAmount, // tasdiqlash kutayotgan receiptlar summasi
          receivedAmount, // amountPaid + pendingAmount (o'quvchi topshirgan)
          remaining, // shu oy uchun kassa qarzi (amountDue - amountPaid)
          payableNow, // shu oy uchun o'quvchidan olinishi kerak
          status: p.status,
          // ↓ proratsiyani tushuntirish uchun
          lessonsPlanned, // guruhda shu oyda jami rejalashtirilgan darslar
          lessonsBillable, // o'quvchiga hisoblangan darslar
          lessonsExcused, // sababli darslar (INFO — to'lovga ta'sir qilmaydi)
          effectiveBillable, // to'lovga kiradigan darslar (== lessonsBillable)
          fullAmount, // proratsiyasiz to'liq oylik (chegirma bilan)
          discountPercent, // shu guruh to'loviga qo'llangan foiz
          // summadagi chegirma — umumiy to'lovdan bir marta, faqat asosiy
          // guruh qatorida (to'liq oy bo'lsa amalda ayriladi)
          discountAmount,
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
    // O'quvchi topshirgan jami pul (tasdiqlangan + tasdiq kutayotgan).
    const totalReceived = sum((m) => m.receivedAmount);
    // O'quvchidan olinishi kerak bo'lgan summa — oylar bo'yicha yig'indi
    // (qarzdan tasdiqlash kutayotgani ayirilgan).
    const payableNow = sum((m) => m.payableNow);

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
        discountAmount: Number((student as any).discountAmount ?? 0),
        discountReason: student.discountReason ?? null,
        activatedAt: student.activatedAt ?? null,
        stoppedAt: student.stoppedAt ?? null,
        createdAt: student.createdAt,
        centerId: student.centerId,
        centerName: (student as any).center?.name ?? null,
        subject: student.subject
          ? { id: student.subject.id, name: (student.subject as any).name }
          : null,
        // Barcha fanlar: asosiysi (`subject`) birinchi.
        subjects: [...(student.subjects ?? [])]
          .sort(
            (a, b) =>
              Number(b.id === student.subjectId) -
                Number(a.id === student.subjectId) || a.id - b.id,
          )
          .map((x) => ({ id: x.id, name: x.name })),
        groups,
      },
      totals: {
        totalDue,
        totalPaid, // admin tasdiqlagan, kassaga tushgan
        totalDebt, // kassa qarzi (totalDue - totalPaid)
        totalPending, // reception olgan, tasdiq kutayotgan
        totalReceived, // totalPaid + totalPending
        payableNow, // o'quvchidan olinishi kerak
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

    const amount =
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

    this.resetBillingCaches();
    this.enrollmentsService.clearCache();

    // Bazaviy summa (manual exclusionsiz to'liq hisob). To'xtatilgan sana va
    // "shu sanagacha o'qiyman" chegarasi ham hisobga olinadi — aks holda
    // chiqarib tashlash qarzni kamaytirish o'rniga oshirib yuborardi.
    const base = await this.computeMonthBilling({
      student: payment.student,
      group: payment.group,
      forMonth,
      studentActiveEndExclusive: this.resolveActiveEndExclusive({
        student: payment.student,
        group: payment.group,
        forMonth,
        plannedStudyUntilDate: payment.plannedStudyUntilDate,
      }),
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

    const newAmountDue = this.round2(
      Math.max(0, base.amountDue - excludedTotal),
    );
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
        'Chiqarib tashlashda izoh (comment) majburiy',
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

  private discountCache = new Map<string, ResolvedDiscount>();

  // Bitta hisob operatsiyasi davomidagi keshlar (ommaviy qayta hisoblashda
  // har qator uchun bir xil so'rovlar takrorlanmasligi uchun). Har operatsiya
  // boshida `resetBillingCaches()` bilan tozalanadi.
  private calendarCache = new Map<
    number,
    Pick<Group, 'schedulePeriods' | 'pauses' | 'holidays'>
  >();
  private basePeriodsCache = new Map<
    number,
    Awaited<ReturnType<StudentBaseDiscountService['getPeriods']>>
  >();
  private primaryGroupCache = new Map<string, number | null>();
  private freeWindowCache = new Map<string, FreeWindow | null>();

  private resetBillingCaches() {
    this.discountCache.clear();
    this.freeWindowCache.clear();
    this.calendarCache.clear();
    this.basePeriodsCache.clear();
    this.primaryGroupCache.clear();
  }

  /** Guruhning jadval tarixi, pauzalari va bayramlari (keshlangan). */
  private async loadGroupCalendar(group: Group) {
    const hit = this.calendarCache.get(group.id);
    if (hit) {
      group.schedulePeriods ??= hit.schedulePeriods;
      group.pauses ??= hit.pauses;
      group.holidays ??= hit.holidays;
      return;
    }
    await ensureSchedulePeriods(this.dataSource.manager, group);
    await ensureGroupPauses(this.dataSource.manager, group);
    await ensureGroupHolidays(this.dataSource.manager, group);
    this.calendarCache.set(group.id, {
      schedulePeriods: group.schedulePeriods,
      pauses: group.pauses,
      holidays: group.holidays,
    });
  }

  private async getBasePeriods(studentId: number) {
    const hit = this.basePeriodsCache.get(studentId);
    if (hit) return hit;
    const periods = await this.baseDiscountService.getPeriods(studentId);
    this.basePeriodsCache.set(studentId, periods);
    return periods;
  }

  /**
   * Shu oy uchun guruh narxi.
   *
   * Narx oyga bog'langan (`group_fee_periods`): guruh narxi oy o'rtasida
   * o'zgartirilsa, u faqat keyingi oydan kuchga kiradi. Shuning uchun bu yerda
   * `group.monthlyFee` emas, aynan `forMonth` uchun amaldagi narx olinadi.
   * Tarix topilmasa — `group.monthlyFee` ga qaytamiz (eski ma'lumot uchun).
   *
   * Tarix `GroupFeeService` ichida qisqa muddatli keshda — massiv qayta
   * hisoblashda har bir to'lov uchun DB'ga borilmaydi.
   */
  private async resolveGroupFeeForMonth(
    group: Group,
    forMonth: string,
  ): Promise<number> {
    if (!group?.id) return Number(group?.monthlyFee ?? 0);
    return this.groupFeeService.resolveFeeForMonth(
      group.id,
      forMonth,
      Number(group.monthlyFee ?? 0),
    );
  }

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

      const base = (await this.resolveBaseDiscountForMonth(student, mStart))
        .percent;
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
    this.resetBillingCaches();
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

  /**
   * Shu oy (va guruh) uchun amaldagi chegirma.
   *
   * - Foizlar qo'shiladi (100% dan oshsa — xato), summalar ham qo'shiladi.
   * - Davr `groupId` bilan bog'langan bo'lsa faqat o'sha guruh to'loviga
   *   qo'llanadi (ikki fanda o'qiganga chegirma arzonroq fanga); `groupId`
   *   bo'sh davr — o'quvchining barcha guruhlariga.
   * - `groupId` berilmasa faqat guruhga bog'lanmagan chegirmalar olinadi.
   */
  /**
   * Oy uchun amaldagi doimiy chegirma: `student_base_discounts` tarixidan,
   * tarix bo'lmasa — `students` ustunlaridan (hech qachon o'zgartirilmagan).
   */
  /**
   * Shu oy uchun amaldagi SHAXSIY narx (0 — guruh narxi ishlatiladi).
   * Doimiy chegirma bilan bitta tarixda: o'zgartirilsa o'tgan oylar tegilmaydi.
   */
  private async resolvePersonalFeeForMonth(
    student: Student,
    forMonth: string,
  ): Promise<number> {
    const periods = await this.getBasePeriods(student.id);
    const picked = pickBaseDiscountForMonth(periods, forMonth);
    if (picked && picked.monthlyFee != null) return Number(picked.monthlyFee);
    return Number(student.monthlyFee ?? 0);
  }

  private async resolveBaseDiscountForMonth(
    student: Student,
    forMonth: string,
  ): Promise<{ percent: number; amount: number; reason: string | null }> {
    const periods = await this.getBasePeriods(student.id);
    const picked = pickBaseDiscountForMonth(periods, forMonth);
    if (picked) return picked;
    return {
      percent: Number(student.discountPercent ?? 0),
      amount: Number((student as any).discountAmount ?? 0),
      reason: student.discountReason ?? null,
    };
  }

  private async resolveDiscountForMonth(args: {
    student: Student;
    forMonth: string; // YYYY-MM-01
    groupId?: number | null;
  }): Promise<ResolvedDiscount> {
    const { student, forMonth } = args;
    const groupId = args.groupId ?? null;
    const key = `${student.id}:${forMonth}:${groupId ?? '-'}`;
    const cached = this.discountCache.get(key);
    if (cached !== undefined) return cached;

    const qb = this.discountPeriodRepo
      .createQueryBuilder('d')
      .where('d.studentId = :studentId', { studentId: student.id })
      .andWhere('d.fromMonth <= :forMonth', { forMonth })
      .andWhere('(d.toMonth IS NULL OR d.toMonth > :forMonth)', { forMonth });
    if (groupId) {
      qb.andWhere('(d.groupId IS NULL OR d.groupId = :groupId)', { groupId });
    } else {
      qb.andWhere('d.groupId IS NULL');
    }
    const rows = await qb
      .orderBy('d.fromMonth', 'DESC')
      .addOrderBy('d.createdAt', 'DESC')
      .getMany();

    const breakdown: ResolvedDiscount['breakdown'] = [];

    // Doimiy (davrsiz) chegirma — shu oy uchun amalda bo'lgani tarixdan.
    const base = await this.resolveBaseDiscountForMonth(student, forMonth);
    if (base.percent > 0 || base.amount > 0) {
      breakdown.push({
        percent: base.percent,
        amount: base.amount,
        groupId: null,
        reason: base.reason ? `Base: ${base.reason}` : 'Base discount',
      });
    }

    for (const r of rows) {
      const p = Number(r.percent ?? 0);
      const a = Number(r.amount ?? 0);
      if (!p && !a) continue;
      breakdown.push({
        percent: p,
        amount: a,
        groupId: r.groupId ?? null,
        reason: r.reason ?? 'Discount period',
      });
    }

    // Summadagi chegirma (so'm/oy) fanga bog'lanmagan bo'lsa — o'quvchining
    // UMUMIY to'lovidan BIR MARTA ayriladi: shu oydagi "asosiy" guruh
    // to'loviga (shu oyda eng birinchi qo'shilgan guruh) yoziladi. Ilgari har
    // bir guruh to'lovidan alohida ayrilardi (ikki fanda — ikki barobar).
    // Foizli chegirma har guruh narxidan foiz bo'lgani uchun hamma guruhda qoladi.
    if (groupId && breakdown.some((b) => b.amount > 0 && b.groupId === null)) {
      const primary = await this.primaryGroupForMonth(student.id, forMonth);
      if (primary !== null && primary !== groupId) {
        for (const b of breakdown) {
          if (b.groupId === null && b.amount > 0) b.amount = 0;
        }
      }
    }
    for (let i = breakdown.length - 1; i >= 0; i--) {
      if (!breakdown[i].percent && !breakdown[i].amount) breakdown.splice(i, 1);
    }

    const rawTotal = breakdown.reduce((sum, b) => sum + b.percent, 0);
    // 100% dan oshsa xato TASHLAMAYMIZ: bu metod oylik cron va ommaviy qayta
    // hisoblash ichida chaqiriladi — bitta o'quvchining noto'g'ri chegirmasi
    // butun tashkilot to'lovlarini to'xtatib qo'yardi. 100% da to'xtatamiz.
    if (rawTotal > 100) {
      this.logger.warn(
        `Chegirma 100% dan oshdi: studentId=${student.id} oy=${forMonth} (${rawTotal}%) — 100% qo'llandi`,
      );
    }
    const total = Math.min(100, rawTotal);

    const result: ResolvedDiscount = {
      percent: Math.max(0, total),
      amount: this.round2(breakdown.reduce((sum, b) => sum + b.amount, 0)),
      breakdown,
    };
    this.discountCache.set(key, result);
    return result;
  }

  /**
   * O'quvchining shu oydagi "asosiy" guruhi — fanga bog'lanmagan summadagi
   * chegirma shu guruh to'loviga yoziladi. Tanlov barqaror: shu oy bilan
   * kesishgan a'zolik oynalari ichida eng erta qo'shilgani (teng bo'lsa —
   * kichik groupId). Oyna yo'q (eski ma'lumot) — hozirgi guruhlardan eng kichik id.
   */
  private async primaryGroupForMonth(
    studentId: number,
    forMonth: string,
  ): Promise<number | null> {
    const key = `${studentId}:${forMonth}`;
    if (this.primaryGroupCache.has(key))
      return this.primaryGroupCache.get(key)!;
    const monthStart = dayjs(forMonth).startOf('month').format('YYYY-MM-DD');
    const monthEnd = dayjs(forMonth).endOf('month').format('YYYY-MM-DD');
    // Butun oyni qamragan a'zolik afzal (chegirma faqat to'liq oyga
    // qo'llanadi — oy o'rtasida chiqqan guruhga yozilsa yo'qolib ketardi).
    const [row] = await this.dataSource.query(
      `SELECT "groupId" FROM "student_group_enrollments"
        WHERE "studentId" = $1 AND "joinedAt" <= $3::date
          AND ("leftAt" IS NULL OR "leftAt" > $2::date)
        ORDER BY ("joinedAt" <= $2::date AND ("leftAt" IS NULL OR "leftAt" > $3::date)) DESC,
                 "joinedAt" ASC, "groupId" ASC
        LIMIT 1`,
      [studentId, monthStart, monthEnd],
    );
    let result: number | null = row?.groupId ? Number(row.groupId) : null;
    if (result === null) {
      const [legacy] = await this.dataSource.query(
        `SELECT MIN("groupsId") AS "groupId" FROM "students_groups_groups"
          WHERE "studentsId" = $1`,
        [studentId],
      );
      result = legacy?.groupId ? Number(legacy.groupId) : null;
    }
    this.primaryGroupCache.set(key, result);
    return result;
  }

  private async triggerTeacherEarningsRecalcForPayment(paymentId: number) {
    // We intentionally do not block the payment flow on earnings calculations.
    // If this fails, payroll can still be recalculated via /teacher-earnings/calculate.
    const info = await this.paymentRepo
      .createQueryBuilder('p')
      .select(['p.forMonth as "forMonth"', 'p.groupId as "groupId"'])
      .where('p.id = :paymentId', { paymentId })
      .getRawOne<{ forMonth: string; groupId: number | null }>();

    if (!info?.groupId || !info?.forMonth) return;
    await this.recalcTeacherEarningsForGroupMonth(
      Number(info.groupId),
      dayjs(info.forMonth).format('YYYY-MM-01'),
    );
  }

  /**
   * Guruhning shu oydagi BARCHA o'qituvchilari komissiyasini qayta hisoblaydi
   * (oy o'rtasida o'qituvchi almashgan bo'lsa ikkalasi ham).
   */
  async recalcTeacherEarningsForGroupMonth(groupId: number, month: string) {
    // O'qituvchi oyligi to'lov bilan bir xil oyda (ish oyi) turadi.
    // Kelajak oy uchun oldindan to'lov bo'lsa — o'sha oy ochilganda hisoblanadi.
    const monthYm = dayjs(month).format('YYYY-MM');
    if (dayjs(`${monthYm}-01`).isAfter(dayjs().startOf('month'))) return;

    const [row] = await this.dataSource.query(
      `SELECT c."organizationId" FROM "groups" g
         JOIN "centers" c ON c."id" = g."centerId"
        WHERE g."id" = $1`,
      [groupId],
    );
    const organizationId = Number(row?.organizationId ?? 0);
    if (!organizationId) return;

    const teacherIds = await this.teacherEarningsService.teachersForGroupMonth(
      groupId,
      `${monthYm}-01`,
    );
    for (const teacherId of teacherIds) {
      try {
        await this.teacherEarningsService.calculateTeacherEarningsForMonth(
          organizationId,
          teacherId,
          monthYm,
          { force: true },
        );
      } catch (e) {
        this.logger.warn(
          `Teacher earnings recalc failed teacher=${teacherId} group=${groupId} month=${monthYm}: ${
            (e as any)?.message ?? e
          }`,
        );
      }
    }
  }

  /**
   * Joriy oy to'lov qatorlarini yaratadi. HAR KUNI ishlaydi (idempotent —
   * mavjud qatorga tegmaydi): server oyning 1-sanasida o'chiq bo'lsa ham
   * qatorlar keyingi kuni yaratiladi, oy boshida qo'shilgan o'quvchilar ham
   * qoladi. Toshkent vaqti bilan — UTC serverda 1-sanada 00:00–05:00
   * oralig'ida yangi oy "kelajak" bo'lib qolmasligi uchun.
   */
  @Cron('10 0 * * *', { timeZone: 'Asia/Tashkent' })
  async generateMonthlyPayments() {
    this.logger.log('Cron: Current month payments ensuring...');
    try {
      await this.ensurePaymentsForAllActiveStudents({ onlyCurrentMonth: true });
      this.logger.log('Cron: Payment ensure finished');
    } catch (e) {
      this.logger.error(
        `Cron: Payment ensure failed: ${(e as any)?.message ?? e}`,
      );
    }
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
    for (let i = 1; i <= installmentIndex; i++)
      letters.push(this.columnLetter(i));
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
  private async generateTransactionNo(
    when: Date = new Date(),
  ): Promise<string> {
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
      teacher: teacher ? { id: teacher.id, fullName: fullName(teacher) } : null,
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
      paidAt: receipt.paidAt
        ? dayjs(receipt.paidAt).format('YYYY-MM-DD')
        : null,
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
    /** A'zolik oynalari (shu oy bilan kesishganlari); berilsa dars shulardan biriga tushishi shart. */
    enrollmentWindows?: { joinedAt: string; leftAt: string | null }[] | null;
    /** "Birinchi N oy tekin" — bu oraliqdagi darslar to'lovga kirmaydi. */
    freeWindow?: FreeWindow | null;
  }): {
    lessonsPlanned: number;
    lessonsBillable: number;
    billableDates: string[];
    /** O'quvchi oynasidagi, lekin guruh pauzasi sabab o'tkazilmagan darslar. */
    lessonsPaused: number;
  } {
    const {
      group,
      forMonth,
      studentActiveStart,
      studentActiveEndExclusive,
      enrollmentWindows,
      freeWindow,
    } = args;
    const timezone = group.timezone || 'Asia/Tashkent';

    // IMPORTANT: parse first, then apply timezone
    const monthStart = dayjs(forMonth).tz(timezone).startOf('month');
    const monthEnd = monthStart.endOf('month');
    const monthStartStr = monthStart.format('YYYY-MM-DD');
    const monthEndStr = monthEnd.format('YYYY-MM-DD');

    /**
     * BUSINESS RULE:
     * - group.monthlyFee — TO'LIQ oy narxi.
     * - lessonsPlanned — to'liq kalendar oydagi jadval bo'yicha darslar soni,
     *   guruhning boshlanish/tugash sanasidan QAT'I NAZAR.
     * - lessonsBillable — shu darslardan o'quvchi to'laydiganlari: guruh
     *   chegarasi [startDate..endDate] va o'quvchining faol oynasi kesishmasi.
     *
     * Shuning uchun guruh oyning 10-sanasida tugasa, o'quvchi butun oy emas,
     * faqat o'sha 10 kundagi darslar uchun to'laydi (lessonsBillable /
     * lessonsPlanned nisbati).
     */
    const plannedDates = computeLessonDates({
      timezone,
      groupStartDate: monthStartStr,
      groupEndDate: null,
      schedules: group.schedules ?? [],
      // O'tgan oylar o'sha paytdagi jadval bo'yicha: jadval o'zgarsa ham
      // eski oylar proratsiyasi buzilmaydi.
      schedulePeriods: group.schedulePeriods ?? null,
      // Bayram kunlari rejadan ham chiqadi — oylik narx o'zgarmaydi, faqat
      // oy o'rtasida qo'shilganlar proratsiyasi o'tkaziladigan darslar bo'yicha.
      holidays: group.holidays ?? null,
      window: {
        mode: 'range',
        from: monthStartStr,
        to: monthEndStr,
      },
    });

    const lessonsPlanned = plannedDates.length;
    if (!lessonsPlanned)
      return {
        lessonsPlanned: 0,
        lessonsBillable: 0,
        billableDates: [],
        lessonsPaused: 0,
      };

    // Guruh chegaralari (inclusive). endDate o'zgarsa shu yerda darhol aks etadi.
    const groupStartDate = group.startDate
      ? dayjs(group.startDate).format('YYYY-MM-DD')
      : null;
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    // Guruh to'xtatilgan kunlardagi darslar o'tkazilmaydi — o'quvchi ular
    // uchun to'lamaydi (rejadagi darslar soni o'zgarmaydi, shuning uchun
    // oylik narx to'xtatilgan darslar ulushiga kamayadi).
    const isPaused = buildPausedChecker(group.pauses);
    let lessonsPaused = 0;
    const billableDates = plannedDates.filter((d) => {
      if (groupStartDate && d < groupStartDate) return false;
      if (groupEndDate && d > groupEndDate) return false;
      if (d < studentActiveStart) return false;
      if (studentActiveEndExclusive && d >= studentActiveEndExclusive)
        return false;
      // Oy ichida chiqib, qayta qo'shilgan bo'lsa — oradagi darslar kirmaydi.
      if (
        enrollmentWindows?.length &&
        !enrollmentWindows.some(
          (w) => w.joinedAt <= d && (!w.leftAt || d < w.leftAt),
        )
      )
        return false;
      if (isPaused(d)) {
        lessonsPaused++;
        return false;
      }
      // Tekin davr: dars o'tadi, lekin pul olinmaydi. `lessonsPlanned`
      // o'zgarmaydi — oylik narx qolgan (pullik) darslar ulushiga kamayadi.
      if (freeWindow && d >= freeWindow.from && d < freeWindow.untilExclusive)
        return false;
      return true;
    });

    return {
      lessonsPlanned,
      lessonsBillable: billableDates.length,
      billableDates,
      lessonsPaused,
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
    discountAmount: number;
    amountDue: number;
  }> {
    const {
      student,
      group,
      forMonth,
      studentActiveEndExclusive,
      manualExcludedAmount = 0,
    } = args;

    // O'quvchining shu GURUHDAGI a'zolik oynasi. Oy o'rtasida qo'shilgan bo'lsa
    // proratsiya `joinedAt` dan boshlanadi; guruhdan chiqqan (yoki boshqa
    // guruhga ko'chirilgan) bo'lsa `leftAt` dan keyingi darslar to'lovga
    // kirmaydi — bu chegara har qanday qayta hisoblashda saqlanib qoladi.
    const { joinedAt, leftAt } = await this.resolveEnrollmentWindow(
      student.id,
      group.id,
      forMonth,
    );

    const studentActiveStart = this.computeStudentActiveStartForMonth({
      student,
      group,
      forMonth,
      joinedAt,
    });

    // Chegaralardan ERTAROG'I kuchga kiradi: o'quvchi to'xtatilgan sana,
    // "shu sanagacha o'qiyman" va guruhdan chiqqan sana.
    const effectiveEndExclusive = this.earliestDate(
      studentActiveEndExclusive,
      leftAt,
    );

    await this.loadGroupCalendar(group);
    const enrollmentWindows =
      await this.enrollmentsService.resolveWindowsForMonth(
        student.id,
        group.id,
        forMonth,
      );
    const freeWindow = await this.resolveFreeWindow(student);
    const { lessonsPlanned, lessonsBillable, billableDates, lessonsPaused } =
      this.computeMonthLessonCounts({
        group,
        forMonth,
        studentActiveStart,
        studentActiveEndExclusive: effectiveEndExclusive,
        enrollmentWindows,
        freeWindow,
      });

    // EXCUSED (sababli) darslar endi to'lovni kamaytirmaydi (Req1) — faqat
    // ma'lumot uchun sanaymiz. Kamaytirish faqat qo'lda (manualExcludedAmount)
    // orqali reception tomonidan qilinadi.
    const lessonsExcused = lessonsPlanned
      ? await this.countExcusedOnDates(group.id, student.id, billableDates)
      : 0;
    const effectiveBillable = lessonsBillable;

    const { percent: discountPercent, amount: discountAmount } =
      await this.resolveDiscountForMonth({
        student,
        forMonth,
        groupId: group.id,
      });

    // Guruh narxi ham, shaxsiy narx ham oyga bog'langan: o'tgan/joriy oylar
    // eski narxda qoladi.
    const groupFee = await this.resolveGroupFeeForMonth(group, forMonth);
    const personalFee = await this.resolvePersonalFeeForMonth(
      student,
      forMonth,
    );

    const amountDue = this.computeAmountDue({
      personalFee,
      groupFee,
      lessonsPlanned,
      lessonsBillable, // excused ayirilmaydi
      lessonsPaused,
      discountPercent,
      discountAmount,
      manualExcludedAmount,
    });

    return {
      studentActiveStart,
      lessonsPlanned,
      lessonsBillable,
      lessonsExcused,
      effectiveBillable,
      discountPercent,
      discountAmount,
      amountDue,
    };
  }

  /**
   * "Birinchi N oy tekin" oralig'i (`students.freeMonths`). Boshlanishi —
   * o'quvchining birinchi darsi: barcha guruhlari bo'yicha
   * max(guruhga qo'shilgan, faollashgan, guruh boshlangan) sanalarining
   * eng ertasi. Shuning uchun keyin qo'shilgan guruh yana tekin oy olmaydi,
   * to'xtab qaytgan o'quvchida ham davr qayta boshlanmaydi.
   * 17-oktabr + 1 oy → `[2026-10-17, 2026-11-17)`.
   */
  async resolveFreeWindow(
    student: Student,
    opts: { fresh?: boolean } = {},
  ): Promise<FreeWindow | null> {
    const months = Number(student.freeMonths ?? 0);
    if (months <= 0) return null;
    const key = `${student.id}:${months}`;
    // Kesh faqat bitta hisob operatsiyasi ichida; tashqaridan (o'quvchi
    // sahifasi, tekshiruv) `fresh` bilan chaqiriladi — eski oyna qaytmasin.
    if (!opts.fresh && this.freeWindowCache.has(key)) {
      return this.freeWindowCache.get(key) ?? null;
    }

    const enrollments = await this.enrollmentsService.listForStudent(
      student.id,
    );
    let from: string | null = null;
    for (const e of enrollments) {
      const tz = e.group?.timezone || 'Asia/Tashkent';
      const candidates = [dayjs(e.joinedAt).format('YYYY-MM-DD')];
      if (e.group?.startDate) {
        candidates.push(dayjs(e.group.startDate).format('YYYY-MM-DD'));
      }
      const activated = student.activatedAt ?? student.createdAt;
      if (activated) {
        candidates.push(dayjs(activated).tz(tz).format('YYYY-MM-DD'));
      }
      const start = candidates.sort().at(-1) as string;
      if (!from || start < from) from = start;
    }

    const window = from
      ? {
          from,
          untilExclusive: dayjs(from).add(months, 'month').format('YYYY-MM-DD'),
        }
      : null;
    this.freeWindowCache.set(key, window);
    return window;
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

  /**
   * O'quvchining shu guruhdagi a'zolik oynasi (`joinedAt` … `leftAt`).
   *
   * Asosiy manba — `student_group_enrollments`: o'quvchi guruhdan chiqarilgan
   * bo'lsa ham oyna saqlanib qoladi, shuning uchun o'tgan oylar proratsiyasi
   * buzilmaydi va ketgan guruhning to'lovi qayta hisoblanganda to'liq oyga
   * qaytib ketmaydi.
   *
   * Oyna topilmasa (eski ma'lumot, migratsiyadan oldingi holat) —
   * `students_groups_groups.joinedAt` ga, u ham bo'lmasa eski xatti-harakatga
   * (activatedAt / group.startDate) qaytamiz.
   */
  private async resolveEnrollmentWindow(
    studentId: number,
    groupId: number,
    forMonth: string,
  ): Promise<{ joinedAt: string | null; leftAt: string | null }> {
    const window = await this.enrollmentsService.resolveWindowForMonth(
      studentId,
      groupId,
      forMonth,
    );
    if (window) return window;

    const legacy = await this.getLegacyJoinedAt(studentId, groupId);
    return { joinedAt: legacy, leftAt: null };
  }

  // (student, group) -> junction'dagi eski joinedAt keshi. Har bir billing
  // operatsiyasi boshida tozalanadi (discountCache bilan birga).
  private joinedAtCache = new Map<string, string | null>();

  private async getLegacyJoinedAt(
    studentId: number,
    groupId: number,
  ): Promise<string | null> {
    const key = `${studentId}:${groupId}`;
    const cached = this.joinedAtCache.get(key);
    if (cached !== undefined) return cached;

    let val: string | null = null;
    try {
      const rows = await this.dataSource.query(
        `SELECT "joinedAt" FROM "students_groups_groups"
          WHERE "studentsId" = $1 AND "groupsId" = $2 LIMIT 1`,
        [studentId, groupId],
      );
      const raw = rows?.[0]?.joinedAt ?? null;
      val = raw ? dayjs(raw).format('YYYY-MM-DD') : null;
    } catch {
      // joinedAt ustuni hali yo'q bo'lsa (migratsiya ishlamagan) — eski
      // xatti-harakat (proratsiya activatedAt/groupStart bo'yicha).
      val = null;
    }

    this.joinedAtCache.set(key, val);
    return val;
  }

  /** Ikki chegaradan ERTAROG'ini tanlaydi (ikkalasi ham bo'lmasa undefined). */
  private earliestDate(
    a?: string | null,
    b?: string | null,
  ): string | undefined {
    const values = [a, b].filter((v): v is string => Boolean(v));
    if (!values.length) return undefined;
    return values.sort()[0];
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
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();
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

      const studentActiveEndExclusive = this.resolveActiveEndExclusive({
        student: p.student,
        group: p.group,
        forMonth,
        plannedStudyUntilDate: p.plannedStudyUntilDate,
      });

      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive,
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
   * O'quvchi GURUHDAN chiqqanda o'sha guruhning to'lovlarini to'g'rilaydi:
   *  - chiqqan kungacha (exclusive) o'tgan darslar bo'yicha prorate;
   *  - birorta ham dars qolmasa va pul to'lanmagan bo'lsa — to'lov o'chiriladi;
   *  - kelajak oylar — billable = 0 bo'ladi -> o'chadi;
   *  - ortiqcha to'langan pul **bo'shatiladi**: `mode` ga qarab o'quvchiga
   *    qaytariladigan pul (`refund`) yoki boshqa guruhga ko'chiriladigan pul
   *    (`release`) bo'lib yoziladi.
   *
   * MUHIM: chiqish sanasi (`leftAt`) bu metod chaqirilishidan OLDIN
   * `student_group_enrollments` ga yozilgan bo'lishi kerak — proratsiya
   * chegarasi o'sha yerdan o'qiladi va keyingi qayta hisoblashlarda ham
   * saqlanib qoladi.
   *
   * @returns bo'shatilgan pul va ta'sirlangan to'lov qatorlari
   */
  async adjustPaymentsForStudentLeftGroup(
    studentId: number,
    groupId: number,
    opts?: { leftAt?: string; mode?: 'refund' | 'release' },
  ): Promise<{
    releasedAmount: number;
    /** Qaysi to'lov qatoridan qancha pul bo'shagani (qoldiqni qaytarish uchun). */
    released: Array<{ paymentId: number; amount: number }>;
  }> {
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();

    const mode = opts?.mode ?? 'refund';
    // Chiqish oyidan boshlab qayta hisoblaymiz. Sana berilmasa — joriy oy
    // (eski xatti-harakat: "bugun chiqdi").
    const fromMonth = dayjs(opts?.leftAt ?? undefined)
      .startOf('month')
      .format('YYYY-MM-01');

    const payments = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where('payments.studentId = :studentId', { studentId })
      .andWhere('payments.groupId = :groupId', { groupId })
      .andWhere('payments.forMonth >= :forMonth', { forMonth: fromMonth })
      .getMany();

    if (!payments.length) {
      return { releasedAmount: 0, released: [] };
    }

    const toSave: Payment[] = [];
    const toDeleteIds: number[] = [];
    const released: Array<{ paymentId: number; amount: number }> = [];
    let releasedAmount = 0;
    const withReceipts = await this.paymentIdsWithReceipts(
      payments.map((p) => p.id),
    );

    for (const p of payments as any[]) {
      if (!p.group || !p.student || !p.group.schedules?.length) continue;

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      // Chiqish chegarasini computeMonthBilling a'zolik oynasidan (leftAt)
      // o'zi oladi — bu yerda qo'shimcha chegara bermaymiz.
      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
        });

      const amountPaid = Number(p.amountPaid ?? 0);

      // Hech qanday to'lovga kiradigan dars qolmadi.
      if (!lessonsBillable) {
        if (amountPaid === 0 && !withReceipts.has(p.id)) {
          // Pul ham, chek ham yo'q -> to'lovni butunlay o'chiramiz.
          toDeleteIds.push(p.id);
        } else if (amountPaid === 0) {
          // Tasdiq kutayotgan chek bor: qator qoladi (qarz 0), chek
          // tasdiqlansa pul qaytariladigan bo'lib tushadi.
          p.amountDue = 0 as any;
          p.lessonsPlanned = lessonsPlanned;
          p.lessonsBillable = 0;
          p.lessonsExcused = lessonsExcused;
          p.status = PaymentStatus.PAID;
          toSave.push(p);
        } else {
          // Pul to'langan -> hammasi bo'shaydi, amountDue = 0.
          this.releaseMoneyFromPayment(p, amountPaid, mode);
          released.push({ paymentId: p.id, amount: amountPaid });
          releasedAmount = this.round2(releasedAmount + amountPaid);
          p.amountDue = 0 as any;
          p.amountPaid = 0 as any;
          p.lessonsPlanned = lessonsPlanned;
          p.lessonsBillable = 0;
          p.lessonsExcused = lessonsExcused;
          p.status = PaymentStatus.PAID; // 0 dan 0 -> to'liq yopilgan
          toSave.push(p);
        }
        continue;
      }

      // Aks holda: o'tgan darslar bo'yicha qayta prorate + ortiqchasini bo'shatish.
      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);
      let newPaid = amountPaid;
      if (newPaid > amountDue) {
        const excess = this.round2(newPaid - amountDue);
        this.releaseMoneyFromPayment(p, excess, mode);
        released.push({ paymentId: p.id, amount: excess });
        releasedAmount = this.round2(releasedAmount + excess);
        newPaid = amountDue;
      }

      let newStatus: PaymentStatus;
      if (newPaid >= amountDue) newStatus = PaymentStatus.PAID;
      else if (newPaid > 0) newStatus = PaymentStatus.PARTIAL;
      else newStatus = PaymentStatus.UNPAID;

      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = lessonsBillable;
      p.lessonsExcused = lessonsExcused;
      p.amountDue = amountDue as any;
      p.amountPaid = newPaid as any;
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

    return { releasedAmount, released };
  }

  /**
   * To'lov qatoridan pulni "bo'shatadi": `refund` — o'quvchiga qaytariladigan
   * pul, `release` — boshqa guruh to'loviga ko'chiriladigan pul. Ikkalasi
   * alohida ustunlarda saqlanadi, chunki birinchisida pul kassadan chiqadi,
   * ikkinchisida esa markazda qoladi.
   */
  private releaseMoneyFromPayment(
    payment: Payment,
    amount: number,
    mode: 'refund' | 'release',
  ) {
    if (amount <= 0) return;
    if (mode === 'refund') {
      payment.refundedAmount = this.round2(
        Number(payment.refundedAmount ?? 0) + amount,
      ) as any;
      payment.refundedAt = new Date() as any;
    } else {
      payment.transferredOutAmount = this.round2(
        Number(payment.transferredOutAmount ?? 0) + amount,
      ) as any;
    }
  }

  /**
   * Eski guruhdan bo'shatilgan pulni YANGI guruh to'lovlariga taqsimlaydi.
   * Eng eski to'lanmagan oydan boshlab yopiladi; har bir qism uchun tasdiqlangan
   * chek (`transferFromPaymentId` bilan) yoziladi, shunda pul qayerdan kelgani
   * chekda ham, tarixda ham ko'rinib turadi.
   *
   * Qabul qiluvchi komissiyasi hisoblanmaydi — kassaga yangi pul tushmagan.
   *
   * @returns qo'llangan summa va joy topilmay qolgan qoldiq
   */
  private async applyTransferredMoneyToGroup(args: {
    studentId: number;
    toGroupId: number;
    amount: number;
    fromPaymentId?: number | null;
    comment?: string | null;
    performedById?: number | null;
  }): Promise<{ applied: number; leftover: number }> {
    let remaining = this.round2(Math.max(0, Number(args.amount ?? 0)));
    if (remaining <= 0) return { applied: 0, leftover: 0 };

    const targets = await this.paymentRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.student', 'student')
      .where('p.studentId = :studentId', { studentId: args.studentId })
      .andWhere('p.groupId = :groupId', { groupId: args.toGroupId })
      .andWhere('p.status != :paid', { paid: PaymentStatus.PAID })
      .orderBy('p.forMonth', 'ASC')
      .getMany();

    let applied = 0;

    for (const target of targets) {
      if (remaining <= 0) break;
      const due = Number(target.amountDue ?? 0);
      const paid = Number(target.amountPaid ?? 0);
      const gap = this.round2(due - paid);
      if (gap <= 0) continue;

      const chunk = Math.min(gap, remaining);

      await this.createTransferReceipt({
        payment: target,
        amount: chunk,
        fromPaymentId: args.fromPaymentId ?? null,
        comment: args.comment ?? null,
        performedById: args.performedById ?? null,
      });

      await this.applyConfirmedMoneyToPayment({
        payment: target,
        addAmount: chunk,
        confirmedById: args.performedById ?? undefined,
      });

      applied = this.round2(applied + chunk);
      remaining = this.round2(remaining - chunk);
    }

    return { applied, leftover: remaining };
  }

  /** Ko'chirilgan pul uchun tasdiqlangan chek yozuvi. */
  private async createTransferReceipt(args: {
    payment: Payment;
    amount: number;
    fromPaymentId: number | null;
    comment: string | null;
    performedById: number | null;
  }): Promise<PaymentReceipt> {
    const { payment, amount } = args;

    const withStudent =
      payment.student ??
      (
        await this.paymentRepo.findOne({
          where: { id: payment.id },
          relations: ['student'],
        })
      )?.student;
    const centerId = withStudent?.centerId ?? null;

    const invoiceNo = await this.assignInvoiceNoIfNeeded(payment, centerId);

    const priorCount = await this.receiptRepo
      .createQueryBuilder('r')
      .where('r.paymentId = :paymentId', { paymentId: payment.id })
      .andWhere('r.status != :rejected', {
        rejected: PaymentReceiptStatus.REJECTED,
      })
      .getCount();
    const installmentIndex = priorCount + 1;

    const singleFull =
      installmentIndex === 1 &&
      this.round2(Number(payment.amountPaid ?? 0) + amount) >=
        this.round2(Number(payment.amountDue ?? 0));
    const checkNo = this.buildCheckNo(invoiceNo, installmentIndex, singleFull);
    const transactionNo = await this.generateTransactionNo();

    const balanceBefore = await this.getStudentTotalDebt(payment.studentId);
    const balanceAfter = this.round2(Math.max(0, balanceBefore - amount));

    return this.receiptRepo.save(
      this.receiptRepo.create({
        paymentId: payment.id,
        amount: this.round2(amount) as any,
        invoiceNo: invoiceNo as any,
        installmentIndex,
        checkNo,
        transactionNo,
        balanceBefore: balanceBefore as any,
        balanceAfter: balanceAfter as any,
        paidAt: null,
        receivedById: args.performedById,
        receivedAt: new Date(),
        status: PaymentReceiptStatus.CONFIRMED,
        confirmedById: args.performedById,
        confirmedAt: new Date(),
        comment: args.comment,
        paymentMethod: null,
        transferFromPaymentId: args.fromPaymentId,
        // Yangi pul tushmagani uchun qabul qiluvchi komissiyasi yo'q.
        receiverCommissionPercentSnapshot: 0 as any,
        receiverCommissionAmountSnapshot: 0 as any,
      }),
    );
  }

  /**
   * O'quvchini bir guruhdan boshqasiga ko'chirishdagi PUL qismi.
   *
   * 1) eski guruh to'lovlari `leftAt` gacha qayta hisoblanadi (ortiqcha pul
   *    bo'shatiladi, lekin kassadan chiqmaydi);
   * 2) yangi guruh uchun to'lov qatori yaratiladi (`joinedAt` dan prorate);
   * 3) bo'shagan pul yangi guruh to'loviga chek bilan o'tkaziladi;
   * 4) joy topilmagan qoldiq — o'quvchiga qaytariladigan pul sifatida eski
   *    to'lovda `refundedAmount` ga yoziladi.
   *
   * A'zolik oynalari (leftAt/joinedAt) bu metod chaqirilishidan OLDIN
   * yozilgan bo'lishi shart.
   */
  async settlePaymentsForTransfer(args: {
    studentId: number;
    fromGroupId: number;
    toGroupId: number;
    transferDate: string; // YYYY-MM-DD
    performedById?: number | null;
    comment?: string | null;
  }): Promise<{
    releasedAmount: number;
    carriedOverAmount: number;
    refundedAmount: number;
  }> {
    const { studentId, fromGroupId, toGroupId, transferDate } = args;

    const { releasedAmount, released } =
      await this.adjustPaymentsForStudentLeftGroup(studentId, fromGroupId, {
        leftAt: transferDate,
        mode: 'release',
      });

    // Yangi guruhning to'lov qatorlari. Oyna (`joinedAt`) tufayli qo'shilishdan
    // oldingi oylar uchun billable = 0 bo'ladi va qator yaratilmaydi — ya'ni
    // guruh 3 oy oldin boshlangan bo'lsa ham o'quvchiga eski oylar yozilmaydi.
    //
    // Oyna ko'chirish oyidan bugungacha bo'lishi kerak: ko'chirish orqaga
    // sanalangan bo'lsa (masalan "o'tgan oy o'tgan edi, endi kiritdik"),
    // oradagi oylar uchun ham to'lov yozilishi shart.
    const monthsSinceTransfer = dayjs()
      .startOf('month')
      .diff(dayjs(transferDate).startOf('month'), 'month');
    const maxMonthsBack = Math.min(24, Math.max(3, monthsSinceTransfer + 1));

    await this.ensurePaymentsForStudent(studentId, {
      onlyCurrentMonth: false,
      maxMonthsBack,
    });

    // Yangi guruhda shu oy uchun qator ALLAQACHON bo'lishi mumkin (o'quvchi
    // A→B→A qaytdi): ensurePayments mavjud qatorga tegmaydi, shuning uchun
    // yangi oyna bo'yicha majburan qayta hisoblaymiz.
    const transferMonth = dayjs(transferDate)
      .startOf('month')
      .format('YYYY-MM-01');
    this.enrollmentsService.clearCache();
    const targetRows = await this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where('payments.studentId = :studentId', { studentId })
      .andWhere('payments.groupId = :toGroupId', { toGroupId })
      .andWhere('payments.forMonth >= :transferMonth', { transferMonth })
      .getMany();
    await this.recalcOpenPaymentRows(targetRows, { force: true });

    if (releasedAmount <= 0) {
      return { releasedAmount: 0, carriedOverAmount: 0, refundedAmount: 0 };
    }

    const { applied, leftover } = await this.applyTransferredMoneyToGroup({
      studentId,
      toGroupId,
      amount: releasedAmount,
      fromPaymentId: released[0]?.paymentId ?? null,
      comment: args.comment ?? null,
      performedById: args.performedById ?? null,
    });

    // Yangi guruhda yopadigan qarz qolmadi -> qolgan pul o'quvchining haqi
    // bo'lib qoladi (naqd qaytariladi). Uni qaysi qatordan chiqqan bo'lsa
    // o'shanga, oxirgisidan boshlab qaytarib yozamiz.
    let toRefund = leftover;
    for (let i = released.length - 1; i >= 0 && toRefund > 0; i--) {
      const { paymentId, amount } = released[i];
      const part = Math.min(amount, toRefund);
      const source = await this.paymentRepo.findOne({
        where: { id: paymentId },
      });
      if (!source) continue;
      source.transferredOutAmount = this.round2(
        Math.max(0, Number(source.transferredOutAmount ?? 0) - part),
      ) as any;
      source.refundedAmount = this.round2(
        Number(source.refundedAmount ?? 0) + part,
      ) as any;
      source.refundedAt = new Date() as any;
      await this.paymentRepo.save(source);
      toRefund = this.round2(toRefund - part);
    }

    return {
      releasedAmount,
      carriedOverAmount: applied,
      refundedAmount: leftover,
    };
  }

  private computeAmountDue(args: {
    /** Shu oy uchun amaldagi shaxsiy narx (`resolvePersonalFeeForMonth`). */
    personalFee: number;
    /** Shu oy uchun amaldagi GURUH narxi (`resolveGroupFeeForMonth`). */
    groupFee: number;
    lessonsPlanned: number;
    lessonsBillable: number;
    /** Pauza sabab o'tmagan darslar — "to'liq oy" hisobiga kiradi. */
    lessonsPaused?: number;
    discountPercent: number;
    /** Summadagi chegirma (so'm/oy) — faqat to'liq oyga qo'llanadi. */
    discountAmount?: number;
    manualExcludedAmount?: number;
  }): number {
    const {
      personalFee,
      groupFee,
      lessonsPlanned,
      lessonsBillable,
      lessonsPaused = 0,
      discountPercent,
      discountAmount = 0,
      manualExcludedAmount = 0,
    } = args;
    // Narx ustunligi:
    // - o'quvchining shaxsiy narxi bo'lsa (> 0) -> o'sha ishlatiladi va
    //   guruh narxi o'zgarsa ham bu o'quvchiga umuman ta'sir qilmaydi;
    // - aks holda -> shu OY uchun amaldagi guruh narxi.
    const studentFee = Number(personalFee ?? 0);
    const baseMonthlyFee = studentFee > 0 ? studentFee : Number(groupFee ?? 0);
    if (!lessonsPlanned) return 0;

    // Apply discount AFTER lesson-based prorating
    const proratedFee = baseMonthlyFee * (lessonsBillable / lessonsPlanned);
    const discountedFee = proratedFee * (1 - discountPercent / 100);
    // Summadagi chegirma (masalan oyiga 20 000) faqat TO'LIQ oyga: o'quvchi oy
    // o'rtasida qo'shilgan (yoki chiqqan) bo'lsa, chegirma keyingi oydan boshlanadi.
    // Guruh pauzasi o'quvchini "oy o'rtasida qo'shilgan" qilmaydi.
    const fullMonth = lessonsBillable + lessonsPaused >= lessonsPlanned;
    const amountOff = fullMonth ? Math.max(0, Number(discountAmount)) : 0;
    // Reception qo'lda chiqarib tashlagan summani oxirida ayiramiz.
    const finalFee =
      discountedFee - amountOff - Math.max(0, Number(manualExcludedAmount));
    return this.round2(Math.max(0, finalFee));
  }

  /**
   * Oy ichida to'lov hisoblanadigan chegara (exclusive): o'quvchi to'xtatilgan
   * sana (stoppedAt) va "shu sanagacha o'qiyman" (plannedStudyUntilDate) —
   * qaysi biri erta bo'lsa o'sha. Ikkalasi ham bo'lmasa undefined.
   */
  private resolveActiveEndExclusive(args: {
    student: Student;
    group: Group;
    forMonth: string;
    plannedStudyUntilDate?: Date | string | null;
  }): string | undefined {
    const { student, group, forMonth, plannedStudyUntilDate } = args;

    const stoppedBoundary = this.computeStudentActiveEndExclusiveForMonth({
      student,
      group,
      forMonth,
    });
    const plannedBoundary = plannedStudyUntilDate
      ? dayjs(plannedStudyUntilDate).add(1, 'day').format('YYYY-MM-DD')
      : null;

    const candidates = [stoppedBoundary, plannedBoundary].filter(
      (v): v is string => Boolean(v),
    );
    if (!candidates.length) return undefined;
    return candidates.sort()[0];
  }

  /**
   * Rad etilmagan (pending yoki confirmed) cheki bor to'lov qatorlari.
   * Bunday qator HECH QACHON o'chirilmaydi: chek `ON DELETE CASCADE` bilan
   * birga o'chib ketardi va xodim qabul qilgan naqd pulning izi qolmasdi.
   */
  private async paymentIdsWithReceipts(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await this.receiptRepo
      .createQueryBuilder('r')
      .select('DISTINCT r.paymentId', 'paymentId')
      .where('r.paymentId IN (:...ids)', { ids })
      .andWhere('r.status != :rejected', {
        rejected: PaymentReceiptStatus.REJECTED,
      })
      .getRawMany<{ paymentId: number }>();
    return new Set(rows.map((r) => Number(r.paymentId)));
  }

  /**
   * To'lov qatorlarini qayta hisoblaydi.
   * - dars qolmagan oylar (guruh tugagan, o'quvchi chiqib ketgan) o'chiriladi,
   *   agar ular bo'yicha pul ham, cheki ham bo'lmasa; pul to'langan bo'lsa
   *   qarz 0 ga tushadi va pul `refundedAmount` ga o'tadi;
   * - qolganlari joriy sana/jadval/narx/chegirma bo'yicha yangilanadi;
   *   yangi qarz to'langan puldan kam bo'lsa farq `refundedAmount` ga
   *   yoziladi (jimgina kesib tashlanmaydi).
   * - PAID qatorlar (faqat `includePaid` bilan keladi) faqat dars soni
   *   KAMAYGANDA qayta hisoblanadi (guruh erta yopildi) — narx/chegirma
   *   o'zgarishi to'liq to'langan oyga tegmaydi.
   */
  private async recalcOpenPaymentRows(
    payments: Payment[],
    opts?: { force?: boolean },
  ) {
    if (!payments.length) return;

    const toSave: Payment[] = [];
    const toDeleteIds: number[] = [];
    const withReceipts = await this.paymentIdsWithReceipts(
      payments.map((p) => p.id),
    );

    // O'qilgan paytdagi pul holati — saqlashda solishtiriladi (parallel
    // tasdiqlangan chekni ustidan yozib yubormaslik uchun).
    const readMoney = new Map<number, { paid: number; refunded: number }>();
    const snapshot = (p: any) =>
      [
        Number(p.amountDue ?? 0),
        Number(p.amountPaid ?? 0),
        Number(p.refundedAmount ?? 0),
        p.lessonsPlanned ?? null,
        p.lessonsBillable ?? null,
        p.lessonsExcused ?? null,
        p.status,
        p.dueDate ? dayjs(p.dueDate).format('YYYY-MM-DD') : null,
        p.hardDueDate ? dayjs(p.hardDueDate).format('YYYY-MM-DD') : null,
      ].join('|');
    const before = new Map<number, string>();

    for (const p of payments as any[]) {
      if (!p.group || !p.student) continue;
      if (!p.group.schedules?.length) continue;
      readMoney.set(p.id, {
        paid: Number(p.amountPaid ?? 0),
        refunded: Number(p.refundedAmount ?? 0),
      });
      before.set(p.id, snapshot(p));

      const timezone = p.group.timezone || 'Asia/Tashkent';
      const forMonth = dayjs(p.forMonth).startOf('month').format('YYYY-MM-01');

      const studentActiveEndExclusive = this.resolveActiveEndExclusive({
        student: p.student,
        group: p.group,
        forMonth,
        plannedStudyUntilDate: p.plannedStudyUntilDate,
      });

      const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
        await this.computeMonthBilling({
          student: p.student,
          group: p.group,
          forMonth,
          studentActiveEndExclusive,
          manualExcludedAmount: Number(p.manualExcludedAmount ?? 0),
        });

      const wasPaid = p.status === PaymentStatus.PAID;
      if (
        wasPaid &&
        !opts?.force &&
        !(lessonsBillable < Number(p.lessonsBillable ?? lessonsBillable))
      ) {
        continue;
      }

      const amountPaid = Number(p.amountPaid ?? 0);
      const noLessons = !lessonsPlanned || !lessonsBillable;

      if (noLessons && amountPaid === 0 && !withReceipts.has(p.id)) {
        // Keraksiz nol qator — o'chiramiz.
        toDeleteIds.push(p.id);
        continue;
      }

      const newDue = noLessons ? 0 : amountDue;
      let newAmountPaid = amountPaid;
      if (newAmountPaid > newDue) {
        this.releaseMoneyFromPayment(
          p,
          this.round2(newAmountPaid - newDue),
          'refund',
        );
        newAmountPaid = newDue;
      } else if (newAmountPaid < newDue && Number(p.refundedAmount ?? 0) > 0) {
        // Qarz qayta oshdi (pauza bekor qilindi, tugash sanasi uzaytirildi,
        // xato tuzatildi): shu oy uchun avval "qaytariladigan" deb yozilgan pul
        // o'quvchining haqi sifatida shu qarzni yopishga qaytadi — aks holda
        // o'quvchi ham qarzdor, ham qaytariladigan pulga ega bo'lib qolardi.
        const reclaim = this.round2(
          Math.min(Number(p.refundedAmount ?? 0), newDue - newAmountPaid),
        );
        newAmountPaid = this.round2(newAmountPaid + reclaim);
        p.refundedAmount = this.round2(
          Number(p.refundedAmount ?? 0) - reclaim,
        ) as any;
        if (Number(p.refundedAmount) <= 0) p.refundedAt = null;
      }

      const { dueDate, hardDueDate } = this.computeDueDates(forMonth, timezone);
      p.lessonsPlanned = lessonsPlanned;
      p.lessonsBillable = noLessons ? 0 : lessonsBillable;
      p.lessonsExcused = lessonsExcused;
      p.amountDue = newDue as any;
      p.amountPaid = newAmountPaid as any;
      p.status = this.statusFor(newAmountPaid, newDue);
      p.dueDate = dueDate as any;
      p.hardDueDate = hardDueDate as any;

      // O'zgarmagan qator saqlanmaydi (ro'yxat har ochilganda minglab
      // keraksiz UPDATE bo'lmasligi uchun).
      if (snapshot(p) !== before.get(p.id)) toSave.push(p);
    }

    if (toDeleteIds.length) {
      // O'chirish paytida ham shart qayta tekshiriladi: shu orada pul yoki
      // chek tushgan bo'lsa qator qoladi.
      await this.paymentRepo
        .createQueryBuilder()
        .delete()
        .from(Payment)
        .where('id IN (:...ids)', { ids: toDeleteIds })
        .andWhere('"amountPaid" = 0')
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM payment_receipts r
                        WHERE r."paymentId" = payments.id AND r.status != :rejected)`,
          { rejected: PaymentReceiptStatus.REJECTED },
        )
        .execute();
    }

    // Pul o'zgargan (guruh, oy) juftliklari — komissiya har biri uchun BIR
    // marta va ketma-ket qayta hisoblanadi (parallel yuzlab hisob pg pool'ni
    // to'ldirib, carryover'ni ikki marta yozishi mumkin edi).
    const earningsKeys = new Set<string>();
    for (const p of toSave as any[]) {
      const read = readMoney.get(p.id)!;
      const saved = await this.dataSource.transaction(async (m) => {
        const locked = await m
          .getRepository(Payment)
          .createQueryBuilder('x')
          .setLock('pessimistic_write')
          .where('x.id = :id', { id: p.id })
          .getOne();
        if (!locked) return false;
        // Shu orada chek tasdiqlangan / pul qaytarilgan — hisob eskirgan,
        // tegmaymiz (keyingi qayta hisoblash yangi holatdan qiladi).
        if (
          Number(locked.amountPaid ?? 0) !== read.paid ||
          Number(locked.refundedAmount ?? 0) !== read.refunded
        ) {
          return false;
        }
        await m.getRepository(Payment).update(p.id, {
          lessonsPlanned: p.lessonsPlanned,
          lessonsBillable: p.lessonsBillable,
          lessonsExcused: p.lessonsExcused,
          amountDue: p.amountDue,
          amountPaid: p.amountPaid,
          refundedAmount: p.refundedAmount,
          refundedAt: p.refundedAt ?? null,
          status: p.status,
          dueDate: p.dueDate,
          hardDueDate: p.hardDueDate,
        } as any);
        return true;
      });
      if (saved && Number(p.amountPaid ?? 0) !== read.paid && p.groupId) {
        earningsKeys.add(
          `${p.groupId}|${dayjs(p.forMonth).format('YYYY-MM-01')}`,
        );
      }
    }
    if (earningsKeys.size) {
      void (async () => {
        for (const key of earningsKeys) {
          const [gid, month] = key.split('|');
          await this.recalcTeacherEarningsForGroupMonth(
            Number(gid),
            month,
          ).catch(() => undefined);
        }
      })();
    }
  }

  /** Qayta hisoblash uchun ochiq to'lovlar oynasi (oxirgi N oy). */
  private openPaymentsWindow(maxMonthsBack?: number): {
    windowStart: string;
    windowEnd: string;
  } {
    const months = Math.max(1, maxMonthsBack ?? 3);
    return {
      windowStart: dayjs()
        .startOf('month')
        .subtract(months - 1, 'month')
        .format('YYYY-MM-01'),
      windowEnd: dayjs().startOf('month').format('YYYY-MM-01'),
    };
  }

  private openPaymentsQuery(maxMonthsBack?: number, includePaid = false) {
    const { windowStart, windowEnd } = this.openPaymentsWindow(maxMonthsBack);
    return this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .where(includePaid ? '1=1' : 'payments.status != :paid', {
        paid: PaymentStatus.PAID,
      })
      .andWhere('payments.forMonth BETWEEN :windowStart AND :windowEnd', {
        windowStart,
        windowEnd,
      });
  }

  /**
   * Recalculate open payments (UNPAID/PARTIAL) when pricing/date inputs change:
   * - student.monthlyFee / group.monthlyFee
   * - student.discountPercent
   * - guruh tugash sanasi / jadvali
   *
   * Bound to a small window for safety (default: last 3 months).
   * PAID payments are never changed.
   */
  async recalculateOpenPaymentsForOrganization(
    organizationId: number,
    opts?: { maxMonthsBack?: number; centerId?: number },
  ) {
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();

    const payments = await this.openPaymentsQuery(opts?.maxMonthsBack)
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .andWhere('organization.id = :organizationId', { organizationId })
      .andWhere(opts?.centerId ? 'center.id = :centerId' : '1=1', {
        centerId: opts?.centerId,
      })
      .getMany();

    await this.recalcOpenPaymentRows(payments);
  }

  /**
   * Guruhning ochiq to'lovlarini qayta hisoblaydi. Guruh tugash sanasi,
   * jadvali yoki narxi o'zgarganda chaqiriladi: tugash sanasidan keyingi
   * oylarning to'lanmagan to'lovlari o'chadi, guruh oy o'rtasida tugagan
   * bo'lsa o'sha oy faqat haqiqiy dars kunlari bo'yicha hisoblanadi.
   */
  async recalculateOpenPaymentsForGroup(
    groupId: number,
    opts?: { maxMonthsBack?: number; includePaid?: boolean; force?: boolean },
  ) {
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();

    // `includePaid` — guruh erta yopilganda / tugash sanasi oldinga
    // tortilganda: to'liq to'langan oylar ham o'tmagan darslar uchun
    // qaytariladigan pul bilan to'g'rilanadi.
    const payments = await this.openPaymentsQuery(
      opts?.maxMonthsBack,
      opts?.includePaid ?? false,
    )
      .andWhere('payments.groupId = :groupId', { groupId })
      .getMany();

    await this.recalcOpenPaymentRows(payments, { force: opts?.force });
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
    opts: { onlyCurrentMonth: boolean; maxMonthsBack?: number } = {
      onlyCurrentMonth: false,
    },
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
   * Recalculate open payments for a specific student (used when discount
   * periods or the student's groups change). PAID payments are never modified.
   */
  async recalculateOpenPaymentsForStudent(
    studentId: number,
    opts?: { maxMonthsBack?: number; includePaid?: boolean; force?: boolean },
  ) {
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();

    const payments = await this.openPaymentsQuery(
      opts?.maxMonthsBack,
      opts?.includePaid ?? false,
    )
      .andWhere('payments.studentId = :studentId', { studentId })
      .getMany();

    await this.recalcOpenPaymentRows(payments, { force: opts?.force });
  }

  /**
   * Davomat o'zgargandan keyin (student, group, oy) qatorini yangilaydi.
   *
   * Sababli dars ham, kelmagan dars ham to'lovni KAMAYTIRMAYDI (Req1) —
   * shuning uchun bu yerda summa qayta hisoblanmaydi, faqat ma'lumot uchun
   * `lessonsExcused` yangilanadi. Ilgari bu metod butun qatorni (PAID ham)
   * bugungi narx/oyna bilan qayta hisoblardi: o'tgan oyning davomati
   * tuzatilsa, to'langan oy "qaytariladigan pul"ga aylanib ketishi mumkin edi.
   */
  async recalcPaymentForAttendanceChange(
    studentId: number,
    groupId: number,
    forMonthInput: string, // any date within the month
  ): Promise<void> {
    const forMonth = dayjs(forMonthInput).startOf('month').format('YYYY-MM-01');

    let payment = await this.paymentRepo.findOne({
      where: {
        studentId,
        groupId: groupId as any,
        forMonth: forMonth as any,
      },
    });

    // Qator hali yo'q bo'lsa (davomat to'lovlardan oldin yozildi) — yaratamiz.
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
      });
    }
    if (!payment) return;

    const excused = await this.attendanceRepo
      .createQueryBuilder('a')
      .where('a.groupId = :groupId', { groupId })
      .andWhere('a.studentId = :studentId', { studentId })
      .andWhere('a.status = :status', { status: AttendanceStatus.EXCUSED })
      .andWhere("TO_CHAR(a.lessonDate, 'YYYY-MM-01') = :forMonth", {
        forMonth,
      })
      .getCount();

    if (Number(payment.lessonsExcused ?? 0) !== excused) {
      await this.paymentRepo.update(payment.id, { lessonsExcused: excused });
    }
  }

  private async ensurePaymentsForStudents(
    students: Student[],
    opts: { onlyCurrentMonth: boolean; maxMonthsBack?: number },
  ) {
    if (!students.length) return;
    this.resetBillingCaches();
    this.joinedAtCache.clear();
    this.enrollmentsService.clearCache();

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

          // Bitta o'quvchidagi xato (masalan buzuq ma'lumot) butun
          // tashkilotning oylik to'lovlarini to'xtatib qo'ymasligi kerak.
          let billing: Awaited<ReturnType<typeof this.computeMonthBilling>>;
          try {
            billing = await this.computeMonthBilling({
              student,
              group,
              forMonth,
            });
          } catch (e) {
            this.logger.error(
              `ensurePayments: student=${student.id} group=${group.id} oy=${forMonth}: ${
                (e as any)?.message ?? e
              }`,
            );
            cursor = cursor.add(1, 'month');
            continue;
          }
          const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
            billing;

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

    // Faqat qo'shish: parallel so'rov shu qatorni allaqachon yaratgan bo'lsa
    // `ON CONFLICT DO NOTHING` uni o'tkazib yuboradi. Ilgari bitta unique
    // to'qnashuv butun to'plamni (boshqa o'quvchilarnikini ham) bekor qilardi.
    const rows = toCreate;
    for (let i = 0; i < rows.length; i += 500) {
      await this.paymentRepo
        .createQueryBuilder()
        .insert()
        .into(Payment)
        .values(rows.slice(i, i + 500) as any)
        .orIgnore()
        .execute();
    }
  }

  private resolvePaymentsScope(
    centerId: number | undefined,
    currentUser: CurrentUser,
  ): { isAdmin: boolean; effectiveCenterId?: number } {
    const isAdmin =
      currentUser.role === UserRole.ADMIN ||
      currentUser.role === UserRole.SUPER_ADMIN;

    return {
      isAdmin,
      effectiveCenterId:
        centerId ?? (!isAdmin ? currentUser.centerId : undefined),
    };
  }

  /**
   * ACTIVE o'quvchilar uchun yetishmayotgan oylik to'lovlarni yaratadi
   * (ro'yxat ham, excel export ham shu holatdan o'qiydi).
   */
  private async ensurePaymentsBeforeListing(
    organizationId: number,
    effectiveCenterId?: number,
  ) {
    try {
      await this.ensurePaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
        centerId: effectiveCenterId,
      });
      // Mavjud ochiq to'lovlarni ham yangilaymiz: guruh tugash sanasi,
      // jadvali yoki narxi o'zgargan bo'lsa summalar eskirib qolmasin.
      await this.recalculateOpenPaymentsForOrganization(organizationId, {
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
  }

  /**
   * dateFrom/dateTo ni to'lov oyi (forMonth) bilan solishtirish uchun
   * oy boshiga keltiradi. Ikkalasi ham ixtiyoriy — faqat biri berilsa
   * bir tomonlama (>= yoki <=) filter bo'ladi.
   */
  private normalizePeriodRange(
    dateFrom?: string,
    dateTo?: string,
  ): { from?: string; to?: string } {
    const toMonthStart = (value: string, label: string) => {
      const trimmed = value.trim();
      // YYYY-MM ham, YYYY-MM-DD ham qabul qilinadi
      const parsed = /^\d{4}-\d{2}$/.test(trimmed)
        ? dayjs(`${trimmed}-01`)
        : dayjs(trimmed);

      if (!parsed.isValid()) {
        throw new BadRequestException(
          `${label} noto'g'ri formatda. YYYY-MM-DD yoki YYYY-MM kutilmoqda.`,
        );
      }

      return parsed.startOf('month').format('YYYY-MM-01');
    };

    const from = dateFrom?.trim()
      ? toMonthStart(dateFrom, 'dateFrom')
      : undefined;
    const to = dateTo?.trim() ? toMonthStart(dateTo, 'dateTo') : undefined;

    if (from && to && from > to) {
      throw new BadRequestException(
        "dateFrom dateTo dan katta bo'lishi mumkin emas",
      );
    }

    return { from, to };
  }

  /**
   * GET /payments va GET /payments/export uchun umumiy filter query'si.
   * Ikkalasi bir xil natijani ko'rishi uchun faqat shu yerda quriladi.
   */
  private buildPaymentsListQuery(
    organizationId: number,
    {
      status,
      forMonth,
      overdueOnly,
      studentId,
      groupId,
      teacherId,
      search,
      dateFrom,
      dateTo,
    }: PaymentListFilters,
    {
      isAdmin,
      effectiveCenterId,
    }: { isAdmin: boolean; effectiveCenterId?: number },
  ) {
    const query = this.paymentRepo
      .createQueryBuilder('payments')
      .leftJoinAndSelect('payments.student', 'student')
      .leftJoinAndSelect('payments.group', 'group')
      .leftJoinAndSelect('group.teacher', 'teacher')
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

    if (teacherId) {
      query.andWhere('teacher.id = :teacherId', { teacherId });
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

    // Oraliq bo'yicha filter: to'lov OYI (forMonth) oraliqqa tushsa oladi.
    // Sana oy o'rtasi bo'lsa ham o'sha oy to'liq kiradi
    // (masalan dateFrom=2026-01-15 => yanvar oyi ham chiqadi).
    const { from, to } = this.normalizePeriodRange(dateFrom, dateTo);

    if (from) {
      query.andWhere('payments.forMonth >= :periodFrom', { periodFrom: from });
    }

    if (to) {
      query.andWhere('payments.forMonth <= :periodTo', { periodTo: to });
    }

    return query.orderBy('payments.createdAt', 'DESC');
  }

  /**
   * Ro'yxatdagi to'lovlarga hisoblangan maydonlarni qo'shadi
   * (overdue, remaining, pending receipts, discount breakdown).
   */
  private async enrichPayments(data: Payment[]) {
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
    return Promise.all(
      data.map(async (p: any) => {
        const timezone = p.group?.timezone || 'Asia/Tashkent';
        const today = dayjs().tz(timezone).format('YYYY-MM-DD');
        const hardDue = p.hardDueDate
          ? dayjs(p.hardDueDate).format('YYYY-MM-DD')
          : null;
        const isOverdue =
          !!hardDue && today > hardDue && p.status !== PaymentStatus.PAID;

        const pending = pendingByPaymentId.get(Number(p.id)) ?? {
          pendingAmount: 0,
          pendingReceiptsCount: 0,
        };

        const amountDue = Number(p.amountDue ?? 0);
        const amountPaid = Number(p.amountPaid ?? 0);
        // Kassa qarzi: faqat TASDIQLANGAN pul ayiriladi.
        const remainingAmount = this.round2(amountDue - amountPaid);
        // O'quvchi haqiqatda topshirgan pul (tasdiqlangan + reception qo'lidagi).
        const receivedAmount = this.round2(amountPaid + pending.pendingAmount);
        // O'quvchidan hali olinishi kerak bo'lgan summa.
        const payableNow = this.round2(Math.max(0, amountDue - receivedAmount));

        const paymentForMonth = p.forMonth
          ? dayjs(p.forMonth).startOf('month').format('YYYY-MM-01')
          : null;
        const discount =
          p.student && paymentForMonth
            ? await this.resolveDiscountForMonth({
                student: p.student,
                forMonth: paymentForMonth,
                groupId: p.groupId,
              })
            : { percent: 0, amount: 0, breakdown: [] };

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
          receivedAmount,
          payableNow,
          refundedAmount: Number((p as any).refundedAmount ?? 0),
          pendingAmount: pending.pendingAmount,
          hasPendingReceipt: pending.pendingReceiptsCount > 0,
          pendingReceiptsCount: pending.pendingReceiptsCount,
          discountPercentApplied: discount.percent,
          discountAmountApplied: discount.amount,
          discountBreakdown: discount.breakdown,
          lessonsPlanned: p.lessonsPlanned ?? 0,
          lessonsBillable: p.lessonsBillable ?? 0,
          lessonsExcused: p.lessonsExcused ?? 0,
        };
      }),
    );
  }

  async findAll(
    organizationId: number,
    {
      page,
      perPage,
      ...filters
    }: PaymentListFilters & {
      page: number;
      perPage: number;
    },
    currentUser: CurrentUser,
  ) {
    const scope = this.resolvePaymentsScope(filters.centerId, currentUser);

    await this.ensurePaymentsBeforeListing(
      organizationId,
      scope.effectiveCenterId,
    );

    const skip = (page - 1) * perPage;
    const [data, total] = await this.buildPaymentsListQuery(
      organizationId,
      filters,
      scope,
    )
      .skip(skip)
      .take(perPage)
      .getManyAndCount();

    const enriched = await this.enrichPayments(data);

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

  /**
   * 📊 Filterlangan to'lovlarni Excel (.xlsx) fayl sifatida qaytaradi.
   * Filterlar GET /payments bilan bir xil, ya'ni frontend qanday ko'rsatsa,
   * export ham aynan shu ro'yxatni beradi (paginatsiyasiz — barcha natijalar).
   */
  async exportToExcel(
    organizationId: number,
    filters: PaymentListFilters,
    currentUser: CurrentUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const scope = this.resolvePaymentsScope(filters.centerId, currentUser);

    await this.ensurePaymentsBeforeListing(
      organizationId,
      scope.effectiveCenterId,
    );

    const data = await this.buildPaymentsListQuery(
      organizationId,
      filters,
      scope,
    ).getMany();

    const rows = await this.enrichPayments(data);

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("To'lovlar", {
      views: [{ state: 'frozen', ySplit: 3 }],
    });

    const columns = [
      { header: '№', key: 'no', width: 6 },
      { header: "O'quvchi", key: 'student', width: 28 },
      { header: 'Telefon', key: 'phone', width: 16 },
      { header: 'Guruh', key: 'group', width: 24 },
      { header: "O'qituvchi", key: 'teacher', width: 24 },
      { header: 'Oy', key: 'forMonth', width: 10 },
      { header: 'Chegirma %', key: 'discount', width: 12 },
      { header: "To'lanishi kerak", key: 'amountDue', width: 18 },
      { header: "To'langan", key: 'amountPaid', width: 16 },
      { header: 'Tasdiq kutilmoqda', key: 'pendingAmount', width: 18 },
      { header: 'Qaytarilgan', key: 'refundedAmount', width: 16 },
      { header: 'Qoldiq', key: 'remainingAmount', width: 16 },
      { header: 'Holat', key: 'status', width: 18 },
      { header: "To'lov muddati", key: 'hardDueDate', width: 16 },
      { header: 'Kechikkan', key: 'isOverdue', width: 12 },
    ];
    sheet.columns = columns;

    // 1-qator: sarlavha, 2-qator: qo'llanilgan filterlar
    sheet.spliceRows(1, 0, [], []);

    const titleRow = sheet.getRow(1);
    titleRow.getCell(1).value = "To'lovlar ro'yxati";
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells(1, 1, 1, columns.length);

    const filterRow = sheet.getRow(2);
    filterRow.getCell(1).value = this.describePaymentFilters(filters, rows);
    filterRow.getCell(1).font = {
      italic: true,
      size: 10,
      color: { argb: 'FF666666' },
    };
    sheet.mergeCells(2, 1, 2, columns.length);

    const headerRow = sheet.getRow(3);
    headerRow.font = { bold: true };
    headerRow.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' },
      };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
    });

    rows.forEach((p: any, index: number) => {
      sheet.addRow({
        no: index + 1,
        student: [p.student?.firstName, p.student?.lastName]
          .filter(Boolean)
          .join(' '),
        phone: p.student?.phone ?? '',
        group: p.group?.name ?? '',
        teacher: p.group?.teacher
          ? [p.group.teacher.firstName, p.group.teacher.lastName]
              .filter(Boolean)
              .join(' ')
          : '',
        forMonth: p.forMonth ? dayjs(p.forMonth).format('YYYY-MM') : '',
        discount: Number(p.discountPercentApplied ?? 0),
        amountDue: Number(p.amountDue ?? 0),
        amountPaid: Number(p.amountPaid ?? 0),
        pendingAmount: Number(p.pendingAmount ?? 0),
        refundedAmount: Number(p.refundedAmount ?? 0),
        remainingAmount: Number(p.remainingAmount ?? 0),
        status: PAYMENT_STATUS_LABELS[p.status as PaymentStatus] ?? p.status,
        hardDueDate: p.hardDueDate ?? '',
        isOverdue: p.isOverdue ? 'Ha' : "Yo'q",
      });
    });

    // Jami qatori
    const totalRow = sheet.addRow({
      student: 'JAMI',
      amountDue: rows.reduce(
        (a: number, p: any) => a + Number(p.amountDue ?? 0),
        0,
      ),
      amountPaid: rows.reduce(
        (a: number, p: any) => a + Number(p.amountPaid ?? 0),
        0,
      ),
      pendingAmount: rows.reduce(
        (a: number, p: any) => a + Number(p.pendingAmount ?? 0),
        0,
      ),
      refundedAmount: rows.reduce(
        (a: number, p: any) => a + Number(p.refundedAmount ?? 0),
        0,
      ),
      remainingAmount: rows.reduce(
        (a: number, p: any) => a + Number(p.remainingAmount ?? 0),
        0,
      ),
    });
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
    });

    // Pul ustunlariga format
    for (const key of [
      'amountDue',
      'amountPaid',
      'pendingAmount',
      'refundedAmount',
      'remainingAmount',
    ]) {
      sheet.getColumn(key).numFmt = '#,##0';
    }

    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    return {
      buffer: Buffer.from(buffer),
      fileName: this.buildPaymentsExportFileName(filters),
    };
  }

  /**
   * Excel'ning 2-qatoriga yoziladigan "qo'llanilgan filterlar" matni.
   */
  private describePaymentFilters(
    filters: PaymentListFilters,
    rows: any[],
  ): string {
    const parts: string[] = [];

    if (filters.forMonth) parts.push(`Oy: ${filters.forMonth}`);

    if (filters.dateFrom || filters.dateTo) {
      const { from, to } = this.normalizePeriodRange(
        filters.dateFrom,
        filters.dateTo,
      );
      const fromLabel = from ? dayjs(from).format('YYYY-MM') : null;
      const toLabel = to ? dayjs(to).format('YYYY-MM') : null;

      if (fromLabel && toLabel) {
        parts.push(`Oraliq: ${fromLabel} — ${toLabel}`);
      } else if (fromLabel) {
        parts.push(`Oraliq: ${fromLabel} dan boshlab`);
      } else {
        parts.push(`Oraliq: ${toLabel} gacha`);
      }
    }

    if (filters.teacherId) {
      const teacher = rows.find(
        (p: any) => Number(p.group?.teacher?.id) === Number(filters.teacherId),
      )?.group?.teacher;
      parts.push(
        `O'qituvchi: ${
          teacher
            ? [teacher.firstName, teacher.lastName].filter(Boolean).join(' ')
            : `#${filters.teacherId}`
        }`,
      );
    }

    if (filters.groupId) {
      const group = rows.find(
        (p: any) => Number(p.group?.id) === Number(filters.groupId),
      )?.group;
      parts.push(`Guruh: ${group?.name ?? `#${filters.groupId}`}`);
    }

    if (filters.studentId) {
      const student = rows.find(
        (p: any) => Number(p.student?.id) === Number(filters.studentId),
      )?.student;
      parts.push(
        `O'quvchi: ${
          student
            ? [student.firstName, student.lastName].filter(Boolean).join(' ')
            : `#${filters.studentId}`
        }`,
      );
    }

    if (filters.status) {
      parts.push(
        `Holat: ${PAYMENT_STATUS_LABELS[filters.status] ?? filters.status}`,
      );
    }

    if (filters.overdueOnly) parts.push('Faqat kechikkanlar');
    if (filters.search?.trim())
      parts.push(`Qidiruv: "${filters.search.trim()}"`);

    const applied = parts.length ? parts.join(' | ') : 'Filtersiz (barchasi)';

    return `${applied} — ${rows.length} ta yozuv, yuklandi: ${dayjs().format('YYYY-MM-DD HH:mm')}`;
  }

  private buildPaymentsExportFileName(filters: PaymentListFilters): string {
    const parts = ['tolovlar'];
    if (filters.forMonth) parts.push(filters.forMonth);

    if (filters.dateFrom || filters.dateTo) {
      const { from, to } = this.normalizePeriodRange(
        filters.dateFrom,
        filters.dateTo,
      );
      parts.push(
        `${from ? dayjs(from).format('YYYY-MM') : 'boshidan'}-dan_${
          to ? dayjs(to).format('YYYY-MM') : 'oxirigacha'
        }-gacha`,
      );
    }
    if (filters.teacherId) parts.push(`teacher-${filters.teacherId}`);
    if (filters.groupId) parts.push(`group-${filters.groupId}`);
    if (filters.studentId) parts.push(`student-${filters.studentId}`);
    if (filters.status) parts.push(filters.status);
    if (filters.overdueOnly) parts.push('overdue');
    parts.push(dayjs().format('YYYY-MM-DD'));

    return `${parts.join('_')}.xlsx`;
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

    this.resetBillingCaches();
    this.enrollmentsService.clearCache();
    const { lessonsPlanned, lessonsBillable, lessonsExcused, amountDue } =
      await this.computeMonthBilling({
        student: payment.student!,
        group: payment.group!,
        forMonth,
        studentActiveEndExclusive: this.resolveActiveEndExclusive({
          student: payment.student!,
          group: payment.group!,
          forMonth,
          plannedStudyUntilDate: payment.plannedStudyUntilDate,
        }),
        manualExcludedAmount: Number(payment.manualExcludedAmount ?? 0),
      });

    // Update payment fields
    payment.lessonsPlanned = lessonsPlanned;
    payment.lessonsBillable = lessonsBillable;
    payment.lessonsExcused = lessonsExcused;
    payment.amountDue = amountDue as any;

    // Yangi qarzdan ortiq to'langan pul — qaytariladigan pul (yo'qolmaydi).
    let currentPaid = Number(payment.amountPaid ?? 0);
    if (currentPaid > amountDue) {
      this.releaseMoneyFromPayment(
        payment,
        this.round2(currentPaid - amountDue),
        'refund',
      );
      currentPaid = amountDue;
      payment.amountPaid = amountDue as any;
    }
    payment.status = this.statusFor(currentPaid, amountDue);

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
    // O'quvchi topshirgan pul (tasdiqlangan + tasdiq kutayotgan) va qolgan qarzi.
    const receivedAmount = this.round2(amountPaid + pendingAmount);
    const payableNow = this.round2(Math.max(0, amountDue - receivedAmount));

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
            groupId: (payment as any).groupId,
          })
        : { percent: 0, amount: 0, breakdown: [] };

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
      receivedAmount,
      payableNow,
      refundedAmount: Number((payment as any).refundedAmount ?? 0),
      pendingAmount,
      hasPendingReceipt: pendingReceiptsCount > 0,
      pendingReceiptsCount,
      discountPercentApplied: discount.percent,
      discountAmountApplied: discount.amount,
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
