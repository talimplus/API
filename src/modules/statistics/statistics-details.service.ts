import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CENTER_SCOPE,
  EXPENSE_DAY,
  RECEIPT_DAY,
  ROW_PENDING,
  digitsArg,
  num,
  pageArgs,
  pageMeta,
  resolveDayRange,
  resolveStatsCenter,
  searchArg,
} from '@/modules/statistics/statistics-range.util';

export enum StatsStudentsKind {
  ACTIVE = 'active',
  STARTED = 'started',
  REGISTERED = 'registered',
  STOPPED = 'stopped',
}

export enum StatsIncomeStatus {
  CONFIRMED = 'confirmed',
  PENDING = 'pending',
}

export interface StatsDetailsQuery {
  centerId?: number;
  fromDate?: string;
  toDate?: string;
  page?: number;
  perPage?: number;
  search?: string;
}

/** Ism-familiya bo'yicha qidiruv (`s` — students aliasi). */
const STUDENT_SEARCH = (n: number) => `($${n}::text IS NULL
  OR CONCAT_WS(' ', s."firstName", s."lastName") ILIKE $${n}
  OR CONCAT_WS(' ', s."lastName", s."firstName") ILIKE $${n}
  OR ($${n + 1}::text IS NOT NULL AND regexp_replace(COALESCE(s.phone, ''), '\\D', '', 'g') LIKE $${n + 1}))`;

/**
 * Statistika bloklarining ichki sahifalari. Har bir ro'yxat aynan o'sha
 * blokdagi raqamni beradigan shart bilan olinadi — `summary` doim blokdagi
 * summaga teng bo'ladi (qidiruvsiz).
 */
@Injectable()
export class StatisticsDetailsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async base(
    organizationId: number,
    reqCenterId: number | undefined,
    q: StatsDetailsQuery,
  ) {
    const centerId = await resolveStatsCenter(
      this.ds,
      organizationId,
      reqCenterId,
      q.centerId,
    );
    const range = resolveDayRange(q.fromDate, q.toDate);
    return { centerId, range, ...pageArgs(q.page, q.perPage) };
  }

  private wrap(
    rows: any[],
    page: number,
    perPage: number,
    map: (r: any) => unknown,
    range: { fromDate: string; toDate: string },
  ) {
    const total = num(rows[0]?.total);
    return {
      fromDate: range.fromDate,
      toDate: range.toDate,
      data: rows.map(map),
      meta: pageMeta(total, page, perPage),
      summary: { count: total, amount: num(rows[0]?.sumAmount) },
    };
  }

  /** Kassaga tushgan pul — cheklar (ko'chirilgan pul emas). */
  async income(
    org: number,
    reqCenter: number | undefined,
    q: StatsDetailsQuery & { status?: StatsIncomeStatus },
  ) {
    const { centerId, range, page, perPage, offset } = await this.base(
      org,
      reqCenter,
      q,
    );
    const status = q.status ?? StatsIncomeStatus.CONFIRMED;
    if (!Object.values(StatsIncomeStatus).includes(status))
      throw new BadRequestException('status');
    const rows = await this.ds.query(
      `SELECT r.id, TO_CHAR(${RECEIPT_DAY}, 'YYYY-MM-DD') AS date, r.amount, r."paymentMethod" AS method,
              r.status, r."invoiceNo", s.id AS "studentId", s."firstName", s."lastName", s.phone,
              g.id AS "groupId", g.name AS "groupName", TO_CHAR(p."forMonth", 'YYYY-MM') AS "forMonth",
              NULLIF(TRIM(CONCAT_WS(' ', u."firstName", u."lastName")), '') AS "receivedBy",
              COUNT(*) OVER()::int AS total, SUM(r.amount) OVER() AS "sumAmount"
         FROM payment_receipts r
         JOIN payments p ON p.id = r."paymentId"
         JOIN students s ON s.id = p."studentId"
         JOIN centers c ON c.id = s."centerId"
         LEFT JOIN groups g ON g.id = p."groupId"
         LEFT JOIN users u ON u.id = r."receivedById"
        WHERE ${CENTER_SCOPE} AND r."transferFromPaymentId" IS NULL AND r.status = $5
          AND ${RECEIPT_DAY} >= $3::date AND ${RECEIPT_DAY} < $4::date
          AND ${STUDENT_SEARCH(6)}
        ORDER BY ${RECEIPT_DAY} DESC, r.id DESC
        LIMIT $8 OFFSET $9`,
      [
        org,
        centerId,
        range.fromDate,
        range.toExclusive,
        status,
        searchArg(q.search),
        digitsArg(q.search),
        perPage,
        offset,
      ],
    );
    return this.wrap(
      rows,
      page,
      perPage,
      (r) => ({
        id: r.id,
        date: r.date,
        amount: num(r.amount),
        method: r.method,
        status: r.status,
        invoiceNo: r.invoiceNo,
        studentId: r.studentId,
        studentName: `${r.lastName ?? ''} ${r.firstName ?? ''}`.trim(),
        phone: r.phone,
        groupId: r.groupId,
        groupName: r.groupName,
        forMonth: r.forMonth,
        receivedBy: r.receivedBy,
      }),
      range,
    );
  }

  async expenses(
    org: number,
    reqCenter: number | undefined,
    q: StatsDetailsQuery,
  ) {
    const { centerId, range, page, perPage, offset } = await this.base(
      org,
      reqCenter,
      q,
    );
    const rows = await this.ds.query(
      `SELECT e.id, TO_CHAR(${EXPENSE_DAY}, 'YYYY-MM-DD') AS date, e.name, e.description, e.amount,
              TO_CHAR(e."forMonth", 'YYYY-MM') AS "forMonth",
              COUNT(*) OVER()::int AS total, SUM(e.amount) OVER() AS "sumAmount"
         FROM expenses e
         JOIN centers c ON c.id = e."centerId"
        WHERE ${CENTER_SCOPE} AND ${EXPENSE_DAY} >= $3::date AND ${EXPENSE_DAY} < $4::date
          AND ($5::text IS NULL OR e.name ILIKE $5 OR e.description ILIKE $5)
        ORDER BY ${EXPENSE_DAY} DESC, e.id DESC
        LIMIT $6 OFFSET $7`,
      [
        org,
        centerId,
        range.fromDate,
        range.toExclusive,
        searchArg(q.search),
        perPage,
        offset,
      ],
    );
    return this.wrap(
      rows,
      page,
      perPage,
      (r) => ({
        id: r.id,
        date: r.date,
        name: r.name,
        description: r.description,
        amount: num(r.amount),
        forMonth: r.forMonth,
      }),
      range,
    );
  }

  /** Xodimlarga berilgan pul: oylik to'lovlari + avanslar. */
  async salaries(
    org: number,
    reqCenter: number | undefined,
    q: StatsDetailsQuery,
  ) {
    const { centerId, range, page, perPage, offset } = await this.base(
      org,
      reqCenter,
      q,
    );
    const rows = await this.ds.query(
      `WITH x AS (
         SELECT 'salary' AS kind, sp.id, sp."paidAt" AS at, sp.amount, sp.comment,
                TO_CHAR(ss."forMonth", 'YYYY-MM') AS "forMonth", u.id AS "userId", u."firstName", u."lastName"
           FROM staff_salary_payments sp
           JOIN staff_salaries ss ON ss.id = sp."staffSalaryId"
           JOIN users u ON u.id = ss."userId"
          WHERE u."organizationId" = $1 AND ($2::int IS NULL OR u."centerId" = $2::int)
            AND sp."paidAt" >= $3::date AND sp."paidAt" < $4::date
         UNION ALL
         SELECT 'advance', d.id, d."createdAt", d.amount, d.reason,
                TO_CHAR(d."sourceForMonth", 'YYYY-MM'), u.id, u."firstName", u."lastName"
           FROM staff_deductions d
           JOIN users u ON u.id = d."userId"
          WHERE d.type = 'advance' AND d."organizationId" = $1
            AND ($2::int IS NULL OR d."centerId" = $2::int)
            AND d."createdAt" >= $3::date AND d."createdAt" < $4::date)
       SELECT x.*, TO_CHAR(x.at, 'YYYY-MM-DD') AS date,
              COUNT(*) OVER()::int AS total, SUM(x.amount) OVER() AS "sumAmount"
         FROM x
        WHERE ($5::text IS NULL OR CONCAT_WS(' ', x."firstName", x."lastName") ILIKE $5
               OR CONCAT_WS(' ', x."lastName", x."firstName") ILIKE $5)
        ORDER BY x.at DESC, x.id DESC
        LIMIT $6 OFFSET $7`,
      [
        org,
        centerId,
        range.fromDate,
        range.toExclusive,
        searchArg(q.search),
        perPage,
        offset,
      ],
    );
    return this.wrap(
      rows,
      page,
      perPage,
      (r) => ({
        kind: r.kind,
        id: r.id,
        date: r.date,
        amount: num(r.amount),
        comment: r.comment,
        forMonth: r.forMonth,
        userId: r.userId,
        fullName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
      }),
      range,
    );
  }

  /** O'quvchilar: hozir o'qiyotganlar / boshlaganlar / yozilganlar / to'xtatganlar. */
  async students(
    org: number,
    reqCenter: number | undefined,
    q: StatsDetailsQuery & { kind?: StatsStudentsKind },
  ) {
    const { centerId, range, page, perPage, offset } = await this.base(
      org,
      reqCenter,
      q,
    );
    const kind = q.kind ?? StatsStudentsKind.STARTED;
    const cond: Record<StatsStudentsKind, { where: string; date: string }> = {
      [StatsStudentsKind.ACTIVE]: {
        where: `s.status = 'ACTIVE'`,
        date: `COALESCE(s."activatedAt", s."createdAt")`,
      },
      [StatsStudentsKind.STARTED]: {
        where: `s."activatedAt" >= $3::date AND s."activatedAt" < $4::date`,
        date: `s."activatedAt"`,
      },
      [StatsStudentsKind.REGISTERED]: {
        where: `s."createdAt" >= $3::date AND s."createdAt" < $4::date`,
        date: `s."createdAt"`,
      },
      [StatsStudentsKind.STOPPED]: {
        where: `s."stoppedAt" >= $3::date AND s."stoppedAt" < $4::date`,
        date: `s."stoppedAt"`,
      },
    };
    const c = cond[kind];
    if (!c) throw new BadRequestException('kind');
    const rows = await this.ds.query(
      `SELECT s.id, s."firstName", s."lastName", s.phone, s.status::text AS status,
              TO_CHAR(${c.date}, 'YYYY-MM-DD') AS date, s."returnLikelihood"::text AS "returnLikelihood",
              (SELECT string_agg(DISTINCT g.name, ', ') FROM student_group_enrollments en
                 JOIN groups g ON g.id = en."groupId"
                WHERE en."studentId" = s.id AND (en."leftAt" IS NULL OR en."leftAt" >= $3::date)) AS groups,
              COUNT(*) OVER()::int AS total, 0 AS "sumAmount"
         FROM students s
         JOIN centers c ON c.id = s."centerId"
        WHERE ${CENTER_SCOPE} AND $4::date IS NOT NULL AND ${c.where} AND ${STUDENT_SEARCH(5)}
        ORDER BY ${c.date} DESC NULLS LAST, s.id DESC
        LIMIT $7 OFFSET $8`,
      [
        org,
        centerId,
        range.fromDate,
        range.toExclusive,
        searchArg(q.search),
        digitsArg(q.search),
        perPage,
        offset,
      ],
    );
    return {
      kind,
      ...this.wrap(
        rows,
        page,
        perPage,
        (r) => ({
          id: r.id,
          fullName: `${r.lastName ?? ''} ${r.firstName ?? ''}`.trim(),
          phone: r.phone,
          status: r.status,
          date: r.date,
          returnLikelihood: r.returnLikelihood,
          groups: r.groups,
        }),
        range,
      ),
    };
  }

  /** Oraliq tegadigan oylar uchun hali yig'ilmagan pul (qarzdorlar). */
  async debts(
    org: number,
    reqCenter: number | undefined,
    q: StatsDetailsQuery,
  ) {
    const { centerId, range, page, perPage, offset } = await this.base(
      org,
      reqCenter,
      q,
    );
    const rows = await this.ds.query(
      `WITH x AS (
         SELECT p.id, p."studentId", p."groupId", p."forMonth", p."amountDue" AS due,
                p."amountPaid" AS paid, ${ROW_PENDING} AS pending
           FROM payments p
           JOIN students s ON s.id = p."studentId"
           JOIN centers c ON c.id = s."centerId"
          WHERE ${CENTER_SCOPE} AND p."forMonth" >= $3::date AND p."forMonth" < $4::date
            AND ${STUDENT_SEARCH(5)})
       SELECT x.id, x."studentId", s."firstName", s."lastName", s.phone, s.status::text AS status,
              g.name AS "groupName", x."groupId", TO_CHAR(x."forMonth", 'YYYY-MM') AS "forMonth",
              x.due, x.paid, x.pending, (x.due - x.paid - x.pending) AS debt,
              COUNT(*) OVER()::int AS total, SUM(x.due - x.paid - x.pending) OVER() AS "sumAmount"
         FROM x
         JOIN students s ON s.id = x."studentId"
         LEFT JOIN groups g ON g.id = x."groupId"
        WHERE x.due - x.paid - x.pending > 0
        ORDER BY debt DESC, x.id
        LIMIT $7 OFFSET $8`,
      [
        org,
        centerId,
        range.monthFrom,
        range.monthToExclusive,
        searchArg(q.search),
        digitsArg(q.search),
        perPage,
        offset,
      ],
    );
    return this.wrap(
      rows,
      page,
      perPage,
      (r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: `${r.lastName ?? ''} ${r.firstName ?? ''}`.trim(),
        phone: r.phone,
        status: r.status,
        groupId: r.groupId,
        groupName: r.groupName,
        forMonth: r.forMonth,
        amountDue: num(r.due),
        amountPaid: num(r.paid),
        pendingAmount: num(r.pending),
        debt: num(r.debt),
      }),
      range,
    );
  }
}
