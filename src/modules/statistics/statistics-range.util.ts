import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';

export const STATS_TIMEZONE = 'Asia/Tashkent';

/** Kunlar oralig'i: `from` (inclusive) … `toExclusive`, ikkalasi `YYYY-MM-DD`. */
export interface DayRange {
  fromDate: string;
  toDate: string;
  toExclusive: string;
  /** Oraliq tegadigan oylar: birinchi oy boshi … oxirgi oydan keyingi oy boshi. */
  monthFrom: string;
  monthToExclusive: string;
}

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Sana oralig'ini tekshiradi. Berilmasa — joriy oy (Toshkent vaqti bilan):
 * 1-sanadan oyning oxirgi kunigacha. Ikkala chegara ham **inclusive**.
 */
export function resolveDayRange(fromDate?: string, toDate?: string): DayRange {
  const now = dayjs().tz(STATS_TIMEZONE);
  const parse = (v: string | undefined, field: string) => {
    if (!v) return null;
    if (!DAY_RE.test(v) || !dayjs(v).isValid()) {
      throw new BadRequestException(
        `${field} YYYY-MM-DD formatida bo'lishi kerak`,
      );
    }
    return dayjs(v);
  };
  const from = parse(fromDate, 'fromDate') ?? now.startOf('month');
  const to = parse(toDate, 'toDate') ?? (fromDate ? from : now.endOf('month'));
  if (to.isBefore(from, 'day')) {
    throw new BadRequestException(
      "toDate fromDate dan oldin bo'lishi mumkin emas",
    );
  }
  if (to.diff(from, 'day') > 366 * 3) {
    throw new BadRequestException("Oraliq 3 yildan uzun bo'lmasin");
  }
  return {
    fromDate: from.format('YYYY-MM-DD'),
    toDate: to.format('YYYY-MM-DD'),
    toExclusive: to.add(1, 'day').format('YYYY-MM-DD'),
    monthFrom: from.startOf('month').format('YYYY-MM-DD'),
    monthToExclusive: to.startOf('month').add(1, 'month').format('YYYY-MM-DD'),
  };
}

/**
 * Filialni tekshiradi. `null` — "Barcha filiallar" (butun tashkilot).
 * Begona tashkilot filiali — 400 (IDOR oldini olish).
 */
export async function resolveStatsCenter(
  ds: DataSource,
  organizationId: number,
  reqCenterId?: number | null,
  queryCenterId?: number,
): Promise<number | null> {
  const centerId = queryCenterId ?? reqCenterId ?? null;
  if (!centerId) return null;
  const rows = await ds.query(
    `SELECT 1 FROM centers WHERE id = $1 AND "organizationId" = $2`,
    [centerId, organizationId],
  );
  if (!rows.length) {
    throw new BadRequestException('centerId is invalid for this organization');
  }
  return centerId;
}

/**
 * Hamma so'rovlarda `$1` = organizationId, `$2` = centerId (yoki NULL).
 * `c` — `centers` aliasi.
 */
export const CENTER_SCOPE = `c."organizationId" = $1 AND ($2::int IS NULL OR c.id = $2::int)`;

/**
 * Pul kassaga tushgan kun: karta uchun reception kiritgan `paidAt`, bo'lmasa
 * qabul qilingan vaqt (to'lovlar sahifasidagi sana filtri bilan bir xil).
 */
export const RECEIPT_DAY = `COALESCE(r."paidAt", COALESCE(r."receivedAt", r."createdAt")::date)`;

/**
 * Xarajat kuni. Xarajat oyga yoziladi (`forMonth`); o'sha oyning ichida
 * kiritilgan bo'lsa — kiritilgan kun, boshqa oy uchun (orqaga/oldinga)
 * kiritilgan bo'lsa — o'sha oyning 1-sanasi. Shunda oy bo'yicha jami eski
 * hisobot bilan bir xil qoladi, kun/hafta bo'yicha ham ma'noli bo'ladi.
 */
export const EXPENSE_DAY = `(CASE WHEN date_trunc('month', e."createdAt")::date = e."forMonth"
  THEN e."createdAt"::date ELSE e."forMonth" END)`;

/** Bitta to'lov qatorining tasdiq kutayotgan cheklari. */
export const ROW_PENDING = `(SELECT COALESCE(SUM(pr.amount), 0) FROM payment_receipts pr
  WHERE pr."paymentId" = p.id AND pr.status = 'pending')`;

export const num = (v: unknown): number => Number(v ?? 0);

export function pageArgs(page?: number, perPage?: number) {
  const size = Math.min(Math.max(Number(perPage) || 20, 1), 200);
  const current = Math.max(Number(page) || 1, 1);
  return { page: current, perPage: size, offset: (current - 1) * size };
}

export function pageMeta(total: number, page: number, perPage: number) {
  return {
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Qidiruv qatori: bo'sh bo'lsa NULL (SQL'da `$n::text IS NULL` bilan o'tkaziladi). */
export function searchArg(search?: string): string | null {
  const v = search?.trim();
  return v ? `%${v.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
}

/** Telefon bo'yicha qidiruv: faqat raqamlar (`97-752` → `%97752%`). */
export function digitsArg(search?: string): string | null {
  const d = (search ?? '').replace(/\D/g, '');
  return d.length >= 3 ? `%${d}%` : null;
}
