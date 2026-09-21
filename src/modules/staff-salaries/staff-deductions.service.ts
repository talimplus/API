import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffDeduction } from '@/modules/staff-salaries/entities/staff-deduction.entity';
import { StaffSalaryDeduction } from '@/modules/staff-salaries/entities/staff-salary-deduction.entity';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { CreateStaffDeductionDto } from '@/modules/staff-salaries/dto/create-staff-deduction.dto';

const round2 = (n: number): number =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

@Injectable()
export class StaffDeductionsService {
  constructor(
    @InjectRepository(StaffDeduction)
    private readonly deductionRepo: Repository<StaffDeduction>,
    @InjectRepository(StaffSalaryDeduction)
    private readonly applicationRepo: Repository<StaffSalaryDeduction>,
    @InjectRepository(StaffSalary)
    private readonly salaryRepo: Repository<StaffSalary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Yozish
  // ─────────────────────────────────────────────────────────────

  /**
   * Jarima yozadi va imkon qadar shu oy oyligidan ushlab qoladi.
   *
   * Jarima oylikdan katta bo'lsa — sig'gani ushlanadi, qolgani ochiq qoladi
   * va keyingi oyliklardan avtomatik ushlanadi (`applyOutstanding`).
   */
  async create(dto: CreateStaffDeductionDto, reqUser: any) {
    const user = await this.userRepo.findOne({
      where: { id: dto.userId },
      relations: ['organization', 'center'],
    });
    if (!user) throw new NotFoundException('Xodim topilmadi');
    if ((user as any).organization?.id !== reqUser.organizationId) {
      throw new ForbiddenException(
        'Bu xodim sizning tashkilotingizga tegishli emas',
      );
    }

    const amount = round2(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException(
        'Jarima summasi 0 dan katta bo‘lishi kerak',
      );
    }

    const forMonth = this.normalizeMonth(dto.forMonth);

    const deduction = await this.deductionRepo.save(
      this.deductionRepo.create({
        userId: user.id,
        centerId: (user as any).center?.id ?? null,
        organizationId: reqUser.organizationId,
        sourceForMonth: forMonth as any,
        amount: amount as any,
        appliedAmount: 0 as any,
        type: dto.type ?? StaffDeductionType.OTHER,
        reason: dto.reason.trim(),
        createdById: reqUser.userId ?? null,
      }),
    );

    // Shu oy oyligi bo'lsa — darhol qo'llab ko'ramiz
    const salary = await this.salaryRepo.findOne({
      where: { userId: user.id, forMonth: forMonth as any },
    });
    if (salary) await this.applyOutstanding(salary);

    return this.findOne(deduction.id, reqUser);
  }

  /**
   * Jarimani bekor qiladi.
   *
   * O'chirish xodim foydasiga ishlaydi (qo'lga tegadigan summa oshadi), shuning
   * uchun to'langan oylikda ham ruxsat etiladi — lekin oylik holati qayta
   * hisoblanadi: jarima oylikni to'liq yeb qo'ygani uchun "to'langan" bo'lib
   * turgan qator yana "to'lanmagan" holatiga qaytadi.
   */
  async remove(id: number, reqUser: any) {
    const deduction = await this.getOwned(id, reqUser);

    const applications = await this.applicationRepo.find({
      where: { deductionId: deduction.id },
    });

    await this.dataSource.transaction(async (manager) => {
      for (const application of applications) {
        const salary = await manager.findOne(StaffSalary, {
          where: { id: application.staffSalaryId },
        });
        if (!salary) continue;

        const nextDeduction = round2(
          Math.max(
            0,
            Number(salary.deductionAmount ?? 0) - Number(application.amount),
          ),
        );
        const netSalary = round2(
          Math.max(0, Number(salary.baseSalary ?? 0) - nextDeduction),
        );
        const paid = Number(salary.paidAmount ?? 0);

        await manager.update(
          StaffSalary,
          { id: salary.id },
          {
            deductionAmount: nextDeduction as any,
            status: this.statusFor(paid, netSalary),
            paidAt: paid >= netSalary ? (salary.paidAt ?? new Date()) : null,
          },
        );
      }

      await manager.delete(StaffSalaryDeduction, { deductionId: deduction.id });
      await manager.delete(StaffDeduction, { id: deduction.id });
    });

    return { success: true };
  }

  private statusFor(paid: number, netSalary: number): StaffSalaryStatus {
    if (paid >= netSalary) return StaffSalaryStatus.PAID;
    return paid > 0 ? StaffSalaryStatus.PARTIAL : StaffSalaryStatus.UNPAID;
  }

  // ─────────────────────────────────────────────────────────────
  // Qo'llash
  // ─────────────────────────────────────────────────────────────

  /**
   * Xodimning ochiq jarimalarini shu oy oyligiga qo'llaydi (eskisidan boshlab).
   *
   * Idempotent: faqat hali ushlanmagan qismni va faqat oylikka sig'adigan
   * miqdorni qo'llaydi, shuning uchun har o'qishda xavfsiz chaqiriladi.
   * To'langan summadan pastga tushib ketmaydi — aks holda xodimga ortiqcha
   * berilgan bo'lib qolardi.
   */
  async applyOutstanding(salary: StaffSalary): Promise<number> {
    const baseSalary = Number(salary.baseSalary ?? 0);
    const paidAmount = Number(salary.paidAmount ?? 0);
    const alreadyApplied = Number(salary.deductionAmount ?? 0);

    // Ushlab qolish mumkin bo'lgan eng katta summa
    const capacity = round2(
      Math.max(0, baseSalary - alreadyApplied - paidAmount),
    );
    if (capacity <= 0) return alreadyApplied;

    const monthEnd = dayjs(salary.forMonth).endOf('month').format('YYYY-MM-DD');
    const open = await this.deductionRepo
      .createQueryBuilder('d')
      .where('d."userId" = :userId', { userId: salary.userId })
      .andWhere('d."sourceForMonth" <= :monthEnd', { monthEnd })
      .andWhere('d."amount" > d."appliedAmount"')
      .orderBy('d.sourceForMonth', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .getMany();
    if (!open.length) return alreadyApplied;

    let left = capacity;
    let applied = alreadyApplied;

    await this.dataSource.transaction(async (manager) => {
      for (const deduction of open) {
        if (left <= 0) break;

        const remaining = round2(
          Number(deduction.amount) - Number(deduction.appliedAmount),
        );
        if (remaining <= 0) continue;

        const take = round2(Math.min(remaining, left));

        // Bitta jarima bitta oylikka bir necha marta qo'llanishi mumkin
        // (masalan baseSalary keyinroq oshsa) — shuning uchun upsert
        const existing = await manager.findOne(StaffSalaryDeduction, {
          where: { staffSalaryId: salary.id, deductionId: deduction.id },
        });
        if (existing) {
          existing.amount = round2(Number(existing.amount) + take) as any;
          await manager.save(existing);
        } else {
          await manager.save(
            manager.create(StaffSalaryDeduction, {
              staffSalaryId: salary.id,
              deductionId: deduction.id,
              amount: take as any,
            }),
          );
        }

        const nextApplied = round2(Number(deduction.appliedAmount) + take);
        await manager.update(
          StaffDeduction,
          { id: deduction.id },
          {
            appliedAmount: nextApplied as any,
            settledAt:
              nextApplied >= Number(deduction.amount) ? new Date() : null,
          },
        );

        left = round2(left - take);
        applied = round2(applied + take);
      }

      if (applied !== alreadyApplied) {
        await manager.update(
          StaffSalary,
          { id: salary.id },
          { deductionAmount: applied as any },
        );
      }
    });

    salary.deductionAmount = applied as any;
    return applied;
  }

  // ─────────────────────────────────────────────────────────────
  // O'qish
  // ─────────────────────────────────────────────────────────────

  /** Xodimning hali ushlanmagan jarimalari yig'indisi (keyingi oyliklarga qoladi) */
  async getOutstanding(userId: number): Promise<number> {
    const row = await this.deductionRepo
      .createQueryBuilder('d')
      .select('COALESCE(SUM(d."amount" - d."appliedAmount"), 0)', 'total')
      .where('d."userId" = :userId', { userId })
      .andWhere('d."amount" > d."appliedAmount"')
      .getRawOne<{ total: string }>();
    return round2(Number(row?.total ?? 0));
  }

  /** Bir nechta xodim uchun birdan (ro'yxat uchun N+1 dan qochish) */
  async getOutstandingMap(userIds: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (!userIds.length) return result;

    const rows = await this.deductionRepo
      .createQueryBuilder('d')
      .select('d."userId"', 'userId')
      .addSelect('COALESCE(SUM(d."amount" - d."appliedAmount"), 0)', 'total')
      .where('d."userId" IN (:...userIds)', { userIds })
      .andWhere('d."amount" > d."appliedAmount"')
      .groupBy('d."userId"')
      .getRawMany<{ userId: number; total: string }>();

    for (const row of rows) {
      result.set(Number(row.userId), round2(Number(row.total ?? 0)));
    }
    return result;
  }

  async listForUser(userId: number, reqUser: any) {
    const rows = await this.deductionRepo.find({
      where: { userId, organizationId: reqUser.organizationId },
      relations: ['createdBy'],
      order: { sourceForMonth: 'DESC', id: 'DESC' },
    });
    return rows.map((row) => this.toView(row));
  }

  /** Shu oylikka aynan qaysi jarimalardan qancha ushlangani */
  async listForSalary(staffSalaryId: number) {
    const rows = await this.applicationRepo.find({
      where: { staffSalaryId },
      relations: ['deduction', 'deduction.createdBy'],
      order: { id: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      deductionId: row.deductionId,
      amount: Number(row.amount ?? 0),
      reason: row.deduction?.reason ?? null,
      type: row.deduction?.type ?? null,
      sourceForMonth: row.deduction?.sourceForMonth
        ? dayjs(row.deduction.sourceForMonth).format('YYYY-MM-DD')
        : null,
    }));
  }

  async findOne(id: number, reqUser: any) {
    return this.toView(await this.getOwned(id, reqUser));
  }

  // ─────────────────────────────────────────────────────────────

  private async getOwned(id: number, reqUser: any): Promise<StaffDeduction> {
    const row = await this.deductionRepo.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!row) throw new NotFoundException('Jarima topilmadi');
    if (row.organizationId !== reqUser.organizationId) {
      throw new ForbiddenException('Bu yozuvga ruxsatingiz yo‘q');
    }
    return row;
  }

  private normalizeMonth(forMonth?: string): string {
    const ym = forMonth?.trim() || dayjs().format('YYYY-MM');
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new BadRequestException(
        'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak',
      );
    }
    return `${ym}-01`;
  }

  private toView(row: StaffDeduction) {
    const amount = Number(row.amount ?? 0);
    const appliedAmount = Number(row.appliedAmount ?? 0);
    return {
      id: row.id,
      userId: row.userId,
      amount,
      appliedAmount,
      remainingAmount: round2(amount - appliedAmount),
      type: row.type,
      reason: row.reason,
      sourceForMonth: row.sourceForMonth
        ? dayjs(row.sourceForMonth).format('YYYY-MM-DD')
        : null,
      settledAt: row.settledAt,
      createdAt: row.createdAt,
      createdBy: row.createdBy
        ? {
            id: row.createdBy.id,
            firstName: row.createdBy.firstName,
            lastName: row.createdBy.lastName,
          }
        : null,
    };
  }
}
