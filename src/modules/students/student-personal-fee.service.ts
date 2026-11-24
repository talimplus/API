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
 * aniq SANANI tanlaydi (default — o'quvchi faollashgan kun), o'sha kundan shu
 * guruhda guruh narxi ishlatiladi va to'lovlar (to'langan oylar ham) qayta
 * hisoblanadi:
 * - yangi narx qimmat — farq qarz bo'lib qoladi;
 * - arzon — ortiqcha pul admin tanlovi bilan qaytariladi (`refund`) yoki
 *   keyingi oylarga o'tkaziladi (`carry`).
 * Tanlangan sanadan oldingi darslar (shu oyda ham) eski narxda qoladi; boshqa guruhlar tegilmaydi.
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

  /** Ta'sir (hech narsa yozmaydi). `fromDate` berilmasa — default kun. */
  async preview(
    organizationId: number,
    studentId: number,
    groupId: number,
    fromDate?: string,
  ) {
    const student = await this.load(organizationId, studentId);
    const group = await this.loadGroup(student, groupId);
    const defaultFromDate = this.defaultFromDate(student);
    const date = this.normalizeDate(fromDate ?? defaultFromDate);
    await this.assertHasPersonalFee(student, group, date);

    const result = await this.paymentsService.previewBackdating([
      {
        student,
        group,
        fromMonth: dayjs(date).startOf('month').format('YYYY-MM-01'),
        personalFeeClearedFrom: date,
      },
    ]);
    return {
      groupId: group.id,
      groupName: group.name,
      fromDate: date,
      defaultFromDate,
      minDate: this.minDate(),
      personalFee: await this.groupFees.feeAt(student.id, group.id, date),
      ...result,
    };
  }

  /**
   * Narxni olib tashlaydi, `fromDate` dan bugungacha qayta hisoblaydi va
   * ortiqcha pulni tanlov bo'yicha qaytaradi yoki keyingi oylarga o'tkazadi.
   */
  async apply(
    organizationId: number,
    studentId: number,
    groupId: number,
    fromDate: string,
    overpayment: OverpaymentMode,
    performedById?: number | null,
  ) {
    const student = await this.load(organizationId, studentId);
    const group = await this.loadGroup(student, groupId);
    const date = this.normalizeDate(fromDate);
    await this.assertHasPersonalFee(student, group, date);

    const refundsBefore = await this.refundsByPayment(
      student.id,
      group.id,
      date,
    );

    await this.groupFees.clearFrom(student.id, group.id, date);
    await this.studentRepo.update(student.id, {
      monthlyFee: await this.groupFees.legacyFee(
        student.id,
        (student.groups ?? []).map((g) => g.id),
      ),
    });
    await this.paymentsService.rebillAfterBackdating({
      studentIds: [student.id],
      groupIds: [group.id],
      fromDate: date,
    });

    // Qayta hisoblashda paydo bo'lgan ortiqcha pul (faqat shu amal sabab).
    const refundsAfter = await this.refundsByPayment(
      student.id,
      group.id,
      date,
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
      fromDate: date,
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

  private minDate(): string {
    return dayjs(this.currentMonth())
      .subtract(MAX_MONTHS_BACK, 'month')
      .format('YYYY-MM-01');
  }

  /** O'quvchi faollashgan kun (chegaradan oldin bo'lsa — chegara). */
  private defaultFromDate(student: Student): string {
    const today = this.groupFees.today();
    if (!student.activatedAt) return this.currentMonth();
    const date = dayjs(student.activatedAt).tz(TZ).format('YYYY-MM-DD');
    const min = this.minDate();
    if (date < min) return min;
    return date > today ? today : date;
  }

  private normalizeDate(value: string): string {
    const parsed = dayjs(value);
    if (!value || !parsed.isValid()) {
      throw new ValidationException({ fromDate: "Sana noto'g'ri" });
    }
    const date = parsed.format('YYYY-MM-DD');
    if (date > this.groupFees.today()) {
      throw new ValidationException({
        fromDate: "Sana bugundan keyin bo'lishi mumkin emas",
      });
    }
    if (date < this.minDate()) {
      throw new ValidationException({
        fromDate: `Sana ${this.minDate()} dan oldin bo'lishi mumkin emas`,
      });
    }
    return date;
  }

  private async assertHasPersonalFee(
    student: Student,
    group: Group,
    date: string,
  ) {
    if (!(await this.groupFees.hasFeeFrom(student.id, group.id, date))) {
      throw new BadRequestException(
        "Bu guruhda tanlangan sanadan keyin shaxsiy narx yo'q — guruh narxi allaqachon ishlatilmoqda",
      );
    }
  }

  private async refundsByPayment(
    studentId: number,
    groupId: number,
    date: string,
  ): Promise<Map<number, number>> {
    const rows: { id: number; refundedAmount: string }[] =
      await this.studentRepo.query(
        `SELECT "id", "refundedAmount" FROM "payments"
          WHERE "studentId" = $1 AND "groupId" = $2 AND "forMonth" >= DATE_TRUNC('month', $3::date)`,
        [studentId, groupId, date],
      );
    return new Map(
      rows.map((r) => [Number(r.id), Number(r.refundedAmount ?? 0)]),
    );
  }
}
