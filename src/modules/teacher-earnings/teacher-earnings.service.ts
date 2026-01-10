import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeacherMonthlyEarning } from '@/modules/teacher-earnings/entities/teacher-monthly-earning.entity';
import { TeacherCommissionCarryOver } from '@/modules/teacher-earnings/entities/teacher-commission-carryover.entity';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { Payment, PaymentStatus } from '@/modules/payments/entities/payment.entity';
import { dayjs } from '@/shared/utils/dayjs';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';

@Injectable()
export class TeacherEarningsService {
  constructor(
    @InjectRepository(TeacherMonthlyEarning)
    private readonly earningRepo: Repository<TeacherMonthlyEarning>,
    @InjectRepository(TeacherCommissionCarryOver)
    private readonly carryRepo: Repository<TeacherCommissionCarryOver>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(StaffSalary)
    private readonly staffSalaryRepo: Repository<StaffSalary>,
  ) {}

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private async applyCarryoverToNextUnpaidEarningMonth(
    organizationId: number,
    teacherId: number,
    sourceEarningMonth: string, // YYYY-MM-01
  ) {
    // We only look ahead a limited window to prevent pathological loops.
    // Next unpaid month is usually the immediate next month.
    for (let i = 1; i <= 12; i++) {
      const candidate = dayjs(sourceEarningMonth)
        .add(i, 'month')
        .startOf('month')
        .format('YYYY-MM-01');

      // If the pay month (candidate + 1) is already paid, we cannot change it; move forward.
      // eslint-disable-next-line no-await-in-loop
      const paidOut = await this.isSalaryPaidOut(teacherId, candidate);
      if (paidOut) continue;

      // Recalculate to apply any unapplied carryovers into this candidate month.
      // eslint-disable-next-line no-await-in-loop
      await this.calculateTeacherEarningsForMonth(
        organizationId,
        teacherId,
        dayjs(candidate).format('YYYY-MM'),
        { force: true },
      );
      return;
    }
  }

  private normalizeForMonthYM(ym?: string): string {
    if (!ym) throw new BadRequestException('forMonth is required (YYYY-MM)');
    const v = ym.trim();
    if (!/^\d{4}-\d{2}$/.test(v)) {
      throw new BadRequestException('forMonth must be in YYYY-MM format');
    }
    const monthStart = dayjs(`${v}-01`).startOf('month');
    const currentStart = dayjs().startOf('month');
    if (monthStart.isAfter(currentStart)) {
      throw new BadRequestException('Future months are not allowed');
    }
    return `${v}-01`;
  }

  /**
   * Month offset rule:
   * - earnings month = M
   * - salary is paid in M+1 (pay month)
   *
   * StaffSalary.forMonth stores the PAY month for teachers.
   */
  private async isSalaryPaidOut(
    teacherId: number,
    payMonth: string, // YYYY-MM-01
  ): Promise<boolean> {
    const row = await this.staffSalaryRepo.findOne({
      where: { userId: teacherId, forMonth: payMonth as any },
    });
    return row?.status === StaffSalaryStatus.PAID;
  }

  private async computeCommissionAmount(
    teacherId: number,
    earningMonth: string, // YYYY-MM-01
  ): Promise<number> {
    // Only PAID student payments count; paid late will be included when recalculated.
    const raw = await this.paymentRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amountPaid), 0)', 'sum')
      .leftJoin('p.group', 'g')
      .leftJoin('g.teacher', 't')
      .where('p.forMonth = :forMonth', { forMonth: earningMonth })
      // Count commission on all money actually received (partial payments included)
      .andWhere('p.status IN (:...statuses)', {
        statuses: [PaymentStatus.PAID, PaymentStatus.PARTIAL],
      })
      .andWhere('p.amountPaid > 0')
      .andWhere('t.id = :teacherId', { teacherId })
      .getRawOne<{ sum: string }>();

    return Number(raw?.sum ?? 0);
  }

  /**
   * Calculates and stores monthly earning snapshot for a teacher.
   * - commission based on PAID student payments for that month
   * - salary snapshot is teacher.salary at calculation time
   * - carryover applies only when current month is not already paid out
   */
  async calculateTeacherEarningsForMonth(
    organizationId: number,
    teacherId: number,
    payMonthYM: string,
    opts?: { force?: boolean },
  ) {
    const payMonth = this.normalizeForMonthYM(payMonthYM);
    const force = !!opts?.force;

    const teacher = await this.userRepo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.organization', 'org')
      .where('u.id = :teacherId', { teacherId })
      .andWhere('org.id = :organizationId', { organizationId })
      .getOne();

    if (!teacher) throw new NotFoundException('Teacher not found');
    if (teacher.role !== UserRole.TEACHER) {
      throw new BadRequestException('User is not a teacher');
    }

    const existing = await this.earningRepo.findOne({
      where: { teacherId, forMonth: payMonth as any },
      relations: ['teacher'],
    });
    if (existing && !force) return existing;

    const earningMonth = dayjs(payMonth)
      .subtract(1, 'month')
      .startOf('month')
      .format('YYYY-MM-01');

    const baseSalary = Number(teacher.salary ?? 0);
    const commissionPct = Math.max(
      0,
      Math.min(100, Number(teacher.commissionPercentage ?? 0)),
    );
    const grossPaid = await this.computeCommissionAmount(teacherId, earningMonth);
    const commissionAmount = this.round2(
      Math.max(0, grossPaid * (commissionPct / 100)),
    );

    const paidOut = await this.isSalaryPaidOut(teacherId, payMonth);

    // If pay month was already marked PAID and commission increased (late payments),
    // record the incremental commission as a carryover applied to THIS SAME pay month.
    if (paidOut && existing) {
      const prevCommission = Number(existing.commissionAmount ?? 0);
      const diff = this.round2(commissionAmount - prevCommission);
      if (diff > 0) {
        await this.carryRepo.save(
          this.carryRepo.create({
            teacherId,
            sourceForMonth: earningMonth as any,
            amount: diff as any,
            appliedForMonth: payMonth as any,
            appliedAt: new Date(),
          }),
        );
      }
    }

    // Carryover semantics:
    // - carryover rows are immutable amounts
    // - appliedForMonth marks which earnings month received that carryover
    // On recalculation (force=true), we MUST preserve already-applied carryovers for this month.
    const alreadyApplied = await this.carryRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount), 0)', 'sum')
      .where('c.teacherId = :teacherId', { teacherId })
      .andWhere('c.appliedForMonth = :forMonth', { forMonth: payMonth })
      .getRawOne<{ sum: string }>();
    const alreadyAppliedSum = Number(alreadyApplied?.sum ?? 0);

    // Apply any currently-unapplied carryovers into this month (only when not paid out)
    const toApply = await this.carryRepo.find({
      where: { teacherId, appliedForMonth: null },
      order: { createdAt: 'ASC' },
    });
    const toApplySum = this.round2(
      toApply.reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
    );
    if (toApply.length) {
      const now = new Date();
      for (const c of toApply) {
        c.appliedForMonth = payMonth as any;
        c.appliedAt = now;
      }
      await this.carryRepo.save(toApply);
    }

    const carryOverCommission = this.round2(alreadyAppliedSum + toApplySum);

    // Total to pay for this pay month is base + full commission calculated from earningMonth.
    // carryOverCommission is informational (how much was added after the pay month was first settled).
    const totalEarning = this.round2(baseSalary + commissionAmount);

    const snapshot =
      existing ??
      this.earningRepo.create({
        teacherId,
        teacher: teacher as any,
        forMonth: payMonth as any,
      });

    snapshot.baseSalarySnapshot = baseSalary as any;
    snapshot.commissionAmount = commissionAmount as any;
    snapshot.carryOverCommission = carryOverCommission as any;
    snapshot.totalEarning = totalEarning as any;
    snapshot.calculatedAt = new Date();

    const savedSnapshot = await this.earningRepo.save(snapshot);

    // Keep StaffSalary row for this pay month in sync, even if it was previously marked PAID.
    const salaryRow = await this.staffSalaryRepo.findOne({
      where: { userId: teacherId, forMonth: payMonth as any },
    });
    if (salaryRow) {
      salaryRow.baseSalary = savedSnapshot.totalEarning as any;
      const paidAmount = Number((salaryRow as any).paidAmount ?? 0);
      const base = Number((salaryRow as any).baseSalary ?? 0);
      if (paidAmount >= base) {
        salaryRow.status = StaffSalaryStatus.PAID;
        salaryRow.paidAt = salaryRow.paidAt ?? new Date();
      } else if (paidAmount > 0) {
        salaryRow.status = StaffSalaryStatus.PARTIAL;
        salaryRow.paidAt = null;
      } else {
        salaryRow.status = StaffSalaryStatus.UNPAID;
        salaryRow.paidAt = null;
      }
      await this.staffSalaryRepo.save(salaryRow);
    }

    return savedSnapshot;
  }

  async ensureTeacherEarningsForMonth(organizationId: number, forMonthYM: string) {
    const forMonth = this.normalizeForMonthYM(forMonthYM);

    const teachers = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .andWhere('u.role = :role', { role: UserRole.TEACHER })
      .andWhere('(COALESCE(u.salary, 0) > 0 OR COALESCE(u.commissionPercentage, 0) > 0)')
      .getMany();

    for (const t of teachers) {
      // No force: create if missing
      // eslint-disable-next-line no-await-in-loop
      await this.calculateTeacherEarningsForMonth(organizationId, t.id, forMonth.slice(0, 7), {
        force: false,
      });
    }
  }

  async listEarnings(organizationId: number, forMonthYM: string) {
    const forMonth = this.normalizeForMonthYM(forMonthYM);

    await this.ensureTeacherEarningsForMonth(organizationId, forMonth.slice(0, 7));

    return this.earningRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.teacher', 'teacher')
      .leftJoin('teacher.organization', 'org')
      .where('org.id = :organizationId', { organizationId })
      .andWhere('e.forMonth = :forMonth', { forMonth })
      .orderBy('teacher.createdAt', 'DESC')
      .getMany();
  }
}

