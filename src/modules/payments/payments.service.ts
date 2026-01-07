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
import { QueryFailedError, Repository } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Student } from '@/modules/students/entities/students.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StudentStatus } from '@/common/enums/students-status.enums';
import { computeLessonDates } from '@/modules/attendance/utils/lesson-dates';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

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
  }): { lessonsPlanned: number; lessonsBillable: number } {
    const { group, forMonth, studentActiveStart } = args;
    const timezone = group.timezone || 'Asia/Tashkent';

    // IMPORTANT: parse first, then apply timezone
    const monthStart = dayjs(forMonth).tz(timezone).startOf('month');
    const monthEnd = monthStart.endOf('month');

    const groupStartDate = dayjs(group.startDate).format('YYYY-MM-DD');
    const groupEndDate = group.endDate
      ? dayjs(group.endDate).format('YYYY-MM-DD')
      : null;

    const lessonDates = computeLessonDates({
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

    const lessonsPlanned = lessonDates.length;
    if (!lessonsPlanned) return { lessonsPlanned: 0, lessonsBillable: 0 };

    const lessonsBillable = lessonDates.filter(
      (d) => d >= studentActiveStart,
    ).length;

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

  private computeAmountDue(args: {
    student: Student;
    group: Group;
    lessonsPlanned: number;
    lessonsBillable: number;
  }): number {
    const { student, group, lessonsPlanned, lessonsBillable } = args;
    const baseMonthlyFee = Number(student.monthlyFee ?? group.monthlyFee ?? 0);
    if (!lessonsPlanned) return 0;

    // Apply discount AFTER lesson-based prorating
    const proratedFee = baseMonthlyFee * (lessonsBillable / lessonsPlanned);
    const discountPercent = Math.max(
      0,
      Math.min(100, Number(student.discountPercent ?? 0)),
    );
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
    opts?: { maxMonthsBack?: number },
  ) {
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
      const { lessonsPlanned, lessonsBillable } = this.computeMonthLessonCounts(
        {
          group: p.group,
          forMonth,
          studentActiveStart,
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

      const amountDue = this.computeAmountDue({
        student: p.student,
        group: p.group,
        lessonsPlanned,
        lessonsBillable,
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
    opts?: { maxMonthsBack?: number },
  ) {
    // Load active students within org + their groups + schedules (billing is schedule-based)
    const students = await this.studentRepo
      .createQueryBuilder('student')
      .leftJoinAndSelect('student.groups', 'group')
      .leftJoinAndSelect('group.schedules', 'schedule')
      .leftJoin('student.center', 'center')
      .leftJoin('center.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
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

  private async ensurePaymentsForStudents(
    students: Student[],
    opts: { onlyCurrentMonth: boolean; maxMonthsBack?: number },
  ) {
    if (!students.length) return;

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

          const amountDue = this.computeAmountDue({
            student,
            group,
            lessonsPlanned,
            lessonsBillable,
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
      page,
      perPage,
      status,
      forMonth,
      overdueOnly,
      studentId,
      groupId,
    }: {
      page: number;
      perPage: number;
      status?: PaymentStatus;
      forMonth?: string; // YYYY-MM
      overdueOnly?: boolean;
      studentId?: number;
      groupId?: number;
    },
  ) {
    // Ensure missing monthly payments are present when listing payments
    try {
      await this.ensurePaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
      });
      // Also recalculate open payments in the same bounded window (pricing/discount updates)
      await this.recalculateOpenPaymentsForOrganization(organizationId, {
        maxMonthsBack: 3,
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

    if (status) {
      query.andWhere('payments.status = :status', { status });
    }

    if (studentId) {
      query.andWhere('payments.studentId = :studentId', { studentId });
    }

    if (groupId) {
      query.andWhere('payments.groupId = :groupId', { groupId });
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

    // enrich response with computed fields (overdue, remaining)
    const enriched = data.map((p: any) => {
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
        lessonsPlanned: p.lessonsPlanned ?? 0,
        lessonsBillable: p.lessonsBillable ?? 0,
      };
    });

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

  async findOne(id: number) {
    const payment = await this.paymentRepo.findOne({
      where: { id },
      relations: ['group', 'student'],
    });
    if (!payment) throw new NotFoundException('To‘lov topilmadi');

    const timezone = (payment as any).group?.timezone || 'Asia/Tashkent';
    const today = dayjs().tz(timezone).format('YYYY-MM-DD');
    const hardDue = (payment as any).hardDueDate
      ? dayjs((payment as any).hardDueDate).format('YYYY-MM-DD')
      : null;
    const isOverdue =
      !!hardDue && today > hardDue && payment.status !== PaymentStatus.PAID;

    const amountDue = Number((payment as any).amountDue ?? 0);
    const amountPaid = Number((payment as any).amountPaid ?? 0);
    const remainingAmount = this.round2(amountDue - amountPaid);

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
      lessonsPlanned: (payment as any).lessonsPlanned ?? 0,
      lessonsBillable: (payment as any).lessonsBillable ?? 0,
    };
  }
}
