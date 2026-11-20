import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { PaymentsService } from '@/modules/payments/payments.service';
import { StudentGroupFeeService } from '@/modules/students/student-group-fee.service';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';
import { OverpaymentMode } from '@/common/enums/overpayment-mode.enum';

const TZ = 'Asia/Tashkent';
/** Qayta hisoblash chegarasi — orqaga sanalash bilan bir xil (24 oy). */
const MAX_MONTHS_BACK = 23;

/**
 * Adashib yozilgan shaxsiy narxni bitta GURUHDA olib tashlash (2026-11-20).
 *
 * Reception ba'zan guruh narxini o'quvchining shaxsiy narxi qilib yozib
 * qo'ygan: keyin guruh narxi o'zgarsa bu o'quvchiga o'tmaydi. Admin guruh va
 * oyni tanlaydi (default — o'quvchi faollashgan oy), o'sha oydan boshlab shu
 * guruhda guruh narxi ishlatiladi va to'lovlar (to'langan oylar ham) qayta
 * hisoblanadi:
 * - yangi narx qimmat — farq qarz bo'lib qoladi;
 * - arzon — ortiqcha pul admin tanlovi bilan qaytariladi (`refund`) yoki
 *   keyingi oylarga o'tkaziladi (`carry`).
 * Tanlangan oydan oldingi oylar eski narxda qoladi; boshqa guruhlar tegilmaydi.
 */
@Injectable()
export class StudentPersonalFeeService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly groupFees: StudentGroupFeeService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  /** Ta'sir (hech narsa yozmaydi). `fromMonth` berilmasa — default oy. */
  async preview(
    organizationId: number,
    studentId: number,
    groupId: number,
    fromMonth?: string,
  ) {
    const student = await this.load(organizationId, studentId);
    const group = await this.loadGroup(student, groupId);
    const defaultFromMonth = this.defaultFromMonth(student);
    const month = this.normalizeMonth(fromMonth ?? defaultFromMonth);
    await this.assertHasPersonalFee(student, group, month);

    const result = await this.paymentsService.previewBackdating([
      { student, group, fromMonth: month, personalFeeClearedFrom: month },
    ]);
    return {
      groupId: group.id,
      groupName: group.name,
      fromMonth: month,
      defaultFromMonth,
      minMonth: this.minMonth(),
      personalFee: await this.groupFees.feeForMonth(
        student.id,
        group.id,
        month,
      ),
      ...result,
    };
  }

  /**
   * Narxni olib tashlaydi, `fromMonth` dan bugungacha qayta hisoblaydi va
   * ortiqcha pulni tanlov bo'yicha qaytaradi yoki keyingi oylarga o'tkazadi.
   */
  async apply(
    organizationId: number,
    studentId: number,
    groupId: number,
    fromMonth: string,
    overpayment: OverpaymentMode,
    performedById?: number | null,
  ) {
    const student = await this.load(organizationId, studentId);
    const group = await this.loadGroup(student, groupId);
    const month = this.normalizeMonth(fromMonth);
    await this.assertHasPersonalFee(student, group, month);

    const refundsBefore = await this.refundsByPayment(
      student.id,
      group.id,
      month,
    );

    await this.groupFees.clearFrom(student.id, group.id, month);
    await this.studentRepo.update(student.id, {
      monthlyFee: await this.groupFees.legacyFee(
        student.id,
        (student.groups ?? []).map((g) => g.id),
      ),
    });
    await this.paymentsService.rebillAfterBackdating({
      studentIds: [student.id],
      groupIds: [group.id],
      fromDate: month,
    });

    // Qayta hisoblashda paydo bo'lgan ortiqcha pul (faqat shu amal sabab).
    const refundsAfter = await this.refundsByPayment(
      student.id,
      group.id,
      month,
    );
    const excess = [...refundsAfter]
      .map(([paymentId, after]) => ({
        paymentId,
        amount:
          Math.round((after - (refundsBefore.get(paymentId) ?? 0)) * 100) / 100,
      }))
      .filter((x) => x.amount > 0);
    const overpaid = excess.reduce((s, x) => s + x.amount, 0);

    let carry = { carried: 0, applied: 0, waiting: 0 };
    if (overpayment === OverpaymentMode.CARRY && excess.length) {
      carry = await this.paymentsService.carryRefundsForward(
        student.id,
        excess,
        performedById,
      );
    }
    return {
      studentId: student.id,
      groupId: group.id,
      fromMonth: month,
      overpayment,
      overpaidAmount: Math.round(overpaid * 100) / 100,
      refundedAmount: Math.round((overpaid - carry.carried) * 100) / 100,
      carriedAmount: carry.carried,
      appliedAmount: carry.applied,
      waitingAmount: carry.waiting,
    };
  }

  // ───────────────────────────── Ichki ─────────────────────────────

  private async load(organizationId: number, studentId: number) {
    const student = await this.studentRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.groups', 'g')
      .innerJoin('s.center', 'c')
      .where('s.id = :studentId', { studentId })
      .andWhere('c.organizationId = :organizationId', { organizationId })
      .getOne();
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    return student;
  }

  /** Hozirgi guruhi yoki to'lov qatori bor (sobiq) guruhi. */
  private async loadGroup(student: Student, groupId: number) {
    const own = (student.groups ?? []).some((g) => g.id === groupId);
    if (!own) {
      const [row] = await this.studentRepo.query(
        `SELECT 1 FROM "payments" WHERE "studentId" = $1 AND "groupId" = $2 LIMIT 1`,
        [student.id, groupId],
      );
      if (!row) {
        throw new ValidationException({
          groupId: "O'quvchi bu guruhda o'qimagan",
        });
      }
    }
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['schedules'],
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');
    return group;
  }

  private currentMonth(): string {
    return dayjs().tz(TZ).startOf('month').format('YYYY-MM-01');
  }

  private minMonth(): string {
    return dayjs(this.currentMonth())
      .subtract(MAX_MONTHS_BACK, 'month')
      .format('YYYY-MM-01');
  }

  /** O'quvchi faollashgan oy (chegaradan oldin bo'lsa — chegara). */
  private defaultFromMonth(student: Student): string {
    const current = this.currentMonth();
    if (!student.activatedAt) return current;
    const month = dayjs(student.activatedAt)
      .tz(TZ)
      .startOf('month')
      .format('YYYY-MM-01');
    const min = this.minMonth();
    if (month < min) return min;
    return month > current ? current : month;
  }

  private normalizeMonth(value: string): string {
    const parsed = dayjs(value);
    if (!value || !parsed.isValid()) {
      throw new ValidationException({ fromMonth: "Oy noto'g'ri" });
    }
    const month = parsed.startOf('month').format('YYYY-MM-01');
    if (month > this.currentMonth()) {
      throw new ValidationException({
        fromMonth: "Oy joriy oydan keyin bo'lishi mumkin emas",
      });
    }
    if (month < this.minMonth()) {
      throw new ValidationException({
        fromMonth: `Oy ${this.minMonth()} dan oldin bo'lishi mumkin emas`,
      });
    }
    return month;
  }

  private async assertHasPersonalFee(
    student: Student,
    group: Group,
    month: string,
  ) {
    if (!(await this.groupFees.hasFeeFrom(student.id, group.id, month))) {
      throw new BadRequestException(
        "Bu guruhda tanlangan oydan keyin shaxsiy narx yo'q — guruh narxi allaqachon ishlatilmoqda",
      );
    }
  }

  private async refundsByPayment(
    studentId: number,
    groupId: number,
    month: string,
  ): Promise<Map<number, number>> {
    const rows: { id: number; refundedAmount: string }[] =
      await this.studentRepo.query(
        `SELECT "id", "refundedAmount" FROM "payments"
          WHERE "studentId" = $1 AND "groupId" = $2 AND "forMonth" >= $3::date`,
        [studentId, groupId, month],
      );
    return new Map(
      rows.map((r) => [Number(r.id), Number(r.refundedAmount ?? 0)]),
    );
  }
}
