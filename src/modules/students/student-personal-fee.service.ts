import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { PaymentsService } from '@/modules/payments/payments.service';
import { BackdateSimulation } from '@/modules/payments/backdate-preview.interface';
import { StudentBaseDiscountService } from '@/modules/students/student-base-discount.service';
import { ValidationException } from '@/common/exceptions/validation.exception';
import { dayjs } from '@/shared/utils/dayjs';

const TZ = 'Asia/Tashkent';
/** Qayta hisoblash chegarasi — orqaga sanalash bilan bir xil (24 oy). */
const MAX_MONTHS_BACK = 23;

/**
 * Adashib yozilgan shaxsiy narxni olib tashlash (2026-11-20).
 *
 * Reception ba'zan guruh narxini o'quvchining shaxsiy narxi (`monthlyFee`)
 * qilib yozib qo'ygan: keyin guruh narxi o'zgarsa bu o'quvchiga o'tmaydi.
 * Admin oyni tanlaydi (default — o'quvchi faollashgan oy), o'sha oydan
 * boshlab guruh narxi ishlatiladi va to'lovlar (to'langan oylar ham)
 * qayta hisoblanadi: ortiqcha pul `refundedAmount` ga, kam bo'lsa qarz.
 * Tanlangan oydan oldingi oylar eski narxda qoladi.
 */
@Injectable()
export class StudentPersonalFeeService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly baseDiscounts: StudentBaseDiscountService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
  ) {}

  /** Ta'sir (hech narsa yozmaydi). `fromMonth` berilmasa — default oy. */
  async preview(organizationId: number, studentId: number, fromMonth?: string) {
    const student = await this.load(organizationId, studentId);
    const defaultFromMonth = this.defaultFromMonth(student);
    const month = this.normalizeMonth(fromMonth ?? defaultFromMonth);
    await this.assertHasPersonalFee(student, month);

    const groups = await this.affectedGroups(student, month);
    const sims: BackdateSimulation[] = groups.map((group) => ({
      student,
      group,
      fromMonth: month,
      personalFeeClearedFrom: month,
    }));
    const result = await this.paymentsService.previewBackdating(sims);
    return {
      fromMonth: month,
      defaultFromMonth,
      minMonth: this.minMonth(),
      personalFee: Number(student.monthlyFee ?? 0),
      ...result,
    };
  }

  /** Narxni olib tashlaydi va `fromMonth` dan bugungacha qayta hisoblaydi. */
  async apply(organizationId: number, studentId: number, fromMonth: string) {
    const student = await this.load(organizationId, studentId);
    const month = this.normalizeMonth(fromMonth);
    await this.assertHasPersonalFee(student, month);
    const groups = await this.affectedGroups(student, month);

    await this.baseDiscounts.clearPersonalFeeFrom(student.id, month, {
      percent: Number(student.discountPercent ?? 0),
      amount: Number(student.discountAmount ?? 0),
      reason: student.discountReason ?? null,
      monthlyFee: Number(student.monthlyFee ?? 0),
    });
    await this.studentRepo.update(student.id, { monthlyFee: 0 });

    if (groups.length) {
      await this.paymentsService.rebillAfterBackdating({
        studentIds: [student.id],
        groupIds: groups.map((g) => g.id),
        fromDate: month,
      });
    }
    return { studentId: student.id, fromMonth: month };
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

  /** Tanlangan oydan keyin biror oyda shaxsiy narx amal qilishi kerak. */
  private async assertHasPersonalFee(student: Student, month: string) {
    const periods = await this.baseDiscounts.getPeriods(student.id);
    const fallback = Number(student.monthlyFee ?? 0);
    const inEffect = periods.filter((p) => p.fromMonth <= month).pop();
    const feeAt = (p?: { monthlyFee: number | null }) =>
      p ? (p.monthlyFee ?? fallback) : fallback;
    const has =
      feeAt(inEffect ?? periods[0]) > 0 ||
      periods.some((p) => p.fromMonth > month && feeAt(p) > 0);
    if (!has) {
      throw new BadRequestException(
        "Bu o'quvchida tanlangan oydan keyin shaxsiy narx yo'q — guruh narxi allaqachon ishlatilmoqda",
      );
    }
  }

  /**
   * Qayta hisoblanadigan guruhlar: hozirgi guruhlari + `month` dan beri
   * to'lov qatori bor guruhlar (chiqib ketgan guruhdagi qarz ham tuzalsin).
   */
  private async affectedGroups(student: Student, month: string) {
    const rows: { groupId: number }[] = await this.studentRepo.query(
      `SELECT DISTINCT "groupId" FROM "payments"
        WHERE "studentId" = $1 AND "forMonth" >= $2::date`,
      [student.id, month],
    );
    const ids = Array.from(
      new Set([
        ...(student.groups ?? []).map((g) => g.id),
        ...rows.map((r) => Number(r.groupId)),
      ]),
    );
    if (!ids.length) return [];
    return this.groupRepo.find({
      where: { id: In(ids) },
      relations: ['schedules'],
    });
  }
}
