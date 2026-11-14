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
import { CreateStaffAdvanceDto } from '@/modules/staff-salaries/dto/create-staff-adjustment.dto';
import {
  round2,
  salaryCapacity,
  salaryNet,
} from '@/modules/staff-salaries/salary-math';

/** Hali ushlanmagan qism qaysi turdan: jarimalar yoki avanslar. */
export enum OutstandingKind {
  FINE = 'fine',
  ADVANCE = 'advance',
}

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
    if (user.dismissedAt) {
      throw new BadRequestException(
        "Xodim ishdan bo'shatilgan — unga jarima yoki avans yozilmaydi",
      );
    }

    const amount = round2(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException('Summa 0 dan katta bo‘lishi kerak');
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
   * Avans: pul hozir xodimga beriladi va tanlangan oy oyligidan ushlanadi
   * (sig'masa keyingi oyliklardan — jarima bilan bir xil FIFO). Oy kelajak
   * bo'lishi mumkin, lekin keyingi oydan uzoq emas.
   */
  async createAdvance(dto: CreateStaffAdvanceDto, reqUser: any) {
    const month = this.normalizeMonth(dto.forMonth);
    const maxMonth = dayjs()
      .add(1, 'month')
      .startOf('month')
      .format('YYYY-MM-DD');
    if (month > maxMonth) {
      throw new BadRequestException(
        'Avans keyingi oydan uzoq oy oyligiga yozilmaydi',
      );
    }
    return this.create(
      {
        userId: dto.userId,
        amount: dto.amount,
        forMonth: month.slice(0, 7),
        type: StaffDeductionType.ADVANCE,
        reason: dto.comment?.trim() || 'Avans',
      },
      reqUser,
    );
  }

  /**
   * Jarimani bekor qiladi.
   *
   * O'chirish xodim foydasiga ishlaydi (qo'lga tegadigan summa oshadi), shuning
   * uchun to'langan oylikda ham ruxsat etiladi — lekin oylik holati qayta
   * hisoblanadi: jarima oylikni to'liq yeb qo'ygani uchun "to'langan" bo'lib
   * turgan qator yana "to'lanmagan" holatiga qaytadi.
   */
  async remove(id: number, reqUser: any, kind?: OutstandingKind) {
    const deduction = await this.getOwned(id, reqUser);
    // Jarima va avans turli ruxsat bilan o'chiriladi — endpoint o'z turini so'raydi.
    const isAdvanceRow = deduction.type === StaffDeductionType.ADVANCE;
    if (kind && isAdvanceRow !== (kind === OutstandingKind.ADVANCE)) {
      throw new NotFoundException(
        kind === OutstandingKind.ADVANCE
          ? 'Avans topilmadi'
          : 'Jarima topilmadi',
      );
    }

    const applications = await this.applicationRepo.find({
      where: { deductionId: deduction.id },
    });

    const isAdvance = deduction.type === StaffDeductionType.ADVANCE;
    await this.dataSource.transaction(async (manager) => {
      for (const application of applications) {
        const salary = await manager.findOne(StaffSalary, {
          where: { id: application.staffSalaryId },
        });
        if (!salary) continue;

        const take = Number(application.amount);
        const nextDeduction = round2(
          Math.max(0, Number(salary.deductionAmount ?? 0) - take),
        );
        const nextAdvance = isAdvance
          ? round2(Math.max(0, Number(salary.advanceAmount ?? 0) - take))
          : Number(salary.advanceAmount ?? 0);
        const netSalary = salaryNet({
          ...salary,
          deductionAmount: nextDeduction,
        });
        const paid = Number(salary.paidAmount ?? 0);

        await manager.update(
          StaffSalary,
          { id: salary.id },
          {
            deductionAmount: nextDeduction as any,
            advanceAmount: nextAdvance as any,
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
   * Oylik kichraysa (mukofot bekor qilindi, hisoblangan oylik kamaydi) unga
   * qo'llangan ushlanma sig'imdan oshib qoladi. Ortig'i qaytariladi — eng
   * oxirgi qo'llangandan boshlab — va yana "keyingi oyliklardan ushlanadi"
   * holatiga o'tadi. Berilgan pul (`paidAmount`) tegilmaydi. Idempotent.
   */
  async releaseExcess(salary: StaffSalary): Promise<void> {
    const room =
      Number(salary.baseSalary ?? 0) +
      Number(salary.bonusAmount ?? 0) -
      Number(salary.paidAmount ?? 0);
    let excess = round2(
      Number(salary.deductionAmount ?? 0) - Math.max(0, room),
    );
    if (excess <= 0) return;

    const applications = await this.applicationRepo.find({
      where: { staffSalaryId: salary.id },
      relations: ['deduction'],
    });
    applications.sort(
      (a, b) =>
        String(b.deduction?.sourceForMonth ?? '').localeCompare(
          String(a.deduction?.sourceForMonth ?? ''),
        ) || b.deductionId - a.deductionId,
    );

    let deductionAmount = Number(salary.deductionAmount ?? 0);
    let advanceAmount = Number(salary.advanceAmount ?? 0);
    await this.dataSource.transaction(async (manager) => {
      for (const app of applications) {
        if (excess <= 0) break;
        const back = round2(Math.min(Number(app.amount), excess));
        if (back <= 0) continue;
        const left = round2(Number(app.amount) - back);
        if (left > 0) {
          await manager.update(
            StaffSalaryDeduction,
            { id: app.id },
            { amount: left as any },
          );
        } else {
          await manager.delete(StaffSalaryDeduction, { id: app.id });
        }
        await manager.update(
          StaffDeduction,
          { id: app.deductionId },
          {
            appliedAmount: round2(
              Number(app.deduction.appliedAmount) - back,
            ) as any,
            settledAt: null,
          },
        );
        deductionAmount = round2(deductionAmount - back);
        if (app.deduction.type === StaffDeductionType.ADVANCE) {
          advanceAmount = round2(advanceAmount - back);
        }
        excess = round2(excess - back);
      }
      const net = salaryNet({ ...salary, deductionAmount });
      const paid = Number(salary.paidAmount ?? 0);
      await manager.update(
        StaffSalary,
        { id: salary.id },
        {
          deductionAmount: deductionAmount as any,
          advanceAmount: advanceAmount as any,
          status: this.statusFor(paid, net),
          paidAt: paid >= net ? (salary.paidAt ?? new Date()) : null,
        },
      );
    });
    salary.deductionAmount = deductionAmount as any;
    salary.advanceAmount = advanceAmount as any;
  }

  /**
   * Xodimning ochiq jarimalarini shu oy oyligiga qo'llaydi (eskisidan boshlab).
   *
   * Idempotent: faqat hali ushlanmagan qismni va faqat oylikka sig'adigan
   * miqdorni qo'llaydi, shuning uchun har o'qishda xavfsiz chaqiriladi.
   * To'langan summadan pastga tushib ketmaydi — aks holda xodimga ortiqcha
   * berilgan bo'lib qolardi.
   */
  async applyOutstanding(salary: StaffSalary): Promise<number> {
    const alreadyApplied = Number(salary.deductionAmount ?? 0);
    const alreadyAdvance = Number(salary.advanceAmount ?? 0);

    // Ushlab qolish mumkin bo'lgan eng katta summa (mukofot ham oylikka kiradi)
    const capacity = salaryCapacity(salary);
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
    let advance = alreadyAdvance;

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
        if (deduction.type === StaffDeductionType.ADVANCE) {
          advance = round2(advance + take);
        }
      }

      if (applied !== alreadyApplied) {
        await manager.update(
          StaffSalary,
          { id: salary.id },
          { deductionAmount: applied as any, advanceAmount: advance as any },
        );
      }
    });

    salary.deductionAmount = applied as any;
    salary.advanceAmount = advance as any;
    return applied;
  }

  // ─────────────────────────────────────────────────────────────
  // O'qish
  // ─────────────────────────────────────────────────────────────

  /** Turi bo'yicha shart: jarimalar (avanssiz) yoki faqat avanslar. */
  private kindClause(kind: OutstandingKind): string {
    return kind === OutstandingKind.ADVANCE
      ? `d."type" = '${StaffDeductionType.ADVANCE}'`
      : `d."type" <> '${StaffDeductionType.ADVANCE}'`;
  }

  /**
   * Xodimning hali ushlanmagan qoldig'i (keyingi oyliklarga qoladi):
   * default — jarimalar, `ADVANCE` — avanslar.
   */
  async getOutstanding(
    userId: number,
    kind: OutstandingKind = OutstandingKind.FINE,
  ): Promise<number> {
    const row = await this.deductionRepo
      .createQueryBuilder('d')
      .select('COALESCE(SUM(d."amount" - d."appliedAmount"), 0)', 'total')
      .where('d."userId" = :userId', { userId })
      .andWhere('d."amount" > d."appliedAmount"')
      .andWhere(this.kindClause(kind))
      .getRawOne<{ total: string }>();
    return round2(Number(row?.total ?? 0));
  }

  /** Bir nechta xodim uchun birdan (ro'yxat uchun N+1 dan qochish) */
  async getOutstandingMap(
    userIds: number[],
    kind: OutstandingKind = OutstandingKind.FINE,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (!userIds.length) return result;

    const rows = await this.deductionRepo
      .createQueryBuilder('d')
      .select('d."userId"', 'userId')
      .addSelect('COALESCE(SUM(d."amount" - d."appliedAmount"), 0)', 'total')
      .where('d."userId" IN (:...userIds)', { userIds })
      .andWhere('d."amount" > d."appliedAmount"')
      .andWhere(this.kindClause(kind))
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
