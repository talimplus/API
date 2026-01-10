import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { dayjs } from '@/shared/utils/dayjs';
import { PayStaffSalaryDto } from '@/modules/staff-salaries/dto/pay-staff-salary.dto';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';

@Injectable()
export class StaffSalariesService {
  constructor(
    @InjectRepository(StaffSalary)
    private readonly staffSalaryRepo: Repository<StaffSalary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly teacherEarningsService: TeacherEarningsService,
  ) {}

  private normalizeForMonth(forMonth?: string): string {
    const current = dayjs().startOf('month').format('YYYY-MM');
    const ym = forMonth?.trim() || current;

    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new BadRequestException('forMonth must be in YYYY-MM format');
    }

    const monthStart = dayjs(`${ym}-01`).startOf('month');
    const currentStart = dayjs().startOf('month');
    if (monthStart.isAfter(currentStart)) {
      throw new BadRequestException('Future months are not allowed');
    }

    return `${ym}-01`;
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  async ensureSalariesForMonth(organizationId: number, forMonth: string) {
    const month = this.normalizeForMonth(forMonth);

    const employees = await this.userRepo.find({
      where: [
        { role: UserRole.TEACHER },
        { role: UserRole.MANAGER },
        { role: UserRole.OTHER },
      ],
      relations: ['organization', 'center'],
    });

    const eligible = employees.filter((u) => {
      if (u.organization?.id !== organizationId) return false;
      if (u.role === UserRole.TEACHER) {
        return (
          Number(u.salary ?? 0) > 0 || Number(u.commissionPercentage ?? 0) > 0
        );
      }
      return Number(u.salary ?? 0) > 0;
    });
    if (!eligible.length) return;

    const userIds = eligible.map((u) => u.id);
    const existing = await this.staffSalaryRepo
      .createQueryBuilder('salary')
      .leftJoinAndSelect('salary.user', 'user')
      .where('salary.forMonth = :forMonth', { forMonth: month })
      .andWhere('salary.userId IN (:...userIds)', { userIds })
      .getMany();
    const existingByUserId = new Map(existing.map((r) => [r.userId, r]));

    const payYm = month.slice(0, 7);
    const earningYmForTeachers = dayjs(month)
      .subtract(1, 'month')
      .startOf('month')
      .format('YYYY-MM');

    const toCreate: StaffSalary[] = [];
    for (const u of eligible) {
      let baseSalary = Number(u.salary ?? 0);
      if (u.role === UserRole.TEACHER) {
        const existingRow = existingByUserId.get(u.id);
        const force =
          !!existingRow && existingRow.status !== StaffSalaryStatus.PAID;

        const earning =
          await this.teacherEarningsService.calculateTeacherEarningsForMonth(
            organizationId,
            u.id,
            payYm,
            { force },
          );
        baseSalary = Number((earning as any).totalEarning ?? 0);
      }

      if (baseSalary <= 0) continue;

      const existingRow = existingByUserId.get(u.id);
      if (existingRow) {
        // If not paid yet, keep baseSalary in sync with latest earnings (commission updates, etc.)
        if (existingRow.status !== StaffSalaryStatus.PAID) {
          const currentBase = Number((existingRow as any).baseSalary ?? 0);
          if (currentBase !== baseSalary) {
            await this.staffSalaryRepo.update(
              { id: existingRow.id },
              { baseSalary: baseSalary as any },
            );
          }
        }
        continue;
      }

      toCreate.push(
        this.staffSalaryRepo.create({
          userId: u.id,
          user: u as any,
          forMonth: month as any,
          baseSalary,
          paidAmount: 0,
          status: StaffSalaryStatus.UNPAID,
        }),
      );
    }

    if (!toCreate.length) return;

    await this.staffSalaryRepo.save(toCreate);
  }

  async findAll(organizationId: number, forMonth?: string) {
    const month = this.normalizeForMonth(forMonth);

    // Ensure the month is populated so UI never sees an empty table.
    await this.ensureSalariesForMonth(organizationId, month.slice(0, 7));

    const rows = await this.staffSalaryRepo
      .createQueryBuilder('salary')
      .leftJoinAndSelect('salary.user', 'user')
      .leftJoin('user.organization', 'organization')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('salary.forMonth = :forMonth', { forMonth: month })
      .orderBy('user.createdAt', 'DESC')
      .getMany();

    const payYm = month.slice(0, 7);
    const earningYmForTeachers = dayjs(month)
      .subtract(1, 'month')
      .startOf('month')
      .format('YYYY-MM');

    const teacherEarningById = new Map<number, any>();
    for (const r of rows) {
      if (r.user?.role !== UserRole.TEACHER) continue;
      // eslint-disable-next-line no-await-in-loop
      const earning =
        await this.teacherEarningsService.calculateTeacherEarningsForMonth(
          organizationId,
          r.userId,
          payYm,
          { force: r.status !== StaffSalaryStatus.PAID },
        );
      teacherEarningById.set(r.userId, earning);
    }

    return rows.map((r: any) => {
      const baseSalary = Number(r.baseSalary ?? 0);
      const paidAmount = Number(r.paidAmount ?? 0);
      const out: any = {
        ...r,
        forMonth: r.forMonth ? dayjs(r.forMonth).format('YYYY-MM-DD') : null,
        createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
        paidAt: r.paidAt
          ? (r.paidAt.toISOString?.() ?? String(r.paidAt))
          : null,
        baseSalary,
        paidAmount,
      };

      // Enrich teacher rows with commission breakdown (so frontend can show it)
      if (r.user?.role === UserRole.TEACHER) {
        out.earningForMonth = `${earningYmForTeachers}-01`;
        const earning = teacherEarningById.get(r.userId);
        if (earning) {
          out.earningBaseSalarySnapshot = Number(
            (earning as any).baseSalarySnapshot ?? 0,
          );
          out.earningCommissionAmount = Number(
            (earning as any).commissionAmount ?? 0,
          );
          out.earningCarryOverCommission = Number(
            (earning as any).carryOverCommission ?? 0,
          );
          out.earningTotalEarning = Number((earning as any).totalEarning ?? 0);
        }
      }

      return out;
    });
  }

  async pay(id: number, dto: PayStaffSalaryDto) {
    const salary = await this.staffSalaryRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!salary) throw new NotFoundException('Salary record not found');

    const baseSalary = Number(salary.baseSalary ?? 0);
    const currentPaid = Number(salary.paidAmount ?? 0);
    const nextPaid = this.round2(currentPaid + Number(dto.amount));

    salary.paidAmount = Math.min(nextPaid, baseSalary) as any;

    if (salary.paidAmount >= baseSalary) {
      salary.status = StaffSalaryStatus.PAID;
      salary.paidAt = salary.paidAt ?? new Date();
    } else if (salary.paidAmount > 0) {
      salary.status = StaffSalaryStatus.PARTIAL;
      salary.paidAt = null;
    } else {
      salary.status = StaffSalaryStatus.UNPAID;
      salary.paidAt = null;
    }

    if (dto.comment !== undefined) {
      salary.comment = dto.comment ?? null;
    }

    const saved = await this.staffSalaryRepo.save(salary);
    return {
      ...saved,
      forMonth: saved.forMonth
        ? dayjs(saved.forMonth).format('YYYY-MM-DD')
        : null,
      createdAt: saved.createdAt?.toISOString?.() ?? String(saved.createdAt),
      paidAt: saved.paidAt
        ? (saved.paidAt.toISOString?.() ?? String(saved.paidAt))
        : null,
      baseSalary: Number(saved.baseSalary ?? 0),
      paidAmount: Number(saved.paidAmount ?? 0),
    };
  }
}
