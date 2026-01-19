import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffSalaryPayment } from '@/modules/staff-salaries/entities/staff-salary-payment.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { User } from '@/modules/users/entities/user.entity';
import { UserRole } from '@/common/enums/user-role.enums';
import { dayjs } from '@/shared/utils/dayjs';
import { PayStaffSalaryDto } from '@/modules/staff-salaries/dto/pay-staff-salary.dto';
import { TeacherEarningsService } from '@/modules/teacher-earnings/teacher-earnings.service';
import { PaymentReceipt, PaymentReceiptStatus } from '@/modules/payments/entities/payment-receipt.entity';
import { CurrentUser } from '@/common/types/current.user';

@Injectable()
export class StaffSalariesService {
  constructor(
    @InjectRepository(StaffSalary)
    private readonly staffSalaryRepo: Repository<StaffSalary>,
    @InjectRepository(StaffSalaryPayment)
    private readonly salaryPaymentRepo: Repository<StaffSalaryPayment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PaymentReceipt)
    private readonly receiptRepo: Repository<PaymentReceipt>,
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

  async ensureSalariesForMonth(
    organizationId: number,
    forMonth: string,
    centerId?: number,
  ) {
    const month = this.normalizeForMonth(forMonth);
    // pay month start boundary (salary for this pay-month is for previous month work)
    // If employee was created in the pay month, they should NOT get a salary row for this pay month.
    const monthStart = dayjs(month).startOf('month').toDate();

    const employees = await this.userRepo.find({
      where: [
        { role: UserRole.TEACHER },
        { role: UserRole.MANAGER },
        { role: UserRole.RECEPTION },
        { role: UserRole.OTHER },
      ],
      relations: ['organization', 'center'],
    });

    const eligible = employees.filter((u) => {
      if (u.organization?.id !== organizationId) return false;
      if (centerId && (u as any).center?.id !== centerId) return false;
      // Do not create salaries for months before the employee existed in the system.
      // Example: user created in 2026-01 must not get a salary row for 2025-05.
      // Also: if user was created within the pay month, they will appear starting next month.
      if (u.createdAt && !dayjs(u.createdAt).isBefore(monthStart)) {
        return false;
      }
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
      } else if (
        u.role === UserRole.MANAGER || u.role === UserRole.RECEPTION
      ) {
        // Add commission from payment receipts (confirmed receipts from previous month)
        const earningYm = dayjs(month)
          .subtract(1, 'month')
          .startOf('month')
          .format('YYYY-MM');
        const earningMonthStart = dayjs(`${earningYm}-01`)
          .startOf('month')
          .toDate();
        const earningMonthEnd = dayjs(`${earningYm}-01`)
          .endOf('month')
          .toDate();

        const receipts = await this.receiptRepo
          .createQueryBuilder('r')
          .leftJoin('r.receivedBy', 'u')
          .where('r.status = :status', { status: PaymentReceiptStatus.CONFIRMED })
          .andWhere('u.id = :userId', { userId: u.id })
          .andWhere('r.confirmedAt >= :start', { start: earningMonthStart })
          .andWhere('r.confirmedAt <= :end', { end: earningMonthEnd })
          .andWhere('r.receiverCommissionAmountSnapshot IS NOT NULL')
          .getMany();

        const commissionTotal = receipts.reduce(
          (sum, r) => sum + Number(r.receiverCommissionAmountSnapshot ?? 0),
          0,
        );
        baseSalary = this.round2(baseSalary + commissionTotal);
      }

      if (baseSalary <= 0) continue;

      const existingRow = existingByUserId.get(u.id);
      if (existingRow) {
        // If not paid yet, keep baseSalary in sync with latest earnings (commission updates, etc.)
        // This includes manager/reception commission updates from new confirmed receipts
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

  async findAll(organizationId: number, forMonth?: string, centerId?: number) {
    const month = this.normalizeForMonth(forMonth);
    const monthStart = dayjs(month).startOf('month').toDate();

    // Ensure the month is populated so UI never sees an empty table.
    await this.ensureSalariesForMonth(organizationId, month.slice(0, 7), centerId);

    const rows = await this.staffSalaryRepo
      .createQueryBuilder('salary')
      .leftJoinAndSelect('salary.user', 'user')
      .leftJoin('user.organization', 'organization')
      .leftJoin('user.center', 'center')
      .where('organization.id = :organizationId', { organizationId })
      .andWhere('salary.forMonth = :forMonth', { forMonth: month })
      .andWhere(centerId ? 'center.id = :centerId' : '1=1', { centerId })
      .andWhere('user.createdAt < :monthStart', { monthStart })
      .orderBy('user.createdAt', 'DESC')
      .getMany();

    // Load payment history for all salaries
    const salaryIds = rows.map((r) => r.id);
    const paymentHistoryMap = new Map<number, StaffSalaryPayment[]>();
    if (salaryIds.length > 0) {
      const payments = await this.salaryPaymentRepo.find({
        where: salaryIds.map((id) => ({ staffSalaryId: id })),
        relations: ['paidBy'],
        order: { paidAt: 'DESC' },
      });
      for (const p of payments) {
        const list = paymentHistoryMap.get(p.staffSalaryId) || [];
        list.push(p);
        paymentHistoryMap.set(p.staffSalaryId, list);
      }
    }

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
      const paymentHistory = paymentHistoryMap.get(r.id) || [];
      const out: any = {
        ...r,
        forMonth: r.forMonth ? dayjs(r.forMonth).format('YYYY-MM-DD') : null,
        createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
        paidAt: r.paidAt
          ? (r.paidAt.toISOString?.() ?? String(r.paidAt))
          : null,
        baseSalary,
        paidAmount,
        paymentHistory: paymentHistory.map((p) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          comment: p.comment ?? null,
          paidAt: p.paidAt?.toISOString?.() ?? String(p.paidAt),
          paidBy: p.paidBy
            ? {
                id: p.paidBy.id,
                firstName: p.paidBy.firstName,
                lastName: p.paidBy.lastName,
              }
            : null,
        })),
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

  async pay(id: number, dto: PayStaffSalaryDto, currentUser?: CurrentUser) {
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

    const saved = await this.staffSalaryRepo.save(salary);

    // Create payment history record
    const paymentRecord = this.salaryPaymentRepo.create({
      staffSalaryId: saved.id,
      amount: this.round2(Number(dto.amount)) as any,
      comment: dto.comment ?? null,
      paidById: currentUser?.userId ?? null,
    });
    await this.salaryPaymentRepo.save(paymentRecord);

    // Load payment history
    const paymentHistory = await this.salaryPaymentRepo.find({
      where: { staffSalaryId: saved.id },
      relations: ['paidBy'],
      order: { paidAt: 'DESC' },
    });

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
      paymentHistory: paymentHistory.map((p) => ({
        id: p.id,
        amount: Number(p.amount ?? 0),
        comment: p.comment ?? null,
        paidAt: p.paidAt?.toISOString?.() ?? String(p.paidAt),
        paidBy: p.paidBy
          ? {
              id: p.paidBy.id,
              firstName: p.paidBy.firstName,
              lastName: p.paidBy.lastName,
            }
          : null,
      })),
    };
  }
}
