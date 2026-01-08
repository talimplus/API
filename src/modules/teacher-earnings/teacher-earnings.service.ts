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

  private async isSalaryPaidOut(teacherId: number, forMonth: string): Promise<boolean> {
    const row = await this.staffSalaryRepo.findOne({
      where: { userId: teacherId, forMonth: forMonth as any },
    });
    return row?.status === StaffSalaryStatus.PAID;
  }

  private async computeCommissionAmount(teacherId: number, forMonth: string): Promise<number> {
    // Only PAID student payments count; paid late will be included when recalculated.
    const raw = await this.paymentRepo
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amountPaid), 0)', 'sum')
      .leftJoin('p.group', 'g')
      .leftJoin('g.teacher', 't')
      .where('p.forMonth = :forMonth', { forMonth })
      .andWhere('p.status = :status', { status: PaymentStatus.PAID })
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
    forMonthYM: string,
    opts?: { force?: boolean },
  ) {
    const forMonth = this.normalizeForMonthYM(forMonthYM);
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
      where: { teacherId, forMonth: forMonth as any },
      relations: ['teacher'],
    });
    if (existing && !force) return existing;

    const baseSalary = Number(teacher.salary ?? 0);
    const commissionPct = Math.max(
      0,
      Math.min(100, Number(teacher.commissionPercentage ?? 0)),
    );
    const grossPaid = await this.computeCommissionAmount(teacherId, forMonth);
    const commissionAmount = this.round2(
      Math.max(0, grossPaid * (commissionPct / 100)),
    );

    const paidOut = await this.isSalaryPaidOut(teacherId, forMonth);

    // If already paid out, do not overwrite; store positive diff as carryover.
    if (paidOut && existing) {
      const newTotal = this.round2(baseSalary + commissionAmount);
      const oldTotal = Number(existing.totalEarning ?? 0);
      const diff = this.round2(newTotal - oldTotal);
      if (diff > 0) {
        await this.carryRepo.save(
          this.carryRepo.create({
            teacherId,
            sourceForMonth: forMonth as any,
            amount: diff as any,
            appliedForMonth: null,
            appliedAt: null,
          }),
        );
      }
      return existing;
    }

    // Apply any unapplied carryovers into this month (only when not paid out)
    const carryovers = await this.carryRepo.find({
      where: { teacherId, appliedForMonth: null },
      order: { createdAt: 'ASC' },
    });
    const carryOverCommission = this.round2(
      carryovers.reduce((sum, c) => sum + Number(c.amount ?? 0), 0),
    );
    if (carryovers.length) {
      const now = new Date();
      for (const c of carryovers) {
        c.appliedForMonth = forMonth as any;
        c.appliedAt = now;
      }
      await this.carryRepo.save(carryovers);
    }

    const totalEarning = this.round2(baseSalary + commissionAmount + carryOverCommission);

    const snapshot =
      existing ??
      this.earningRepo.create({
        teacherId,
        teacher: teacher as any,
        forMonth: forMonth as any,
      });

    snapshot.baseSalarySnapshot = baseSalary as any;
    snapshot.commissionAmount = commissionAmount as any;
    snapshot.carryOverCommission = carryOverCommission as any;
    snapshot.totalEarning = totalEarning as any;
    snapshot.calculatedAt = new Date();

    return this.earningRepo.save(snapshot);
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

