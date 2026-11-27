import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffDeduction } from '@/modules/staff-salaries/entities/staff-deduction.entity';
import { StaffSalaryDeduction } from '@/modules/staff-salaries/entities/staff-salary-deduction.entity';
import { StaffDeductionType } from '@/modules/staff-salaries/enums/staff-deduction-type.enum';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { CreateStaffDeductionDto } from '@/modules/staff-salaries/dto/create-staff-deduction.dto';
import {
  CreateStaffAdvanceDto,
  UpdateStaffAdvanceDto,
} from '@/modules/staff-salaries/dto/create-staff-adjustment.dto';
import {
  round2,
  isSalaryFrozen,
  salaryStatusOf,
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
    this.assertAdvanceMonth(month);
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

    const touched = await this.dataSource.transaction(async (manager) => {
      const salaries = await this.unapply(manager, deduction);
      await manager.delete(StaffDeduction, { id: deduction.id });
      return salaries;
    });
    // Bo'shagan joyga boshqa ochiq jarima/avanslar tushadi.
    await this.reapplyFrom(deduction.userId, touched[0]);

    return { success: true };
  }

  /**
   * Xato kiritilgan avansni tuzatadi (summa, oy, izoh). Avans avval barcha
   * oyliklardan to'liq qaytariladi, keyin yangi summa/oy bo'yicha qaytadan
   * ushlanadi — xuddi o'chirib qaytadan kiritgandek, faqat yozuv o'sha qoladi.
   * Berilgan pul (`paidAmount`) tegilmaydi: summa oshsa va oylik berib
   * bo'lingan bo'lsa, oshgan qismi keyingi oyliklardan ushlanadi.
   */
  async updateAdvance(id: number, dto: UpdateStaffAdvanceDto, reqUser: any) {
    const deduction = await this.getOwned(id, reqUser);
    if (deduction.type !== StaffDeductionType.ADVANCE) {
      throw new NotFoundException('Avans topilmadi');
    }
    const oldMonth = dayjs(deduction.sourceForMonth).format('YYYY-MM-DD');
    const month =
      dto.forMonth !== undefined ? this.normalizeMonth(dto.forMonth) : oldMonth;
    if (month !== oldMonth) this.assertAdvanceMonth(month);
    const amount =
      dto.amount !== undefined ? round2(dto.amount) : Number(deduction.amount);
    if (amount <= 0) {
      throw new BadRequestException('Summa 0 dan katta bo‘lishi kerak');
    }
    const reason =
      dto.comment !== undefined
        ? dto.comment.trim() || 'Avans'
        : deduction.reason;

    await this.dataSource.transaction(async (manager) => {
      await this.unapply(manager, deduction);
      await manager.update(
        StaffDeduction,
        { id: deduction.id },
        {
          amount: amount as any,
          appliedAmount: 0 as any,
          settledAt: null,
          sourceForMonth: month as any,
          reason,
        },
      );
    });
    await this.reapplyFrom(
      deduction.userId,
      month < oldMonth ? month : oldMonth,
    );

    return this.findOne(deduction.id, reqUser);
  }

  /**
   * Ushlanmani u qo'llangan barcha oyliklardan qaytaradi (yozuvning o'zi
   * qoladi). Qaytarilgan oyliklarning `forMonth` lari o'sish tartibida.
   */
  private async unapply(
    manager: EntityManager,
    deduction: StaffDeduction,
  ): Promise<string[]> {
    const applications = await manager.find(StaffSalaryDeduction, {
      where: { deductionId: deduction.id },
    });
    const months: string[] = [];
    await this.lockUser(manager, deduction.userId);

    const isAdvance = deduction.type === StaffDeductionType.ADVANCE;
    for (const application of applications) {
      const salary = await manager.findOne(StaffSalary, {
        where: { id: application.staffSalaryId },
      });
      if (!salary) continue;
      months.push(dayjs(salary.forMonth).format('YYYY-MM-DD'));

      const take = Number(application.amount);
      const nextDeduction = round2(
        Math.max(0, Number(salary.deductionAmount ?? 0) - take),
      );
      const nextAdvance = isAdvance
        ? round2(Math.max(0, Number(salary.advanceAmount ?? 0) - take))
        : Number(salary.advanceAmount ?? 0);
      const status = salaryStatusOf({
        ...salary,
        deductionAmount: nextDeduction,
      });

      await manager.update(
        StaffSalary,
        { id: salary.id },
        {
          deductionAmount: nextDeduction as any,
          advanceAmount: nextAdvance as any,
          status,
          paidAt:
            status === StaffSalaryStatus.PAID
              ? (salary.paidAt ?? new Date())
              : null,
        },
      );
    }

    await manager.delete(StaffSalaryDeduction, { deductionId: deduction.id });
    return months.sort();
  }

  /**
   * Xodimning `fromMonth` va undan keyingi barcha oyliklariga ochiq
   * jarima/avanslarni qaytadan qo'llaydi (eski oydan boshlab, FIFO).
   */
  private async reapplyFrom(userId: number, fromMonth?: string): Promise<void> {
    if (!fromMonth) return;
    await this.rebuildUser(userId);
  }

  private assertAdvanceMonth(month: string): void {
    const maxMonth = dayjs()
      .add(1, 'month')
      .startOf('month')
      .format('YYYY-MM-DD');
    if (month > maxMonth) {
      throw new BadRequestException(
        'Avans keyingi oydan uzoq oy oyligiga yozilmaydi',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Qo'llash
  // ─────────────────────────────────────────────────────────────

  /**
   * Xodimning oylik ushlanmalari bilan ishlash bitta qulf ostida: o'qituvchi
   * daromadi (chek tasdig'i, fire-and-forget) va oylik ro'yxati bir vaqtda
   * qayta hisoblasa ham bitta avans ikki marta ushlanmaydi.
   */
  private async lockUser(manager: EntityManager, userId: number) {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext('staff_salary_deductions'), $1)`,
      [userId],
    );
  }

  /**
   * Oylik qatorini ushlanmalar bilan moslaydi — yagona kirish nuqtasi.
   * `baseSalary` berilsa yoziladi, keyin xodimning BUTUN taqsimoti qayta
   * quriladi (`rebuildUserTx`). Qulf ostida, idempotent.
   */
  async resync(
    salaryId: number,
    patch?: { baseSalary?: number },
  ): Promise<StaffSalary | null> {
    const head = await this.salaryRepo.findOne({ where: { id: salaryId } });
    if (!head) return null;

    return this.dataSource.transaction(async (manager) => {
      await this.lockUser(manager, head.userId);
      if (patch?.baseSalary !== undefined) {
        await manager.update(
          StaffSalary,
          { id: salaryId },
          { baseSalary: round2(patch.baseSalary) as any },
        );
      }
      await this.rebuildUserTx(manager, head.userId);
      return manager.findOne(StaffSalary, { where: { id: salaryId } });
    });
  }

  /** Xodimning taqsimotini qayta quradi (skript va avans yozilganda). */
  async rebuildUser(userId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockUser(manager, userId);
      await this.rebuildUserTx(manager, userId);
    });
  }

  /** `resync` natijasini chaqiruvchining obyektiga ko'chiradi. */
  private async resyncInto(salary: StaffSalary): Promise<void> {
    const fresh = await this.resync(salary.id);
    if (!fresh) return;
    salary.baseSalary = fresh.baseSalary;
    salary.deductionAmount = fresh.deductionAmount;
    salary.advanceAmount = fresh.advanceAmount;
    salary.status = fresh.status;
    salary.paidAt = fresh.paidAt;
  }

  /** Eski nom — endi butun taqsimotni qayta quradi. */
  async releaseExcess(salary: StaffSalary): Promise<void> {
    await this.resyncInto(salary);
  }

  /** Eski nom — endi butun taqsimotni qayta quradi. */
  async applyOutstanding(salary: StaffSalary): Promise<number> {
    await this.resyncInto(salary);
    return Number(salary.deductionAmount ?? 0);
  }

  /**
   * Xodimning avans va jarimalari qaysi oy oyligidan qancha ushlanishini
   * NOLDAN hisoblab chiqadi va bazani shunga moslaydi (2026-11-28).
   *
   * Qoida: oylar eskidan yangiga qarab to'ldiriladi. Har bir oyga avval
   * eng eski ushlanma (o'zi tanlangan oy bo'yicha, keyin id) tushadi —
   * ushlanma o'zi tanlangan oydan OLDINGI oyga tushmaydi. Oy oyligiga
   * sig'magani keyingi oyga o'tadi. Ya'ni oldingi oyda joy bor ekan,
   * avans keyingi oyga ushlanmaydi.
   *
   * Ilgari ushlanma "qo'llangan joyida" qolardi: noyabr oktyabrdan oldin
   * hisoblansa, oktyabr avansi noyabrga tushib, oktyabr keyin oshganda ham
   * o'sha yerda qolib ketardi (prod, user 358).
   *
   * Muzlatilgan oylik (pul berib yopilgan o'tgan oy) tegilmaydi — undagi
   * ushlanmalar o'zgarmas. Oy sig'imi = oylik + mukofot − berilgan pul.
   * Faqat farq yoziladi: o'zgarmagan qatorlarga UPDATE yo'q, dublikat yo'q.
   */
  private async rebuildUserTx(
    manager: EntityManager,
    userId: number,
  ): Promise<void> {
    const salaries = await manager
      .getRepository(StaffSalary)
      .createQueryBuilder('s')
      .where('s."userId" = :userId', { userId })
      .orderBy('s."forMonth"', 'ASC')
      .getMany();
    const deductions = await manager
      .getRepository(StaffDeduction)
      .createQueryBuilder('d')
      .where('d."userId" = :userId', { userId })
      .orderBy('d."sourceForMonth"', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .getMany();
    const salaryIds = salaries.map((s) => s.id);
    const current = salaryIds.length
      ? await manager
          .getRepository(StaffSalaryDeduction)
          .createQueryBuilder('a')
          .where('a."staffSalaryId" IN (:...salaryIds)', { salaryIds })
          .getMany()
      : [];

    const key = (salaryId: number, deductionId: number) =>
      `${salaryId}:${deductionId}`;
    const frozenIds = new Set(
      salaries.filter((s) => isSalaryFrozen(s)).map((s) => s.id),
    );

    // Qolgan (ushlanmagan) summa — muzlagan oyliklardagisi o'zgarmas.
    const left = new Map<number, number>(
      deductions.map((d) => [d.id, Number(d.amount)]),
    );
    const target = new Map<string, number>();
    for (const app of current) {
      if (!frozenIds.has(app.staffSalaryId)) continue;
      target.set(key(app.staffSalaryId, app.deductionId), Number(app.amount));
      left.set(
        app.deductionId,
        round2((left.get(app.deductionId) ?? 0) - Number(app.amount)),
      );
    }

    const monthStr = (s: StaffSalary) => dayjs(s.forMonth).format('YYYY-MM-DD');
    const srcStr = (d: StaffDeduction) =>
      dayjs(d.sourceForMonth).format('YYYY-MM-DD');
    for (const salary of salaries) {
      if (frozenIds.has(salary.id)) continue;
      let room = round2(
        Math.max(
          0,
          Number(salary.baseSalary ?? 0) +
            Number(salary.bonusAmount ?? 0) -
            Number(salary.paidAmount ?? 0),
        ),
      );
      for (const d of deductions) {
        if (room <= 0) break;
        if (srcStr(d) > monthStr(salary)) continue;
        const take = round2(Math.min(left.get(d.id) ?? 0, room));
        if (take <= 0) continue;
        target.set(key(salary.id, d.id), take);
        left.set(d.id, round2((left.get(d.id) ?? 0) - take));
        room = round2(room - take);
      }
    }

    // ── Farqni yozish ──
    const seen = new Set<string>();
    for (const app of current) {
      const k = key(app.staffSalaryId, app.deductionId);
      seen.add(k);
      const want = target.get(k) ?? 0;
      if (want <= 0) {
        await manager.delete(StaffSalaryDeduction, { id: app.id });
      } else if (round2(Number(app.amount)) !== want) {
        await manager.update(
          StaffSalaryDeduction,
          { id: app.id },
          { amount: want as any },
        );
      }
    }
    for (const [k, amount] of target) {
      if (seen.has(k) || amount <= 0) continue;
      const [staffSalaryId, deductionId] = k.split(':').map(Number);
      await manager.save(
        manager.create(StaffSalaryDeduction, {
          staffSalaryId,
          deductionId,
          amount: amount as any,
        }),
      );
    }

    for (const d of deductions) {
      const applied = round2(Number(d.amount) - (left.get(d.id) ?? 0));
      const settled = applied >= Number(d.amount);
      if (
        round2(Number(d.appliedAmount)) !== applied ||
        !!d.settledAt !== settled
      ) {
        await manager.update(
          StaffDeduction,
          { id: d.id },
          {
            appliedAmount: applied as any,
            settledAt: settled ? (d.settledAt ?? new Date()) : null,
          },
        );
      }
    }

    const typeById = new Map(deductions.map((d) => [d.id, d.type]));
    for (const salary of salaries) {
      let deduction = 0;
      let advance = 0;
      for (const [k, amount] of target) {
        const [sid, did] = k.split(':').map(Number);
        if (sid !== salary.id) continue;
        deduction += amount;
        if (typeById.get(did) === StaffDeductionType.ADVANCE) advance += amount;
      }
      const next = {
        ...salary,
        deductionAmount: round2(deduction),
        advanceAmount: round2(advance),
      };
      const status = frozenIds.has(salary.id)
        ? salary.status
        : salaryStatusOf(next);
      const paidAt =
        status === StaffSalaryStatus.PAID
          ? (salary.paidAt ?? new Date())
          : null;
      if (
        round2(Number(salary.deductionAmount ?? 0)) !== next.deductionAmount ||
        round2(Number(salary.advanceAmount ?? 0)) !== next.advanceAmount ||
        salary.status !== status ||
        !!salary.paidAt !== !!paidAt
      ) {
        await manager.update(
          StaffSalary,
          { id: salary.id },
          {
            deductionAmount: next.deductionAmount as any,
            advanceAmount: next.advanceAmount as any,
            status,
            paidAt,
          },
        );
      }
    }
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
    const view = this.toView(await this.getOwned(id, reqUser));
    // Qaysi oy oyligidan qancha ushlangani — avans saqlangandan keyingi xabar uchun
    const rows: { forMonth: Date; amount: string }[] =
      await this.dataSource.query(
        `SELECT s."forMonth", a."amount" FROM "staff_salary_deductions" a
           JOIN "staff_salaries" s ON s."id" = a."staffSalaryId"
          WHERE a."deductionId" = $1 ORDER BY s."forMonth"`,
        [id],
      );
    return {
      ...view,
      allocations: rows.map((r) => ({
        month: dayjs(r.forMonth).format('YYYY-MM-01'),
        amount: Number(r.amount),
      })),
    };
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
