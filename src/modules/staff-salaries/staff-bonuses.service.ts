import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import { User } from '@/modules/users/entities/user.entity';
import { StaffSalary } from '@/modules/staff-salaries/entities/staff-salary.entity';
import { StaffBonus } from '@/modules/staff-salaries/entities/staff-bonus.entity';
import { StaffSalaryStatus } from '@/modules/staff-salaries/enums/staff-salary-status.enum';
import { CreateStaffBonusDto } from '@/modules/staff-salaries/dto/create-staff-adjustment.dto';
import { round2, salaryNet } from '@/modules/staff-salaries/salary-math';
import { StaffDeductionsService } from '@/modules/staff-salaries/staff-deductions.service';

/**
 * Xodimga mukofot. Oylik qatoriga `bonusAmount` sifatida qo'shiladi va oylik
 * bilan birga beriladi. Oylik qatori hali yo'q oy uchun (masalan yangi oy)
 * `StaffSalariesService.ensureSalariesForMonth` qatorni yaratganda yig'indini
 * o'zi qo'yadi — shuning uchun bu yerda faqat mavjud qator yangilanadi.
 */
@Injectable()
export class StaffBonusesService {
  constructor(
    @InjectRepository(StaffBonus)
    private readonly bonusRepo: Repository<StaffBonus>,
    @InjectRepository(StaffSalary)
    private readonly salaryRepo: Repository<StaffSalary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly deductionsService: StaffDeductionsService,
  ) {}

  async create(dto: CreateStaffBonusDto, reqUser: any) {
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
      throw new BadRequestException('Summa 0 dan katta bo‘lishi kerak');
    }
    const forMonth = this.normalizeMonth(dto.forMonth);

    const saved = await this.bonusRepo.save(
      this.bonusRepo.create({
        userId: user.id,
        centerId: (user as any).center?.id ?? null,
        organizationId: reqUser.organizationId,
        forMonth: forMonth as any,
        amount: amount as any,
        reason: dto.reason.trim(),
        createdById: reqUser.userId ?? null,
      }),
    );
    await this.syncSalary(user.id, forMonth);
    return this.findOne(saved.id, reqUser);
  }

  /**
   * Mukofotni bekor qiladi. Mukofot oylik bilan BERIB bo'lingan bo'lsa
   * (bekor qilinsa to'langan summa qo'lga tegadigan summadan oshib ketadi) —
   * 400: pul xodimda, uni qaytarib olish alohida masala.
   */
  async remove(id: number, reqUser: any) {
    const bonus = await this.getOwned(id, reqUser);
    const forMonth = dayjs(bonus.forMonth).format('YYYY-MM-DD');
    const salary = await this.salaryRepo.findOne({
      where: { userId: bonus.userId, forMonth: forMonth as any },
    });
    if (salary) {
      const nextNet = salaryNet({
        ...salary,
        bonusAmount: Number(salary.bonusAmount ?? 0) - Number(bonus.amount),
      });
      if (Number(salary.paidAmount ?? 0) > nextNet) {
        throw new BadRequestException(
          'Bu mukofot oylik bilan berib bo‘lingan — bekor qilib bo‘lmaydi',
        );
      }
    }
    await this.bonusRepo.delete({ id: bonus.id });
    await this.syncSalary(bonus.userId, forMonth);
    return { success: true };
  }

  /** Oy mukofotlari yig'indisini oylik qatoriga yozadi va holatni yangilaydi. */
  async syncSalary(userId: number, forMonth: string): Promise<void> {
    const salary = await this.salaryRepo.findOne({
      where: { userId, forMonth: forMonth as any },
    });
    if (!salary) return;
    const total = (await this.sumMap([userId], forMonth)).get(userId) ?? 0;
    if (Number(salary.bonusAmount ?? 0) === total) return;

    salary.bonusAmount = total as any;
    const net = salaryNet(salary);
    const paid = Number(salary.paidAmount ?? 0);
    salary.status =
      paid >= net
        ? StaffSalaryStatus.PAID
        : paid > 0
          ? StaffSalaryStatus.PARTIAL
          : StaffSalaryStatus.UNPAID;
    salary.paidAt = paid >= net ? (salary.paidAt ?? new Date()) : null;
    await this.salaryRepo.update(
      { id: salary.id },
      {
        bonusAmount: total as any,
        status: salary.status,
        paidAt: salary.paidAt ?? null,
      },
    );
    // Mukofot kamaysa — undan ushlangan avans/jarima ortig'i qaytadi;
    // ko'paysa — ochiq avans/jarima undan ushlanadi.
    await this.deductionsService.releaseExcess(salary);
    await this.deductionsService.applyOutstanding(salary);
  }

  /** Xodimlarning shu oy mukofotlari yig'indisi (ro'yxat uchun bitta so'rov). */
  async sumMap(userIds: number[], forMonth: string) {
    const result = new Map<number, number>();
    if (!userIds.length) return result;
    const rows = await this.bonusRepo
      .createQueryBuilder('b')
      .select('b."userId"', 'userId')
      .addSelect('COALESCE(SUM(b."amount"), 0)', 'total')
      .where({ userId: In(userIds), forMonth: forMonth as any })
      .groupBy('b."userId"')
      .getRawMany<{ userId: number; total: string }>();
    for (const r of rows) result.set(Number(r.userId), round2(Number(r.total)));
    return result;
  }

  async listForUser(userId: number, reqUser: any) {
    const rows = await this.bonusRepo.find({
      where: { userId, organizationId: reqUser.organizationId },
      relations: ['createdBy'],
      order: { forMonth: 'DESC', id: 'DESC' },
    });
    return rows.map((r) => this.toView(r));
  }

  async findOne(id: number, reqUser: any) {
    return this.toView(await this.getOwned(id, reqUser));
  }

  private async getOwned(id: number, reqUser: any): Promise<StaffBonus> {
    const row = await this.bonusRepo.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!row) throw new NotFoundException('Mukofot topilmadi');
    if (row.organizationId !== reqUser.organizationId) {
      throw new ForbiddenException('Bu yozuvga ruxsatingiz yo‘q');
    }
    return row;
  }

  /** Ish oyi; kelajak oy emas (oylik qatori faqat joriy oygacha bor). */
  private normalizeMonth(forMonth?: string): string {
    const ym = forMonth?.trim() || dayjs().format('YYYY-MM');
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      throw new BadRequestException(
        'forMonth YYYY-MM ko‘rinishida bo‘lishi kerak',
      );
    }
    if (ym > dayjs().format('YYYY-MM')) {
      throw new BadRequestException('Mukofot kelajak oy oyligiga yozilmaydi');
    }
    return `${ym}-01`;
  }

  private toView(row: StaffBonus) {
    return {
      id: row.id,
      userId: row.userId,
      amount: Number(row.amount ?? 0),
      reason: row.reason,
      forMonth: dayjs(row.forMonth).format('YYYY-MM-DD'),
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
