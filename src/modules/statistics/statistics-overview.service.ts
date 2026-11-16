import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dayjs } from '@/shared/utils/dayjs';
import {
  CENTER_SCOPE,
  EXPENSE_DAY,
  RECEIPT_DAY,
  ROW_PENDING,
  STATS_TIMEZONE,
  num,
  resolveDayRange,
  resolveStatsCenter,
} from '@/modules/statistics/statistics-range.util';

interface RangeQuery {
  centerId?: number;
  fromDate?: string;
  toDate?: string;
}

/**
 * Statistika sahifasi (kun aniqligida). Eski `GET /statistics/dashboard` oy
 * bo'yicha ishlaydi va saqlanadi (eski front); bu servis yangi sahifa uchun.
 *
 * Ikki xil hisob bor va ular aralashtirilmaydi:
 * - **Kassa** (kirim/chiqim) — pul haqiqatan qaysi KUN tushgan/chiqqan:
 *   cheklar, qaytarilgan pul, xarajatlar, oylik va avanslar.
 * - **Oylik to'lovlar** (o'quvchilar qancha to'lashi kerak edi / qarz) —
 *   to'lovlar oyga bog'langan, shuning uchun oraliq TEGADIGAN oylar olinadi.
 */
@Injectable()
export class StatisticsOverviewService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async overview(
    organizationId: number,
    reqCenterId: number | undefined,
    q: RangeQuery,
  ) {
    const centerId = await resolveStatsCenter(
      this.ds,
      organizationId,
      reqCenterId,
      q.centerId,
    );
    const range = resolveDayRange(q.fromDate, q.toDate);
    const day = [organizationId, centerId, range.fromDate, range.toExclusive];
    const month = [
      organizationId,
      centerId,
      range.monthFrom,
      range.monthToExclusive,
    ];

    const [receipts, refunds, expenses, salaries, billing, students] =
      await Promise.all([
        this.ds.query(
          `SELECT COALESCE(r."paymentMethod"::text, 'unknown') AS method, r.status::text AS status,
                COUNT(*)::int AS count, COALESCE(SUM(r.amount), 0) AS amount
           FROM payment_receipts r
           JOIN payments p ON p.id = r."paymentId"
           JOIN students s ON s.id = p."studentId"
           JOIN centers c ON c.id = s."centerId"
          WHERE ${CENTER_SCOPE}
            AND r."transferFromPaymentId" IS NULL
            AND r.status IN ('confirmed', 'pending')
            AND ${RECEIPT_DAY} >= $3::date AND ${RECEIPT_DAY} < $4::date
          GROUP BY 1, 2`,
          day,
        ),
        this.ds.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(p."refundedAmount"), 0) AS amount
           FROM payments p
           JOIN students s ON s.id = p."studentId"
           JOIN centers c ON c.id = s."centerId"
          WHERE ${CENTER_SCOPE} AND p."refundedAmount" > 0
            AND p."refundedAt" >= $3::date AND p."refundedAt" < $4::date`,
          day,
        ),
        this.ds.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount), 0) AS amount
           FROM expenses e
           JOIN centers c ON c.id = e."centerId"
          WHERE ${CENTER_SCOPE}
            AND ${EXPENSE_DAY} >= $3::date AND ${EXPENSE_DAY} < $4::date`,
          day,
        ),
        this.ds.query(
          `SELECT 'salary' AS kind, COUNT(*)::int AS count, COALESCE(SUM(sp.amount), 0) AS amount
           FROM staff_salary_payments sp
           JOIN staff_salaries ss ON ss.id = sp."staffSalaryId"
           JOIN users u ON u.id = ss."userId"
          WHERE u."organizationId" = $1 AND ($2::int IS NULL OR u."centerId" = $2::int)
            AND sp."paidAt" >= $3::date AND sp."paidAt" < $4::date
         UNION ALL
         SELECT 'advance', COUNT(*)::int, COALESCE(SUM(d.amount), 0)
           FROM staff_deductions d
          WHERE d.type = 'advance' AND d."organizationId" = $1
            AND ($2::int IS NULL OR d."centerId" = $2::int)
            AND d."createdAt" >= $3::date AND d."createdAt" < $4::date`,
          day,
        ),
        this.ds.query(
          `WITH rows AS (
           SELECT p."studentId", p."amountDue" AS due, p."amountPaid" AS paid, ${ROW_PENDING} AS pending
             FROM payments p
             JOIN students s ON s.id = p."studentId"
             JOIN centers c ON c.id = s."centerId"
            WHERE ${CENTER_SCOPE} AND p."forMonth" >= $3::date AND p."forMonth" < $4::date)
         SELECT COALESCE(SUM(due), 0) AS due, COALESCE(SUM(paid), 0) AS paid,
                COALESCE(SUM(pending), 0) AS pending,
                COALESCE(SUM(GREATEST(0, due - paid - pending)), 0) AS collectable,
                COUNT(*)::int AS "totalCount",
                COUNT(*) FILTER (WHERE paid >= due)::int AS "paidCount",
                COUNT(*) FILTER (WHERE paid < due AND paid + pending >= due)::int AS "pendingCount",
                COUNT(*) FILTER (WHERE paid > 0 AND paid + pending < due)::int AS "partialCount",
                COUNT(*) FILTER (WHERE paid = 0 AND paid + pending < due)::int AS "unpaidCount",
                COUNT(DISTINCT "studentId") FILTER (WHERE due - paid - pending > 0)::int AS "debtorsCount"
           FROM rows`,
          month,
        ),
        this.ds.query(
          `SELECT COUNT(*) FILTER (WHERE s.status = 'ACTIVE')::int AS active,
                COUNT(*) FILTER (WHERE s."activatedAt" >= $3::date AND s."activatedAt" < $4::date)::int AS started,
                COUNT(*) FILTER (WHERE s."createdAt" >= $3::date AND s."createdAt" < $4::date)::int AS registered,
                COUNT(*) FILTER (WHERE s."stoppedAt" >= $3::date AND s."stoppedAt" < $4::date)::int AS stopped
           FROM students s
           JOIN centers c ON c.id = s."centerId"
          WHERE ${CENTER_SCOPE}`,
          day,
        ),
      ]);

    const confirmed = receipts.filter((r: any) => r.status === 'confirmed');
    const pending = receipts.filter((r: any) => r.status === 'pending');
    const sum = (rows: any[], f = 'amount') =>
      rows.reduce((a, r) => a + num(r[f]), 0);
    const salaryRow = salaries.find((r: any) => r.kind === 'salary');
    const advanceRow = salaries.find((r: any) => r.kind === 'advance');

    const income = { amount: sum(confirmed), count: sum(confirmed, 'count') };
    const refund = {
      amount: num(refunds[0]?.amount),
      count: num(refunds[0]?.count),
    };
    const expense = {
      amount: num(expenses[0]?.amount),
      count: num(expenses[0]?.count),
    };
    const salary = {
      amount: num(salaryRow?.amount) + num(advanceRow?.amount),
      count: num(salaryRow?.count) + num(advanceRow?.count),
      salaryAmount: num(salaryRow?.amount),
      advanceAmount: num(advanceRow?.amount),
    };
    const b = billing[0] ?? {};
    const st = students[0] ?? {};

    return {
      centerId,
      fromDate: range.fromDate,
      toDate: range.toDate,
      /** Oylik to'lovlar bloki qaysi oylarni ko'rsatyapti (`YYYY-MM`). */
      billingFromMonth: range.monthFrom.slice(0, 7),
      billingToMonth: dayjs(range.monthToExclusive)
        .subtract(1, 'month')
        .format('YYYY-MM'),
      income: {
        ...income,
        byMethod: confirmed.map((r: any) => ({
          method: r.method,
          amount: num(r.amount),
          count: num(r.count),
        })),
      },
      pending: { amount: sum(pending), count: sum(pending, 'count') },
      refunds: refund,
      expenses: expense,
      salaries: salary,
      /** Kassada qolgan: kirim − qaytarilgan − xarajat − oylik/avans. */
      balance: income.amount - refund.amount - expense.amount - salary.amount,
      billing: {
        amountDue: num(b.due),
        amountPaid: num(b.paid),
        pendingAmount: num(b.pending),
        collectableAmount: num(b.collectable),
        totalCount: num(b.totalCount),
        paidCount: num(b.paidCount),
        pendingCount: num(b.pendingCount),
        partialCount: num(b.partialCount),
        unpaidCount: num(b.unpaidCount),
        debtorsCount: num(b.debtorsCount),
      },
      students: {
        active: num(st.active),
        started: num(st.started),
        registered: num(st.registered),
        stopped: num(st.stopped),
      },
    };
  }

  /**
   * Oxirgi N oy (joriy oy bilan) — grafik uchun. Sahifadagi sana filtriga
   * bog'liq emas.
   * - `income` — shu oyda kassaga tushgan pul (tasdiqlangan cheklar);
   * - `charged` — shu oy uchun o'quvchilar to'lashi kerak bo'lgan pul;
   * - `students` — shu oyda kamida bir kun guruhda o'qigan o'quvchilar;
   * - `started` / `stopped` — o'qishni boshlagan / to'xtatganlar.
   */
  async trend(
    organizationId: number,
    reqCenterId: number | undefined,
    q: { centerId?: number; months?: number },
  ) {
    const months = Number(q.months ?? 6);
    if (![3, 6, 12, 24].includes(months)) {
      throw new BadRequestException("months 3, 6, 12 yoki 24 bo'lishi kerak");
    }
    const centerId = await resolveStatsCenter(
      this.ds,
      organizationId,
      reqCenterId,
      q.centerId,
    );
    const last = dayjs().tz(STATS_TIMEZONE).startOf('month');
    const first = last.subtract(months - 1, 'month');
    const rows = await this.ds.query(
      `WITH m AS (
         SELECT gs::date AS month, (gs + interval '1 month')::date AS next
           FROM generate_series($3::date, $4::date, interval '1 month') gs)
       SELECT TO_CHAR(m.month, 'YYYY-MM') AS month,
         (SELECT COALESCE(SUM(r.amount), 0) FROM payment_receipts r
            JOIN payments p ON p.id = r."paymentId"
            JOIN students s ON s.id = p."studentId"
            JOIN centers c ON c.id = s."centerId"
           WHERE ${CENTER_SCOPE} AND r.status = 'confirmed' AND r."transferFromPaymentId" IS NULL
             AND ${RECEIPT_DAY} >= m.month AND ${RECEIPT_DAY} < m.next) AS income,
         (SELECT COALESCE(SUM(p."amountDue"), 0) FROM payments p
            JOIN students s ON s.id = p."studentId"
            JOIN centers c ON c.id = s."centerId"
           WHERE ${CENTER_SCOPE} AND p."forMonth" = m.month) AS charged,
         (SELECT COUNT(DISTINCT en."studentId") FROM student_group_enrollments en
            JOIN students s ON s.id = en."studentId"
            JOIN centers c ON c.id = s."centerId"
           WHERE ${CENTER_SCOPE} AND s.status NOT IN ('new', 'ignored')
             AND COALESCE(s."activatedAt", s."createdAt") < m.next
             AND en."joinedAt" < m.next AND (en."leftAt" IS NULL OR en."leftAt" > m.month)) AS students,
         (SELECT COUNT(*) FROM students s JOIN centers c ON c.id = s."centerId"
           WHERE ${CENTER_SCOPE} AND s."activatedAt" >= m.month AND s."activatedAt" < m.next) AS started,
         (SELECT COUNT(*) FROM students s JOIN centers c ON c.id = s."centerId"
           WHERE ${CENTER_SCOPE} AND s."stoppedAt" >= m.month AND s."stoppedAt" < m.next) AS stopped
       FROM m ORDER BY m.month`,
      [
        organizationId,
        centerId,
        first.format('YYYY-MM-DD'),
        last.format('YYYY-MM-DD'),
      ],
    );
    return {
      centerId,
      months,
      points: rows.map((r: any) => ({
        month: r.month,
        income: num(r.income),
        charged: num(r.charged),
        students: num(r.students),
        started: num(r.started),
        stopped: num(r.stopped),
      })),
    };
  }
}
