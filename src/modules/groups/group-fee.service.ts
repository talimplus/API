import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupFeePeriod } from '@/modules/groups/entities/group-fee-period.entity';
import { Group } from '@/modules/groups/entities/groups.entity';
import { dayjs } from '@/shared/utils/dayjs';

/** Oyga bog'langan narx qatori (YYYY-MM-01 + summa). */
export interface FeePeriod {
  fromMonth: string; // YYYY-MM-01
  monthlyFee: number;
}

/** Yangi narx qachon kuchga kirsin. */
export type FeeApplyFrom = 'next_month' | 'current_month';

export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

/**
 * Bitta oy uchun amaldagi narxni tanlaydi.
 *
 * - `fromMonth <= forMonth` bo'lgan eng oxirgi qator;
 * - bunday qator bo'lmasa — eng birinchi qator (guruh tarixidan oldingi oylar);
 * - umuman qator bo'lmasa — `null` (chaqiruvchi `groups.monthlyFee` ga qaytadi).
 */
export function pickFeeForMonth(
  periods: FeePeriod[],
  forMonth: string,
): number | null {
  if (!periods?.length) return null;
  const sorted = [...periods].sort((a, b) =>
    a.fromMonth < b.fromMonth ? -1 : a.fromMonth > b.fromMonth ? 1 : 0,
  );
  let picked: FeePeriod | null = null;
  for (const p of sorted) {
    if (p.fromMonth <= forMonth) picked = p;
    else break;
  }
  return Number((picked ?? sorted[0]).monthlyFee ?? 0);
}

/**
 * Guruh narxini oy aniqligida boshqaradi.
 *
 * BIZNES QOIDA: guruh narxi oy o'rtasida o'zgartirilsa ham, u **keyingi oydan**
 * kuchga kiradi. Joriy va o'tgan oylarning to'lovlari (to'langan ham,
 * to'lanmagan ham) eski narxda qoladi. Xatoni tuzatish kerak bo'lsa — aniq
 * `applyFeeFrom: 'current_month'` yuboriladi.
 *
 * O'quvchining shaxsiy narxi (`students.monthlyFee > 0`) bu logikadan ustun:
 * unday o'quvchi guruh narxini emas, o'z narxini to'laydi (`computeAmountDue`).
 */
@Injectable()
export class GroupFeeService {
  private readonly logger = new Logger(GroupFeeService.name);

  private static readonly CACHE_TTL_MS = 15_000;
  private readonly periodsCache = new Map<
    number,
    { at: number; periods: FeePeriod[] }
  >();

  constructor(
    @InjectRepository(GroupFeePeriod)
    private readonly feeRepo: Repository<GroupFeePeriod>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
  ) {}

  /** Guruh timezone'idagi joriy oy (YYYY-MM-01). */
  currentMonth(timezone?: string | null): string {
    return dayjs()
      .tz(timezone || DEFAULT_TIMEZONE)
      .startOf('month')
      .format('YYYY-MM-01');
  }

  /** Guruh timezone'idagi keyingi oy (YYYY-MM-01). */
  nextMonth(timezone?: string | null): string {
    return dayjs()
      .tz(timezone || DEFAULT_TIMEZONE)
      .add(1, 'month')
      .startOf('month')
      .format('YYYY-MM-01');
  }

  /**
   * Bitta guruhning barcha narx davrlari (oy bo'yicha o'sish tartibida).
   *
   * Massiv qayta hisoblashda har bir to'lov uchun DB'ga bormaslik uchun
   * qisqa muddatli (15s) kesh. Narx o'zgarganda kesh darhol tozalanadi.
   */
  async getPeriods(groupId: number): Promise<FeePeriod[]> {
    const cached = this.periodsCache.get(groupId);
    if (cached && Date.now() - cached.at < GroupFeeService.CACHE_TTL_MS) {
      return cached.periods;
    }

    const periods = await this.loadPeriods(groupId);
    this.periodsCache.set(groupId, { at: Date.now(), periods });
    return periods;
  }

  private async loadPeriods(groupId: number): Promise<FeePeriod[]> {
    const rows = await this.feeRepo.query(
      `SELECT TO_CHAR("fromMonth", 'YYYY-MM-01') AS "fromMonth", "monthlyFee"
         FROM "group_fee_periods"
        WHERE "groupId" = $1
        ORDER BY "fromMonth" ASC`,
      [groupId],
    );
    return (rows ?? []).map((r: any) => ({
      fromMonth: r.fromMonth,
      monthlyFee: Number(r.monthlyFee ?? 0),
    }));
  }

  /**
   * Bitta oy uchun guruh narxi. Tarix bo'lmasa `fallbackFee` qaytadi
   * (migratsiyagacha yaratilgan yoki qo'lda o'chirilgan ma'lumot uchun).
   */
  async resolveFeeForMonth(
    groupId: number,
    forMonth: string,
    fallbackFee: number,
  ): Promise<number> {
    const periods = await this.getPeriods(groupId);
    const picked = pickFeeForMonth(periods, forMonth);
    return picked ?? Number(fallbackFee ?? 0);
  }

  /**
   * Guruh yaratilganda birinchi narx davrini yozadi.
   * `fromMonth` — guruh boshlanish oyi va joriy oydan qaysi biri erta bo'lsa
   * (guruh kelajakda boshlansa ham, bugungi ko'rinish to'g'ri bo'lishi uchun).
   */
  async initFeeForGroup(group: Group): Promise<void> {
    const timezone = group.timezone || DEFAULT_TIMEZONE;
    const startMonth = group.startDate
      ? dayjs(group.startDate).startOf('month').format('YYYY-MM-01')
      : this.currentMonth(timezone);
    const current = this.currentMonth(timezone);
    const fromMonth = startMonth < current ? startMonth : current;

    await this.upsertPeriod(group.id, fromMonth, Number(group.monthlyFee ?? 0));
  }

  /**
   * Guruh narxini belgilaydi.
   *
   * - `next_month` (default) — narx keyingi oydan kuchga kiradi, joriy oy
   *   to'lovlariga tegilmaydi;
   * - `current_month` — xatoni tuzatish uchun: narx shu oydan kuchga kiradi
   *   va rejalashtirilgan kelgusi o'zgarishlar bekor qilinadi;
   * - yangi narx joriy amaldagi narx bilan bir xil bo'lsa — rejalashtirilgan
   *   kelgusi o'zgarish bekor qilinadi (admin fikridan qaytdi).
   *
   * @returns `effectiveFrom` — narx kuchga kiradigan oy (o'zgarish bo'lmasa null),
   *          `appliedNow` — joriy oy to'lovlari qayta hisoblanishi kerakmi.
   */
  async setFee(
    group: Group,
    monthlyFee: number,
    applyFrom: FeeApplyFrom = 'next_month',
  ): Promise<{ effectiveFrom: string | null; appliedNow: boolean }> {
    const timezone = group.timezone || DEFAULT_TIMEZONE;
    const current = this.currentMonth(timezone);
    const fee = Number(monthlyFee ?? 0);

    // Qaror keshdan emas, DB'dagi eng so'nggi holatdan chiqadi.
    const periods = await this.loadPeriods(group.id);
    const currentFee =
      pickFeeForMonth(periods, current) ?? Number(group.monthlyFee ?? 0);

    // Kelgusi (hali kuchga kirmagan) rejalashtirilgan o'zgarishlar.
    const hasFuture = periods.some((p) => p.fromMonth > current);

    if (fee === currentFee) {
      // Narx aslida o'zgarmayapti — faqat rejani bekor qilamiz.
      if (hasFuture) await this.clearFuturePeriods(group.id, current);
      group.monthlyFee = currentFee;
      return { effectiveFrom: null, appliedNow: false };
    }

    if (applyFrom === 'current_month') {
      await this.clearFuturePeriods(group.id, current);
      await this.upsertPeriod(group.id, current, fee);
      await this.groupRepo.update({ id: group.id }, { monthlyFee: fee as any });
      group.monthlyFee = fee;
      return { effectiveFrom: current, appliedNow: true };
    }

    const from = this.nextMonth(timezone);
    await this.clearFuturePeriods(group.id, current);
    await this.upsertPeriod(group.id, from, fee);
    // groups.monthlyFee — joriy oy narxi; u keyingi oy boshida ko'chiriladi.
    group.monthlyFee = currentFee;
    return { effectiveFrom: from, appliedNow: false };
  }

  /**
   * Guruhlarga kelgusi narx ma'lumotini biriktiradi va muddati kelgan
   * narxlarni `groups.monthlyFee` ga ko'chiradi (lazy aktivatsiya).
   */
  async attachFeeInfo<T extends Group>(groups: T[]): Promise<T[]> {
    const list = (groups ?? []).filter(Boolean);
    if (!list.length) return groups;

    const ids = Array.from(new Set(list.map((g) => g.id).filter(Boolean)));
    if (!ids.length) return groups;

    const activated = await this.activateDueFeePeriods(ids);
    const upcoming = await this.getUpcoming(ids);

    for (const g of list) {
      const fresh = activated.get(g.id);
      if (fresh !== undefined) g.monthlyFee = fresh;

      const next = upcoming.get(g.id);
      const isRealChange =
        next && Number(next.monthlyFee) !== Number(g.monthlyFee ?? 0);
      (g as any).upcomingMonthlyFee = isRealChange ? next.monthlyFee : null;
      (g as any).upcomingFeeFromMonth = isRealChange ? next.fromMonth : null;
    }

    return groups;
  }

  /** Kelgusi oylardagi eng yaqin narx o'zgarishi (guruh bo'yicha). */
  async getUpcoming(
    groupIds: number[],
  ): Promise<Map<number, { monthlyFee: number; fromMonth: string }>> {
    const map = new Map<number, { monthlyFee: number; fromMonth: string }>();
    if (!groupIds?.length) return map;

    const rows = await this.feeRepo.query(
      `SELECT DISTINCT ON (f."groupId")
              f."groupId" AS "groupId",
              f."monthlyFee" AS "monthlyFee",
              TO_CHAR(f."fromMonth", 'YYYY-MM-01') AS "fromMonth"
         FROM "group_fee_periods" f
         JOIN "groups" g ON g."id" = f."groupId"
        WHERE f."groupId" = ANY($1::int[])
          AND f."fromMonth" > DATE_TRUNC(
                'month',
                (NOW() AT TIME ZONE COALESCE(g."timezone", '${DEFAULT_TIMEZONE}'))::date
              )::date
        ORDER BY f."groupId", f."fromMonth" ASC`,
      [groupIds],
    );

    for (const r of rows ?? []) {
      map.set(Number(r.groupId), {
        monthlyFee: Number(r.monthlyFee ?? 0),
        fromMonth: r.fromMonth,
      });
    }
    return map;
  }

  /**
   * Muddati kelgan narx davrlarini `groups.monthlyFee` ga ko'chiradi.
   * To'lovlar baribir tarixdan hisoblanadi — bu faqat ko'rsatish uchun.
   *
   * @returns o'zgargan guruhlar: id -> yangi narx
   */
  async activateDueFeePeriods(
    groupIds?: number[],
  ): Promise<Map<number, number>> {
    const scoped = groupIds?.length ? groupIds : null;
    const rows = await this.groupRepo.query(
      `
      UPDATE "groups" g
         SET "monthlyFee" = due."monthlyFee"
        FROM (
          SELECT DISTINCT ON (f."groupId") f."groupId", f."monthlyFee"
            FROM "group_fee_periods" f
            JOIN "groups" gg ON gg."id" = f."groupId"
           WHERE f."fromMonth" <= DATE_TRUNC(
                   'month',
                   (NOW() AT TIME ZONE COALESCE(gg."timezone", '${DEFAULT_TIMEZONE}'))::date
                 )::date
             AND ($1::int[] IS NULL OR f."groupId" = ANY($1::int[]))
           ORDER BY f."groupId", f."fromMonth" DESC
        ) due
       WHERE g."id" = due."groupId"
         AND g."monthlyFee" IS DISTINCT FROM due."monthlyFee"
      RETURNING g."id" AS "id", g."monthlyFee" AS "monthlyFee"
      `,
      [scoped],
    );

    const map = new Map<number, number>();
    for (const r of rows ?? [])
      map.set(Number(r.id), Number(r.monthlyFee ?? 0));
    return map;
  }

  /**
   * Har kuni 00:05 da muddati kelgan narxlarni aktivlashtiradi.
   * (To'lovlar tarixdan hisoblangani uchun bu kechiksa ham hisob buzilmaydi.)
   */
  @Cron('5 0 * * *')
  async activateDueFeePeriodsDaily() {
    const changed = await this.activateDueFeePeriods();
    if (changed.size) {
      this.logger.log(
        `Yangi narx kuchga kirdi: ${Array.from(changed.keys()).join(', ')}`,
      );
    }
  }

  /** Bir oy uchun narx qatorini yozadi/yangilaydi. */
  private async upsertPeriod(
    groupId: number,
    fromMonth: string,
    monthlyFee: number,
  ): Promise<void> {
    await this.feeRepo.query(
      `INSERT INTO "group_fee_periods" ("groupId", "fromMonth", "monthlyFee")
       VALUES ($1, $2::date, $3)
       ON CONFLICT ("groupId", "fromMonth")
       DO UPDATE SET "monthlyFee" = EXCLUDED."monthlyFee"`,
      [groupId, fromMonth, monthlyFee],
    );
    this.periodsCache.delete(groupId);
  }

  /** Hali kuchga kirmagan (kelgusi oylardagi) narx rejalarini o'chiradi. */
  private async clearFuturePeriods(
    groupId: number,
    currentMonth: string,
  ): Promise<void> {
    await this.feeRepo.query(
      `DELETE FROM "group_fee_periods"
        WHERE "groupId" = $1 AND "fromMonth" > $2::date`,
      [groupId, currentMonth],
    );
    this.periodsCache.delete(groupId);
  }
}
