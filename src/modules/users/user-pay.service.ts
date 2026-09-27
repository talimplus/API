import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPayPeriod } from '@/modules/users/entities/user-pay-period.entity';
import { dayjs } from '@/shared/utils/dayjs';

export interface UserPayValue {
  salary: number;
  commissionPercentage: number;
}

interface PayPeriod extends UserPayValue {
  fromMonth: string; // YYYY-MM-01
}

const TZ = 'Asia/Tashkent';

/**
 * Xodim oyligi va komissiya foizini oy aniqligida boshqaradi.
 *
 * BIZNES QOIDA: foiz (yoki oylik) o'zgartirilgan OYDAN boshlab yangi qiymat
 * amal qiladi. Masalan iyulda 40% → 50%: may/iyun uchun keyin tushgan
 * o'quvchi puli ham 40% dan, iyul to'lovlaridan boshlab 50%.
 */
@Injectable()
export class UserPayService {
  constructor(
    @InjectRepository(UserPayPeriod)
    private readonly repo: Repository<UserPayPeriod>,
  ) {}

  currentMonth(): string {
    return dayjs().tz(TZ).startOf('month').format('YYYY-MM-01');
  }

  async getPeriods(userId: number): Promise<PayPeriod[]> {
    const rows = await this.repo.query(
      `SELECT TO_CHAR("fromMonth", 'YYYY-MM-01') AS "fromMonth",
              "salary", "commissionPercentage"
         FROM "user_pay_periods" WHERE "userId" = $1
        ORDER BY "fromMonth" ASC`,
      [userId],
    );
    return (rows ?? []).map((r: any) => ({
      fromMonth: r.fromMonth,
      salary: Number(r.salary ?? 0),
      commissionPercentage: Number(r.commissionPercentage ?? 0),
    }));
  }

  /** Oy uchun amaldagi oylik va foiz. */
  async getForMonth(
    user: {
      id: number;
      salary?: number | null;
      commissionPercentage?: number | null;
    },
    month: string, // YYYY-MM-01
  ): Promise<UserPayValue> {
    const periods = await this.getPeriods(user.id);
    if (!periods.length) {
      return {
        salary: Number(user.salary ?? 0),
        commissionPercentage: Number(user.commissionPercentage ?? 0),
      };
    }
    let picked = periods[0];
    for (const p of periods) {
      if (p.fromMonth <= month) picked = p;
      else break;
    }
    return {
      salary: picked.salary,
      commissionPercentage: picked.commissionPercentage,
    };
  }

  /**
   * Oylik/foiz o'zgarishini tarixga yozadi (shu oydan kuchga kiradi).
   * @returns kuchga kirgan oy yoki null (o'zgarish yo'q).
   */
  async recordChange(
    userId: number,
    previous: UserPayValue,
    next: UserPayValue,
  ): Promise<string | null> {
    if (
      previous.salary === next.salary &&
      previous.commissionPercentage === next.commissionPercentage
    ) {
      return null;
    }
    const from = this.currentMonth();
    const periods = await this.getPeriods(userId);
    if (!periods.length) {
      // Birinchi o'zgarish: eski qiymat oldingi oylar uchun tarixga yoziladi.
      await this.upsert(userId, {
        fromMonth: dayjs(from).subtract(1, 'month').format('YYYY-MM-01'),
        ...previous,
      });
    }
    await this.repo.query(
      `DELETE FROM "user_pay_periods" WHERE "userId" = $1 AND "fromMonth" > $2::date`,
      [userId, from],
    );
    await this.upsert(userId, { fromMonth: from, ...next });
    return from;
  }

  private async upsert(userId: number, p: PayPeriod): Promise<void> {
    await this.repo.query(
      `INSERT INTO "user_pay_periods" ("userId", "fromMonth", "salary", "commissionPercentage")
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT ("userId", "fromMonth")
       DO UPDATE SET "salary" = EXCLUDED."salary",
                     "commissionPercentage" = EXCLUDED."commissionPercentage"`,
      [userId, p.fromMonth, p.salary, p.commissionPercentage],
    );
  }
}
